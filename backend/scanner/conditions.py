"""
Mid-bar real-time condition evaluation.

Runs on every 5-second rtbar update so events fire immediately when a
threshold is crossed — not waiting for the bar to close.

Bracket-based deduplication: fires a new event when the vol ratio crosses
a higher bracket within the same bar. This lets scanners with different
multiplier thresholds each catch the event relevant to them, while still
preventing spam (max ~7 events per ticker per bar in extreme cases).

Example for a ticker escalating within one bar:
  4×  → fires  (crosses 3× bracket)   — Scanner A (3×) sees it
  10× → fires  (crosses 8× bracket)   — Scanner B (8×) sees it
  16× → fires  (crosses 15× bracket)  — Scanner C (15×) sees it

Hit counter (_hits) is session-based (resets on backend restart).
"""
import itertools
import logging
import time
from collections import defaultdict

from scanner.stock_state import StockState

log = logging.getLogger(__name__)

# Bracket levels — new event fires each time ratio crosses the next bracket
_BRACKETS = (2.0, 3.0, 5.0, 8.0, 10.0, 15.0, 20.0)

# Lookback windows included in every event payload
_LOOKBACKS = (1, 3, 5, 10)

# Number of bars we actually need: max lookback + 1 (the current bar)
_N_BARS_NEEDED = max(_LOOKBACKS) + 1  # = 11


def _top_bracket(ratio: float) -> float:
    """Highest bracket the ratio has crossed, or 0 if below minimum."""
    for t in reversed(_BRACKETS):
        if ratio >= t:
            return t
    return 0.0

# {ticker: (bar_time, bracket)} — tracks last fired bracket per bar
_last_fired: dict[str, tuple[int, float]] = defaultdict(lambda: (0, 0.0))

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
    dq = state.bars_1m
    if len(dq) < _N_BARS_NEEDED or state.price == 0:
        return None
    # Copy only the tail we need (11 bars) instead of the full 480-bar deque
    bars = list(itertools.islice(reversed(dq), _N_BARS_NEEDED))
    bars.reverse()

    ratios = _vol_ratios(bars)

    ratio_5 = ratios.get(5, 0)
    bracket = _top_bracket(ratio_5)
    if bracket == 0:
        return None

    # Fire when ratio crosses a new bracket — allows escalation events within same bar
    bar_time = bars[-1].time
    last_bar_time, last_bracket = _last_fired[ticker]
    if last_bar_time == bar_time and last_bracket >= bracket:
        return None
    _last_fired[ticker] = (bar_time, bracket)

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
