"use client";

interface HistogramBar {
  cents?: number;
  pitchClass?: number;
  label?: string;
  sargam?: string;
  weight: number;
}

export function Histogram({ data, title }: { data: HistogramBar[]; title: string }) {
  if (data.length === 0) return null;

  const maxWeight = Math.max(...data.map((d) => d.weight));
  if (maxWeight === 0) return null;

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border">
        <span className="text-text-secondary text-xs font-medium">{title}</span>
      </div>
      <div className="p-4">
        <div className="flex items-end justify-center gap-px" style={{ height: "180px" }}>
          {data.map((bar, i) => {
            const height = maxWeight > 0 ? (bar.weight / maxWeight) * 160 : 0;
            const intensity = 0.3 + (bar.weight / maxWeight) * 0.7;
            return (
              <div key={i} className="flex flex-col items-center" style={{ flex: "1 1 0", maxWidth: 32 }}>
                <div
                  className="w-full rounded-t-sm"
                  style={{
                    height: `${height}px`,
                    backgroundColor: `rgba(191, 110, 19, ${intensity})`,
                  }}
                  title={`${bar.label || bar.sargam || bar.pitchClass}: ${(bar.weight * 100).toFixed(1)}%`}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-center gap-px mt-1.5">
          {data.map((bar, i) => {
            const showLabel = data.length <= 12 || i % 2 === 0;
            return (
              <div key={i} className="text-center" style={{ flex: "1 1 0", maxWidth: 32 }}>
                {showLabel && (
                  <span className="text-text-faint text-[8px] font-mono leading-none">
                    {bar.label || bar.sargam || ""}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
