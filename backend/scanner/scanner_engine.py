"""
Scanner engine — applies configurable filter criteria to STOCKS and
returns a sorted list of matching tickers every second.
"""
from dataclasses import dataclass
from typing import Optional

from scanner.stock_state import STOCKS, StockState


@dataclass
class FilterCriteria:
    # Price filters
    price_min: Optional[float] = 0.10
    price_max: Optional[float] = 25.0

    # Float filter (shares)
    float_max: Optional[int] = 30_000_000

    # Volume filters
    volume_min: Optional[int] = 100_000

    # Relative volume
    relvol_min: Optional[float] = 5.0

    # Price change % from previous close
    change_pct_min: Optional[float] = None
    change_pct_max: Optional[float] = None

    # News filter: None = don't care, True = must have news
    has_news: Optional[bool] = None

    # Sorting
    sort_by: str = "rel_vol"     # field name from to_scanner_row()
    sort_desc: bool = True


# Active criteria updated live via REST API
_active_criteria = FilterCriteria()


def get_criteria() -> FilterCriteria:
    return _active_criteria


def set_criteria(criteria: FilterCriteria):
    global _active_criteria
    _active_criteria = criteria


def _passes(state: StockState, c: FilterCriteria) -> bool:
    if state.price == 0:
        return False

    if c.price_min is not None and state.price < c.price_min:
        return False
    if c.price_max is not None and state.price > c.price_max:
        return False

    if c.float_max is not None:
        if state.float_shares is None or state.float_shares > c.float_max:
            return False

    if c.volume_min is not None and state.volume_today < c.volume_min:
        return False

    if c.relvol_min is not None and state.relative_volume < c.relvol_min:
        return False

    if c.change_pct_min is not None and state.price_change_pct < c.change_pct_min:
        return False
    if c.change_pct_max is not None and state.price_change_pct > c.change_pct_max:
        return False

    if c.has_news is True and not state.has_news_today:
        return False
    if c.has_news is False and state.has_news_today:
        return False

    return True


def get_scanner_results() -> list[dict]:
    c = _active_criteria
    passing = [s for s in STOCKS.values() if _passes(s, c)]

    sort_key = c.sort_by
    passing.sort(
        key=lambda s: s.to_scanner_row().get(sort_key, 0) or 0,
        reverse=c.sort_desc,
    )
    return [s.to_scanner_row() for s in passing]
