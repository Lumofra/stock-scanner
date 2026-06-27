"""
REST API routes:
  GET  /api/filters          — get current filter criteria
  POST /api/filters          — update filter criteria (live)
  GET  /api/historical/{ticker}/{timeframe}  — chart initialization data
  GET  /api/stocks           — debug: list all tracked tickers
  POST /api/test/alert       — dev: fire a fake alert for testing
"""
import json
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from scanner.scanner_engine import FilterCriteria, get_criteria, set_criteria
from scanner.stock_state import STOCKS
from services.ibkr_client import get_bars, get_ib
from services.redis_client import get_redis

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

ET = timezone(timedelta(hours=-4))


# ---------------------------------------------------------------------------
# Filter criteria (Pydantic model mirrors the dataclass)
# ---------------------------------------------------------------------------

class FilterCriteriaModel(BaseModel):
    price_min: Optional[float] = 0.10
    price_max: Optional[float] = 25.0
    float_max: Optional[int] = 30_000_000
    volume_min: Optional[int] = 100_000
    relvol_min: Optional[float] = 5.0
    change_pct_min: Optional[float] = None
    change_pct_max: Optional[float] = None
    has_news: Optional[bool] = None
    sort_by: str = "rel_vol"
    sort_desc: bool = True


@router.get("/filters")
def get_filters():
    c = get_criteria()
    return c.__dict__


@router.post("/filters")
def update_filters(body: FilterCriteriaModel):
    set_criteria(FilterCriteria(**body.model_dump()))
    return {"status": "updated"}


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


@router.post("/test/alert")
async def fire_test_alert(ticker: str = "ABCD"):
    """Fire a fake alert on the alerts channel — useful for frontend testing."""
    redis = get_redis()
    alert = {
        "id": str(uuid.uuid4()),
        "ticker": ticker.upper(),
        "alert_type": "volume_breakout",
        "price": 3.45,
        "volume": 2_500_000,
        "rel_vol": 12.5,
        "change_pct": 18.2,
        "float": 5_000_000,
        "has_news": True,
        "timestamp": int(time.time() * 1000),
        "bars_1m": [],
    }
    await redis.publish("alerts:new", json.dumps(alert))
    return {"status": "fired", "alert": alert}
