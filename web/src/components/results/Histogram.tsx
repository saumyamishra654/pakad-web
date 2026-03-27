"use client";

interface HistogramBar {
  pitchClass: number;
  sargam: string;
  weight: number;
}

export function Histogram({ data, title }: { data: HistogramBar[]; title: string }) {
  if (data.length === 0) return null;
  const maxWeight = Math.max(...data.map((d) => d.weight));

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border">
        <span className="text-text-secondary text-xs font-medium">{title}</span>
      </div>
      <div className="p-4">
        <div className="flex items-end justify-around gap-1" style={{ height: "160px" }}>
          {data.map((bar, i) => (
            <div key={i} className="flex flex-col items-center flex-1">
              <div className="w-full rounded-t-sm transition-all"
                style={{
                  height: `${maxWeight > 0 ? (bar.weight / maxWeight) * 140 : 0}px`,
                  backgroundColor: `rgba(191, 110, 19, ${0.4 + (bar.weight / maxWeight) * 0.6})`,
                }} />
            </div>
          ))}
        </div>
        <div className="flex justify-around mt-2">
          {data.map((bar, i) => (
            <span key={i} className="text-text-faint text-[9px] font-mono flex-1 text-center">
              {bar.sargam || bar.pitchClass}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
