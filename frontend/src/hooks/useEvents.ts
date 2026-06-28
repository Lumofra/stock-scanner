import { useEffect, useRef, useState } from "react";
import { ScannerEvent, EventCondition } from "../store";

const MAX_EVENTS = 300;

export function useEvents(condition: EventCondition) {
  const [events, setEvents] = useState<ScannerEvent[]>([]);
  const wsRef    = useRef<WebSocket | null>(null);
  const reconnRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    function connect() {
      const ws = new WebSocket("/ws/events");
      wsRef.current = ws;

      ws.onmessage = (e) => {
        const ev: ScannerEvent = JSON.parse(e.data);
        if (!passesCondition(ev, condition)) return;
        setEvents((prev) => {
          // Allow escalation events within the same bar (higher vol_ratio = higher bracket)
          if (
            prev[0]?.ticker === ev.ticker &&
            prev[0]?.bar_time === ev.bar_time &&
            ev.vol_ratio_5 <= (prev[0]?.vol_ratio_5 ?? 0)
          ) return prev;
          return [ev, ...prev].slice(0, MAX_EVENTS);
        });
      };

      ws.onclose = () => { reconnRef.current = setTimeout(connect, 3000); };
      ws.onerror = () => ws.close();
    }
    connect();
    return () => {
      clearTimeout(reconnRef.current);
      wsRef.current?.close();
    };
  }, []); // stable connection — condition changes are applied as filter only

  // Re-filter when condition config changes
  const filtered = events.filter((ev) => passesCondition(ev, condition));
  return filtered;
}

function passesCondition(ev: ScannerEvent, c: EventCondition): boolean {
  if (ev.price < c.minPrice || ev.price > c.maxPrice) return false;
  if (c.maxFloat !== null && ev.float !== null && ev.float / 1_000_000 > c.maxFloat) return false;
  if (c.hasNewsOnly && !ev.has_news) return false;

  // Check the vol ratio for the configured lookback window
  const ratio = lookbackRatio(ev, c.lookback);
  if (ratio < c.multiplier) return false;

  return true;
}

function lookbackRatio(ev: ScannerEvent, lookback: number): number {
  if (lookback <= 1) return ev.vol_ratio_1;
  if (lookback <= 3) return ev.vol_ratio_3;
  if (lookback <= 5) return ev.vol_ratio_5;
  return ev.vol_ratio_10;
}
