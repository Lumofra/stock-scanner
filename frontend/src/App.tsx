import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { MultiScanner } from "./components/MultiScanner/MultiScanner";
import { WatchPanel } from "./components/WatchPanel/WatchPanel";
import { RealtimeChart } from "./components/Charts/RealtimeChart";

type DragTarget = "left" | "right" | "colSplit" | "rowSplit" | null;

interface DragInfo {
  target:     DragTarget;
  startX:     number;
  startY:     number;
  startLeft:  number;
  startRight: number;
  startCol:   number;
  startRow:   number;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function VHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="h-[4px] w-full shrink-0 bg-[#21262d] hover:bg-blue-600 cursor-row-resize transition-colors z-10"
    />
  );
}

function HHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="w-[4px] h-full shrink-0 bg-[#21262d] hover:bg-blue-600 cursor-col-resize transition-colors z-10"
    />
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="w-full h-full flex items-center justify-center text-[#30363d] text-[10px]">
      {text}
    </div>
  );
}

export default function App() {
  const selectedTicker   = useStore((s) => s.selectedTicker);
  const selectTicker     = useStore((s) => s.selectTicker);
  const triggerTicker    = useStore((s) => s.triggerTicker);
  const setTriggerTicker = useStore((s) => s.setTriggerTicker);

  const [leftWidth,  setLeftWidth]  = useState(300);  // scanner panel px
  const [watchWidth, setWatchWidth] = useState(260);  // watch panel px
  const [colSplit,   setColSplit]   = useState(38);   // % of chart area for LEFT column
  const [rowSplit,   setRowSplit]   = useState(55);   // % of chart area for TOP row
  const [inputVal,   setInputVal]   = useState("");

  const chartAreaRef = useRef<HTMLDivElement>(null);
  const drag         = useRef<DragInfo | null>(null);
  const stateRef     = useRef({ leftWidth, watchWidth, colSplit, rowSplit });
  stateRef.current   = { leftWidth, watchWidth, colSplit, rowSplit };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current) return;
      const { target, startX, startY, startLeft, startRight, startCol, startRow } = drag.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (target === "left") {
        setLeftWidth(clamp(startLeft + dx, 160, 600));
      } else if (target === "right") {
        // Drag handle is on left edge of watch panel → moving left widens it
        setWatchWidth(clamp(startRight - dx, 160, 520));
      } else if (target === "colSplit") {
        const chartW = (chartAreaRef.current?.clientWidth ?? 800);
        setColSplit(clamp(startCol + (dx / chartW) * 100, 15, 75));
      } else if (target === "rowSplit") {
        const chartH = (chartAreaRef.current?.clientHeight ?? 600);
        setRowSplit(clamp(startRow + (dy / chartH) * 100, 15, 80));
      }
    };
    const onUp = () => { drag.current = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
    };
  }, []);

  function startDrag(e: React.MouseEvent, target: DragTarget) {
    e.preventDefault();
    drag.current = {
      target, startX: e.clientX, startY: e.clientY,
      startLeft:  stateRef.current.leftWidth,
      startRight: stateRef.current.watchWidth,
      startCol:   stateRef.current.colSplit,
      startRow:   stateRef.current.rowSplit,
    };
  }

  function submitTicker(val: string) {
    const t = val.trim().toUpperCase();
    if (t) { selectTicker(t); setInputVal(""); }
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0d1117] text-white font-mono select-none">

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-[#21262d] bg-[#161b22] shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-sm font-bold tracking-widest">NASDAQ SCANNER</span>
          <span className="text-[10px] text-[#8b949e] border border-[#30363d] rounded px-1.5 py-0.5">SMALL CAP</span>

          {/* Vertical separator */}
          <div className="w-px h-4 bg-[#30363d]" />

          {/* Global universe config — sets WHICH tickers enter the system */}
          <UniverseButton />

          {/* Vertical separator */}
          <div className="w-px h-4 bg-[#30363d]" />

          {/* IBKR subscription counter */}
          <IBKRCounter />
        </div>
        <MarketStatus />
      </header>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* Scanner */}
        <div style={{ width: leftWidth }} className="shrink-0 flex flex-col border-r border-[#21262d] min-h-0 overflow-hidden">
          <MultiScanner />
        </div>

        {/* Drag: scanner ↔ charts */}
        <div
          onMouseDown={(e) => startDrag(e, "left")}
          className="w-[4px] shrink-0 bg-[#21262d] hover:bg-blue-600 cursor-col-resize transition-colors"
        />

        {/* Chart area */}
        <div ref={chartAreaRef} className="flex-1 flex flex-col min-h-0 overflow-hidden">

          {/* Ticker search bar */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[#21262d] bg-[#161b22] shrink-0">
            {selectedTicker
              ? <span className="text-sm font-bold text-white tracking-wider">{selectedTicker}</span>
              : <span className="text-xs text-[#444c56]">Ingen ticker valgt</span>
            }
            <div className="flex items-center gap-1 ml-auto">
              <input
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitTicker(inputVal);
                  if (e.key === "Escape") setInputVal("");
                }}
                placeholder="Søk ticker..."
                className="bg-[#0d1117] border border-[#30363d] text-white rounded px-2 py-1 text-xs w-28 placeholder:text-[#444c56] focus:outline-none focus:border-blue-600"
              />
              <button
                onClick={() => submitTicker(inputVal)}
                className="text-xs bg-[#21262d] hover:bg-[#30363d] text-[#8b949e] hover:text-white rounded px-2 py-1 border border-[#30363d]"
              >↵</button>
              {selectedTicker && (
                <button onClick={() => selectTicker(null)} className="text-[10px] text-[#444c56] hover:text-[#8b949e] ml-1">×</button>
              )}
            </div>
          </div>

          {/*
              2×2 chart grid:
              ┌──────────────────┬──────────────────────┐
              │  ⚡ Trigger 1m   │  1m Manual           │  ← rowSplit %
              ├──────────────────┼──────────────────────┤
              │  5m Manual       │  Daily Manual         │  ← (100-rowSplit) %
              └──────────────────┴──────────────────────┘
                  colSplit %         (100-colSplit) %
          */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

            {/* TOP ROW */}
            <div style={{ height: `${rowSplit}%` }} className="flex min-h-0 overflow-hidden">

              {/* Top-left: Trigger chart */}
              <div style={{ width: `${colSplit}%` }} className="flex flex-col min-w-0 overflow-hidden border-r border-[#21262d]">
                <div className="flex items-center gap-1 px-2 py-0.5 bg-[#0d1117] border-b border-[#21262d] shrink-0">
                  <span className="text-[10px] text-blue-400 font-bold">⚡</span>
                  <span className="text-[10px] text-[#8b949e] font-semibold">TRIGGER</span>
                  {triggerTicker
                    ? <span className="text-[10px] font-bold text-white ml-1">{triggerTicker}</span>
                    : <span className="text-[9px] text-[#444c56] ml-1">venter...</span>
                  }
                  <div className="ml-auto flex items-center gap-1">
                    <span className="text-[9px] text-[#30363d]">1m · auto</span>
                    {triggerTicker && (
                      <>
                        <button
                          onClick={() => selectTicker(triggerTicker)}
                          title="Send ticker til de tre andre chartene"
                          className="text-[9px] bg-blue-700 hover:bg-blue-600 text-white rounded px-1.5 py-0.5 ml-1"
                        >
                          → charts
                        </button>
                        <button onClick={() => setTriggerTicker(null)} className="text-[10px] text-[#444c56] hover:text-[#8b949e] ml-0.5">×</button>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex-1 min-h-0">
                  {triggerTicker
                    ? <RealtimeChart ticker={triggerTicker} defaultTimeframe="1m" lockTimeframe />
                    : <Empty text="Aktiver auto-switch i en scanner" />
                  }
                </div>
              </div>

              {/* Top-right: 1m manual */}
              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {selectedTicker
                  ? <RealtimeChart ticker={selectedTicker} defaultTimeframe="1m" />
                  : <Empty text="1 Min" />
                }
              </div>
            </div>

            {/* Horizontal drag handle (top ↕ bottom) */}
            <VHandle onMouseDown={(e) => startDrag(e, "rowSplit")} />

            {/* BOTTOM ROW */}
            <div className="flex-1 flex min-h-0 overflow-hidden">

              {/* Bottom-left: 5m manual */}
              <div style={{ width: `${colSplit}%` }} className="flex flex-col min-w-0 overflow-hidden border-r border-[#21262d]">
                {selectedTicker
                  ? <RealtimeChart ticker={selectedTicker} defaultTimeframe="5m" />
                  : <Empty text="5 Min" />
                }
              </div>

              {/* Bottom-right: Daily */}
              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                {selectedTicker
                  ? <RealtimeChart ticker={selectedTicker} defaultTimeframe="1D" />
                  : <Empty text="Daily" />
                }
              </div>
            </div>
          </div>
        </div>

        {/* Drag: chart grid ↔ daily (shared colSplit line) is inside grid */}
        {/* Vertical column drag — floated overlay on the col boundary */}
        <ColSplitOverlay
          leftWidth={leftWidth}
          colPct={colSplit}
          chartAreaRef={chartAreaRef}
          onMouseDown={(e) => startDrag(e, "colSplit")}
        />

        {/* Drag: charts ↔ watch panel */}
        <div
          onMouseDown={(e) => startDrag(e, "right")}
          className="w-[4px] shrink-0 bg-[#21262d] hover:bg-blue-600 cursor-col-resize transition-colors"
        />

        {/* Watch panel */}
        <div style={{ width: watchWidth }} className="shrink-0 overflow-hidden">
          <WatchPanel />
        </div>
      </div>
    </div>
  );
}

// Invisible drag overlay spanning the full height of the chart area on the column boundary
function ColSplitOverlay({ leftWidth, colPct, chartAreaRef, onMouseDown }: {
  leftWidth: number;
  colPct: number;
  chartAreaRef: React.RefObject<HTMLDivElement>;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const [rect, setRect] = useState<{ top: number; height: number; left: number } | null>(null);

  useEffect(() => {
    function update() {
      if (!chartAreaRef.current) return;
      const r = chartAreaRef.current.getBoundingClientRect();
      const chartW = r.width;
      setRect({ top: r.top, height: r.height, left: r.left + chartW * (colPct / 100) });
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [leftWidth, colPct, chartAreaRef]);

  if (!rect) return null;
  return (
    <div
      onMouseDown={onMouseDown}
      style={{ position: "fixed", top: rect.top, left: rect.left - 2, width: 4, height: rect.height }}
      className="bg-[#21262d] hover:bg-blue-600 cursor-col-resize transition-colors z-20"
    />
  );
}

// ---------------------------------------------------------------------------
// IBKR subscription counter + scanner universe settings
// ---------------------------------------------------------------------------

interface HealthData {
  subscriptions: { tier1: number; tier2: number; total: number; limit: number };
  scan_params:   { min_price: number; max_price: number; max_float: number; max_market_cap: number };
}

const DEFAULT_SCAN_PARAMS: ScanParams = {
  min_price: 1.0, max_price: 25.0,
  max_float: 30_000_000, max_market_cap: 1_000_000_000,
};

// Universe button — opens global scanner universe config
function UniverseButton() {
  const [params, setParams]     = useState<ScanParams>(DEFAULT_SCAN_PARAMS);
  const [showModal, setShowModal] = useState(false);
  const [loaded, setLoaded]     = useState(false);

  useEffect(() => {
    fetch("/api/scanner/params")
      .then((r) => r.json())
      .then((d) => { setParams(d); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-1.5 text-[10px] text-[#8b949e] hover:text-white border border-[#30363d] hover:border-[#8b949e] rounded px-2 py-0.5 transition-colors"
        title="Global universe: hvilke tickers scannerne kan finne"
      >
        <span>⚙</span>
        <span className="font-semibold tracking-wider">UNIVERSE</span>
        {loaded && (
          <span className="text-[9px] text-[#444c56]">
            ${params.min_price}–${params.max_price} · float {(params.max_float / 1_000_000).toFixed(0)}M
          </span>
        )}
      </button>

      {showModal && (
        <ScannerUniverseModal
          params={params}
          onClose={() => setShowModal(false)}
          onSaved={(p) => { setParams(p); setShowModal(false); }}
        />
      )}
    </>
  );
}

// IBKR subscription counter (read-only, polls /health every 5s)
function IBKRCounter() {
  const [subs, setSubs] = useState<{ tier1: number; tier2: number; total: number; limit: number } | null>(null);

  useEffect(() => {
    async function poll() {
      try {
        const r = await fetch("/health");
        const d = await r.json();
        if (d.subscriptions) setSubs(d.subscriptions);
      } catch {}
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  if (!subs) return null;
  const { tier1, tier2, total, limit } = subs;
  const pct      = total / limit;
  const dotColor = pct > 0.95 ? "bg-red-500"    : pct > 0.80 ? "bg-yellow-400" : "bg-[#26a69a]";
  const numColor = pct > 0.95 ? "text-red-400"  : pct > 0.80 ? "text-yellow-400" : "text-[#8b949e]";

  return (
    <div
      className="flex items-center gap-1.5"
      title={`T1: ${tier1} reqRealTimeBars · T2: ${tier2} reqMktData · limit ~${limit}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
      <span className={`text-[10px] tabular-nums font-medium ${numColor}`}>IBKR {total}/{limit}</span>
      <span className="text-[9px] text-[#30363d]">T1:{tier1} T2:{tier2}</span>
    </div>
  );
}

interface ScanParams {
  min_price: number; max_price: number;
  max_float: number; max_market_cap: number;
}

function ScannerUniverseModal({ params, onClose, onSaved }: {
  params: ScanParams;
  onClose: () => void;
  onSaved: (p: ScanParams) => void;
}) {
  const [p, setP]       = useState<ScanParams>({ ...params });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const [stats, setStats]   = useState<{ tracked: number; active: number; t1: number; t2: number } | null>(null);

  useEffect(() => {
    fetch("/health")
      .then((r) => r.json())
      .then((d) => setStats({
        tracked: d.tracked_tickers ?? 0,
        active:  d.active_tickers  ?? 0,
        t1:      d.subscriptions?.tier1 ?? 0,
        t2:      d.subscriptions?.tier2 ?? 0,
      }))
      .catch(() => {});
  }, []);

  function set<K extends keyof ScanParams>(k: K, v: number) {
    setP((prev) => ({ ...prev, [k]: v }));
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const r = await fetch("/api/scanner/params", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const updated = await r.json();
      onSaved(updated);
    } catch (e: any) {
      setError("Feil ved lagring — er backend oppe?");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onClose}>
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg w-80 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Scanner universe</h2>
          <button onClick={onClose} className="text-[#8b949e] hover:text-white text-lg leading-none">×</button>
        </div>
        {/* Live stats */}
        <div className="flex gap-3 mb-4 p-2 bg-[#0d1117] rounded border border-[#21262d]">
          {stats ? (
            <>
              <div className="flex flex-col items-center flex-1">
                <span className="text-base font-bold text-white tabular-nums">{stats.tracked}</span>
                <span className="text-[9px] text-[#444c56]">oppdaget</span>
              </div>
              <div className="flex flex-col items-center flex-1">
                <span className="text-base font-bold text-[#26a69a] tabular-nums">{stats.active}</span>
                <span className="text-[9px] text-[#444c56]">aktive</span>
              </div>
              <div className="flex flex-col items-center flex-1">
                <span className="text-base font-bold text-blue-400 tabular-nums">{stats.t1}</span>
                <span className="text-[9px] text-[#444c56]">T1 subs</span>
              </div>
              <div className="flex flex-col items-center flex-1">
                <span className="text-base font-bold text-purple-400 tabular-nums">{stats.t2}</span>
                <span className="text-[9px] text-[#444c56]">T2 subs</span>
              </div>
            </>
          ) : (
            <span className="text-[9px] text-[#444c56] w-full text-center">Backend ikke tilkoblet</span>
          )}
        </div>
        <p className="text-[9px] text-[#444c56] mb-4 leading-relaxed">
          Disse filtrene avgjør hvilke tickers IBKR-scanneren plukker opp.
          IBKR returnerer maks 50 per søk × 3 søk = <span className="text-[#8b949e]">maks ~150 tickers</span> — alltid de mest aktive nå.
          Endringer trer i kraft neste scanner-runde (~60 sek).
        </p>

        {([
          { key: "min_price",      label: "Min pris ($)",          step: 0.5,       hint: "Anbefalt: 1.00" },
          { key: "max_price",      label: "Max pris ($)",          step: 1,         hint: "" },
          { key: "max_float",      label: "Max float (aksjer)",    step: 1_000_000, hint: "30M = small cap" },
          { key: "max_market_cap", label: "Max market cap ($)",    step: 100_000_000, hint: "1B = standard" },
        ] as { key: keyof ScanParams; label: string; step: number; hint: string }[]).map(({ key, label, step, hint }) => (
          <div key={key} className="mb-3">
            <label className="text-[10px] text-[#8b949e] uppercase tracking-wider block mb-1">{label}</label>
            {hint && <span className="text-[9px] text-[#444c56] block mb-1">{hint}</span>}
            <input
              type="number"
              step={step}
              value={p[key]}
              onChange={(e) => set(key, parseFloat(e.target.value) || 0)}
              className="bg-[#0d1117] border border-[#30363d] text-white rounded px-2 py-1 text-xs w-full focus:outline-none focus:border-blue-600"
            />
          </div>
        ))}

        {error && <p className="text-[10px] text-red-400 mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-xs text-[#8b949e] hover:text-white border border-[#30363d] rounded px-3 py-1.5">Avbryt</button>
          <button onClick={save} disabled={saving} className="text-xs bg-blue-700 hover:bg-blue-600 disabled:opacity-50 text-white rounded px-4 py-1.5">
            {saving ? "Lagrer..." : "Lagre"}
          </button>
        </div>
      </div>
    </div>
  );
}


function getETInfo(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric", minute: "numeric", second: "numeric",
    weekday: "short",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parseInt(parts.find((p) => p.type === type)?.value ?? "0");
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const h = get("hour");
  const m = get("minute");
  const s = get("second");
  return {
    minutes: h * 60 + m,
    isWeekend: weekday === "Sat" || weekday === "Sun",
    timeStr: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
  };
}

// Market sessions in ET minutes from midnight
// PRE-MARKET:  04:00–09:30  (240–570)
// OPENING:     09:30–09:45  (570–585)  — first 15 min, highest volatility
// MARKET OPEN: 09:45–15:00  (585–900)
// POWER HOUR:  15:00–16:00  (900–960)  — last hour, volume surge
// AFTER-HOURS: 16:00–20:00  (960–1200)
// CLOSED:      everything else + weekends

type MarketPhase = {
  label: string;
  color: string;
  dot: string;
  pulse: boolean;
};

function resolvePhase(minutes: number, isClosed: boolean, closeMins = 960): MarketPhase {
  const powerHourStart = closeMins - 60;
  const openMins = 570; // 09:30 always
  if (isClosed || minutes < 240 || minutes >= 1200)
    return { label: "MARKET CLOSED", color: "text-[#8b949e]",    dot: "bg-[#444c56]",    pulse: false };
  if (minutes < openMins)
    return { label: "PRE-MARKET",    color: "text-yellow-400",   dot: "bg-yellow-400",   pulse: false };
  if (minutes < openMins + 15)
    return { label: "OPENING",       color: "text-emerald-300",  dot: "bg-emerald-300",  pulse: true  };
  if (minutes < powerHourStart)
    return { label: "MARKET OPEN",   color: "text-[#26a69a]",    dot: "bg-[#26a69a]",    pulse: true  };
  if (minutes < closeMins)
    return { label: "POWER HOUR",    color: "text-orange-300",   dot: "bg-orange-300",   pulse: true  };
  return   { label: "AFTER-HOURS",   color: "text-orange-400",   dot: "bg-orange-400",   pulse: false };
}

interface MarketCalendar {
  is_trading_day: boolean;
  open:  string | null;   // "09:30"
  close: string | null;   // "13:00" on early-close days
  source: string;
}

function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function fmtCountdown(diffMin: number): string {
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  if (h > 0) return `${h}t ${m}m`;
  return `${m}m`;
}

function nextOpenLabel(now: Date): string {
  // Returns e.g. "åpner man 09:30" based on current ET weekday
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const dayMap: Record<string, number> = { Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:0 };
  const nbMap:  Record<string, string> = { Mon:"man", Tue:"tir", Wed:"ons", Thu:"tor", Fri:"fre", Sat:"man", Sun:"man" };
  const daysUntilMon: Record<string, string> = { Fri:"man", Sat:"man", Sun:"man" };
  if (weekday === "Fri" || weekday === "Sat" || weekday === "Sun")
    return `åpner man 09:30`;
  return `åpner i morgen 09:30`;
}

function MarketStatus() {
  const [now, setNow]           = useState(() => new Date());
  const [driftMs, setDriftMs]   = useState<number | null>(null);
  const [calendar, setCalendar] = useState<MarketCalendar | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Sync with IBKR time every 60 seconds
  useEffect(() => {
    async function sync() {
      try {
        const res  = await fetch("/api/time");
        const data = await res.json();
        if (data.drift_ms !== null) setDriftMs(data.drift_ms);
      } catch { /* ignore */ }
    }
    sync();
    const id = setInterval(sync, 60_000);
    return () => clearInterval(id);
  }, []);

  // Fetch market calendar once per day
  useEffect(() => {
    async function fetchCal() {
      try {
        const res  = await fetch("/api/market/today");
        const data = await res.json();
        setCalendar(data);
      } catch { /* ignore */ }
    }
    fetchCal();
    // Re-fetch at midnight ET each day
    const now_et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const msToMidnight = (
      new Date(now_et.getFullYear(), now_et.getMonth(), now_et.getDate() + 1).getTime() - now_et.getTime()
    );
    const t = setTimeout(fetchCal, msToMidnight);
    return () => clearTimeout(t);
  }, []);

  const { minutes, isWeekend, timeStr } = getETInfo(now);

  // Resolve phase using calendar for accurate close time
  const closeMins = calendar?.close ? parseHHMM(calendar.close) : 960;
  const openMins  = calendar?.open  ? parseHHMM(calendar.open)  : 570;
  const isTradingDay = calendar ? calendar.is_trading_day : !isWeekend;

  const phase = resolvePhase(
    minutes,
    isWeekend || !isTradingDay,
    closeMins,  // pass actual close so POWER HOUR uses real close time
  );

  // Countdown text
  let countdown: string | null = null;
  if (isTradingDay && !isWeekend) {
    if (phase.label === "PRE-MARKET") {
      countdown = `åpner om ${fmtCountdown(openMins - minutes)}`;
    } else if (["OPENING", "MARKET OPEN", "POWER HOUR"].includes(phase.label)) {
      const diff = closeMins - minutes;
      countdown = `stenger om ${fmtCountdown(diff)}`;
      // Warn when ≤ 15 min to close
      if (diff <= 15) countdown = `⚠ ${countdown}`;
    } else if (phase.label === "AFTER-HOURS") {
      countdown = nextOpenLabel(now);
    }
  } else {
    countdown = nextOpenLabel(now);
  }

  const driftWarn = driftMs !== null && Math.abs(driftMs) >= 5000;

  // Early-close badge — show if market closes before 15:30
  const earlyClose = isTradingDay && calendar?.close && closeMins < 15 * 60 + 30;

  return (
    <div className="flex items-center gap-3">
      {driftMs !== null && (
        <span
          className={`text-[9px] border rounded px-1.5 py-0.5 ${
            driftWarn ? "text-red-400 border-red-800" : "text-[#444c56] border-[#30363d]"
          }`}
          title={`Systemklokke vs IBKR: ${driftMs > 0 ? "+" : ""}${driftMs}ms`}
        >
          {driftWarn ? `⚠ drift ${Math.round(driftMs / 1000)}s` : `IBKR ±${Math.abs(driftMs)}ms`}
        </span>
      )}

      {earlyClose && (
        <span className="text-[9px] text-yellow-500 border border-yellow-800 rounded px-1.5 py-0.5">
          kortere dag · stenger {calendar!.close}
        </span>
      )}

      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${phase.dot} ${phase.pulse ? "animate-pulse" : ""}`} />
        <span className={`text-xs font-semibold ${phase.color}`}>{phase.label}</span>
      </div>

      {countdown && (
        <span className={`text-[10px] tabular-nums ${
          countdown.startsWith("⚠") ? "text-red-400 font-semibold" : "text-[#8b949e]"
        }`}>
          {countdown}
        </span>
      )}

      <span className="text-[10px] text-[#444c56] tabular-nums">{timeStr} ET</span>
    </div>
  );
}
