import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  HistogramData,
  LineData,
  Time,
} from "lightweight-charts";
import { Bar } from "../../store";

// ── Types ────────────────────────────────────────────────────────────────────

type TF = "1m" | "5m" | "15m" | "1h" | "1D";

interface Indicators {
  volume: boolean;
  ema9:   boolean;
  ema20:  boolean;
  vwap:   boolean;
  bb:     boolean;
}

interface Props {
  ticker:           string;
  defaultTimeframe?: TF;
  lockTimeframe?:   boolean;
  label?:           string;
}

// ── Indicator math ───────────────────────────────────────────────────────────

function calcEMA(bars: Bar[], period: number): LineData[] {
  if (bars.length < period) return [];
  const k = 2 / (period + 1);
  const out: LineData[] = [];
  let ema = bars[0].close;
  for (let i = 0; i < bars.length; i++) {
    ema = i === 0 ? bars[0].close : bars[i].close * k + ema * (1 - k);
    if (i >= period - 1) out.push({ time: bars[i].time as Time, value: +ema.toFixed(4) });
  }
  return out;
}

function calcVWAP(bars: Bar[]): LineData[] {
  const out: LineData[] = [];
  let cumPV = 0, cumV = 0;
  let lastDay = -1;
  for (const b of bars) {
    const dayTs = Math.floor(b.time / 86400);
    if (dayTs !== lastDay) { cumPV = 0; cumV = 0; lastDay = dayTs; } // reset each day
    const typical = (b.high + b.low + b.close) / 3;
    cumPV += typical * b.volume;
    cumV  += b.volume;
    if (cumV > 0) out.push({ time: b.time as Time, value: +(cumPV / cumV).toFixed(4) });
  }
  return out;
}

interface BB { upper: LineData[]; mid: LineData[]; lower: LineData[] }
function calcBB(bars: Bar[], period = 20, mult = 2): BB {
  const upper: LineData[] = [], mid: LineData[] = [], lower: LineData[] = [];
  for (let i = period - 1; i < bars.length; i++) {
    const window = bars.slice(i - period + 1, i + 1).map((b) => b.close);
    const sma = window.reduce((a, b) => a + b, 0) / period;
    const variance = window.reduce((a, b) => a + (b - sma) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    const t = bars[i].time as Time;
    mid.push({   time: t, value: +sma.toFixed(4) });
    upper.push({ time: t, value: +(sma + mult * std).toFixed(4) });
    lower.push({ time: t, value: +(sma - mult * std).toFixed(4) });
  }
  return { upper, mid, lower };
}

function volData(bars: Bar[]): HistogramData[] {
  return bars.map((b) => ({
    time:  b.time as Time,
    value: b.volume,
    color: b.close >= b.open ? "rgba(38,166,154,0.45)" : "rgba(239,83,80,0.45)",
  }));
}

// ── Chart options ────────────────────────────────────────────────────────────

const CHART_OPTS = {
  layout: {
    background: { type: ColorType.Solid, color: "#0d1117" },
    textColor: "#8b949e",
  },
  grid: {
    vertLines: { color: "#21262d" },
    horzLines: { color: "#21262d" },
  },
  crosshair: {
    vertLine: { color: "#444c56", labelBackgroundColor: "#161b22" },
    horzLine: { color: "#444c56", labelBackgroundColor: "#161b22" },
  },
  timeScale: { borderColor: "#21262d", timeVisible: true, secondsVisible: false, rightOffset: 2 },
  rightPriceScale: { borderColor: "#21262d" },
  handleScroll: true,
  handleScale: true,
};

// ── Helper to build series ───────────────────────────────────────────────────

function addLine(chart: IChartApi, color: string, width = 1, dashed = false) {
  return chart.addLineSeries({
    color,
    lineWidth: width as 1 | 2 | 3 | 4,
    lineStyle: dashed ? 1 : 0,  // 1 = Dashed
    priceLineVisible: false,
    lastValueVisible: false,
    crosshairMarkerVisible: false,
  });
}

// ── Main component ───────────────────────────────────────────────────────────

const TF_LABELS: Record<TF, string> = { "1m": "1M", "5m": "5M", "15m": "15M", "1h": "1H", "1D": "D" };
const ALL_TF: TF[] = ["1m", "5m", "15m", "1h", "1D"];

export function RealtimeChart({ ticker, defaultTimeframe = "1m", lockTimeframe = false, label }: Props) {
  const [activeTF, setActiveTF]     = useState<TF>(defaultTimeframe);
  const [ind, setInd]               = useState<Indicators>({
    volume: true, ema9: false, ema20: false, vwap: false, bb: false,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const candleRef    = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef       = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema9Ref      = useRef<ISeriesApi<"Line"> | null>(null);
  const ema20Ref     = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapRef      = useRef<ISeriesApi<"Line"> | null>(null);
  const bbURef       = useRef<ISeriesApi<"Line"> | null>(null);
  const bbMRef       = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLRef       = useRef<ISeriesApi<"Line"> | null>(null);
  const barsRef      = useRef<Bar[]>([]);
  const wsRef        = useRef<WebSocket | null>(null);
  const reconnRef    = useRef<ReturnType<typeof setTimeout>>();

  // ── Rebuild all indicator series from current barsRef ────────────────────
  function rebuildIndicators(chart: IChartApi, bars: Bar[], indicators: Indicators) {
    // Remove stale series
    for (const [ref, _] of [
      [volRef, null], [ema9Ref, null], [ema20Ref, null],
      [vwapRef, null], [bbURef, null], [bbMRef, null], [bbLRef, null],
    ] as [React.MutableRefObject<ISeriesApi<any> | null>, null][]) {
      if (ref.current) { try { chart.removeSeries(ref.current); } catch {} ref.current = null; }
    }

    if (!bars.length) return;

    if (indicators.volume) {
      volRef.current = chart.addHistogramSeries({
        priceScaleId: "vol",
        priceFormat: { type: "volume" },
        priceLineVisible: false,
        lastValueVisible: false,
      });
      volRef.current.priceScale().applyOptions({ scaleMargins: { top: 0.80, bottom: 0 } });
      volRef.current.setData(volData(bars));
      // Keep main candle scale from being compressed by volume
      candleRef.current?.priceScale().applyOptions({ scaleMargins: { top: 0.02, bottom: 0.22 } });
    } else {
      candleRef.current?.priceScale().applyOptions({ scaleMargins: { top: 0.02, bottom: 0.02 } });
    }

    if (indicators.ema9) {
      ema9Ref.current = addLine(chart, "#f59e0b", 1);
      ema9Ref.current.setData(calcEMA(bars, 9));
    }
    if (indicators.ema20) {
      ema20Ref.current = addLine(chart, "#3b82f6", 1);
      ema20Ref.current.setData(calcEMA(bars, 20));
    }
    if (indicators.vwap) {
      vwapRef.current = addLine(chart, "#a78bfa", 1);
      vwapRef.current.setData(calcVWAP(bars));
    }
    if (indicators.bb) {
      const { upper, mid, lower } = calcBB(bars);
      bbURef.current = addLine(chart, "#22d3ee", 1, true);
      bbMRef.current = addLine(chart, "#6b7280", 1);
      bbLRef.current = addLine(chart, "#22d3ee", 1, true);
      bbURef.current.setData(upper);
      bbMRef.current.setData(mid);
      bbLRef.current.setData(lower);
    }
  }

  // ── Chart lifecycle (recreates on ticker or timeframe change) ─────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      ...CHART_OPTS,
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });
    chartRef.current = chart;
    barsRef.current  = [];

    const candle = chart.addCandlestickSeries({
      upColor: "#26a69a", downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a", wickDownColor: "#ef5350",
    });
    candleRef.current = candle;

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (containerRef.current)
        chart.applyOptions({ width: containerRef.current.clientWidth, height: containerRef.current.clientHeight });
    });
    ro.observe(containerRef.current);

    // Load REST bars
    async function load() {
      try {
        const res  = await fetch(`/api/historical/${ticker}/${activeTF}`);
        const data = await res.json();
        if (data.bars?.length) {
          barsRef.current = data.bars;
          candle.setData(data.bars.map((b: Bar) => ({ time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close })));
          chart.timeScale().fitContent();
          rebuildIndicators(chart, data.bars, ind);
        }
      } catch {}
    }
    load();

    // WebSocket for live bar updates (not for daily)
    if (activeTF !== "1D") {
      const connect = () => {
        const ws = new WebSocket(`/ws/chart/${ticker}/${activeTF}`);
        wsRef.current = ws;

        ws.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (!candleRef.current || !chartRef.current) return;

          if (msg.type === "init" && msg.bars?.length) {
            barsRef.current = msg.bars;
            candleRef.current.setData(msg.bars.map((b: Bar) => ({
              time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close,
            })));
            chartRef.current.timeScale().fitContent();
            rebuildIndicators(chartRef.current, msg.bars, ind);
          } else if (msg.type === "bar") {
            const b: Bar = msg.bar;
            candleRef.current.update({ time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close });

            // Update or append bar in barsRef
            const bars = barsRef.current;
            const last = bars[bars.length - 1];
            if (last && last.time === b.time) { bars[bars.length - 1] = b; }
            else { bars.push(b); if (bars.length > 500) bars.shift(); }

            // Incrementally update indicator series
            updateIndicatorLive(b, bars);
          }
        };

        ws.onclose = () => { reconnRef.current = setTimeout(connect, 3000); };
        ws.onerror = () => ws.close();
      };
      connect();
    }

    return () => {
      clearTimeout(reconnRef.current);
      wsRef.current?.close();
      wsRef.current = null;
      ro.disconnect();
      chart.remove();
      chartRef.current  = null;
      candleRef.current = null;
      volRef.current    = null;
      ema9Ref.current   = null;
      ema20Ref.current  = null;
      vwapRef.current   = null;
      bbURef.current    = null;
      bbMRef.current    = null;
      bbLRef.current    = null;
    };
  }, [ticker, activeTF]);

  // ── Rebuild indicators when toggle changes (after chart exists) ───────────
  useEffect(() => {
    if (chartRef.current && barsRef.current.length) {
      rebuildIndicators(chartRef.current, barsRef.current, ind);
    }
  }, [ind]);

  // ── Incremental live indicator update (avoids full rebuild every bar) ─────
  function updateIndicatorLive(b: Bar, bars: Bar[]) {
    const t = b.time as Time;
    if (volRef.current) {
      volRef.current.update({ time: t, value: b.volume, color: b.close >= b.open ? "rgba(38,166,154,0.45)" : "rgba(239,83,80,0.45)" });
    }
    if (ema9Ref.current && bars.length >= 9) {
      const d = calcEMA(bars, 9);
      if (d.length) ema9Ref.current.update(d[d.length - 1]);
    }
    if (ema20Ref.current && bars.length >= 20) {
      const d = calcEMA(bars, 20);
      if (d.length) ema20Ref.current.update(d[d.length - 1]);
    }
    if (vwapRef.current) {
      const d = calcVWAP(bars);
      if (d.length) vwapRef.current.update(d[d.length - 1]);
    }
    if (bbMRef.current && bars.length >= 20) {
      const { upper, mid, lower } = calcBB(bars);
      if (mid.length) {
        bbMRef.current.update(mid[mid.length - 1]);
        bbURef.current?.update(upper[upper.length - 1]);
        bbLRef.current?.update(lower[lower.length - 1]);
      }
    }
  }

  function toggle(key: keyof Indicators) {
    setInd((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1 bg-[#161b22] border-b border-[#21262d] shrink-0 flex-wrap">
        {/* Ticker + label */}
        <span className="text-xs font-bold text-white mr-1">{ticker}</span>

        {/* Timeframe buttons */}
        {!lockTimeframe && ALL_TF.map((tf) => (
          <button
            key={tf}
            onClick={() => setActiveTF(tf)}
            className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
              activeTF === tf
                ? "bg-blue-700 text-white"
                : "text-[#8b949e] hover:text-white hover:bg-[#21262d]"
            }`}
          >
            {TF_LABELS[tf]}
          </button>
        ))}
        {lockTimeframe && (
          <span className="text-[9px] text-[#30363d] border border-[#21262d] rounded px-1.5 py-0.5">
            {TF_LABELS[activeTF]}
          </span>
        )}

        {/* Indicator toggles */}
        <div className="flex items-center gap-1 ml-auto">
          <IndBtn label="Vol"  active={ind.volume} color="teal"   onClick={() => toggle("volume")} />
          <IndBtn label="E9"   active={ind.ema9}   color="amber"  onClick={() => toggle("ema9")} />
          <IndBtn label="E20"  active={ind.ema20}  color="blue"   onClick={() => toggle("ema20")} />
          <IndBtn label="VWAP" active={ind.vwap}   color="purple" onClick={() => toggle("vwap")} />
          <IndBtn label="BB"   active={ind.bb}     color="cyan"   onClick={() => toggle("bb")} />
        </div>
      </div>

      {/* Chart */}
      <div ref={containerRef} className="flex-1 w-full min-h-0" />
    </div>
  );
}

// ── Small indicator toggle button ────────────────────────────────────────────

type BtnColor = "teal" | "amber" | "blue" | "purple" | "cyan";

const COLOR_MAP: Record<BtnColor, { on: string; dot: string }> = {
  teal:   { on: "bg-teal-900/60 text-teal-300 border-teal-700",     dot: "bg-teal-400"   },
  amber:  { on: "bg-amber-900/60 text-amber-300 border-amber-700",   dot: "bg-amber-400"  },
  blue:   { on: "bg-blue-900/60 text-blue-300 border-blue-700",      dot: "bg-blue-400"   },
  purple: { on: "bg-purple-900/60 text-purple-300 border-purple-700",dot: "bg-purple-400" },
  cyan:   { on: "bg-cyan-900/60 text-cyan-300 border-cyan-700",      dot: "bg-cyan-400"   },
};

function IndBtn({ label, active, color, onClick }: {
  label: string; active: boolean; color: BtnColor; onClick: () => void;
}) {
  const c = COLOR_MAP[color];
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded border transition-colors ${
        active ? c.on : "text-[#444c56] border-[#21262d] hover:text-[#8b949e]"
      }`}
    >
      {active && <span className={`w-1.5 h-1.5 rounded-full ${c.dot} shrink-0`} />}
      {label}
    </button>
  );
}
