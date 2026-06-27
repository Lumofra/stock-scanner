import { useRef } from "react";
import { useWebSocket } from "./useWebSocket";
import { useStore } from "../store";

export function useAlerts() {
  const addAlert = useStore((s) => s.addAlert);
  const soundEnabled = useStore((s) => s.soundEnabled);
  const audioCtxRef = useRef<AudioContext | null>(null);

  function playBeep() {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    } catch {
      // AudioContext may be blocked until user interaction
    }
  }

  useWebSocket("/ws/alerts", (raw) => {
    const alert = JSON.parse(raw);
    addAlert(alert);
    playBeep();
  });
}
