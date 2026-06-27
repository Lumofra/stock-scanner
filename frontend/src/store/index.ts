import { create } from "zustand";

export interface NewsHeadline {
  headline: string;
  provider: string;
  time: string;  // "HH:MM"
}

export interface ScannerRow {
  ticker: string;
  price: number;
  change_pct: number;
  volume: number;
  rel_vol: number;
  float: number | null;
  has_news: boolean;
  news_headlines: NewsHeadline[];
  hit_count: number;
  first_seen: number;  // ms timestamp
  last_seen: number;   // ms timestamp
}

export interface Alert {
  id: string;
  ticker: string;
  alert_type: "volume_breakout" | "price_spike_5pct" | string;
  price: number;
  volume: number;
  rel_vol: number;
  change_pct: number;
  float: number | null;
  has_news: boolean;
  timestamp: number;
  bars_1m: Bar[];
}

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type ScannerMode = "toplist" | "events";

export interface ScannerFilters {
  minRelVol: number;
  minChangePct: number;
  maxChangePct: number | null;
  minPrice: number;
  maxPrice: number;
  maxFloat: number | null;  // millions
  minVolume: number;        // thousands
  hasNewsOnly: boolean;
  sortBy: "rel_vol" | "change_pct" | "volume" | "price";
  sortDesc: boolean;
  autoSwitch: boolean;
}

export interface EventCondition {
  multiplier: number;    // e.g. 5 — fire when current bar vol > N× avg
  lookback: number;      // e.g. 5 — avg of previous N bars
  minPrice: number;
  maxPrice: number;
  maxFloat: number | null;
  hasNewsOnly: boolean;
}

// Columns available in each mode
export type TopListCol = "price" | "change_pct" | "rel_vol" | "volume" | "float" | "has_news";
export type EventCol   = "time" | "price" | "change_pct" | "vol_ratio" | "rel_vol" | "volume" | "float" | "has_news" | "hits";

export interface ScannerConfig {
  id: string;
  name: string;
  mode: ScannerMode;
  filters: ScannerFilters;           // used by toplist
  eventCondition: EventCondition;    // used by events
  columns: string[];                 // selected columns for display
}

export interface ScannerEvent {
  ticker: string;
  event_type: string;
  timestamp: number;       // ms
  bar_time: number;        // bar start Unix s
  price: number;
  change_pct: number;
  rel_vol: number;
  float: number | null;
  has_news: boolean;
  news_headlines: NewsHeadline[];
  bar_volume: number;
  vol_ratio_1: number;
  vol_ratio_3: number;
  vol_ratio_5: number;
  vol_ratio_10: number;
  hits: number;
}

const BASE_FILTERS: ScannerFilters = {
  minRelVol: 2, minChangePct: 0, maxChangePct: null,
  minPrice: 0.5, maxPrice: 25, maxFloat: 30, minVolume: 50,
  hasNewsOnly: false, sortBy: "rel_vol", sortDesc: true, autoSwitch: false,
};

const BASE_EVENT: EventCondition = {
  multiplier: 5, lookback: 5, minPrice: 0.5, maxPrice: 25,
  maxFloat: 30, hasNewsOnly: false,
};

const DEFAULT_SCANNERS: ScannerConfig[] = [
  {
    id: "high-relvol",
    name: "High RelVol",
    mode: "toplist",
    filters: { ...BASE_FILTERS, minRelVol: 3, minChangePct: 3, minVolume: 100, autoSwitch: true },
    eventCondition: BASE_EVENT,
    columns: ["price", "change_pct", "rel_vol", "float", "has_news"],
  },
  {
    id: "top-gainers",
    name: "Top Gainers",
    mode: "toplist",
    filters: { ...BASE_FILTERS, minRelVol: 2, minChangePct: 10, sortBy: "change_pct" },
    eventCondition: BASE_EVENT,
    columns: ["price", "change_pct", "rel_vol", "float", "has_news"],
  },
  {
    id: "vol-spike-events",
    name: "Vol Spike NOW",
    mode: "events",
    filters: BASE_FILTERS,
    eventCondition: { ...BASE_EVENT, multiplier: 5, lookback: 5 },
    columns: ["time", "price", "change_pct", "vol_ratio", "rel_vol", "float", "has_news", "hits"],
  },
  {
    id: "news-catalyst",
    name: "News",
    mode: "toplist",
    filters: { ...BASE_FILTERS, minRelVol: 1, minChangePct: 2, hasNewsOnly: true, sortBy: "rel_vol" },
    eventCondition: BASE_EVENT,
    columns: ["price", "change_pct", "rel_vol", "float", "has_news"],
  },
];

interface Store {
  scannerRows: ScannerRow[];
  setScannerRows: (rows: ScannerRow[]) => void;

  selectedTicker: string | null;
  selectTicker: (ticker: string | null) => void;

  triggerTicker: string | null;
  setTriggerTicker: (ticker: string | null) => void;

  alerts: Alert[];
  addAlert: (alert: Alert) => void;

  soundEnabled: boolean;
  toggleSound: () => void;

  scannerConfigs: ScannerConfig[];
  addScanner: () => void;
  updateScanner: (id: string, updates: Partial<ScannerConfig>) => void;
  removeScanner: (id: string) => void;

  watchlist: string[];
  addToWatchlist: (ticker: string) => void;
  removeFromWatchlist: (ticker: string) => void;
}

export const useStore = create<Store>((set) => ({
  scannerRows: [],
  setScannerRows: (rows) => set({ scannerRows: rows }),

  selectedTicker: null,
  selectTicker: (ticker) => set({ selectedTicker: ticker }),

  triggerTicker: null,
  setTriggerTicker: (ticker) => set({ triggerTicker: ticker }),

  alerts: [],
  addAlert: (alert) =>
    set((state) => ({ alerts: [alert, ...state.alerts].slice(0, 100) })),

  soundEnabled: true,
  toggleSound: () => set((s) => ({ soundEnabled: !s.soundEnabled })),

  scannerConfigs: DEFAULT_SCANNERS,
  addScanner: () =>
    set((s) => ({
      scannerConfigs: [
        ...s.scannerConfigs,
        {
          id: `scanner-${Date.now()}`,
          name: `Scanner ${s.scannerConfigs.length + 1}`,
          filters: { ...BASE },
        },
      ],
    })),
  updateScanner: (id, updates) =>
    set((s) => ({
      scannerConfigs: s.scannerConfigs.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
    })),
  removeScanner: (id) =>
    set((s) => ({
      scannerConfigs: s.scannerConfigs.filter((c) => c.id !== id),
    })),

  watchlist: [],
  addToWatchlist: (ticker) =>
    set((s) => ({
      watchlist: s.watchlist.includes(ticker) ? s.watchlist : [...s.watchlist, ticker],
    })),
  removeFromWatchlist: (ticker) =>
    set((s) => ({ watchlist: s.watchlist.filter((t) => t !== ticker) })),
}));
