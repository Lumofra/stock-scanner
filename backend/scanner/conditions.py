"""
Mid-bar real-time condition evaluation.

Runs on every 5-second rtbar update so events fire immediately when a
threshold is crossed — not waiting for the bar to close.

Each event is deduplicated per ticker per bar: once an event fires for a
given bar_time it won't fire again for the same bar (avoids spam on each
5s update). It WILL re-fire on the next bar if the condition still holds.

Hit counter (_hits) is session-based (resets on backend restart) which is
fine for intraday scalping.
"""
import json
import logging
import time
from collections import defaultdict

from scanner.stock_state import StockState

log = logging.getLogger(__name__)

# Minimum ratio to emit (filters noise; frontend can require higher)
_MIN_EMIT_RATIO = 2.0

# Lookback windows included in every event payload
_LOOKBACKS = (1, 3, 5, 10)

# {ticker: {event_type: last_bar_time}} — deduplication
_last_fired: dict[str, dict[str, int]] = defaultdict(dict)

# {ticker: hit_count} — session hit counter
_hits: dict[str, int] = defaultdict(int)


def _vol_ratios(bars: list, lookbacks=_LOOKBACKS) -> dict[int, float]:
    """Current bar volume ÷ average volume of previous N bars."""
    current_vol = bars[-1].volume
    out: dict[int, float] = {}
    for n in lookbacks:
        if len(bars) < n + 1:
            continue
        avg = sum(b.volume for b in bars[-(n + 1):-1]) / n
        if avg > 0:
            out[n] = current_vol / avg
    return out


def evaluate(ticker: str, state: StockState) -> dict | None:
    """
    Check all configured conditions mid-bar.
    Returns an event dict if a new condition fires, else None.
    """
    bars = list(state.bars_1m)
    if len(bars) < max(_LOOKBACKS) + 1 or state.price == 0:
        return None

    ratios = _vol_ratios(bars)

    # Gate: at minimum a 2× spike on the 5-bar window
    ratio_5 = ratios.get(5, 0)
    if ratio_5 < _MIN_EMIT_RATIO:
        return None

    # Deduplicate within same bar
    bar_time = bars[-1].time
    if _last_fired[ticker].get("vol_spike") == bar_time:
        return None
    _last_fired[ticker]["vol_spike"] = bar_time

    _hits[ticker] += 1

    return {
        "ticker":       ticker,
        "event_type":   "vol_spike",
        "timestamp":    int(time.time() * 1000),
        "bar_time":     bar_time,
        "price":        round(state.price, 4),
        "change_pct":   round(state.price_change_pct, 2),
        "rel_vol":      round(state.relative_volume, 2),
        "float":        state.float_shares,
        "has_news":     state.has_news_today,
        "news_headlines": state.news_headlines,
        "bar_volume":   bars[-1].volume,
        "vol_ratio_1":  round(ratios.get(1, 0), 1),
        "vol_ratio_3":  round(ratios.get(3, 0), 1),
        "vol_ratio_5":  round(ratio_5, 1),
        "vol_ratio_10": round(ratios.get(10, 0), 1),
        "hits":         _hits[ticker],
    }
