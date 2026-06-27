import { useEffect, useRef, useState } from "react";
import { useStore, ScannerRow, ScannerConfig, ScannerEvent } from "../../store";
import { useScanner } from "../../hooks/useScanner";
import { useEvents } from "../../hooks/useEvents";
import { ScannerConfigModal } from "./ScannerConfigModal";

// ── Shared helpers ────────────────────────────────────────────────────────────

function timeAgo(ms: number): string {
  if (!ms) return "—";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    timeZone: "America/New_York",
  });
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + "K";
  return n.toString();
}

function NewsBadge({ row }: { row: { has_news: boolean; news_headlines?: any[] } }) {
  if (!row.has_news) return null;
  return (
    <span className="relative group ml-1 inline-block">
      <span className="text-[9px] bg-blue-900 text-blue-300 rounded px-0.5 cursor-default">N</span>
      {(row.news_headlines?.length ?? 0) > 0 && (
        <div className="absolute left-0 top-4 z-50 hidden group-hover:block bg-[#161b22] border border-[#30363d] rounded shadow-xl p-2 w-72 pointer-events-none">
          {row.news_headlines!.slice(0, 5).map((h, i) => (
            <div key={i} className={i > 0 ? "mt-2 pt-2 border-t border-[#21262d]" : ""}>
              <div className="text-[9px] text-[#444c56]">{h.provider} · {h.time}</div>
              <div className="text-[10px] text-[#c9d1d9] leading-snug">{h.headline}</div>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

function ScannerName({ config }: { config: ScannerConfig }) {
  const updateScanner = useStore((s) => s.updateScanner);
  const [editing, setEditing] = useState(false);
  const [val, setVal]         = useState(config.name);

  function commit() {
    const t = val.trim() || config.name;
    setVal(t);
    updateScanner(config.id, { name: t });
    setEditing(false);
  }

  if (editing) return (
    <input autoFocus value={val} onChange={(e) => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setVal(config.name); setEditing(false); } }}
      className="bg-transparent border-b border-blue-500 text-white text-xs font-semibold outline-none w-28"
    />
  );

  return (
    <span onDoubleClick={() => setEditing(true)}
      className="text-xs font-semibold text-white cursor-text hover:text-blue-300 transition-colors"
      title="Dobbeltklikk for å endre navn"
    >
      {config.name}
    </span>
  );
}

// ── Top List panel ────────────────────────────────────────────────────────────

const TOPLIST_COL_LABELS: Record<string, string> = {
  price: "Pris", change_pct: "% Chg", rel_vol: "R.Vol", volume: "Volum", float: "Float", has_news: "N",
};

function applyFilters(rows: ScannerRow[], f: ScannerConfig["filters"]): ScannerRow[] {
  return rows
    .filter((r) => r.price >= f.minPrice && r.price <= f.maxPrice)
    .filter((r) => r.rel_vol >= f.minRelVol)
    .filter((r) => r.change_pct >= f.minChangePct)
    .filter((r) => f.maxChangePct === null || r.change_pct <= f.maxChangePct)
    .filter((r) => f.maxFloat === null || r.float === null || r.float / 1_000_000 <= f.maxFloat)
    .filter((r) => r.volume / 1000 >= f.minVolume)
    .filter((r) => !f.hasNewsOnly || r.has_news)
    .sort((a, b) => {
      const av = (a as any)[f.sortBy] ?? 0;
      const bv = (b as any)[f.sortBy] ?? 0;
      return f.sortDesc ? bv - av : av - bv;
    });
}

function TopListPanel({ config, height, onDragHandle, isLast }: ScannerPanelProps) {
  const rows           = useStore((s) => s.scannerRows);
  const selectedTicker = useStore((s) => s.selectedTicker);
  const selectTicker   = useStore((s) => s.selectTicker);
  const setTrigger     = useStore((s) => s.setTriggerTicker);
  const scannerConfigs = useStore((s) => s.scannerConfigs);
  const removeScanner  = useStore((s) => s.removeScanner);

  const prevRef = useRef<Set<string>>(new Set());
  const filtered = applyFilters(rows, config.filters);

  // Auto-switch trigger chart on new entry
  useEffect(() => {
    if (!config.filters.autoSwitch) { prevRef.current = new Set(filtered.map((r) => r.ticker)); return; }
    const newEntries = filtered.filter((r) => !prevRef.current.has(r.ticker));
    if (newEntries.length > 0) {
      const best = [...newEntries].sort((a, b) => b.rel_vol - a.rel_vol)[0];
      setTrigger(best.ticker);
    }
    prevRef.current = new Set(filtered.map((r) => r.ticker));
  }, [rows]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const cols = config.columns;

  return (
    <div style={{ height }} className="flex flex-col overflow-hidden shrink-0">
      <PanelHeader config={config} count={filtered.length}
        onEdit={() => setEditingId(config.id)}
        onRemove={() => removeScanner(config.id)}
        canRemove={scannerConfigs.length > 1}
        badge={<span className="text-[8px] text-[#444c56] border border-[#30363d] rounded px-1">LIST</span>}
      />

      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[#0d1117] border-b border-[#21262d]">
            <tr>
              <th className="px-2 py-1 text-left text-[#8b949e] font-medium">Ticker</th>
              {cols.map((c) => (
                <th key={c} className="px-2 py-1 text-right text-[#8b949e] font-medium">
                  {TOPLIST_COL_LABELS[c] ?? c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.ticker} onClick={() => selectTicker(selectedTicker === row.ticker ? null : row.ticker)}
                className={`border-b border-[#21262d] cursor-pointer transition-colors ${
                  selectedTicker === row.ticker ? "bg-[#1f2937]" : "hover:bg-[#161b22]"
                }`}
              >
                <td className="px-2 py-1 font-bold text-white">
                  {row.ticker}<NewsBadge row={row} />
                </td>
                {cols.map((c) => <TopListCell key={c} col={c} row={row} />)}
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={cols.length + 1} className="px-2 py-4 text-center text-[#444c56] text-[10px]">
                {rows.length === 0 ? "Venter på data..." : "Ingen treff"}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {!isLast && <DragHandle onMouseDown={onDragHandle} />}
      {editingId && <ScannerConfigModal config={config} onClose={() => setEditingId(null)} />}
    </div>
  );
}

function TopListCell({ col, row }: { col: string; row: ScannerRow }) {
  switch (col) {
    case "price":      return <td className="px-2 py-1 text-right text-white">${row.price.toFixed(row.price < 1 ? 4 : 2)}</td>;
    case "change_pct": return <td className={`px-2 py-1 text-right font-medium ${row.change_pct >= 0 ? "text-[#26a69a]" : "text-[#ef5350]"}`}>{row.change_pct >= 0 ? "+" : ""}{row.change_pct.toFixed(2)}%</td>;
    case "rel_vol":    return <td className="px-2 py-1 text-right text-yellow-300">{row.rel_vol.toFixed(1)}×</td>;
    case "volume":     return <td className="px-2 py-1 text-right text-[#8b949e]">{fmt(row.volume)}</td>;
    case "float":      return <td className="px-2 py-1 text-right text-[#8b949e]">{row.float ? fmt(row.float) : "—"}</td>;
    case "has_news":   return <td className="px-2 py-1 text-center">{row.has_news ? <span className="text-[9px] bg-blue-900 text-blue-300 rounded px-0.5">N</span> : null}</td>;
    default:           return <td className="px-2 py-1 text-right text-[#8b949e]">—</td>;
  }
}

// ── Events panel ──────────────────────────────────────────────────────────────

const EVENT_COL_LABELS: Record<string, string> = {
  time: "Tid", price: "Pris", change_pct: "% Chg", vol_ratio: "Vol×",
  rel_vol: "R.Vol", volume: "Volum", float: "Float", has_news: "N", hits: "Hits",
};

function EventsPanel({ config, height, onDragHandle, isLast }: ScannerPanelProps) {
  const selectTicker   = useStore((s) => s.selectTicker);
  const setTrigger     = useStore((s) => s.setTriggerTicker);
  const scannerConfigs = useStore((s) => s.scannerConfigs);
  const removeScanner  = useStore((s) => s.removeScanner);

  const events = useEvents(config.eventCondition);
  const [editingId, setEditingId] = useState<string | null>(null);
  const cols = config.columns;

  // Auto-switch: new event → update trigger chart
  const prevEventTime = useRef<number>(0);
  useEffect(() => {
    if (!config.filters.autoSwitch || events.length === 0) return;
    const latest = events[0];
    if (latest.timestamp !== prevEventTime.current) {
      prevEventTime.current = latest.timestamp;
      setTrigger(latest.ticker);
    }
  }, [events]);

  return (
    <div style={{ height }} className="flex flex-col overflow-hidden shrink-0">
      <PanelHeader config={config} count={events.length}
        onEdit={() => setEditingId(config.id)}
        onRemove={() => removeScanner(config.id)}
        canRemove={scannerConfigs.length > 1}
        badge={<span className="text-[8px] text-blue-400 border border-blue-800 rounded px-1">⚡ LIVE</span>}
      />

      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[#0d1117] border-b border-[#21262d]">
            <tr>
              <th className="px-2 py-1 text-left text-[#8b949e] font-medium">Ticker</th>
              {cols.map((c) => (
                <th key={c} className="px-2 py-1 text-right text-[#8b949e] font-medium">
                  {EVENT_COL_LABELS[c] ?? c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((ev, i) => (
              <tr key={`${ev.ticker}-${ev.timestamp}`}
                onClick={() => { selectTicker(ev.ticker); setTrigger(ev.ticker); }}
                className={`border-b border-[#21262d] cursor-pointer hover:bg-[#161b22] transition-colors ${
                  i === 0 ? "bg-[#0d1a0d]" : ""
                }`}
              >
                <td className="px-2 py-1 font-bold text-white">
                  {ev.ticker}<NewsBadge row={ev} />
                </td>
                {cols.map((c) => <EventCell key={c} col={c} ev={ev} lookback={config.eventCondition.lookback} />)}
              </tr>
            ))}
            {events.length === 0 && (
              <tr><td colSpan={cols.length + 1} className="px-2 py-4 text-center text-[#444c56] text-[10px]">
                Venter på vol-spike ≥ {config.eventCondition.multiplier}× siste {config.eventCondition.lookback} min...
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {!isLast && <DragHandle onMouseDown={onDragHandle} />}
      {editingId && <ScannerConfigModal config={config} onClose={() => setEditingId(null)} />}
    </div>
  );
}

function EventCell({ col, ev, lookback }: { col: string; ev: ScannerEvent; lookback: number }) {
  const ratio = lookback <= 1 ? ev.vol_ratio_1 : lookback <= 3 ? ev.vol_ratio_3 : lookback <= 5 ? ev.vol_ratio_5 : ev.vol_ratio_10;
  switch (col) {
    case "time":       return <td className="px-2 py-1 text-right text-[#8b949e] tabular-nums">{fmtTime(ev.timestamp)}</td>;
    case "price":      return <td className="px-2 py-1 text-right text-white">${ev.price.toFixed(ev.price < 1 ? 4 : 2)}</td>;
    case "change_pct": return <td className={`px-2 py-1 text-right font-medium ${ev.change_pct >= 0 ? "text-[#26a69a]" : "text-[#ef5350]"}`}>{ev.change_pct >= 0 ? "+" : ""}{ev.change_pct.toFixed(2)}%</td>;
    case "vol_ratio":  return <td className="px-2 py-1 text-right text-orange-300 font-bold">{ratio.toFixed(1)}×</td>;
    case "rel_vol":    return <td className="px-2 py-1 text-right text-yellow-300">{ev.rel_vol.toFixed(1)}×</td>;
    case "volume":     return <td className="px-2 py-1 text-right text-[#8b949e]">{fmt(ev.bar_volume)}</td>;
    case "float":      return <td className="px-2 py-1 text-right text-[#8b949e]">{ev.float ? fmt(ev.float) : "—"}</td>;
    case "has_news":   return <td className="px-2 py-1 text-center">{ev.has_news ? <span className="text-[9px] bg-blue-900 text-blue-300 rounded px-0.5">N</span> : null}</td>;
    case "hits":       return <td className="px-2 py-1 text-right text-[#8b949e]">{ev.hits}</td>;
    default:           return <td className="px-2 py-1 text-right text-[#8b949e]">—</td>;
  }
}

// ── Shared panel components ───────────────────────────────────────────────────

function PanelHeader({ config, count, onEdit, onRemove, canRemove, badge }: {
  config: ScannerConfig; count: number;
  onEdit: () => void; onRemove: () => void; canRemove: boolean;
  badge: React.ReactNode;
}) {
  const f = config.filters;
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 bg-[#161b22] border-b border-[#21262d] shrink-0">
      <ScannerName config={config} />
      {badge}
      <div className="flex gap-1 flex-wrap flex-1 overflow-hidden">
        {config.mode === "toplist" && <>
          <FilterBadge label={`RV≥${f.minRelVol}×`} />
          {f.minChangePct > 0 && <FilterBadge label={`+${f.minChangePct}%`} />}
          {f.maxFloat !== null && <FilterBadge label={`F≤${f.maxFloat}M`} />}
          {f.hasNewsOnly && <FilterBadge label="N" blue />}
        </>}
        {config.mode === "events" && <>
          <FilterBadge label={`${config.eventCondition.multiplier}×/${config.eventCondition.lookback}m`} />
          {config.eventCondition.maxFloat !== null && <FilterBadge label={`F≤${config.eventCondition.maxFloat}M`} />}
          {config.eventCondition.hasNewsOnly && <FilterBadge label="N" blue />}
        </>}
      </div>
      <span className="text-[9px] text-[#444c56] shrink-0">{count}</span>
      <button onClick={onEdit} className="text-[#444c56] hover:text-[#8b949e] text-xs ml-1 shrink-0" title="Innstillinger">⚙</button>
      {canRemove && <button onClick={onRemove} className="text-[#444c56] hover:text-red-400 text-xs shrink-0" title="Fjern">×</button>}
    </div>
  );
}

function FilterBadge({ label, blue }: { label: string; blue?: boolean }) {
  const cls = blue ? "bg-blue-900/50 text-blue-300 border-blue-800" : "bg-[#21262d] text-[#8b949e] border-[#30363d]";
  return <span className={`text-[9px] border rounded px-1.5 py-0.5 ${cls}`}>{label}</span>;
}

function DragHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div onMouseDown={onMouseDown}
      className="h-[4px] bg-[#21262d] hover:bg-blue-600 cursor-row-resize transition-colors shrink-0"
    />
  );
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

interface ScannerPanelProps {
  config: ScannerConfig;
  height: number;
  onDragHandle: (e: React.MouseEvent) => void;
  isLast: boolean;
}

function ScannerPanel(props: ScannerPanelProps) {
  return props.config.mode === "events"
    ? <EventsPanel {...props} />
    : <TopListPanel {...props} />;
}

export function MultiScanner() {
  useScanner();

  const scannerConfigs = useStore((s) => s.scannerConfigs);
  const addScanner     = useStore((s) => s.addScanner);

  const containerRef       = useRef<HTMLDivElement>(null);
  const [heights, setHeights] = useState<number[] | null>(null);
  const draggingIndex      = useRef<number | null>(null);
  const dragStartY         = useRef(0);
  const dragStartHeights   = useRef<number[]>([]);
  const n = scannerConfigs.length;

  useEffect(() => {
    const ro = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height;
      if (h > 0) setHeights((prev) => (!prev || prev.length !== n) ? Array(n).fill(Math.floor(h / n)) : prev);
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [n]);

  const effectiveHeights = heights ?? Array(n).fill(200);

  function startDrag(index: number, e: React.MouseEvent) {
    e.preventDefault();
    draggingIndex.current   = index;
    dragStartY.current      = e.clientY;
    dragStartHeights.current = [...effectiveHeights];

    const onMove = (ev: MouseEvent) => {
      const idx = draggingIndex.current;
      if (idx === null) return;
      const delta = ev.clientY - dragStartY.current;
      const nh = [...dragStartHeights.current];
      nh[idx]     = Math.max(60, nh[idx] + delta);
      nh[idx + 1] = Math.max(60, nh[idx + 1] - delta);
      setHeights(nh);
    };
    const onUp = () => {
      draggingIndex.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  return (
    <div ref={containerRef} className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {scannerConfigs.map((cfg, i) => (
          <ScannerPanel key={cfg.id} config={cfg} height={effectiveHeights[i]}
            onDragHandle={(e) => startDrag(i, e)} isLast={i === n - 1}
          />
        ))}
      </div>
      <div className="shrink-0 border-t border-[#21262d] bg-[#161b22]">
        <button onClick={addScanner}
          className="w-full text-xs text-[#444c56] hover:text-[#8b949e] py-1.5 hover:bg-[#0d1117] transition-colors">
          + Legg til scanner
        </button>
      </div>
    </div>
  );
}
