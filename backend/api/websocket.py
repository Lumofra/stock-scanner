"""
WebSocket endpoints:
  /ws/scanner          — scanner table rows (pushes every 1s, live data)
  /ws/events           — live event stream (vol spike, etc.) pushed on trigger
  /ws/alerts           — alert feed (pushed on new alert)
  /ws/chart/{ticker}/{timeframe}  — live bar updates, mid-bar aware
"""
import asyncio
import json
import logging

from fastapi import WebSocket, WebSocketDisconnect

from scanner.scanner_engine import get_scanner_results
from scanner.stock_state import STOCKS
from services.redis_client import get_redis

log = logging.getLogger(__name__)


async def scanner_ws(websocket: WebSocket):
    """Push full scanner results every second."""
    await websocket.accept()
    log.info("Scanner WS client connected")
    try:
        while True:
            results = get_scanner_results()
            await websocket.send_text(json.dumps({"type": "scanner", "data": results}))
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        log.info("Scanner WS client disconnected")
    except Exception as e:
        log.error(f"Scanner WS error: {e}")


async def events_ws(websocket: WebSocket):
    """
    Push live events (vol spike, etc.) as they fire mid-bar.
    Events are published to Redis 'events:new' by conditions.py.
    """
    await websocket.accept()
    log.info("Events WS client connected")
    redis = get_redis()
    pubsub = redis.pubsub()
    await pubsub.subscribe("events:new")
    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                await websocket.send_text(message["data"])
    except WebSocketDisconnect:
        log.info("Events WS client disconnected")
    except Exception as e:
        log.error(f"Events WS error: {e}")
    finally:
        await pubsub.unsubscribe("events:new")
        await pubsub.aclose()


async def alerts_ws(websocket: WebSocket):
    await websocket.accept()
    log.info("Alerts WS client connected")
    redis = get_redis()
    pubsub = redis.pubsub()
    await pubsub.subscribe("alerts:new")
    try:
        async for message in pubsub.listen():
            if message["type"] == "message":
                await websocket.send_text(message["data"])
    except WebSocketDisconnect:
        log.info("Alerts WS client disconnected")
    except Exception as e:
        log.error(f"Alerts WS error: {e}")
    finally:
        await pubsub.unsubscribe("alerts:new")
        await pubsub.aclose()


async def chart_ws(websocket: WebSocket, ticker: str, timeframe: str):
    """
    Send initial bar history, then push updates every second.
    Sends update whenever the latest bar changes — including mid-bar
    (price, high, low, volume updating every 5 seconds from rtbars).
    """
    await websocket.accept()
    log.info(f"Chart WS connected: {ticker}/{timeframe}")

    state = STOCKS.get(ticker.upper())
    if state:
        bars = state.bars_1m if timeframe == "1m" else state.bars_5m
        await websocket.send_text(
            json.dumps({"type": "init", "bars": [b.to_dict() for b in list(bars)]})
        )

    # Track last sent bar state to detect any mid-bar change
    last_sent: dict | None = None

    try:
        while True:
            await asyncio.sleep(1)
            s = STOCKS.get(ticker.upper())
            if not s:
                continue
            bars = s.bars_1m if timeframe == "1m" else s.bars_5m
            if not bars:
                continue

            latest = bars[-1]
            # Include all fields that change mid-bar
            sig = (latest.time, latest.close, latest.high, latest.low, latest.volume)
            if sig != last_sent:
                await websocket.send_text(
                    json.dumps({"type": "bar", "bar": latest.to_dict()})
                )
                last_sent = sig
    except WebSocketDisconnect:
        log.info(f"Chart WS disconnected: {ticker}/{timeframe}")
    except Exception as e:
        log.error(f"Chart WS error: {e}")
