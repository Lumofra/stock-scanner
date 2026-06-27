import { RealtimeChart } from "./RealtimeChart";

interface Props {
  ticker: string;
}

export function ChartPanel({ ticker }: Props) {
  return (
    <div className="grid grid-cols-3 h-full border-t border-[#21262d]">
      <div className="border-r border-[#21262d] h-full">
        <RealtimeChart ticker={ticker} timeframe="1m" label="1 Min" />
      </div>
      <div className="border-r border-[#21262d] h-full">
        <RealtimeChart ticker={ticker} timeframe="5m" label="5 Min" />
      </div>
      <div className="h-full">
        <RealtimeChart ticker={ticker} timeframe="1D" label="1 Day" />
      </div>
    </div>
  );
}
