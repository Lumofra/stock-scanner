"""
Alert engine — fires alerts when breakout conditions are detected on
each completed 1-minute bar.

Alert types:
  volume_breakout  — current bar volume > 3× average bar volume for this ticker
  price_spike_5pct — price increased >= 5% in the last 1 minute
"""
import asyncio
import json
import logging
import time
import uuid

from scanner.stock_state import StockState
from services.redis_client import get_redis
from config import ALERT_COOLDOWN_SECONDS

log = logging.getLogger(__name__)

# Tracks last alert time per ticker to enforce cooldown
_last_alert: dict[str, float] = {}

ALERT_CHANNEL = "alerts:new"


async def on_bar_complete(ticker: str, state: StockState):
    """Called by data_feed when a new 1-min bar starts (previous bar is now closed)."""
    if len(state.bars_1m) < 2:
        return

    now = time.monotonic()
    if now - _last_alert.get(ticker, 0) < ALERT_COOLDOWN_SECONDS:
        return

    prev_bar = state.bars_1m[-2]
    curr_bar = state.bars_1m[-1]

    # --- Alert 1: volume breakout ---
    # Average volume per bar based on full-day avg at this time
    total_minutes = max(state.current_minute_of_day, 1)
    avg_bar_vol = state.avg_volume_at_time / total_minutes if total_minutes else 0
    if avg_bar_vol > 0 and curr_bar.volume >= avg_bar_vol * 3:
        await _fire(ticker, state, "volume_breakout")
        return

    # --- Alert 2: 5% price spike in 1 minute ---
    if prev_bar.close > 0:
        pct = (curr_bar.close - prev_bar.close) / prev_bar.close * 100
        if pct >= 5.0:
            await _fire(ticker, state, "price_spike_5pct")


async def _fire(ticker: str, state: StockState, alert_type: str):
    _last_alert[ticker] = time.monotonic()

    bars_snapshot = [b.to_dict() for b in list(state.bars_1m)[-30:]]

    alert = {
        "id": str(uuid.uuid4()),
        "ticker": ticker,
        "alert_type": alert_type,
        "price": round(state.price, 4),
        "volume": state.volume_today,
        "rel_vol": round(state.relative_volume, 2),
        "change_pct": round(state.price_change_pct, 2),
        "float": state.float_shares,
        "has_news": state.has_news_today,
        "timestamp": int(time.time() * 1000),
        "bars_1m": bars_snapshot,
    }

    redis = get_redis()
    await redis.publish(ALERT_CHANNEL, json.dumps(alert))
    log.info(f"Alert fired: {alert_type} on {ticker} @ ${state.price:.2f}")
