"""
REST API routes:
  GET  /api/historical/{ticker}/{timeframe}  — chart initialization data
  GET  /api/stocks           — debug: list all tracked tickers
"""
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from scanner.stock_state import STOCKS
from services.ibkr_client import get_bars, get_ib

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

ET = timezone(timedelta(hours=-4))


# ---------------------------------------------------------------------------
# Historical bars for chart initialization
# ---------------------------------------------------------------------------

TIMEFRAME_MAP = {
    "1m":  (1,  "minute"),
    "5m":  (5,  "minute"),
    "15m": (15, "minute"),
    "1h":  (1,  "hour"),
    "1D":  (1,  "day"),
}


@router.get("/historical/{ticker}/{timeframe}")
async def get_historical(ticker: str, timeframe: str):
    mult, span = TIMEFRAME_MAP.get(timeframe, (1, "minute"))
    today = datetime.now(ET).strftime("%Y-%m-%d")

    if timeframe == "1D":
        from_date = (datetime.now(ET) - timedelta(days=365)).strftime("%Y-%m-%d")
        to_date = today
    else:
        from_date = today
        to_date = today

    bars = await get_bars(ticker.upper(), mult, span, from_date, to_date)
    return {"ticker": ticker.upper(), "timeframe": timeframe, "bars": bars}


# ---------------------------------------------------------------------------
# Tier 2 management (charts + watchlist → reqMktData)
# ---------------------------------------------------------------------------

class Tier2Body(BaseModel):
    tickers: list[str] = []

@router.post("/tier2")
async def update_tier2(body: Tier2Body):
    from scanner.data_feed import sync_tier2, get_tier2_tickers
    wanted = {t.upper() for t in body.tickers if t.strip()}
    await sync_tier2(wanted)
    return {"tier2": get_tier2_tickers()}

@router.get("/tier2")
def get_tier2():
    from scanner.data_feed import get_tier2_tickers
    return {"tier2": get_tier2_tickers()}


# ---------------------------------------------------------------------------
# Scanner universe parameters (runtime-adjustable, no restart needed)
# ---------------------------------------------------------------------------

class ScannerParamsModel(BaseModel):
    min_price:      Optional[float] = None
    max_price:      Optional[float] = None
    max_float:      Optional[int]   = None
    max_market_cap: Optional[int]   = None

@router.get("/scanner/params")
def get_scanner_params():
    from scanner.data_feed import get_scan_params
    from dataclasses import asdict
    return asdict(get_scan_params())

@router.post("/scanner/params")
def update_scanner_params(body: ScannerParamsModel):
    from scanner.data_feed import update_scan_params
    update_scan_params(**body.model_dump())
    from scanner.data_feed import get_scan_params
    from dataclasses import asdict
    return asdict(get_scan_params())


# ---------------------------------------------------------------------------
# DAS Trader Remote API — symbol routing
# ---------------------------------------------------------------------------

class DasSymbolBody(BaseModel):
    ticker: str

@router.post("/das/symbol")
def das_set_symbol(body: DasSymbolBody):
    ticker = body.ticker.upper().strip()
    from services.das_client import set_symbol, is_connected
    if not is_connected():
        return {"status": "disconnected", "ticker": ticker}
    ok = set_symbol(ticker)
    return {"status": "ok" if ok else "error", "ticker": ticker}

@router.get("/das/status")
def das_status():
    from services.das_client import is_connected
    from config import DAS_HOST, DAS_PORT
    return {"connected": is_connected(), "host": DAS_HOST, "port": DAS_PORT}

@router.get("/das/test")
def das_test(cmd: str = "SYMBOL AAPL"):
    """Debug: send raw command to DAS and return response. E.g. /api/das/test?cmd=SYMBOL+AAPL"""
    from services.das_client import raw_test
    return raw_test(cmd)


# ---------------------------------------------------------------------------
# Market indices (NASDAQ, S&P 500, DOW) — cached 30 seconds
# ---------------------------------------------------------------------------

_indices_cache: dict = {"data": {}, "ts": 0.0}

@router.get("/market/indices")
async def market_indices():
    import time
    import yfinance as yf
    now = time.time()
    if now - _indices_cache["ts"] < 30 and _indices_cache["data"]:
        return _indices_cache["data"]

    symbols = {"NASDAQ": "^IXIC", "S&P 500": "^GSPC", "DOW": "^DJI"}
    result: dict = {}
    for name, sym in symbols.items():
        try:
            fi = yf.Ticker(sym).fast_info
            price = fi.last_price
            prev  = fi.previous_close
            chg   = ((price - prev) / prev * 100) if prev else 0.0
            result[name] = {"price": round(price, 2), "change_pct": round(chg, 2)}
        except Exception:
            result[name] = {"price": None, "change_pct": None}

    _indices_cache["data"] = result
    _indices_cache["ts"]   = now
    return result


# ---------------------------------------------------------------------------
# Market calendar (today's session open/close, handles early closes)
# ---------------------------------------------------------------------------

@router.get("/market/today")
async def market_today():
    """Return today's trading session: is_trading_day, open (HH:MM), close (HH:MM)."""
    from services.alpaca_client import get_market_calendar
    return await get_market_calendar()


# ---------------------------------------------------------------------------
# Server / IBKR time
# ---------------------------------------------------------------------------

@router.get("/time")
async def get_time():
    """Return current time from IBKR server + local system clock for comparison."""
    system_unix = time.time()
    ibkr_unix = None
    drift_ms = None
    try:
        ib = get_ib()
        ibkr_result = await ib.reqCurrentTimeAsync()
        # ib_insync may return datetime or int depending on version
        if isinstance(ibkr_result, datetime):
            ibkr_unix = ibkr_result.timestamp()
        else:
            ibkr_unix = float(ibkr_result)
        drift_ms = round((system_unix - ibkr_unix) * 1000)
    except Exception:
        pass
    return {
        "system_unix": system_unix,
        "ibkr_unix": ibkr_unix,
        "drift_ms": drift_ms,
    }


# ---------------------------------------------------------------------------
# Debug / dev endpoints
# ---------------------------------------------------------------------------

@router.get("/stocks")
def list_stocks():
    """Return summary of all tracked tickers (dev/debug)."""
    return {
        "count": len(STOCKS),
        "tickers": sorted(STOCKS.keys())[:200],
    }
