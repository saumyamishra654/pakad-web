"use client";

interface DualHistogramData {
  highRes: { cents: number; weight: number; smoothed: number }[];
  lowRes: { cents: number; weight: number; smoothed: number; label: string }[];
}

const COLORS = {
  amber: {
    bar: "var(--color-hist-amber-bar)",
    curve: "var(--color-hist-amber-curve)",
    fill: "var(--color-hist-amber-fill)",
  },
  teal: {
    bar: "var(--color-hist-teal-bar)",
    curve: "var(--color-hist-teal-curve)",
    fill: "var(--color-hist-teal-fill)",
  },
};

const NOTE_LABELS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function Histogram({
  data,
  title,
  color = "amber",
}: {
  data: DualHistogramData;
  title: string;
  color?: "amber" | "teal";
}) {
  if (!data || (!data.highRes?.length && !data.lowRes?.length)) return null;

  const palette = COLORS[color];

  const W = 580;
  const H = 190;
  const pad = { top: 12, right: 12, bottom: 30, left: 12 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  // Find max across both resolutions for consistent scale
  const maxHigh = data.highRes.length > 0
    ? Math.max(...data.highRes.map((d) => d.smoothed))
    : 0;
  const maxLow = data.lowRes.length > 0
    ? Math.max(...data.lowRes.map((d) => d.weight))
    : 0;
  const maxVal = Math.max(maxHigh, maxLow, 0.001);

  const xScale = (cents: number) => pad.left + (cents / 1200) * plotW;
  const yScale = (val: number) => pad.top + plotH * (1 - val / maxVal);

  // Low-res bar width
  const barW = data.lowRes.length > 0 ? plotW / data.lowRes.length : 0;

  // High-res smoothed curve as SVG path
  let curveLine = "";
  let areaPath = "";
  if (data.highRes.length > 0) {
    const points = data.highRes.map(
      (d) => `${xScale(d.cents).toFixed(1)},${yScale(d.smoothed).toFixed(1)}`
    );
    curveLine = `M ${points.join(" L ")}`;
    const lastX = xScale(data.highRes[data.highRes.length - 1].cents).toFixed(1);
    const firstX = xScale(data.highRes[0].cents).toFixed(1);
    const baseline = yScale(0).toFixed(1);
    areaPath = `${curveLine} L ${lastX},${baseline} L ${firstX},${baseline} Z`;
  }

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
        <span className="text-text-secondary text-xs font-medium">{title}</span>
        <div className="flex items-center gap-3 text-[9px] text-text-faint">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-2.5 rounded-sm"
              style={{ backgroundColor: palette.bar }}
            />
            33-bin
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-4 h-px"
              style={{ backgroundColor: palette.curve }}
            />
            100-bin smoothed
          </span>
        </div>
      </div>
      <div className="p-4">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Subtle horizontal grid lines */}
          {[0.25, 0.5, 0.75].map((frac) => (
            <line
              key={frac}
              x1={pad.left}
              x2={W - pad.right}
              y1={pad.top + plotH * (1 - frac)}
              y2={pad.top + plotH * (1 - frac)}
              stroke="currentColor"
              className="text-border"
              strokeWidth={0.5}
              strokeDasharray="3 4"
            />
          ))}

          {/* Low-res bars (raw weight) */}
          {data.lowRes.map((d, i) => {
            const h = (d.weight / maxVal) * plotH;
            if (h < 0.5) return null;
            return (
              <rect
                key={i}
                x={xScale(d.cents) - barW * 0.4}
                y={yScale(d.weight)}
                width={barW * 0.8}
                height={h}
                fill={palette.bar}
                rx={1}
              />
            );
          })}

          {/* High-res smoothed area fill */}
          {areaPath && <path d={areaPath} fill={palette.fill} />}

          {/* High-res smoothed curve line */}
          {curveLine && (
            <path
              d={curveLine}
              fill="none"
              stroke={palette.curve}
              strokeWidth={1.5}
              opacity={0.85}
            />
          )}

          {/* Baseline */}
          <line
            x1={pad.left}
            x2={W - pad.right}
            y1={yScale(0)}
            y2={yScale(0)}
            stroke="currentColor"
            className="text-border"
            strokeWidth={0.5}
          />

          {/* X-axis note labels at semitone centers */}
          {NOTE_LABELS.map((label, i) => (
            <text
              key={label}
              x={xScale(i * 100 + 50)}
              y={H - 6}
              textAnchor="middle"
              fill="var(--color-text-faint)"
              style={{ fontSize: "9px", fontFamily: "ui-monospace, monospace" }}
            >
              {label}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}
