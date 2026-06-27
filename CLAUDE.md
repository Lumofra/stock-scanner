# NASDAQ Small-Cap Scanner — Project Brief

## What this is

A real-time NASDAQ small-cap stock scanner built for **scalp trading** via Interactive Brokers Gateway. The scanner watches 50–150 tickers simultaneously, detects volume spikes mid-bar, and pushes live data to a React frontend with charts, scanners, and a watchlist.

**Core design principle: speed is the edge.** Every latency decision should optimize for the fastest possible detection of momentum moves. Mid-bar detection beats waiting for bar close. Tick-level data beats 5-second bars for active positions.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Broker | Interactive Brokers Gateway (paper: port 4002, live: 4001) |
| IBKR client | ib_insync 0.9.86 / Python 3.12 |
| Backend | FastAPI + Uvicorn |
| Message bus | Redis pub/sub |
| Real-time push | WebSocket (FastAPI) |
| Frontend | React 18 + Vite + TypeScript |
| Styling | Tailwind CSS |
| Charts | lightweight-charts (TradingView open-source) |
| State | Zustand |

---

## Architecture

### Data Tiers

**Tier 1 — reqRealTimeBars** (all scanner tickers)
- IBKR pushes 5-second OHLCV bars
- ~100 simultaneous subscription limit on standard account
- Backend aggregates into 1-minute and 5-minute bars
- Mid-bar conditions evaluated every 5 seconds on each rtbar update

**Tier 2 — reqMktData** (charts + watchlist tickers)
- Sub-second tick-level updates
- Fires on every trade, not every 5 seconds
- Automatically promoted when a ticker is loaded into any chart or added to watchlist
- Demoted back to Tier 1 when no longer in charts or watchlist
- Frontend signals tier membership via `POST /api/tier2`

### Scanner Discovery

IBKR server-side `reqScannerDataAsync` runs every 60 seconds across 3 scan codes:
- `TOP_PERC_GAIN` — top gainers
- `HOT_BY_VOLUME` — most active by volume
- `HIGH_VS_52W_HL` — near 52-week high

Returns top 50 per code → up to 150 tickers watched. Each new ticker is lazy-initialized (float via yfinance, prev close + historical volume via IBKR REST for rel vol baseline).

### Mid-Bar Detection

Vol-spike conditions are checked on every 5-second rtbar (Tier 1) or every tick (Tier 2), NOT at bar close. This is critical for scalp trading — catching moves as they happen, not after the minute is done.

`backend/scanner/conditions.py` gates events at ≥2× avg volume and deduplicates per bar per ticker.

---

## Backend Structure

```
backend/
  api/
    main.py          — FastAPI app, mounts routes + websockets
    routes.py        — REST: /api/filters, /api/historical, /api/tier2, /api/time
    websocket.py     — WS: /ws/scanner, /ws/chart/{ticker}, /ws/events
  scanner/
    data_feed.py     — IBKR connection, reqRealTimeBars (T1), reqMktData (T2), scanner loop
    stock_state.py   — StockState dataclass: bars_1m, bars_5m, price, rel_vol, float, news, etc.
    scanner_engine.py — Filter + sort logic for toplist mode
    conditions.py    — Mid-bar vol-spike evaluation, dedup, hit counter
    news_poller.py   — 5-min poller for news on visible tickers
  services/
    ibkr_client.py   — IBKR helpers: connect, get_bars, fetch_news_ibkr (reqHistoricalNews)
    redis_client.py  — Redis connection singleton
  config.py          — Env vars: IBKR_HOST, IBKR_PORT, MAX_FLOAT, MIN_PRICE, etc.
```

### Key backend flows

- New ticker discovered → `_lazy_loader()` fetches float + history → starts `reqRealTimeBars`
- Ticker added to charts/watchlist → `sync_tier2()` → `_promote_tier2()` → `reqMktData`
- Each 5-sec rtbar → update bars → `_eval_conditions()` → if spike → publish to `events:new` Redis channel → WebSocket push
- News: triggered immediately when ticker enters scanner + polled every 5 min

---

## Frontend Structure

```
frontend/src/
  App.tsx                       — Layout: scanner panel | 2×2 chart grid | watch panel
  store/index.ts                — Zustand: scannerRows, selectedTicker, triggerTicker, watchlist, scannerConfigs
  hooks/
    useScanner.ts               — WebSocket /ws/scanner → scannerRows
    useEvents.ts                — WebSocket /ws/events → event log (client-side filtered)
  components/
    Charts/RealtimeChart.tsx    — lightweight-charts with EMA 9/20, VWAP, Bollinger Bands, volume bars
                                   Timeframe switcher: 1M / 5M / 15M / 1H / D
    MultiScanner/
      MultiScanner.tsx          — Multi-panel scanner container with drag-resize
      ScannerConfigModal.tsx    — Per-scanner config (mode, filters, columns, auto-switch)
    WatchPanel/WatchPanel.tsx   — Watchlist + News panel (replaces AlertFeed)
```

### Scanner types

**📊 Top List** — live filtered/sorted rankings of all tracked tickers. Updates every 5 seconds. No "Hits" column. Good for seeing who's leading right now.

**⚡ Live Events** — event log, newest on top. Each row = one mid-bar vol-spike detection. Has Hits counter. Good for catching the exact moment something moves. Auto-switch fires trigger chart on each new event.

### Chart layout (2×2 grid)

```
┌─────────────────┬──────────────────────┐
│  ⚡ Trigger 1m  │  selectedTicker 1m   │
│  (triggerTicker)│  (manual choice)     │
├─────────────────┼──────────────────────┤
│  selectedTicker │  selectedTicker      │
│       5m        │       Daily          │
└─────────────────┴──────────────────────┘
```

- Trigger chart: auto-follows scanner alerts, locked to 1m, always Tier 2
- Three manual charts: follow `selectedTicker`, timeframe-switchable
- "→ charts" button on trigger chart sends triggerTicker to all three manual charts
- All chart+watchlist tickers → Tier 2 (reqMktData) automatically

### Tier 2 signaling

In `WatchPanel.tsx`, a `useEffect` watches `[selectedTicker, triggerTicker, watchlist]` and posts to `POST /api/tier2` on every change. Backend promotes/demotes accordingly.

---

## Running locally

**Prerequisites:** IB Gateway running, Redis running

```bash
# Backend
cd backend
python -m uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload

# Frontend
cd frontend
npm run dev   # → http://localhost:5173
```

Vite proxies `/api` and `/ws` to `localhost:8000` (see `vite.config.ts`).

---

## Key constraints

- `reqRealTimeBars` limit: ~100 simultaneous subscriptions on a standard IBKR account. Scanner stays within this via 50 results × 3 scan codes with overlap.
- `reqMktData` uses the same subscription pool — Tier 2 promotions cancel the corresponding Tier 1 sub.
- IBKR news requires `reqHistoricalNews` with provider codes from `reqNewsProviders()`. Falls back to yfinance if IBKR news is unavailable.
- Float data comes from yfinance (free, cached 24h). Not available for very new tickers.
- `reqRealTimeBars` minimum resolution is 5 seconds — cannot go faster for Tier 1.

---

## What's working

- Live scanner discovery (3 IBKR scan codes, refresh every 60s)
- Real-time 5-second bar aggregation into 1m/5m bars
- Tier 1/Tier 2 subscription management
- Mid-bar vol-spike detection and event push
- Multi-scanner with Top List and Live Events modes
- Per-scanner config: filters, columns, auto-switch
- 2×2 chart grid with all technical indicators
- Watchlist panel with live data + news feed
- Tier 2 auto-promote on chart/watchlist membership
- IBKR news via reqHistoricalNews (trigger-based + 5-min poll)
- Market clock synced to IBKR time

---

## Pending / next steps

- More scan codes to improve discovery coverage (e.g. `TOP_PERC_LOSE`, `MOST_ACTIVE`)
- TradingView Charting Library access (submitted request — would replace lightweight-charts)
- Right panel width drag-resize (currently fixed at 260px)
- Watchlist persistence across page reloads (localStorage)
- Position sizing / trade execution integration (IBKR order routing)
