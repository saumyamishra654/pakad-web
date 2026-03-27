"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";

interface PitchPoint {
  time: number;
  frequency: number;
  confidence: number;
}

const SARGAM_LABELS = ["S", "r", "R", "g", "G", "m", "M", "P", "d", "D", "n", "N"];

function freqToMidi(hz: number): number {
  return 12 * Math.log2(hz / 440) + 69;
}

export function PitchContour({
  songId,
  stem = "vocals",
  tonicMidi,
  currentTime,
  duration,
  onSeek,
}: {
  songId: string;
  stem?: string;
  tonicMidi: number | null;
  currentTime: number;
  duration: number;
  onSeek?: (time: number) => void;
}) {
  const [points, setPoints] = useState<PitchPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 300 });

  useEffect(() => {
    setLoading(true);
    fetch(`/api/results/${songId}/pitch/${stem}`)
      .then((r) => r.json())
      .then((data) => { setPoints(data.points || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [songId, stem]);

  useEffect(() => {
    function handleResize() {
      if (containerRef.current) {
        setDimensions({ width: containerRef.current.clientWidth, height: 300 });
      }
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const { minMidi, maxMidi, tonic } = useMemo(() => {
    if (points.length === 0) return { minMidi: 48, maxMidi: 84, tonic: 60 };
    const midis = points.map((p) => freqToMidi(p.frequency));
    const min = Math.floor(Math.min(...midis) - 2);
    const max = Math.ceil(Math.max(...midis) + 2);
    return { minMidi: min, maxMidi: max, tonic: tonicMidi ?? 60 };
  }, [points, tonicMidi]);

  const margin = { top: 10, right: 15, bottom: 30, left: 45 };
  const plotW = dimensions.width - margin.left - margin.right;
  const plotH = dimensions.height - margin.top - margin.bottom;

  const xScale = useCallback(
    (t: number) => margin.left + (t / Math.max(duration, 1)) * plotW,
    [duration, plotW, margin.left]
  );
  const yScale = useCallback(
    (midi: number) => margin.top + plotH - ((midi - minMidi) / (maxMidi - minMidi)) * plotH,
    [minMidi, maxMidi, plotH, margin.top]
  );

  const pathD = useMemo(() => {
    if (points.length === 0) return "";
    const step = Math.max(1, Math.floor(points.length / 2000));
    const sampled = points.filter((_, i) => i % step === 0);
    let d = "";
    let prevMidi = 0;
    for (let i = 0; i < sampled.length; i++) {
      const p = sampled[i];
      const midi = freqToMidi(p.frequency);
      const x = xScale(p.time);
      const y = yScale(midi);
      if (i === 0 || Math.abs(midi - prevMidi) > 12 || (i > 0 && p.time - sampled[i - 1].time > 0.5)) {
        d += `M ${x} ${y} `;
      } else {
        d += `L ${x} ${y} `;
      }
      prevMidi = midi;
    }
    return d;
  }, [points, xScale, yScale]);

  const gridLines = useMemo(() => {
    const lines: { midi: number; label: string; isTonic: boolean }[] = [];
    for (let midi = Math.ceil(minMidi); midi <= Math.floor(maxMidi); midi++) {
      const semitone = ((midi - tonic) % 12 + 12) % 12;
      const label = SARGAM_LABELS[semitone];
      if (label) {
        lines.push({ midi, label, isTonic: semitone === 0 });
      }
    }
    return lines;
  }, [minMidi, maxMidi, tonic]);

  const timeLabels = useMemo(() => {
    if (duration <= 0) return [];
    const count = Math.min(8, Math.floor(plotW / 80));
    const step = duration / count;
    return Array.from({ length: count + 1 }, (_, i) => {
      const t = i * step;
      const m = Math.floor(t / 60);
      const s = Math.floor(t % 60);
      return { time: t, label: `${m}:${s.toString().padStart(2, "0")}` };
    });
  }, [duration, plotW]);

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!svgRef.current || !onSeek) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - margin.left;
    const ratio = Math.max(0, Math.min(1, x / plotW));
    onSeek(ratio * duration);
  }

  if (loading) {
    return (
      <div className="bg-bg-card border border-border rounded-xl h-[300px] flex items-center justify-center">
        <p className="text-text-muted text-sm">Loading pitch data...</p>
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-xl h-[300px] flex items-center justify-center">
        <p className="text-text-muted text-sm">No pitch data available</p>
      </div>
    );
  }

  const playheadX = xScale(currentTime);

  return (
    <div ref={containerRef} className="bg-bg-card border border-border rounded-xl overflow-hidden">
      <svg ref={svgRef} width={dimensions.width} height={dimensions.height} className="cursor-crosshair" onClick={handleClick}>
        <rect x={margin.left} y={margin.top} width={plotW} height={plotH} fill="#0d0a04" />

        {gridLines.map((line, i) => (
          <g key={i}>
            <line x1={margin.left} y1={yScale(line.midi)} x2={margin.left + plotW} y2={yScale(line.midi)}
              stroke={line.isTonic ? "#3a2a14" : "#1a1408"} strokeWidth={line.isTonic ? 1.5 : 0.5} />
            <text x={margin.left - 6} y={yScale(line.midi) + 3} textAnchor="end"
              fill={line.isTonic ? "#d4942a" : "#5a4a30"} fontSize={10} fontFamily="monospace">
              {line.label}
            </text>
          </g>
        ))}

        {timeLabels.map((t, i) => (
          <text key={i} x={xScale(t.time)} y={dimensions.height - 8} textAnchor="middle"
            fill="#5a4a30" fontSize={10} fontFamily="monospace">
            {t.label}
          </text>
        ))}

        <path d={pathD} fill="none" stroke="#bf6e13" strokeWidth={1.5} opacity={0.9} />

        <line x1={playheadX} y1={margin.top} x2={playheadX} y2={margin.top + plotH}
          stroke="#bf6e13" strokeWidth={2} opacity={0.8} />
      </svg>
    </div>
  );
}
