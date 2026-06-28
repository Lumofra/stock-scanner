"""
FastAPI application entrypoint — IBKR edition.

Startup:
  1. Start IBKR feed (connects to IB Gateway, runs scanner + real-time bars)
  2. Start news poller (yfinance, background)
  3. Serve WebSocket and REST endpoints

IB Gateway must be running before the backend starts.
"""
import asyncio
import logging

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router
from api.websocket import scanner_ws, chart_ws, events_ws
from scanner.data_feed import start_feed
from scanner.news_poller import run_news_poller
from scanner.stock_state import STOCKS
from services.redis_client import close_redis

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger(__name__)

app = FastAPI(title="Stock Scanner API — IBKR")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.on_event("startup")
async def startup():
    log.info("=== Stock Scanner starting up (IBKR feed) ===")

    # Start IBKR feed — connects to Gateway, runs scanner + real-time bars
    asyncio.create_task(start_feed(), name="ibkr_feed")

    # Start news poller (yfinance, background)
    asyncio.create_task(run_news_poller(), name="news_poller")

    log.info("=== Startup complete — waiting for IB Gateway connection ===")


@app.on_event("shutdown")
async def shutdown():
    await close_redis()


# ---------------------------------------------------------------------------
# WebSocket routes
# ---------------------------------------------------------------------------

@app.websocket("/ws/scanner")
async def ws_scanner(websocket: WebSocket):
    await scanner_ws(websocket)


@app.websocket("/ws/chart/{ticker}/{timeframe}")
async def ws_chart(websocket: WebSocket, ticker: str, timeframe: str):
    await chart_ws(websocket, ticker, timeframe)


@app.websocket("/ws/events")
async def ws_events(websocket: WebSocket):
    await events_ws(websocket)


@app.get("/health")
@app.get("/api/health")
def health():
    active = sum(1 for s in STOCKS.values() if s.price > 0)
    from scanner.data_feed import get_subscription_counts, get_scan_params
    from dataclasses import asdict
    subs = get_subscription_counts()
    return {
        "status": "ok",
        "tracked_tickers": len(STOCKS),
        "active_tickers": active,
        "subscriptions": subs,
        "scan_params": asdict(get_scan_params()),
    }
