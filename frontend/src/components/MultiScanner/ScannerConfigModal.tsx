import { useState } from "react";
import { useStore, ScannerConfig, ScannerFilters, EventCondition, ScannerMode } from "../../store";

interface Props { config: ScannerConfig; onClose: () => void; }

// ── Column definitions ────────────────────────────────────────────────────────

const TOPLIST_COLS = [
  { id: "price",      label: "Pris" },
  { id: "change_pct", label: "% Chg" },
  { id: "rel_vol",    label: "Rel Vol" },
  { id: "volume",     label: "Volum" },
  { id: "float",      label: "Float" },
  { id: "has_news",   label: "News" },
];

const EVENT_COLS = [
  { id: "time",       label: "Tid" },
  { id: "price",      label: "Pris" },
  { id: "change_pct", label: "% Chg" },
  { id: "vol_ratio",  label: "Vol×" },
  { id: "rel_vol",    label: "Rel Vol" },
  { id: "volume",     label: "Volum" },
  { id: "float",      label: "Float" },
  { id: "has_news",   label: "News" },
  { id: "hits",       label: "Hits" },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function Num({ label, value, onChange, step = "0.1", hint }: {
  label: string; value: number | null;
  onChange: (v: number | null) => void;
  step?: string; hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">{label}</label>
      {hint && <span className="text-[9px] text-[#444c56]">{hint}</span>}
      <input type="number" step={step} value={value ?? ""}
        placeholder="—"
        onChange={(e) => onChange(e.target.value === "" ? null : parseFloat(e.target.value))}
        className="bg-[#0d1117] border border-[#30363d] text-white rounded px-2 py-1 text-xs w-full"
      />
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)}
      className={`w-10 h-5 rounded-full transition-colors shrink-0 ${value ? "bg-blue-600" : "bg-[#30363d]"}`}>
      <div className={`w-4 h-4 bg-white rounded-full mx-0.5 transition-transform ${value ? "translate-x-5" : "translate-x-0"}`} />
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-[10px] text-[#444c56] uppercase tracking-wider mb-2 border-b border-[#21262d] pb-1">{title}</div>
      {children}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export function ScannerConfigModal({ config, onClose }: Props) {
  const updateScanner  = useStore((s) => s.updateScanner);
  const removeScanner  = useStore((s) => s.removeScanner);
  const scannerConfigs = useStore((s) => s.scannerConfigs);

  const [name,          setName]          = useState(config.name);
  const [mode,          setMode]          = useState<ScannerMode>(config.mode);
  const [f,             setF]             = useState<ScannerFilters>({ ...config.filters });
  const [ec,            setEc]            = useState<EventCondition>({ ...config.eventCondition });
  const [columns,       setColumns]       = useState<string[]>(config.columns);
  const [alertsEnabled, setAlertsEnabled] = useState(config.alertsEnabled ?? false);

  const setFld  = <K extends keyof ScannerFilters>(k: K, v: ScannerFilters[K]) => setF((p) => ({ ...p, [k]: v }));
  const setEcFld = <K extends keyof EventCondition>(k: K, v: EventCondition[K]) => setEc((p) => ({ ...p, [k]: v }));

  function toggleCol(id: string) {
    setColumns((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]);
  }

  function save() {
    updateScanner(config.id, { name, mode, filters: f, eventCondition: ec, columns, alertsEnabled });
    onClose();
  }

  function remove() {
    if (scannerConfigs.length <= 1) return;
    removeScanner(config.id);
    onClose();
  }

  const colDefs = mode === "events" ? EVENT_COLS : TOPLIST_COLS;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg w-[540px] max-h-[92vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Scanner-innstillinger</h2>
          <button onClick={onClose} className="text-[#8b949e] hover:text-white text-lg leading-none">×</button>
        </div>

        {/* Name */}
        <Section title="Navn">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            className="bg-[#0d1117] border border-[#30363d] text-white rounded px-2 py-1 text-xs w-full"
          />
        </Section>

        {/* Mode */}
        <Section title="Type">
          <div className="flex gap-2">
            {(["toplist", "events"] as ScannerMode[]).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={`flex-1 py-2 rounded text-xs font-medium border transition-colors ${
                  mode === m
                    ? m === "events" ? "bg-blue-900/40 border-blue-700 text-blue-300" : "bg-[#21262d] border-[#30363d] text-white"
                    : "border-[#21262d] text-[#444c56] hover:text-[#8b949e]"
                }`}
              >
                {m === "toplist" ? "📊 Top List" : "⚡ Live Events"}
              </button>
            ))}
          </div>
          <p className="text-[9px] text-[#444c56] mt-1.5">
            {mode === "toplist"
              ? "Viser alle tickers som passer filtrene, sortert på valgt metrikk. Oppdateres live."
              : "Event-logg: registrerer hvert øyeblikk volumet krysser en grense, midt i pågående bar."}
          </p>
        </Section>

        {/* Top List filters */}
        {mode === "toplist" && <>
          <Section title="Pris">
            <div className="grid grid-cols-2 gap-3">
              <Num label="Min pris ($)" value={f.minPrice} onChange={(v) => setFld("minPrice", v ?? 0)} step="0.1" />
              <Num label="Max pris ($)" value={f.maxPrice} onChange={(v) => setFld("maxPrice", v ?? 999)} step="1" />
            </div>
          </Section>
          <Section title="Float">
            <Num label="Max Float (millioner)" value={f.maxFloat} onChange={(v) => setFld("maxFloat", v)} step="1"
              hint="10M = micro, 30M = small cap" />
          </Section>
          <Section title="Volum">
            <div className="grid grid-cols-2 gap-3">
              <Num label="Min volum (tusen)" value={f.minVolume} onChange={(v) => setFld("minVolume", v ?? 0)} step="10" />
              <Num label="Min Rel Vol (×)" value={f.minRelVol} onChange={(v) => setFld("minRelVol", v ?? 0)} step="0.5" />
            </div>
          </Section>
          <Section title="Momentum">
            <div className="grid grid-cols-2 gap-3">
              <Num label="Min % endring" value={f.minChangePct} onChange={(v) => setFld("minChangePct", v ?? 0)} step="1" />
              <Num label="Max % endring" value={f.maxChangePct} onChange={(v) => setFld("maxChangePct", v)} step="1" />
            </div>
          </Section>
          <Section title="Sortering">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Sorter på</label>
                <select value={f.sortBy} onChange={(e) => setFld("sortBy", e.target.value as any)}
                  className="bg-[#0d1117] border border-[#30363d] text-white rounded px-2 py-1 text-xs">
                  <option value="rel_vol">Relative Volume</option>
                  <option value="change_pct">% Endring</option>
                  <option value="volume">Volum</option>
                  <option value="price">Pris</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-[#8b949e] uppercase tracking-wider">Rekkefølge</label>
                <select value={f.sortDesc ? "desc" : "asc"} onChange={(e) => setFld("sortDesc", e.target.value === "desc")}
                  className="bg-[#0d1117] border border-[#30363d] text-white rounded px-2 py-1 text-xs">
                  <option value="desc">Høy → Lav</option>
                  <option value="asc">Lav → Høy</option>
                </select>
              </div>
            </div>
          </Section>
          <Section title="Nyheter">
            <div className="flex items-center gap-3">
              <Toggle value={f.hasNewsOnly} onChange={(v) => setFld("hasNewsOnly", v)} />
              <span className="text-xs text-[#8b949e]">Kun tickers med nyheter i dag</span>
            </div>
          </Section>
          <Section title="Auto-switch trigger-chart">
            <div className="flex items-center gap-3">
              <Toggle value={f.autoSwitch} onChange={(v) => setFld("autoSwitch", v)} />
              <span className="text-xs text-[#8b949e]">Bytt trigger-chart når ny ticker dukker opp</span>
            </div>
          </Section>
        </>}

        {/* Events filters */}
        {mode === "events" && <>
          <Section title="Vol Spike betingelse">
            <p className="text-[10px] text-[#8b949e] mb-3">
              Trigger midt i pågående bar når: <span className="text-white">siste bar volum &gt; X× snitt av forrige N barer</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Num label="Multiplier (X×)" value={ec.multiplier} onChange={(v) => setEcFld("multiplier", v ?? 3)} step="0.5"
                hint="Eks: 5 = 5 ganger mer enn snitt" />
              <Num label="Lookback (N min)" value={ec.lookback} onChange={(v) => setEcFld("lookback", v ?? 5)} step="1"
                hint="Snitt av forrige N minutter" />
            </div>
          </Section>
          <Section title="Pris-filter">
            <div className="grid grid-cols-2 gap-3">
              <Num label="Min pris ($)" value={ec.minPrice} onChange={(v) => setEcFld("minPrice", v ?? 0)} step="0.1" />
              <Num label="Max pris ($)" value={ec.maxPrice} onChange={(v) => setEcFld("maxPrice", v ?? 999)} step="1" />
            </div>
          </Section>
          <Section title="Float-filter">
            <Num label="Max Float (millioner)" value={ec.maxFloat} onChange={(v) => setEcFld("maxFloat", v)} step="1"
              hint="Tom = ingen grense" />
          </Section>
          <Section title="Katalysator">
            <div className="flex items-center gap-3">
              <Toggle value={ec.hasNewsOnly} onChange={(v) => setEcFld("hasNewsOnly", v)} />
              <span className="text-xs text-[#8b949e]">Kun tickers med nyheter i dag</span>
            </div>
          </Section>
          <Section title="Auto-switch trigger-chart">
            <div className="flex items-center gap-3">
              <Toggle value={f.autoSwitch} onChange={(v) => setFld("autoSwitch", v)} />
              <span className="text-xs text-[#8b949e]">Bytt trigger-chart umiddelbart på nytt event</span>
            </div>
          </Section>
          <Section title="Lyd- og flash-varsler">
            <div className="flex items-center gap-3">
              <Toggle value={alertsEnabled} onChange={setAlertsEnabled} />
              <span className="text-xs text-[#8b949e]">Spill lyd og flash rad ved nytt event</span>
            </div>
          </Section>
        </>}

        {/* Column picker */}
        <Section title="Kolonner">
          <div className="flex flex-wrap gap-2">
            {colDefs.map((col) => (
              <button key={col.id} onClick={() => toggleCol(col.id)}
                className={`text-[10px] px-2.5 py-1 rounded border transition-colors ${
                  columns.includes(col.id)
                    ? "bg-[#21262d] border-[#30363d] text-white"
                    : "border-[#21262d] text-[#444c56] hover:text-[#8b949e]"
                }`}
              >
                {col.label}
              </button>
            ))}
          </div>
        </Section>

        {/* Actions */}
        <div className="flex justify-between mt-5">
          <button onClick={remove} disabled={scannerConfigs.length <= 1}
            className="text-xs text-red-400 hover:text-red-300 disabled:opacity-30">
            Slett scanner
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="text-xs text-[#8b949e] hover:text-white border border-[#30363d] rounded px-3 py-1.5">Avbryt</button>
            <button onClick={save} className="text-xs bg-blue-700 hover:bg-blue-600 text-white rounded px-4 py-1.5">Lagre</button>
          </div>
        </div>
      </div>
    </div>
  );
}
