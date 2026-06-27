import { Alert } from "../../store";

const TYPE_LABELS: Record<string, string> = {
  volume_breakout: "VOL BREAKOUT",
  price_spike_5pct: "PRICE SPIKE",
};

const TYPE_COLORS: Record<string, string> = {
  volume_breakout: "text-orange-400 bg-orange-950 border-orange-800",
  price_spike_5pct: "text-green-400 bg-green-950 border-green-800",
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  });
}

interface Props {
  alert: Alert;
  isSelected: boolean;
  onClick: () => void;
}

export function AlertCard({ alert, isSelected, onClick }: Props) {
  const typeClass = TYPE_COLORS[alert.alert_type] ?? "text-blue-400 bg-blue-950 border-blue-800";

  return (
    <div
      onClick={onClick}
      className={`px-3 py-2 border-b border-[#21262d] cursor-pointer transition-colors ${
        isSelected ? "bg-[#1f2937]" : "hover:bg-[#161b22]"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <span className="font-bold text-white text-sm">{alert.ticker}</span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${typeClass}`}
          >
            {TYPE_LABELS[alert.alert_type] ?? alert.alert_type.toUpperCase()}
          </span>
          {alert.has_news && (
            <span className="text-[10px] px-1 py-0.5 rounded bg-blue-900 text-blue-300 border border-blue-700">
              NEWS
            </span>
          )}
        </div>
        <span className="text-[10px] text-[#8b949e] whitespace-nowrap">
          {formatTime(alert.timestamp)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-1 text-[11px]">
        <div>
          <span className="text-[#8b949e]">Price </span>
          <span className="text-white">${alert.price.toFixed(2)}</span>
        </div>
        <div>
          <span className="text-[#8b949e]">Chg </span>
          <span className={alert.change_pct >= 0 ? "text-[#26a69a]" : "text-[#ef5350]"}>
            {alert.change_pct >= 0 ? "+" : ""}
            {alert.change_pct.toFixed(2)}%
          </span>
        </div>
        <div>
          <span className="text-[#8b949e]">RVol </span>
          <span className="text-yellow-300">{alert.rel_vol.toFixed(1)}x</span>
        </div>
      </div>
    </div>
  );
}
