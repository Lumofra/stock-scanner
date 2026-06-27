"""
Polygon.io (Massive.com) REST client.
Handles: float data, previous close, historical bars, news.
"""
import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import mean

import httpx

from config import POLYGON_API_KEY, RELVOL_HISTORY_DAYS, MAX_FLOAT
from scanner.stock_state import STOCKS, StockState

log = logging.getLogger(__name__)

BASE_URL = "https://api.polygon.io"
ET = timezone(timedelta(hours=-4))  # EDT; adjust -5 for EST (Nov-Mar)

_http: httpx.AsyncClient | None = None


def get_client() -> httpx.AsyncClient:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(
            base_url=BASE_URL,
            headers={"Authorization": f"Bearer {POLYGON_API_KEY}"},
            timeout=30.0,
        )
    return _http


async def close_client():
    global _http
    if _http:
        await _http.aclose()
        _http = None


# ---------------------------------------------------------------------------
# Float data
# ---------------------------------------------------------------------------

async def load_float_data() -> int:
    """
    Fetch all NASDAQ tickers with free float < MAX_FLOAT.
    Populates STOCKS with float_shares. Returns count loaded.
    """
    client = get_client()
    loaded = 0
    url = "/vX/stocks/float"
    params = {
        "free_float.lt": MAX_FLOAT,
        "limit": 5000,
    }

    while url:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
        for item in data.get("results", []):
            ticker = item["ticker"]
            float_val = item.get("free_float")
            if not float_val:
                continue
            if ticker not in STOCKS:
                STOCKS[ticker] = StockState(ticker=ticker)
            STOCKS[ticker].float_shares = int(float_val)
            loaded += 1

        next_url = data.get("next_url")
        if next_url:
            url = next_url.replace(BASE_URL, "")
            params = {}
        else:
            break

    log.info(f"Loaded float data for {loaded} tickers")
    return loaded


# ---------------------------------------------------------------------------
# Previous close (for price change %)
# ---------------------------------------------------------------------------

async def load_prev_closes(tickers: list[str]):
    """Fetch previous day close for all given tickers in batches."""
    client = get_client()
    yesterday = (datetime.now(ET) - timedelta(days=1)).strftime("%Y-%m-%d")

    async def fetch_one(ticker: str):
        try:
            resp = await client.get(f"/v2/aggs/ticker/{ticker}/range/1/day/{yesterday}/{yesterday}")
            resp.raise_for_status()
            results = resp.json().get("results", [])
            if results and ticker in STOCKS:
                STOCKS[ticker].prev_close = results[-1]["c"]
        except Exception as e:
            log.warning(f"prev_close fetch failed for {ticker}: {e}")

    # Run in batches of 50 to avoid overwhelming the API
    for i in range(0, len(tickers), 50):
        batch = tickers[i : i + 50]
        await asyncio.gather(*[fetch_one(t) for t in batch])
        await asyncio.sleep(0.2)


# ---------------------------------------------------------------------------
# Historical 1-minute bars for relative volume calculation
# ---------------------------------------------------------------------------

async def load_avg_intraday_volumes(tickers: list[str]):
    """
    For each ticker, fetch RELVOL_HISTORY_DAYS of 1-min bars and compute
    average volume at each minute of the extended trading day.
    Stores result in StockState.avg_by_minute.
    """
    client = get_client()
    to_date = (datetime.now(ET) - timedelta(days=1)).strftime("%Y-%m-%d")
    from_date = (datetime.now(ET) - timedelta(days=RELVOL_HISTORY_DAYS + 5)).strftime("%Y-%m-%d")

    async def fetch_one(ticker: str):
        try:
            resp = await client.get(
                f"/v2/aggs/ticker/{ticker}/range/1/minute/{from_date}/{to_date}",
                params={"adjusted": "true", "sort": "asc", "limit": 50000},
            )
            resp.raise_for_status()
            results = resp.json().get("results", [])

            by_minute: dict[int, list[int]] = defaultdict(list)
            for bar in results:
                ts = datetime.fromtimestamp(bar["t"] / 1000, tz=ET)
                # Minutes since 4:00am ET (pre-market open)
                minute_of_day = (ts.hour - 4) * 60 + ts.minute
                if 0 <= minute_of_day < 480:  # 4am to 12pm ET window
                    by_minute[minute_of_day].append(bar["v"])

            if ticker in STOCKS and by_minute:
                STOCKS[ticker].avg_by_minute = {
                    m: mean(vols) for m, vols in by_minute.items()
                }
        except Exception as e:
            log.warning(f"avg_volume fetch failed for {ticker}: {e}")

    log.info(f"Loading historical volume averages for {len(tickers)} tickers...")
    for i in range(0, len(tickers), 20):
        batch = tickers[i : i + 20]
        await asyncio.gather(*[fetch_one(t) for t in batch])
        await asyncio.sleep(0.5)
    log.info("Historical volume averages loaded")


# ---------------------------------------------------------------------------
# Historical bars for chart initialization
# ---------------------------------------------------------------------------

async def get_bars(ticker: str, multiplier: int, timespan: str, from_date: str, to_date: str) -> list[dict]:
    """Return OHLCV bars for a ticker as list of dicts ready for Lightweight Charts."""
    client = get_client()
    try:
        resp = await client.get(
            f"/v2/aggs/ticker/{ticker}/range/{multiplier}/{timespan}/{from_date}/{to_date}",
            params={"adjusted": "true", "sort": "asc", "limit": 50000},
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])
        return [
            {
                "time": r["t"] // 1000,
                "open": r["o"],
                "high": r["h"],
                "low": r["l"],
                "close": r["c"],
                "volume": r["v"],
            }
            for r in results
        ]
    except Exception as e:
        log.error(f"get_bars failed for {ticker}: {e}")
        return []


# ---------------------------------------------------------------------------
# News
# ---------------------------------------------------------------------------

async def check_news_for_tickers(tickers: list[str]) -> dict[str, bool]:
    """
    Return {ticker: True} for tickers that have news published today.
    """
    client = get_client()
    today = datetime.now(ET).strftime("%Y-%m-%d")
    result: dict[str, bool] = {}

    async def fetch_one(ticker: str):
        try:
            resp = await client.get(
                "/v2/reference/news",
                params={"ticker": ticker, "published_utc.gte": today, "limit": 1},
            )
            resp.raise_for_status()
            has_news = len(resp.json().get("results", [])) > 0
            result[ticker] = has_news
        except Exception as e:
            log.warning(f"news fetch failed for {ticker}: {e}")
            result[ticker] = False

    for i in range(0, len(tickers), 20):
        batch = tickers[i : i + 20]
        await asyncio.gather(*[fetch_one(t) for t in batch])
        await asyncio.sleep(0.2)

    return result
