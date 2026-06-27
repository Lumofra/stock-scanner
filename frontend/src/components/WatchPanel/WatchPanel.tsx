import { useEffect, useRef, useState } from "react";
import { useStore, ScannerRow } from "../../store";

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + "K";
  return n.toString();
}

function timeStr(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: false,
    timeZone: "America/New_York",
  });
}

// ── Watchlist section ─────────────────────────────────────────────────────────

function WatchlistSection({ height, tier2Set }: { height: number; tier2Set: Set<string> }) {
  const watchlist         = useStore((s) => s.watchlist);
  const addToWatchlist    = useStore((s) => s.addToWatchlist);
  const removeFromWatchlist = useStore((s) => s.removeFromWatchlist);
  const scannerRows       = useStore((s) => s.scannerRows);
  const selectedTicker    = useStore((s) => s.selectedTicker);
  const selectTicker      = useStore((s) => s.selectTicker);

  const [input, setInput] = useState("");

  const rowMap = new Map<string, ScannerRow>(scannerRows.map((r) => [r.ticker, r]));

  function add() {
    const t = input.trim().toUpperCase();
    if (t) { addToWatchlist(t); setInput(""); }
  }

  return (
    <div style={{ height }} className="flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-1 bg-[#161b22] border-b border-[#21262d] shrink-0">
        <span className="text-[10px] font-semibold text-[#8b949e] tracking-wider">WATCHLIST</span>
        <span className="text-[9px] text-[#444c56] ml-1">{watchlist.length}</span>
        <div className="flex items-center gap-1 ml-auto">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            placeholder="+ ticker"
            className="bg-[#0d1117] border border-[#30363d] text-white rounded px-1.5 py-0.5 text-[10px] w-16 placeholder:text-[#444c56] focus:outline-none focus:border-blue-600"
          />
          <button onClick={add} className="text-[10px] text-[#444c56] hover:text-white px-1">↵</button>
        </div>
      </div>

      {/* Rows */}
      <div className="overflow-auto flex-1 min-h-0">
        {watchlist.length === 0 && (
          <div className="p-3 text-[10px] text-[#30363d] text-center">Legg til tickers du vil følge</div>
        )}
        {watchlist.map((ticker) => {
          const row = rowMap.get(ticker);
          const isT2 = tier2Set.has(ticker);
          const isSelected = selectedTicker === ticker;
          return (
            <div key={ticker}
              onClick={() => selectTicker(isSelected ? null : ticker)}
              className={`flex items-center gap-1 px-2 py-1.5 border-b border-[#21262d] cursor-pointer transition-colors ${
                isSelected ? "bg-[#1f2937]" : "hover:bg-[#161b22]"
              }`}
            >
              {/* Tier 2 indicator */}
              <span className={`text-[8px] mr-0.5 ${isT2 ? "text-blue-400" : "text-[#30363d]"}`}>⚡</span>

              <span className="text-xs font-bold text-white w-14 truncate">{ticker}</span>

              {row ? (
                <>
                  <span className="text-[10px] text-white tabular-nums ml-1">
                    ${row.price.toFixed(row.price < 1 ? 4 : 2)}
                  </span>
                  <span className={`text-[9px] font-medium tabular-nums ml-auto ${row.change_pct >= 0 ? "text-[#26a69a]" : "text-[#ef5350]"}`}>
                    {row.change_pct >= 0 ? "+" : ""}{row.change_pct.toFixed(2)}%
                  </span>
                  <span className="text-[9px] text-yellow-300 ml-1">{row.rel_vol.toFixed(1)}×</span>
                  {row.has_news && <span className="text-[8px] bg-blue-900 text-blue-300 rounded px-0.5 ml-1">N</span>}
                </>
              ) : (
                <span className="text-[9px] text-[#444c56] ml-auto">ingen data</span>
              )}

              <button
                onClick={(e) => { e.stopPropagation(); removeFromWatchlist(ticker); }}
                className="text-[10px] text-[#30363d] hover:text-red-400 ml-1 shrink-0"
              >×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── News section ──────────────────────────────────────────────────────────────

interface NewsItem {
  ticker: string;
  headline: string;
  provider: string;
  time: string;
}

function NewsSection({ height }: { height: number }) {
  const scannerRows    = useStore((s) => s.scannerRows);
  const watchlist      = useStore((s) => s.watchlist);
  const selectedTicker = useStore((s) => s.selectedTicker);
  const triggerTicker  = useStore((s) => s.triggerTicker);

  // Collect all relevant tickers
  const relevant = new Set<string>([
    ...(selectedTicker ? [selectedTicker] : []),
    ...(triggerTicker  ? [triggerTicker]  : []),
    ...watchlist,
  ]);

  const rowMap = new Map<string, ScannerRow>(scannerRows.map((r) => [r.ticker, r]));

  const newsItems: NewsItem[] = [];
  for (const ticker of relevant) {
    const row = rowMap.get(ticker);
    if (row?.news_headlines?.length) {
      for (const h of row.news_headlines) {
        newsItems.push({ ticker, ...h });
      }
    }
  }

  return (
    <div style={{ height }} className="flex flex-col overflow-hidden">
      <div className="px-2 py-1 bg-[#161b22] border-b border-[#21262d] shrink-0">
        <span className="text-[10px] font-semibold text-[#8b949e] tracking-wider">NYHETER</span>
      </div>
      <div className="overflow-auto flex-1 min-h-0">
        {newsItems.length === 0 && (
          <div className="p-3 text-[10px] text-[#30363d] text-center">Ingen nyheter for aktive tickers</div>
        )}
        {newsItems.map((item, i) => (
          <div key={i} className="px-2 py-1.5 border-b border-[#21262d] hover:bg-[#161b22]">
            <div className="flex items-center gap-1 mb-0.5">
              <span className="text-[9px] font-bold text-blue-400">{item.ticker}</span>
              <span className="text-[9px] text-[#444c56]">{item.provider}</span>
              <span className="text-[9px] text-[#444c56] ml-auto">{item.time}</span>
            </div>
            <div className="text-[10px] text-[#c9d1d9] leading-snug">{item.headline}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main WatchPanel ───────────────────────────────────────────────────────────

export function WatchPanel() {
  const selectedTicker = useStore((s) => s.selectedTicker);
  const triggerTicker  = useStore((s) => s.triggerTicker);
  const watchlist      = useStore((s) => s.watchlist);

  const containerRef = useRef<HTMLDivElement>(null);
  const [split, setSplit]     = useState(55); // % for watchlist
  const [tier2Set, setTier2Set] = useState<Set<string>>(new Set());

  const dragging = useRef(false);
  const startY   = useRef(0);
  const startSplit = useRef(split);

  // Sync tier2 with backend whenever charts or watchlist change
  useEffect(() => {
    const wanted = new Set<string>([
      ...(selectedTicker ? [selectedTicker] : []),
      ...(triggerTicker  ? [triggerTicker]  : []),
      ...watchlist,
    ]);
    setTier2Set(new Set(wanted));
    fetch("/api/tier2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers: [...wanted] }),
    }).catch(() => {});
  }, [selectedTicker, triggerTicker, watchlist]);

  // Drag resize between watchlist and news
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const dy    = e.clientY - startY.current;
      const total = containerRef.current.clientHeight;
      setSplit(Math.max(20, Math.min(80, startSplit.current + (dy / total) * 100)));
    };
    const onUp = () => { dragging.current = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
    };
  }, []);

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    dragging.current  = true;
    startY.current    = e.clientY;
    startSplit.current = split;
  }

  const totalH = containerRef.current?.clientHeight ?? 600;
  const watchH = Math.round(totalH * split / 100);
  const newsH  = totalH - watchH - 4;

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
      <WatchlistSection height={watchH} tier2Set={tier2Set} />
      <div
        onMouseDown={startDrag}
        className="h-[4px] shrink-0 bg-[#21262d] hover:bg-blue-600 cursor-row-resize transition-colors"
      />
      <NewsSection height={newsH} />
    </div>
  );
}
