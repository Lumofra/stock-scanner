"""
IBKR data client (ib_insync wrapper).

Responsibilities:
  - Connect / reconnect to IB Gateway or TWS
  - Historical OHLCV bars   → reqHistoricalDataAsync
  - Previous close          → reqHistoricalDataAsync (1-day bar)
  - Intraday volume history → reqHistoricalDataAsync (1-min bars, 10 days)
  - Today's cumulative vol  → reqHistoricalDataAsync (1-min bars, today)
  - Float shares            → yfinance, cached 24h in Redis
  - News flag               → yfinance, cached 1h in Redis

IBKR pacing rule: max 60 historical requests per 10 minutes.
A semaphore + 2-second sleep between requests keeps us well inside that limit.
"""
import asyncio
import json
import logging
from collections import defaultdict
from datetime import date as _date_type, datetime, timedelta, timezone
from statistics import mean

import yfinance as yf
from ib_insync import IB, Stock

from config import (
    IBKR_HOST, IBKR_PORT, IBKR_CLIENT_ID,
    RELVOL_HISTORY_DAYS,
)
from scanner.stock_state import STOCKS, Bar
from services.redis_client import get_redis

log = logging.getLogger(__name__)

ET = timezone(timedelta(hours=-4))


def _bar_ts(val) -> int:
    """Convert IBKR bar date (Unix int OR datetime.date for daily bars) to Unix seconds."""
    if isinstance(val, _date_type) and not isinstance(val, datetime):
        return int(datetime(val.year, val.month, val.day, tzinfo=timezone.utc).timestamp())
    return int(val)


# Shared IB connection — created once in start_feed(), passed around
_ib: IB | None = None

# Limit concurrent historical data requests to stay inside IBKR pacing rules
_hist_sem = asyncio.Semaphore(3)

# Limit concurrent yfinance calls (it scrapes Yahoo Finance)
_yf_sem = asyncio.Semaphore(5)


# ---------------------------------------------------------------------------
# Connection
# ---------------------------------------------------------------------------

def _on_error(req_id: int, error_code: int, error_string: str, contract):
    """Suppress harmless IBKR info messages; log real errors."""
    if error_code in (2104, 2106, 2107, 2108, 2158, 2119):
        # Farm connection / market data farm messages — informational only
        return
    log.warning(f"IBKR [{error_code}] req={req_id}: {error_string}")


async def connect_ib() -> IB:
    global _ib
    ib = IB()
    ib.errorEvent += _on_error
    await ib.connectAsync(IBKR_HOST, IBKR_PORT, clientId=IBKR_CLIENT_ID, readonly=True)
    _ib = ib
    log.info(f"Connected to IB Gateway at {IBKR_HOST}:{IBKR_PORT} (clientId={IBKR_CLIENT_ID})")
    return ib


def get_ib() -> IB:
    if _ib is None or not _ib.isConnected():
        raise RuntimeError("IB not connected")
    return _ib


# ---------------------------------------------------------------------------
# Historical bars  (for chart REST endpoint and relative volume)
# ---------------------------------------------------------------------------

_BAR_SIZE_MAP = {
    "1m":  "1 min",
    "5m":  "5 mins",
    "15m": "15 mins",
    "1h":  "1 hour",
    "1D":  "1 day",
}

_DURATION_MAP = {
    "1m":  "1 D",
    "5m":  "1 D",
    "15m": "1 D",
    "1h":  "1 D",
    "1D":  "1 Y",
}


async def get_bars(ticker: str, multiplier: int, timespan: str, from_date: str, to_date: str) -> list[dict]:
    """Return OHLCV bars as dicts for TradingView Lightweight Charts."""
    tf_key = {(1, "minute"): "1m", (5, "minute"): "5m",
              (15, "minute"): "15m", (1, "hour"): "1h",
              (1, "day"): "1D"}.get((multiplier, timespan), "1m")
    bar_size = _BAR_SIZE_MAP.get(tf_key, "1 min")
    duration = _DURATION_MAP.get(tf_key, "1 D")

    return await _fetch_bars(ticker, bar_size, duration, use_rth=(timespan == "day"))


async def _fetch_bars(ticker: str, bar_size: str, duration: str, use_rth: bool = False) -> list[dict]:
    async with _hist_sem:
        try:
            ib = get_ib()
            contract = Stock(ticker, "SMART", "USD")
            bars = await ib.reqHistoricalDataAsync(
                contract,
                endDateTime="",      # "" = now
                durationStr=duration,
                barSizeSetting=bar_size,
                whatToShow="TRADES",
                useRTH=use_rth,
                formatDate=2,        # 2 = Unix timestamp
            )
            await asyncio.sleep(2)  # pace requests
            return [
                {
                    "time":   _bar_ts(b.date),
                    "open":   b.open,
                    "high":   b.high,
                    "low":    b.low,
                    "close":  b.close,
                    "volume": int(b.volume),
                }
                for b in bars
                if b.open > 0
            ]
        except Exception as e:
            log.error(f"get_bars failed for {ticker}: {e}")
            return []


# ---------------------------------------------------------------------------
# Previous close
# ---------------------------------------------------------------------------

async def load_prev_close(ib: IB, ticker: str) -> float | None:
    async with _hist_sem:
        try:
            contract = Stock(ticker, "SMART", "USD")
            bars = await ib.reqHistoricalDataAsync(
                contract,
                endDateTime="",
                durationStr="5 D",
                barSizeSetting="1 day",
                whatToShow="TRADES",
                useRTH=True,
                formatDate=2,
            )
            await asyncio.sleep(2)
            # Return the last completed day (not today)
            today_date = datetime.now(ET).date()
            for bar in reversed(bars):
                bar_date = datetime.fromtimestamp(_bar_ts(bar.date), tz=ET).date()
                if bar_date < today_date:
                    return bar.close
        except Exception as e:
            log.warning(f"prev_close failed for {ticker}: {e}")
        return None


# ---------------------------------------------------------------------------
# Historical intraday volume  (relative volume baseline)
# ---------------------------------------------------------------------------

async def load_avg_intraday_volumes_for(ib: IB, ticker: str):
    """
    Fetch RELVOL_HISTORY_DAYS of 1-min bars and store average volume at
    each minute-of-day (0 = 4am ET) in STOCKS[ticker].avg_by_minute.
    """
    async with _hist_sem:
        try:
            contract = Stock(ticker, "SMART", "USD")
            bars = await ib.reqHistoricalDataAsync(
                contract,
                endDateTime="",
                durationStr=f"{RELVOL_HISTORY_DAYS + 3} D",
                barSizeSetting="1 min",
                whatToShow="TRADES",
                useRTH=False,
                formatDate=2,
            )
            await asyncio.sleep(2)

            by_minute: dict[int, list[int]] = defaultdict(list)
            for bar in bars:
                ts = datetime.fromtimestamp(_bar_ts(bar.date), tz=ET)
                minute_of_day = (ts.hour - 4) * 60 + ts.minute
                if 0 <= minute_of_day < 480 and bar.volume > 0:
                    by_minute[minute_of_day].append(int(bar.volume))

            if ticker in STOCKS and by_minute:
                STOCKS[ticker].avg_by_minute = {
                    m: mean(vols) for m, vols in by_minute.items()
                }
        except Exception as e:
            log.warning(f"avg_volume load failed for {ticker}: {e}")


# ---------------------------------------------------------------------------
# Today's bars — seeds bars_1m, bars_5m, volume_today, price on restart
# ---------------------------------------------------------------------------

async def seed_todays_bars(ib: IB, ticker: str):
    """
    Fetch today's 1-min bars from IBKR and fully populate the in-memory state:
      - bars_1m  (full intraday history for vol-spike condition evaluation)
      - bars_5m  (aggregated, rebuilt from bars_1m)
      - volume_today
      - price (latest close)

    Without this, vol-spike detection has no bar history to compare against
    for the first minutes after a restart.
    """
    async with _hist_sem:
        try:
            contract = Stock(ticker, "SMART", "USD")
            raw = await ib.reqHistoricalDataAsync(
                contract,
                endDateTime="",
                durationStr="1 D",
                barSizeSetting="1 min",
                whatToShow="TRADES",
                useRTH=False,
                formatDate=2,
            )
            await asyncio.sleep(2)

            if not raw or ticker not in STOCKS:
                return

            today = datetime.now(ET).date()
            state = STOCKS[ticker]

            bars_1m: list[Bar] = []
            for b in raw:
                ts = datetime.fromtimestamp(_bar_ts(b.date), tz=ET)
                if ts.date() != today or b.volume <= 0:
                    continue
                bar_time = (int(ts.timestamp()) // 60) * 60
                bars_1m.append(Bar(
                    time=bar_time,
                    open=b.open, high=b.high, low=b.low, close=b.close,
                    volume=int(b.volume),
                ))

            if not bars_1m:
                return

            state.bars_1m    = bars_1m
            state.volume_today = sum(b.volume for b in bars_1m)
            state.price      = bars_1m[-1].close

            # Rebuild 5-min bars from 1-min bars
            bars_5m: list[Bar] = []
            for i in range(len(bars_1m)):
                # Collect the five 1-min bars that form this 5-min candle
                anchor = bars_1m[i]
                if anchor.time % 300 != 0:
                    continue
                window = [b for b in bars_1m if anchor.time <= b.time < anchor.time + 300]
                if not window:
                    continue
                five = Bar(
                    time=anchor.time,
                    open=window[0].open,
                    high=max(b.high   for b in window),
                    low=min(b.low     for b in window),
                    close=window[-1].close,
                    volume=sum(b.volume for b in window),
                )
                if bars_5m and bars_5m[-1].time == five.time:
                    bars_5m[-1] = five
                else:
                    bars_5m.append(five)

            state.bars_5m = bars_5m

            log.info(
                f"Seeded {ticker}: {len(bars_1m)} 1m bars, "
                f"{len(bars_5m)} 5m bars, vol={state.volume_today:,}"
            )
        except Exception as e:
            log.warning(f"seed_todays_bars failed for {ticker}: {e}")


# Keep old name as alias so nothing else breaks
async def load_todays_volume(ib: IB, ticker: str):
    await seed_todays_bars(ib, ticker)


# ---------------------------------------------------------------------------
# Float shares  (yfinance + Redis 24h cache)
# ---------------------------------------------------------------------------

def _yf_fetch_float(ticker: str) -> int | None:
    try:
        info = yf.Ticker(ticker).info
        val = info.get("floatShares") or info.get("sharesOutstanding")
        return int(val) if val and val > 0 else None
    except Exception:
        return None


async def get_float_shares(ticker: str) -> int | None:
    redis = get_redis()
    cached = await redis.get(f"float:{ticker}")
    if cached is not None:
        v = int(cached)
        return v if v > 0 else None

    async with _yf_sem:
        loop = asyncio.get_event_loop()
        float_val = await loop.run_in_executor(None, _yf_fetch_float, ticker)

    await redis.setex(f"float:{ticker}", 86400, str(float_val or 0))
    return float_val


# ---------------------------------------------------------------------------
# News  (IBKR reqHistoricalNews, yfinance fallback, Redis 5-min cache)
# ---------------------------------------------------------------------------

_news_providers_cache: str = ""  # "+"-joined provider codes, cached after first call


async def _get_ibkr_provider_codes(ib: IB) -> str:
    global _news_providers_cache
    if _news_providers_cache:
        return _news_providers_cache
    try:
        providers = ib.reqNewsProviders()
        if providers:
            _news_providers_cache = "+".join(p.code for p in providers)
            log.info(f"IBKR news providers available: {_news_providers_cache}")
    except Exception as e:
        log.warning(f"reqNewsProviders failed: {e}")
    return _news_providers_cache


def _yf_fetch_headlines(ticker: str) -> list[dict]:
    """yfinance fallback — used when IBKR has no news subscriptions."""
    try:
        articles = yf.Ticker(ticker).news or []
        today = datetime.now(timezone.utc).date()
        result = []
        for a in articles[:10]:
            pub_ts = a.get("providerPublishTime", 0)
            if pub_ts and datetime.fromtimestamp(pub_ts, tz=timezone.utc).date() >= today:
                result.append({
                    "headline": a.get("title", ""),
                    "provider": a.get("publisher", "Yahoo"),
                    "time": datetime.fromtimestamp(pub_ts, tz=ET).strftime("%H:%M"),
                })
        return result
    except Exception:
        return []


async def fetch_news_ibkr(ticker: str) -> list[dict]:
    """
    Fetch today's news headlines for ticker via IBKR reqHistoricalNews.
    Falls back to yfinance if no IBKR news providers are subscribed.
    Cache: 5 minutes in Redis.
    """
    redis = get_redis()
    cache_key = f"ibkr_news:{ticker}"

    cached = await redis.get(cache_key)
    if cached is not None:
        return json.loads(cached)

    result: list[dict] = []
    try:
        ib = get_ib()
        provider_codes = await _get_ibkr_provider_codes(ib)

        if provider_codes:
            # Qualify contract to get conId
            contract = Stock(ticker, "SMART", "USD")
            details = await ib.qualifyContractsAsync(contract)
            if details:
                con_id = details[0].conId
                start_dt = (datetime.now(timezone.utc) - timedelta(hours=24)).strftime("%Y-%m-%d %H:%M:%S")

                loop = asyncio.get_event_loop()
                headlines = await loop.run_in_executor(
                    None,
                    lambda: ib.reqHistoricalNews(con_id, provider_codes, start_dt, "", 10, [])
                )

                today = datetime.now(ET).date()
                for h in headlines:
                    try:
                        pub_date = h.time.date() if hasattr(h.time, "date") else \
                                   datetime.fromtimestamp(float(h.time), tz=ET).date()
                        if pub_date >= today:
                            result.append({
                                "headline": h.headline,
                                "provider": h.providerCode,
                                "time": h.time.strftime("%H:%M") if hasattr(h.time, "strftime") else str(h.time),
                            })
                    except Exception:
                        pass
        else:
            # No IBKR news subscription — fall back to yfinance
            loop = asyncio.get_event_loop()
            async with _yf_sem:
                result = await loop.run_in_executor(None, _yf_fetch_headlines, ticker)

    except Exception as e:
        log.warning(f"fetch_news_ibkr failed for {ticker}: {e}")

    await redis.setex(cache_key, 300, json.dumps(result))  # 5-min cache
    return result


async def check_news_for_tickers(tickers: list[str]) -> dict[str, bool]:
    """Return {ticker: has_news_today} — used by news_poller."""
    result = {}
    for ticker in tickers:
        headlines = await fetch_news_ibkr(ticker)
        result[ticker] = len(headlines) > 0
    return result
