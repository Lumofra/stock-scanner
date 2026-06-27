"""
News poller — every 5 minutes, refreshes news for tickers visible in scanner.
Uses IBKR reqHistoricalNews (with yfinance fallback).
Trigger-based check in data_feed.py handles brand-new entries immediately.
"""
import asyncio
import logging

from scanner.stock_state import STOCKS
from scanner.scanner_engine import get_scanner_results
from services.ibkr_client import fetch_news_ibkr

log = logging.getLogger(__name__)

POLL_INTERVAL = 300  # 5 minutes — IBKR news is cached 5 min anyway


async def run_news_poller():
    """Refresh news for currently visible scanner tickers every 5 minutes."""
    while True:
        await asyncio.sleep(POLL_INTERVAL)
        try:
            visible = [row["ticker"] for row in get_scanner_results()]
            if not visible:
                continue

            for ticker in visible[:100]:
                try:
                    headlines = await fetch_news_ibkr(ticker)
                    if ticker in STOCKS:
                        STOCKS[ticker].has_news_today = len(headlines) > 0
                        STOCKS[ticker].news_headlines = headlines
                except Exception:
                    pass

            log.debug(f"News poll complete: refreshed {len(visible[:100])} tickers")
        except Exception as e:
            log.error(f"News poller error: {e}")
