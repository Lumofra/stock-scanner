"""
IBKR real-time data feed.

Two concurrent loops:
  1. _run_scanner()   — IBKR server-side scanner refreshes every 60s.
                        Discovers the top active NASDAQ small-caps and
                        manages which tickers get real-time bar subscriptions.

  2. _lazy_loader()   — For each new ticker, loads float (yfinance),
                        prev close, historical volume (for rel vol), and
                        today's cumulative volume — all via IBKR REST.

Real-time resolution:
  reqRealTimeBars() delivers 5-second OHLCV bars from IBKR.
  These are aggregated here into 1-minute bars (and then 5-minute bars)
  to feed the scanner engine, alert engine, and live charts.

IBKR simultaneous subscription limit: ~100 tickers on a standard account.
The scanner keeps us well within that (50–100 results across 3 scan codes).
"""
import asyncio
import json
import logging
import time
from datetime import datetime, timezone, timedelta
from typing import Any

from ib_insync import IB, Stock, ScannerSubscription

from scanner.stock_state import STOCKS, StockState, Bar
from scanner.conditions import evaluate as _eval_conditions
from config import (
    IBKR_HOST, IBKR_PORT, IBKR_CLIENT_ID,
    MAX_FLOAT, MAX_PRICE, MIN_PRICE,
    SCANNER_REFRESH_SECONDS,
)

log = logging.getLogger(__name__)

ET = timezone(timedelta(hours=-4))

# ---------------------------------------------------------------------------
# Runtime-adjustable scanner universe parameters
# (can be updated via POST /api/scanner/params without restarting)
# ---------------------------------------------------------------------------

from dataclasses import dataclass, asdict

@dataclass
class ScannerParams:
    min_price:      float = MIN_PRICE          # default from config (1.00)
    max_price:      float = MAX_PRICE          # default from config (25.0)
    max_float:      int   = MAX_FLOAT          # default from config (30M)
    max_market_cap: int   = 1_000_000_000      # $1B IBKR coarse filter

_scan_params = ScannerParams()

def get_scan_params() -> ScannerParams:
    return _scan_params

def update_scan_params(**kwargs):
    for k, v in kwargs.items():
        if hasattr(_scan_params, k) and v is not None:
            setattr(_scan_params, k, type(getattr(_scan_params, k))(v))
    log.info(f"Scanner params updated: {asdict(_scan_params)}")


_bar_complete_callbacks: list = []

# Tier 1: reqRealTimeBars — all scanner tickers (5-second bars)
_active_subs: dict[str, Any] = {}

# Tier 2: reqMktData — charts + watchlist (sub-second tick updates)
_tier2_subs: dict[str, Any] = {}        # ticker → Ticker object
_tier2_prev_vol: dict[str, int] = {}    # ticker → last known total day volume
_tier2_wanted: set[str] = set()         # maintained by frontend via REST

# Tickers queued for lazy initialisation (float, history, etc.)
_needs_init: set[str] = set()
_init_started: set[str] = set()

# Keep IB ref for tier2 promote/demote after initial connect
_ib_ref: IB | None = None


def register_bar_callback(fn):
    """Register a coroutine called each time a 1-min bar closes."""
    _bar_complete_callbacks.append(fn)


def get_tier2_tickers() -> list[str]:
    return list(_tier2_subs.keys())

def get_subscription_counts() -> dict:
    return {
        "tier1": len(_active_subs),
        "tier2": len(_tier2_subs),
        "total": len(_active_subs) + len(_tier2_subs),
        "limit": 100,
    }


# ---------------------------------------------------------------------------
# 5-second bar handler → aggregates into 1-min and 5-min bars
# ---------------------------------------------------------------------------

def _et_minute_of_day(ts_unix: int) -> int:
    dt = datetime.fromtimestamp(ts_unix, tz=ET)
    return (dt.hour - 4) * 60 + dt.minute


async def _on_rtbar(ticker: str, bars, has_new_bar: bool):
    if not has_new_bar:
        return

    rtbar = bars[-1]

    if ticker not in STOCKS:
        STOCKS[ticker] = StockState(ticker=ticker)
        _needs_init.add(ticker)

    state = STOCKS[ticker]
    state.price = rtbar.close
    state.current_minute_of_day = _et_minute_of_day(rtbar.time)

    # Snap bar timestamp down to its 1-minute boundary
    bar_1m_time = (rtbar.time // 60) * 60

    if state.bars_1m and state.bars_1m[-1].time == bar_1m_time:
        # Update the currently open 1-min bar in place
        live = state.bars_1m[-1]
        live.high  = max(live.high, rtbar.high)
        live.low   = min(live.low,  rtbar.low)
        live.close = rtbar.close
        live.volume += rtbar.volume
        state.volume_today += rtbar.volume

        # Mid-bar condition check (runs every 5 seconds)
        event = _eval_conditions(ticker, state)
        if event:
            asyncio.create_task(_publish_event(event))
    else:
        # New minute started — close the previous bar and notify the alert engine
        if state.bars_1m:
            for cb in _bar_complete_callbacks:
                asyncio.create_task(cb(ticker, state))

        state.bars_1m.append(Bar(
            time=bar_1m_time,
            open=rtbar.open,
            high=rtbar.high,
            low=rtbar.low,
            close=rtbar.close,
            volume=rtbar.volume,
        ))
        state.volume_today += rtbar.volume
        _build_5m_bar(state)


def _build_5m_bar(state: StockState):
    """Aggregate every 5 completed 1-min bars into a 5-min bar."""
    bars = list(state.bars_1m)
    if len(bars) < 5:
        return
    last5 = bars[-5:]
    if last5[0].time % 300 != 0:
        return
    five = Bar(
        time=last5[0].time,
        open=last5[0].open,
        high=max(b.high for b in last5),
        low=min(b.low  for b in last5),
        close=last5[-1].close,
        volume=sum(b.volume for b in last5),
    )
    if state.bars_5m and state.bars_5m[-1].time == five.time:
        state.bars_5m[-1] = five
    else:
        state.bars_5m.append(five)


# ---------------------------------------------------------------------------
# Tier 2 — reqMktData (sub-second tick updates for charts + watchlist)
# ---------------------------------------------------------------------------

async def _on_mkt_data(ticker: str, t):
    """
    Fires on every IBKR market data update for a Tier 2 ticker.
    Updates price and bar data at tick resolution (sub-second during spikes).
    Uses total day volume delta to avoid double-counting.
    """
    if not t.last or t.last <= 0:
        return

    state = STOCKS.get(ticker)
    if not state:
        return

    state.price = t.last

    # Volume delta from total day volume field (tick type 8)
    day_vol = int(t.volume) if t.volume and t.volume > 0 else 0
    prev    = _tier2_prev_vol.get(ticker, day_vol)
    delta   = max(0, day_vol - prev)
    if day_vol > 0:
        _tier2_prev_vol[ticker] = day_vol

    now      = int(time.time())
    bar_time = (now // 60) * 60
    state.current_minute_of_day = _et_minute_of_day(now)

    if state.bars_1m and state.bars_1m[-1].time == bar_time:
        bar       = state.bars_1m[-1]
        bar.high  = max(bar.high, t.last)
        bar.low   = min(bar.low, t.last)
        bar.close = t.last
        if delta > 0:
            bar.volume        += delta
            state.volume_today += delta
            # Condition check fires on every trade — true tick-level detection
            event = _eval_conditions(ticker, state)
            if event:
                asyncio.create_task(_publish_event(event))
    else:
        # New minute started
        if state.bars_1m:
            for cb in _bar_complete_callbacks:
                asyncio.create_task(cb(ticker, state))
        state.bars_1m.append(Bar(
            time=bar_time,
            open=t.last, high=t.last, low=t.last, close=t.last,
            volume=delta,
        ))
        if delta > 0:
            state.volume_today += delta
        _build_5m_bar(state)


def _promote_tier2(ib: IB, ticker: str):
    """Switch ticker from reqRealTimeBars (Tier 1) to reqMktData (Tier 2)."""
    if ticker in _tier2_subs:
        return
    # Cancel Tier 1 if active — both share the ~100 sub limit
    if ticker in _active_subs:
        _unsubscribe(ib, ticker)

    contract   = Stock(ticker, "SMART", "USD")
    mkt_ticker = ib.reqMktData(contract, "", False, False)

    def on_update(t):
        asyncio.ensure_future(_on_mkt_data(ticker, t))

    mkt_ticker.updateEvent += on_update
    _tier2_subs[ticker] = mkt_ticker
    # Seed prev volume from state to avoid bogus delta on first tick
    if ticker in STOCKS:
        _tier2_prev_vol[ticker] = STOCKS[ticker].volume_today
    log.info(f"Tier 2 ↑ {ticker} → reqMktData")


def _demote_tier2(ib: IB, ticker: str):
    """Switch ticker back from reqMktData to reqRealTimeBars."""
    if ticker not in _tier2_subs:
        return
    mkt_ticker = _tier2_subs.pop(ticker)
    _tier2_prev_vol.pop(ticker, None)
    try:
        ib.cancelMktData(mkt_ticker.contract)
    except Exception:
        pass
    # Re-subscribe with 5-second bars if still a wanted scanner ticker
    if ticker in STOCKS:
        _subscribe(ib, ticker)
    log.info(f"Tier 2 ↓ {ticker} → reqRealTimeBars")


async def sync_tier2(wanted: set[str]):
    """Called by REST endpoint when frontend updates charts/watchlist."""
    global _tier2_wanted
    ib = _ib_ref
    if not ib or not ib.isConnected():
        _tier2_wanted = wanted
        return

    current = set(_tier2_subs.keys())
    for t in current - wanted:
        _demote_tier2(ib, t)
    for t in wanted - current:
        if t in STOCKS or t in _active_subs:
            _promote_tier2(ib, t)
        else:
            # Ticker not yet discovered — queue for init and tier2 on first data
            _needs_init.add(t)
            _tier2_wanted.add(t)
    _tier2_wanted = wanted


# ---------------------------------------------------------------------------
# Subscription management (max ~100 simultaneous on standard IBKR account)
# ---------------------------------------------------------------------------

def _subscribe(ib: IB, ticker: str):
    if ticker in _active_subs:
        return
    contract = Stock(ticker, "SMART", "USD")
    bars = ib.reqRealTimeBars(contract, 5, "TRADES", useRTH=False)

    def on_update(bars, has_new_bar):
        asyncio.ensure_future(_on_rtbar(ticker, bars, has_new_bar))

    bars.updateEvent += on_update
    _active_subs[ticker] = bars
    log.debug(f"Subscribed: {ticker}")


def _unsubscribe(ib: IB, ticker: str):
    if ticker in _active_subs:
        ib.cancelRealTimeBars(_active_subs.pop(ticker))
        log.debug(f"Unsubscribed: {ticker}")


def _sync_subscriptions(ib: IB, wanted: set[str]):
    """Add subscriptions for new tickers; cancel those no longer wanted."""
    current = set(_active_subs.keys())
    for ticker in current - wanted:
        _unsubscribe(ib, ticker)
    for ticker in wanted - current:
        _subscribe(ib, ticker)


# ---------------------------------------------------------------------------
# IBKR server-side scanner — runs three scan codes, unions the results
# ---------------------------------------------------------------------------

# Scan codes that surface "in-play" small-caps:
#   MOST_ACTIVE_USD  — highest dollar volume today
#   HOT_BY_VOLUME    — highest volume vs 30-day average (= high relative volume)
#   TOP_PERC_GAIN    — biggest % gainers (momentum alerts)
_SCAN_CODES = ["MOST_ACTIVE_USD", "HOT_BY_VOLUME", "TOP_PERC_GAIN"]


async def _run_scanner(ib: IB):
    while True:
        try:
            found: set[str] = set()

            # Volume threshold depends on session:
            # RTH (9:30–16:00 ET): 50k — filters noise, keeps real movers
            # Extended hours: 2k — pre/post market has much lower volume
            et_min = _et_minute_of_day(int(time.time()))
            is_rth = 330 <= et_min < 720   # 09:30–16:00 relative to 4 AM offset
            vol_threshold = 50_000 if is_rth else 2_000

            p = get_scan_params()
            for scan_code in _SCAN_CODES:
                sub = ScannerSubscription(
                    instrument="STK",
                    locationCode="STK.NASDAQ",
                    scanCode=scan_code,
                    numberOfRows=50,
                    abovePrice=p.min_price,
                    belowPrice=p.max_price,
                    aboveVolume=vol_threshold,
                    marketCapBelow=p.max_market_cap,
                )
                try:
                    scan_data = await ib.reqScannerDataAsync(sub)
                    for sd in scan_data:
                        found.add(sd.contractDetails.contract.symbol)
                except Exception as e:
                    log.warning(f"Scanner {scan_code} error: {e}")
                await asyncio.sleep(2)  # brief gap between scanner requests

            if found:
                log.info(
                    f"Scanner results: {len(found)} tickers "
                    f"({', '.join(sorted(found)[:8])}{'...' if len(found) > 8 else ''})"
                )
                _sync_subscriptions(ib, found)
                now = time.time()
                for t in found:
                    is_new = t not in STOCKS
                    if is_new:
                        STOCKS[t] = StockState(ticker=t)
                    state = STOCKS[t]
                    if state.first_seen == 0:
                        state.first_seen = now
                    state.hit_count += 1
                    state.last_seen = now
                    if t not in _init_started:
                        _needs_init.add(t)
                    if is_new:
                        # Immediately check news for brand-new scanner entries
                        asyncio.create_task(_check_news_trigger(t))

        except Exception as e:
            log.error(f"Scanner loop error: {e}")

        await asyncio.sleep(SCANNER_REFRESH_SECONDS)


# ---------------------------------------------------------------------------
# Lazy initialiser — loads float, history, prev close per new ticker
# ---------------------------------------------------------------------------

async def _lazy_loader(ib: IB):
    from services.ibkr_client import (
        get_float_shares,
        load_prev_close,
        load_avg_intraday_volumes_for,
        seed_todays_bars,
    )

    while True:
        await asyncio.sleep(5)
        if not _needs_init:
            continue

        batch = set(list(_needs_init)[:3])  # 3 at a time to respect IBKR pacing
        _needs_init -= batch
        _init_started |= batch

        for ticker in batch:
            asyncio.create_task(
                _init_ticker(ticker, ib,
                             get_float_shares, load_prev_close,
                             load_avg_intraday_volumes_for, seed_todays_bars)
            )


async def _init_ticker(ticker, ib, get_float, load_prev, load_avg_vol, seed_bars):
    if ticker not in STOCKS:
        STOCKS[ticker] = StockState(ticker=ticker)
    state = STOCKS[ticker]

    # 1. Float (yfinance, Redis-cached 24h)
    if state.float_shares is None:
        state.float_shares = await get_float(ticker)

    # Skip expensive IBKR historical calls for obviously large-cap stocks
    if state.float_shares is not None and state.float_shares > MAX_FLOAT * 3:
        return

    # 2. Previous close (for % change column)
    if state.prev_close == 0:
        pc = await load_prev(ib, ticker)
        if pc:
            state.prev_close = pc

    # 3. 10-day 1-min volume history (for relative volume baseline)
    if not state.avg_by_minute:
        await load_avg_vol(ib, ticker)

    # 4. Seed today's 1-min bars, 5-min bars and volume_today from IBKR history.
    #    Without this, bars_1m is empty after restart and vol-spike conditions
    #    have no bar history to compare against for the first minutes of uptime.
    if not state.bars_1m:
        await seed_bars(ib, ticker)

    log.debug(
        f"Init done {ticker}: float={state.float_shares}, "
        f"prev_close={state.prev_close:.2f}, "
        f"bars_1m={len(state.bars_1m)}, bars_5m={len(state.bars_5m)}"
    )


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Event publisher
# ---------------------------------------------------------------------------

async def _publish_event(event: dict):
    from services.redis_client import get_redis
    try:
        redis = get_redis()
        await redis.publish("events:new", json.dumps(event))
    except Exception as e:
        log.debug(f"event publish failed: {e}")


# ---------------------------------------------------------------------------
# Trigger-based news check
# ---------------------------------------------------------------------------

async def _check_news_trigger(ticker: str):
    """Called immediately when a new ticker enters the scanner."""
    from services.ibkr_client import fetch_news_ibkr
    try:
        headlines = await fetch_news_ibkr(ticker)
        if ticker in STOCKS:
            STOCKS[ticker].has_news_today = len(headlines) > 0
            STOCKS[ticker].news_headlines = headlines
            if headlines:
                log.info(f"News on trigger {ticker}: {headlines[0]['headline'][:60]}")
    except Exception as e:
        log.debug(f"news trigger check failed for {ticker}: {e}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

async def start_feed():
    """Connect to IB Gateway, then run scanner + real-time bars indefinitely."""
    from services.ibkr_client import connect_ib
    global _ib_ref

    while True:
        try:
            ib = await connect_ib()
            _ib_ref = ib
            # Promote any tickers that were requested before connection
            for t in list(_tier2_wanted):
                if t in STOCKS:
                    _promote_tier2(ib, t)

            asyncio.create_task(_run_scanner(ib), name="ibkr_scanner")
            asyncio.create_task(_lazy_loader(ib), name="lazy_loader")

            # Stay alive until IB Gateway disconnects
            while ib.isConnected():
                await asyncio.sleep(5)

            log.warning("IB Gateway connection lost — reconnecting in 10s")

        except ConnectionRefusedError:
            log.error(
                "Cannot connect to IB Gateway. "
                f"Make sure it is running on {IBKR_HOST}:{IBKR_PORT} "
                "and API connections are enabled."
            )
        except Exception as e:
            log.error(f"Feed error: {e}")

        _active_subs.clear()
        await asyncio.sleep(10)
