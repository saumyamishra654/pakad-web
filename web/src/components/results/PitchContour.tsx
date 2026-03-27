"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";

interface PitchPoint {
  time: number;
  frequency: number;
  confidence: number;
}

const SARGAM_LABELS = ["S", "r", "R", "g", "G", "m", "M", "P", "d", "D", "n", "N"];
const PX_PER_SECOND = 50;
const PLOT_HEIGHT = 400;
const MARGIN = { top: 10, right: 15, bottom: 30, left: 0 };
const LABEL_WIDTH = 45;

function freqToMidi(hz: number): number {
  return 12 * Math.log2(hz / 440) + 69;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PitchContour({
  songId,
  stem = "vocals",
  tonicMidi,
  currentTime,
  duration,
  isPlaying,
  onSeek,
}: {
  songId: string;
  stem?: string;
  tonicMidi: number | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  onSeek?: (time: number) => void;
}) {
  const [points, setPoints] = useState<PitchPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const lastSeekRef = useRef(0);

  // Fetch pitch data
  useEffect(() => {
    setLoading(true);
    fetch(`/api/results/${songId}/pitch/${stem}`)
      .then((r) => r.json())
      .then((data) => { setPoints(data.points || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [songId, stem]);

  // Compute MIDI range
  const { minMidi, maxMidi, tonic } = useMemo(() => {
    if (points.length === 0) return { minMidi: 48, maxMidi: 84, tonic: 60 };
    const midis = points.map((p) => freqToMidi(p.frequency));
    const min = Math.floor(Math.min(...midis) - 2);
    const max = Math.ceil(Math.max(...midis) + 2);
    return { minMidi: min, maxMidi: max, tonic: tonicMidi ?? 60 };
  }, [points, tonicMidi]);

  // Total SVG width based on duration
  const totalWidth = Math.max(800, Math.ceil(duration * PX_PER_SECOND));
  const plotH = PLOT_HEIGHT - MARGIN.top - MARGIN.bottom;

  // Scale functions
  const xScale = useCallback(
    (t: number) => (t / Math.max(duration, 1)) * totalWidth,
    [duration, totalWidth]
  );
  const yScale = useCallback(
    (midi: number) => MARGIN.top + plotH - ((midi - minMidi) / (maxMidi - minMidi)) * plotH,
    [minMidi, maxMidi, plotH]
  );

  // Build SVG path (no downsampling limit since we have horizontal space now)
  const pathD = useMemo(() => {
    if (points.length === 0) return "";
    // Downsample to ~1 point per 2 pixels
    const maxPoints = Math.ceil(totalWidth / 2);
    const step = Math.max(1, Math.floor(points.length / maxPoints));
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
  }, [points, xScale, yScale, totalWidth]);

  // Grid lines
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

  // Time labels (one every ~5 seconds)
  const timeLabels = useMemo(() => {
    if (duration <= 0) return [];
    const step = Math.max(5, Math.ceil(duration / (totalWidth / 100)));
    const labels: { time: number; label: string }[] = [];
    for (let t = 0; t <= duration; t += step) {
      labels.push({ time: t, label: formatTime(t) });
    }
    return labels;
  }, [duration, totalWidth]);

  // Auto-scroll during playback
  useEffect(() => {
    if (!isPlaying || !scrollRef.current) return;

    let rafId: number;
    function tick() {
      const container = scrollRef.current;
      if (!container) return;

      const x = xScale(currentTime);
      const viewWidth = container.clientWidth;
      const target = Math.max(0, x - viewWidth / 2);

      // Snap if we just seeked, smooth easing otherwise
      const timeSinceSeek = Date.now() - lastSeekRef.current;
      if (timeSinceSeek < 300 || Math.abs(container.scrollLeft - target) > viewWidth) {
        container.scrollLeft = target;
      } else {
        container.scrollLeft = container.scrollLeft * 0.85 + target * 0.15;
      }

      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, currentTime, xScale]);

  // Update playhead position via ref (avoids re-render on every frame)
  useEffect(() => {
    if (playheadRef.current) {
      playheadRef.current.style.left = `${xScale(currentTime)}px`;
    }
  }, [currentTime, xScale]);

  // Snap scroll when seeking while paused
  useEffect(() => {
    if (!isPlaying && scrollRef.current) {
      const x = xScale(currentTime);
      const viewWidth = scrollRef.current.clientWidth;
      scrollRef.current.scrollLeft = Math.max(0, x - viewWidth / 2);
    }
  }, [currentTime, isPlaying, xScale]);

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
    const x = e.clientX - rect.left + scrollLeft;
    const time = (x / totalWidth) * duration;
    lastSeekRef.current = Date.now();
    onSeek(Math.max(0, Math.min(duration, time)));
  }

  if (loading) {
    return (
      <div className="bg-bg-card border border-border rounded-xl flex items-center justify-center" style={{ height: PLOT_HEIGHT }}>
        <p className="text-text-muted text-sm">Loading pitch data...</p>
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-xl flex items-center justify-center" style={{ height: PLOT_HEIGHT }}>
        <p className="text-text-muted text-sm">No pitch data available</p>
      </div>
    );
  }

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden flex" style={{ height: PLOT_HEIGHT }}>
      {/* Sticky sargam labels */}
      <div className="flex-shrink-0 bg-bg-card border-r border-border" style={{ width: LABEL_WIDTH }}>
        <svg width={LABEL_WIDTH} height={PLOT_HEIGHT}>
          {gridLines.map((line, i) => (
            <text
              key={i}
              x={LABEL_WIDTH - 6}
              y={yScale(line.midi) + 3}
              textAnchor="end"
              fill={line.isTonic ? "#d4942a" : "#5a4a30"}
              fontSize={10}
              fontFamily="monospace"
              fontWeight={line.isTonic ? "bold" : "normal"}
            >
              {line.label}
            </text>
          ))}
        </svg>
      </div>

      {/* Scrollable plot area */}
      <div ref={scrollRef} className="flex-1 overflow-x-auto relative" style={{ height: PLOT_HEIGHT }}>
        <svg
          width={totalWidth}
          height={PLOT_HEIGHT}
          className="cursor-crosshair"
          onClick={handleClick}
        >
          {/* Plot background */}
          <rect x={0} y={MARGIN.top} width={totalWidth} height={plotH} fill="#0d0a04" />

          {/* Sargam grid lines */}
          {gridLines.map((line, i) => (
            <line
              key={i}
              x1={0}
              y1={yScale(line.midi)}
              x2={totalWidth}
              y2={yScale(line.midi)}
              stroke={line.isTonic ? "#3a2a14" : "#1a1408"}
              strokeWidth={line.isTonic ? 1.5 : 0.5}
            />
          ))}

          {/* Time labels */}
          {timeLabels.map((t, i) => (
            <text
              key={i}
              x={xScale(t.time)}
              y={PLOT_HEIGHT - 8}
              textAnchor="middle"
              fill="#5a4a30"
              fontSize={10}
              fontFamily="monospace"
            >
              {t.label}
            </text>
          ))}

          {/* Pitch curve */}
          <path d={pathD} fill="none" stroke="#bf6e13" strokeWidth={1.5} opacity={0.9} />
        </svg>

        {/* Playhead (positioned via ref for performance) */}
        <div
          ref={playheadRef}
          className="absolute top-0 pointer-events-none"
          style={{
            left: xScale(currentTime),
            width: 2,
            height: PLOT_HEIGHT - MARGIN.bottom,
            backgroundColor: "#bf6e13",
            opacity: 0.8,
          }}
        />
      </div>
    </div>
  );
}
