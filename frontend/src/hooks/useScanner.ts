import { useWebSocket } from "./useWebSocket";
import { useStore } from "../store";

export function useScanner() {
  const setScannerRows = useStore((s) => s.setScannerRows);

  useWebSocket("/ws/scanner", (raw) => {
    const msg = JSON.parse(raw);
    if (msg.type === "scanner") {
      setScannerRows(msg.data);
    }
  });
}
