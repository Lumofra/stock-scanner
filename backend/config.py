import os
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# IB Gateway / TWS connection
# ---------------------------------------------------------------------------
# IB Gateway (recommended — lightweight, no GUI needed):
#   Live account  → port 4001
#   Paper account → port 4002
# TWS (full Trader Workstation):
#   Live account  → port 7496
#   Paper account → port 7497
IBKR_HOST: str = os.getenv("IBKR_HOST", "127.0.0.1")
IBKR_PORT: int = int(os.getenv("IBKR_PORT", "4001"))
IBKR_CLIENT_ID: int = int(os.getenv("IBKR_CLIENT_ID", "1"))

REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379")

# ---------------------------------------------------------------------------
# Scanner universe
# ---------------------------------------------------------------------------
MAX_FLOAT: int = 30_000_000
MAX_PRICE: float = 25.0
MIN_PRICE: float = 0.10

# How often the IBKR server-side scanner refreshes (seconds)
SCANNER_REFRESH_SECONDS: int = 60

# Days of 1-min history used to compute average intraday volume (rel vol baseline)
RELVOL_HISTORY_DAYS: int = 10

# Minimum seconds between repeat alerts for the same ticker
ALERT_COOLDOWN_SECONDS: int = 60
