import { useEffect, useRef, useState } from "react";
import { useStore } from "./store";
import { MultiScanner } from "./components/MultiScanner/MultiScanner";
import { WatchPanel } from "./components/WatchPanel/WatchPanel";
import { RealtimeChart } from "./components/Charts/RealtimeChart";

type DragTarget = "left" | "colSplit" | "rowSplit" | null;

interface DragInfo {
  target: DragTarget;
  startX: number;
  startY: number;
  startLeft: number;
  startCol: number;
  startRow: number;
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

  const [leftWidth,  setLeftWidth]  = useState(300);  // scanner width px
  const [colSplit,   setColSplit]   = useState(38);   // % of chart area for LEFT column
  const [rowSplit,   setRowSplit]   = useState(55);   // % of chart area for TOP row
  const [inputVal,   setInputVal]   = useState("");

  const chartAreaRef = useRef<HTMLDivElement>(null);
  const drag         = useRef<DragInfo | null>(null);
  const stateRef     = useRef({ leftWidth, colSplit, rowSplit });
  stateRef.current   = { leftWidth, colSplit, rowSplit };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current) return;
      const { target, startX, startY, startLeft, startCol, startRow } = drag.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (target === "left") {
        setLeftWidth(clamp(startLeft + dx, 160, 600));
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
      startLeft: stateRef.current.leftWidth,
      startCol:  stateRef.current.colSplit,
      startRow:  stateRef.current.rowSplit,
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
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold tracking-widest">NASDAQ SCANNER</span>
          <span className="text-[10px] text-[#8b949e] border border-[#30363d] rounded px-1.5 py-0.5">SMALL CAP</span>
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

        {/* Watch panel */}
        <div className="w-[260px] shrink-0 border-l border-[#21262d] overflow-hidden">
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

function MarketStatus() {
  const [now, setNow]         = useState(() => new Date());
  const [driftMs, setDriftMs] = useState<number | null>(null);

  // Tick every second
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

  const etStr = now.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });

  const [hStr, mStr] = etStr.split(":");
  const minutes = parseInt(hStr) * 60 + parseInt(mStr);

  const [status, color] =
    minutes >= 240 && minutes < 570  ? ["PRE-MARKET",    "text-yellow-400"] :
    minutes >= 570 && minutes < 960  ? ["MARKET OPEN",   "text-[#26a69a]"]  :
    minutes >= 960 && minutes < 1200 ? ["AFTER-HOURS",   "text-orange-400"] :
                                       ["MARKET CLOSED", "text-[#8b949e]"];

  const driftOk  = driftMs !== null && Math.abs(driftMs) < 5000;
  const driftWarn = driftMs !== null && Math.abs(driftMs) >= 5000;

  return (
    <div className="flex items-center gap-3">
      {driftMs !== null && (
        <span
          className={`text-[9px] border rounded px-1.5 py-0.5 ${
            driftWarn
              ? "text-red-400 border-red-800"
              : "text-[#444c56] border-[#30363d]"
          }`}
          title={`Systemklokke vs IBKR: ${driftMs > 0 ? "+" : ""}${driftMs}ms`}
        >
          {driftWarn ? `⚠ drift ${Math.round(driftMs / 1000)}s` : `IBKR ±${Math.abs(driftMs)}ms`}
        </span>
      )}
      <span className={`text-xs font-semibold ${color}`}>{status}</span>
      <span className="text-[10px] text-[#8b949e] tabular-nums">{etStr} ET</span>
    </div>
  );
}
