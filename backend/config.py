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
MIN_PRICE: float = 1.00

# Days of 1-min history used to compute average intraday volume (rel vol baseline)
RELVOL_HISTORY_DAYS: int = 10

# ---------------------------------------------------------------------------
# DAS Trader Remote API
# Enable in DAS: Setup → API Settings → Enable API, set port
# ---------------------------------------------------------------------------
DAS_HOST: str = os.getenv("DAS_HOST", "127.0.0.1")
DAS_PORT: int = int(os.getenv("DAS_PORT", "9910"))
