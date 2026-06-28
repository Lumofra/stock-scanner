"""
Scanner engine — filters STOCKS by universe params and returns a sorted
list of matching tickers every second.

Filtering uses the live ScannerParams (price range, float max) from
data_feed — the same universe the IBKR scanner already pre-filters by.
Each frontend scanner panel applies its own additional filters on top.
"""
from scanner.stock_state import STOCKS, StockState


def _passes(state: StockState, min_price: float, max_price: float, max_float: int) -> bool:
    if state.price <= 0:
        return False
    if state.price < min_price or state.price > max_price:
        return False
    if state.float_shares is not None and state.float_shares > max_float:
        return False
    return True


def get_scanner_results() -> list[dict]:
    from scanner.data_feed import get_scan_params
    p = get_scan_params()

    rows = [
        s.to_scanner_row()
        for s in STOCKS.values()
        if _passes(s, p.min_price, p.max_price, p.max_float)
    ]
    rows.sort(key=lambda r: r.get("rel_vol") or 0, reverse=True)
    return rows
