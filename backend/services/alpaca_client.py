"""
Alpaca Markets data client.

Responsibilities:
  - Historical OHLCV bars  (Alpaca REST — synchronous, run in thread executor)
  - Float shares           (yfinance — synchronous, cached 24h in Redis)
  - Previous close         (Alpaca REST)
  - Historical avg intraday volume for relative volume (Alpaca REST)
  - News feed              (Alpaca News API)

Float note: Alpaca has no float endpoint. yfinance pulls it from Yahoo Finance.
It's cached in Redis so each ticker is only fetched once per day.
"""
import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from statistics import mean

import yfinance as yf
from alpaca.data.historical import StockHistoricalDataClient, NewsClient
from alpaca.data.requests import StockBarsRequest, NewsRequest
from alpaca.data.timeframe import TimeFrame, TimeFrameUnit

from config import (
    ALPACA_API_KEY,
    ALPACA_SECRET_KEY,
    ALPACA_DATA_FEED,
    MAX_FLOAT,
    RELVOL_HISTORY_DAYS,
)
from scanner.stock_state import STOCKS, StockState
from services.redis_client import get_redis

log = logging.getLogger(__name__)

ET = timezone(timedelta(hours=-4))

# Semaphore to limit concurrent yfinance requests (it's scraping Yahoo)
_yf_sem = asyncio.Semaphore(5)

_hist_client: StockHistoricalDataClient | None = None
_news_client: NewsClient | None = None


def _hist() -> StockHistoricalDataClient:
    global _hist_client
    if _hist_client is None:
        _hist_client = StockHistoricalDataClient(ALPACA_API_KEY, ALPACA_SECRET_KEY)
    return _hist_client


def _news() -> NewsClient:
    global _news_client
    if _news_client is None:
        _news_client = NewsClient(ALPACA_API_KEY, ALPACA_SECRET_KEY)
    return _news_client


def _make_timeframe(multiplier: int, timespan: str) -> TimeFrame:
    unit_map = {
        "minute": TimeFrameUnit.Minute,
        "hour":   TimeFrameUnit.Hour,
        "day":    TimeFrameUnit.Day,
    }
    unit = unit_map.get(timespan, TimeFrameUnit.Minute)
    return TimeFrame(multiplier, unit)


# ---------------------------------------------------------------------------
# Float shares  (yfinance + Redis cache)
# ---------------------------------------------------------------------------

def _yf_fetch_float(ticker: str) -> int | None:
    """Synchronous yfinance call — run in thread executor."""
    try:
        info = yf.Ticker(ticker).info
        val = info.get("floatShares") or info.get("sharesOutstanding")
        return int(val) if val and val > 0 else None
    except Exception:
        return None


async def get_float_shares(ticker: str) -> int | None:
    """Return float shares, using Redis as a 24-hour cache."""
    redis = get_redis()
    cached = await redis.get(f"float:{ticker}")
    if cached is not None:
        v = int(cached)
        return v if v > 0 else None

    async with _yf_sem:
        loop = asyncio.get_event_loop()
        float_val = await loop.run_in_executor(None, _yf_fetch_float, ticker)

    # Cache: positive value OR 0 (to stop re-fetching known-empty results)
    await redis.setex(f"float:{ticker}", 86400, str(float_val or 0))
    return float_val


# ---------------------------------------------------------------------------
# Historical bars  (for chart REST endpoint)
# ---------------------------------------------------------------------------

async def get_bars(
    ticker: str, multiplier: int, timespan: str, from_date: str, to_date: str
) -> list[dict]:
    """Return OHLCV bars as dicts ready for TradingView Lightweight Charts."""
    tf = _make_timeframe(multiplier, timespan)
    try:
        start = datetime.strptime(from_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        end   = datetime.strptime(to_date,   "%Y-%m-%d").replace(
            hour=23, minute=59, second=59, tzinfo=timezone.utc
        )
        req = StockBarsRequest(
            symbol_or_symbols=ticker,
            timeframe=tf,
            start=start,
            end=end,
            feed=ALPACA_DATA_FEED,
            adjustment="raw",
        )
        loop = asyncio.get_event_loop()
        barset = await loop.run_in_executor(None, _hist().get_stock_bars, req)
        return [
            {
                "time":   int(b.timestamp.timestamp()),
                "open":   b.open,
                "high":   b.high,
                "low":    b.low,
                "close":  b.close,
                "volume": int(b.volume),
            }
            for b in barset.get(ticker, [])
        ]
    except Exception as e:
        log.error(f"get_bars failed for {ticker}: {e}")
        return []


# ---------------------------------------------------------------------------
# Previous close
# ---------------------------------------------------------------------------

async def load_prev_close(ticker: str) -> float | None:
    try:
        end   = datetime.now(ET).replace(hour=0, minute=0, second=0, microsecond=0)
        start = end - timedelta(days=5)  # go back far enough to skip weekends/holidays
        req = StockBarsRequest(
            symbol_or_symbols=ticker,
            timeframe=TimeFrame.Day,
            start=start,
            end=end,
            feed=ALPACA_DATA_FEED,
        )
        loop = asyncio.get_event_loop()
        barset = await loop.run_in_executor(None, _hist().get_stock_bars, req)
        bars = barset.get(ticker, [])
        return bars[-1].close if bars else None
    except Exception as e:
        log.warning(f"prev_close failed for {ticker}: {e}")
        return None


# ---------------------------------------------------------------------------
# Historical intraday volumes  (for relative volume baseline)
# ---------------------------------------------------------------------------

async def load_avg_intraday_volumes_for(ticker: str):
    """
    Fetch RELVOL_HISTORY_DAYS of 1-min bars and store the average volume at
    each minute-of-day (0 = 4am ET) in STOCKS[ticker].avg_by_minute.
    """
    try:
        end   = datetime.now(ET).replace(hour=0, minute=0, second=0, microsecond=0)
        start = end - timedelta(days=RELVOL_HISTORY_DAYS + 3)
        req = StockBarsRequest(
            symbol_or_symbols=ticker,
            timeframe=TimeFrame.Minute,
            start=start,
            end=end,
            feed=ALPACA_DATA_FEED,
        )
        loop = asyncio.get_event_loop()
        barset = await loop.run_in_executor(None, _hist().get_stock_bars, req)
        bars = barset.get(ticker, [])

        by_minute: dict[int, list[int]] = defaultdict(list)
        for bar in bars:
            ts = bar.timestamp.astimezone(ET)
            minute_of_day = (ts.hour - 4) * 60 + ts.minute
            if 0 <= minute_of_day < 480:
                by_minute[minute_of_day].append(int(bar.volume))

        if ticker in STOCKS and by_minute:
            STOCKS[ticker].avg_by_minute = {
                m: mean(vols) for m, vols in by_minute.items()
            }
    except Exception as e:
        log.warning(f"avg_volume load failed for {ticker}: {e}")


# ---------------------------------------------------------------------------
# Today's bars (to seed volume_today on startup if already mid-session)
# ---------------------------------------------------------------------------

async def load_todays_volume(ticker: str):
    """
    If the backend starts mid-session, fetch today's 1-min bars so that
    volume_today is accurate rather than starting from 0.
    """
    try:
        today = datetime.now(ET).replace(hour=0, minute=0, second=0, microsecond=0)
        now   = datetime.now(timezone.utc)
        req = StockBarsRequest(
            symbol_or_symbols=ticker,
            timeframe=TimeFrame.Minute,
            start=today,
            end=now,
            feed=ALPACA_DATA_FEED,
        )
        loop = asyncio.get_event_loop()
        barset = await loop.run_in_executor(None, _hist().get_stock_bars, req)
        bars = barset.get(ticker, [])
        if bars and ticker in STOCKS:
            STOCKS[ticker].volume_today = sum(int(b.volume) for b in bars)
    except Exception as e:
        log.debug(f"today volume seed failed for {ticker}: {e}")


# ---------------------------------------------------------------------------
# News  (Alpaca News API)
# ---------------------------------------------------------------------------

async def check_news_for_tickers(tickers: list[str]) -> dict[str, bool]:
    """Return {ticker: True} for tickers that have news published today."""
    today_start = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    result: dict[str, bool] = {}

    for i in range(0, len(tickers), 50):
        batch = tickers[i : i + 50]
        try:
            req = NewsRequest(
                symbols=batch,
                start=today_start,
                limit=50,
                sort="desc",
            )
            loop = asyncio.get_event_loop()
            news = await loop.run_in_executor(None, _news().get_news, req)

            mentioned: set[str] = set()
            for article in news:
                for sym in (article.symbols or []):
                    mentioned.add(sym)
            for t in batch:
                result[t] = t in mentioned
        except Exception as e:
            log.warning(f"News batch fetch failed: {e}")
            for t in batch:
                result[t] = False

        await asyncio.sleep(0.1)

    return result
