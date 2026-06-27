import { useState } from "react";
import { useStore } from "../../store";
import { useAlerts } from "../../hooks/useAlerts";
import { AlertCard } from "./AlertCard";

export function AlertFeed() {
  useAlerts(); // connect WebSocket + sound

  const alerts = useStore((s) => s.alerts);
  const soundEnabled = useStore((s) => s.soundEnabled);
  const toggleSound = useStore((s) => s.toggleSound);
  const selectTicker = useStore((s) => s.selectTicker);
  const selectedTicker = useStore((s) => s.selectedTicker);

  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);

  function handleAlertClick(alertId: string, ticker: string) {
    setSelectedAlertId(alertId);
    selectTicker(ticker);
  }

  return (
    <div className="flex flex-col h-full border-l border-[#21262d]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#21262d] bg-[#161b22]">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">Alerts</span>
          {alerts.length > 0 && (
            <span className="text-xs bg-red-900 text-red-300 rounded-full px-1.5 py-0.5">
              {alerts.length}
            </span>
          )}
        </div>
        <button
          onClick={toggleSound}
          title={soundEnabled ? "Disable sound" : "Enable sound"}
          className="text-xs text-[#8b949e] hover:text-white border border-[#30363d] rounded px-2 py-0.5"
        >
          {soundEnabled ? "🔔" : "🔕"}
        </button>
      </div>

      {/* Alert list — newest at top */}
      <div className="overflow-y-auto flex-1">
        {alerts.length === 0 && (
          <div className="px-3 py-6 text-xs text-center text-[#8b949e]">
            Waiting for alerts...
          </div>
        )}
        {alerts.map((alert) => (
          <AlertCard
            key={alert.id}
            alert={alert}
            isSelected={selectedAlertId === alert.id || selectedTicker === alert.ticker}
            onClick={() => handleAlertClick(alert.id, alert.ticker)}
          />
        ))}
      </div>
    </div>
  );
}
