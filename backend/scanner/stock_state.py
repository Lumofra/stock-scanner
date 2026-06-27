import time
from dataclasses import dataclass, field
from collections import deque
from typing import Optional


@dataclass
class Bar:
    time: int    # Unix seconds (start of bar)
    open: float
    high: float
    low: float
    close: float
    volume: int

    def to_dict(self) -> dict:
        return {
            "time": self.time,
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "volume": self.volume,
        }


@dataclass
class StockState:
    ticker: str
    price: float = 0.0
    prev_close: float = 0.0
    volume_today: int = 0
    float_shares: Optional[int] = None
    has_news_today: bool = False
    news_headlines: list = field(default_factory=list)  # [{headline, provider, time}]

    # avg_by_minute[minute_of_day] = average historical volume at that minute
    # minute_of_day 0 = 4:00am ET (pre-market open), 330 = 9:30am ET (market open)
    avg_by_minute: dict = field(default_factory=dict)

    # Current minute of day (0-based from 4am ET), updated by data feed
    current_minute_of_day: int = 0

    # Scanner tracking — updated every 60s when IBKR scanner cycle runs
    hit_count: int = 0
    first_seen: float = 0.0   # Unix timestamp (seconds)
    last_seen: float = 0.0    # Unix timestamp (seconds)

    # Rolling intraday bars — maxlen keeps memory bounded
    bars_1m: deque = field(default_factory=lambda: deque(maxlen=480))  # ~8 hours
    bars_5m: deque = field(default_factory=lambda: deque(maxlen=100))

    @property
    def avg_volume_at_time(self) -> float:
        return self.avg_by_minute.get(self.current_minute_of_day, 0.0)

    @property
    def relative_volume(self) -> float:
        avg = self.avg_volume_at_time
        if avg < 1:
            return 0.0
        return self.volume_today / avg

    @property
    def price_change_pct(self) -> float:
        if self.prev_close == 0:
            return 0.0
        return (self.price - self.prev_close) / self.prev_close * 100

    def to_scanner_row(self) -> dict:
        return {
            "ticker": self.ticker,
            "price": round(self.price, 4),
            "change_pct": round(self.price_change_pct, 2),
            "volume": self.volume_today,
            "rel_vol": round(self.relative_volume, 2),
            "float": self.float_shares,
            "has_news": self.has_news_today,
            "news_headlines": self.news_headlines,
            "hit_count": self.hit_count,
            "first_seen": int(self.first_seen * 1000) if self.first_seen else 0,
            "last_seen": int(self.last_seen * 1000) if self.last_seen else 0,
        }


# Global in-memory registry — all modules import from here
STOCKS: dict[str, StockState] = {}
