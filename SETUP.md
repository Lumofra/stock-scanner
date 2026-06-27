# NASDAQ Scanner — Setup Guide (IBKR edition)

## Prerequisites

- IBKR live or paper account (you already have this)
- IB Gateway installed (free download from IBKR)
- Docker Desktop for Windows (for Redis)
- Python 3.12+
- Node.js 20+

---

## Step 1 — Install and configure IB Gateway

**Download IB Gateway** (lighter than TWS — no charts, just the API bridge):
https://www.interactivebrokers.com/en/trading/ibgateway.php

**First-time configuration in IB Gateway:**
1. Log in with your IBKR credentials
2. Go to **Configure → Settings → API → Settings**
3. Check **"Enable ActiveX and Socket Clients"**
4. Set **Socket port** to `4001` (live) or `4002` (paper)
5. Add `127.0.0.1` to the **Trusted IP Addresses** list
6. Uncheck **"Read-Only API"** is optional — the scanner only reads data
7. Click **OK** and restart IB Gateway

IB Gateway must be **running and logged in** whenever the scanner backend is running.

---

## Step 2 — Check your market data subscriptions

In IB Gateway or TWS: **Account → Market Data Subscriptions**

For NASDAQ small-cap scanning you need:
- **US Securities Snapshot and Futures Value Bundle** (usually free/included)
- or **NASDAQ (NMS & Small Cap)** — typically ~$1.50/month for non-professionals

Most active IBKR accounts already have US stock data active. If the scanner
shows no tickers, check this page first.

---

## Step 3 — Configure .env

```bash
cp .env.example .env
```

The defaults work if IB Gateway is running on the same machine on port 4001.
Only change `IBKR_PORT` if you use IB Gateway paper (4002) or TWS (7496/7497).

---

## Step 4 — Run

**Start Redis (required for caching):**
```bash
docker compose up redis
```

**Start backend:**
```bash
cd backend
pip install -r requirements.txt
uvicorn api.main:app --reload --port 8000
```

You should see in the log:
```
Connected to IB Gateway at 127.0.0.1:4001 (clientId=1)
Scanner results: 47 tickers (ABCD, EFGH, ...)
Subscribed: ABCD
...
```

**Start frontend:**
```bash
cd frontend
npm install
npm run dev
```

Open: **http://localhost:5173**

---

## How it works

```
IB Gateway (running on your PC)
      │ localhost:4001
      ▼
 data_feed.py (ib_insync)
      ├── reqScannerSubscription  → finds top NASDAQ small-caps every 60s
      │     (MOST_ACTIVE_USD, HOT_BY_VOLUME, TOP_PERC_GAIN — up to 150 tickers)
      └── reqRealTimeBars         → 5-second OHLCV bars for each scanner result
            └── aggregated → 1-min bars → 5-min bars
                              ├── scanner engine (price, vol, rel vol filters)
                              └── alert engine (breakout/spike detection)

 yfinance (background, cached in Redis)
      ├── float shares (24h cache)
      └── news flag   (1h cache)

 ibkr_client.py (IBKR REST)
      ├── prev close (for % change)
      ├── 10-day 1-min history (for relative volume baseline)
      └── today's volume (seeds volume_today on mid-session restart)
```

---

## Market hours (Norway / CET)

| Session       | ET            | CET (summer) |
|---------------|---------------|--------------|
| Pre-market    | 4:00–9:30 AM  | 10:00–15:30  |
| Market open   | 9:30–4:00 PM  | 15:30–22:00  |
| After-hours   | 4:00–8:00 PM  | 22:00–02:00  |

IBKR streams real-time bars through all sessions when IB Gateway is connected.

---

## Testing

**Check connection and subscription count:**
```bash
curl http://localhost:8000/health
```
Expected response once connected:
```json
{"status": "ok", "tracked_tickers": 47, "active_tickers": 47, "realtime_subscriptions": 47}
```

**Fire a fake alert (test frontend sound + charts):**
```bash
curl -X POST "http://localhost:8000/api/test/alert?ticker=ABCD"
```

**If scanner shows 0 tickers:**
1. Confirm IB Gateway is running and logged in
2. Check `IBKR_PORT` in `.env` matches IB Gateway's configured port
3. Check market data subscriptions in IB Gateway
4. Check the backend log for connection errors

---

## Adjust scanner filters (live, no restart)

```bash
curl -X POST http://localhost:8000/api/filters \
  -H "Content-Type: application/json" \
  -d '{
    "price_max": 10,
    "float_max": 10000000,
    "relvol_min": 8,
    "volume_min": 200000,
    "sort_by": "rel_vol"
  }'
```

Or use the **Filters** button in the scanner UI.

---

## Multiple IB Gateway clients (clientId conflict)

If you run another application (TWS, another scanner) alongside this one,
each needs a unique `clientId`. Set `IBKR_CLIENT_ID=2` (or any unused number)
in `.env` if you get a "clientId already in use" error.

---

## Adding custom alert types

Edit `backend/scanner/alert_engine.py`, add conditions to `on_bar_complete()`:

```python
# Example: alert on a new intraday high
all_highs = [b.high for b in list(state.bars_1m)[:-1]]
if all_highs and curr_bar.high > max(all_highs):
    await _fire(ticker, state, "new_intraday_high")
```

The new type appears automatically in the frontend alert feed.
