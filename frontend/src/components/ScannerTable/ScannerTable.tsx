import { useState } from "react";
import { useStore } from "../../store";
import { useScanner } from "../../hooks/useScanner";
import { FilterPanel } from "./FilterPanel";

type SortKey = "price" | "change_pct" | "volume" | "rel_vol" | "float";

const COLUMNS: { key: SortKey | "ticker" | "has_news"; label: string; sortable: boolean }[] = [
  { key: "ticker",     label: "Ticker",  sortable: false },
  { key: "price",      label: "Price",   sortable: true },
  { key: "change_pct", label: "% Chg",   sortable: true },
  { key: "rel_vol",    label: "R.Vol",   sortable: true },
  { key: "float",      label: "Float",   sortable: true },
  { key: "has_news",   label: "",        sortable: false },
];

export function ScannerTable() {
  useScanner(); // connect WebSocket

  const rows = useStore((s) => s.scannerRows);
  const selectedTicker = useStore((s) => s.selectedTicker);
  const selectTicker = useStore((s) => s.selectTicker);

  const [sortKey, setSortKey] = useState<SortKey>("rel_vol");
  const [sortDesc, setSortDesc] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  const sorted = [...rows].sort((a, b) => {
    const av = (a as any)[sortKey] ?? 0;
    const bv = (b as any)[sortKey] ?? 0;
    return sortDesc ? bv - av : av - bv;
  });

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDesc((d) => !d);
    } else {
      setSortKey(key);
      setSortDesc(true);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#21262d] bg-[#161b22]">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-white">Scanner</span>
          <span className="text-xs text-[#8b949e]">{rows.length} results</span>
        </div>
        <button
          onClick={() => setShowFilters((s) => !s)}
          className="text-xs text-[#8b949e] hover:text-white border border-[#30363d] rounded px-2 py-0.5"
        >
          Filters
        </button>
      </div>

      {showFilters && <FilterPanel onClose={() => setShowFilters(false)} />}

      {/* Table */}
      <div className="overflow-auto flex-1">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-[#161b22] border-b border-[#21262d]">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortable && handleSort(col.key as SortKey)}
                  className={`px-2 py-2 text-left text-[#8b949e] font-medium whitespace-nowrap ${
                    col.sortable ? "cursor-pointer hover:text-white" : ""
                  }`}
                >
                  {sortKey === col.key ? (sortDesc ? "▼ " : "▲ ") : ""}
                  {col.label}

                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr
                key={row.ticker}
                onClick={() =>
                  selectTicker(selectedTicker === row.ticker ? null : row.ticker)
                }
                className={`border-b border-[#21262d] cursor-pointer transition-colors ${
                  selectedTicker === row.ticker
                    ? "bg-[#1f2937]"
                    : "hover:bg-[#161b22]"
                }`}
              >
                <td className="px-2 py-1.5 font-bold text-white tracking-wide">
                  {row.ticker}
                  {row.has_news && (
                    <span className="ml-1 text-[9px] bg-blue-900 text-blue-300 rounded px-1">N</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-white">
                  ${row.price.toFixed(row.price < 1 ? 4 : 2)}
                </td>
                <td
                  className={`px-2 py-1.5 font-medium ${
                    row.change_pct >= 0 ? "text-[#26a69a]" : "text-[#ef5350]"
                  }`}
                >
                  {row.change_pct >= 0 ? "+" : ""}
                  {row.change_pct.toFixed(2)}%
                </td>
                <td className="px-2 py-1.5 text-yellow-300 font-medium">
                  {row.rel_vol.toFixed(2)}x
                </td>
                <td className="px-2 py-1.5 text-[#8b949e]">
                  {row.float
                    ? row.float >= 1_000_000
                      ? (row.float / 1_000_000).toFixed(1) + "M"
                      : (row.float / 1_000).toFixed(0) + "K"
                    : "—"}
                </td>
                <td className="px-2 py-1.5" />
              </tr>
            ))}

            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-8 text-center text-[#8b949e] text-xs"
                >
                  No tickers match the current filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
