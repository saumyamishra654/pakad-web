"use client";

import { useState, useEffect, useRef, useMemo, useCallback, type RefObject } from "react";

interface PitchPoint {
  time: number;
  frequency: number;
  confidence: number;
}

interface TranscriptionNote {
  start: number;
  end: number;
  sargam: string;
  pitchMidi: number;
  pitchHz: number;
}

interface Phrase {
  startTime: number;
  endTime: number;
  notes: TranscriptionNote[];
  index: number;
}

const SARGAM_LABELS = ["S", "r", "R", "g", "G", "m", "M", "P", "d", "D", "n", "N"];
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const PX_PER_SECOND = 50;
const PLOT_HEIGHT = 400;
const MARGIN = { top: 10, right: 15, bottom: 30, left: 0 };
const LABEL_WIDTH = 45;

function freqToMidi(hz: number): number {
  return 12 * Math.log2(hz / 440) + 69;
}

function midiToNote(midi: number, tonic: number): string {
  const semitone = ((Math.round(midi) - tonic) % 12 + 12) % 12;
  return SARGAM_LABELS[semitone] || "";
}

function midiToWestern(midi: number): string {
  return NOTE_NAMES[Math.round(midi) % 12] || "";
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Stems that have pitch data (vocals, accompaniment — not original) */
const PITCH_STEMS = ["vocals", "accompaniment"];

export function PitchContour({
  songId,
  stem = "vocals",
  tonicMidi,
  currentTimeRef,
  duration,
  isPlaying,
  onSeek,
  transcription,
}: {
  songId: string;
  stem?: string;
  tonicMidi: number | null;
  currentTimeRef: RefObject<number>;
  duration: number;
  isPlaying: boolean;
  onSeek?: (time: number) => void;
  transcription?: TranscriptionNote[];
}) {
  const [pitchStem, setPitchStem] = useState(stem);
  const [points, setPoints] = useState<PitchPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoverInfo, setHoverInfo] = useState<{
    x: number; y: number; time: number; freq: number; midi: number;
    sargam: string; western: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const lastSeekRef = useRef(0);
  const rafRef = useRef(0);

  // Fetch pitch data using the independently-selected pitch stem
  useEffect(() => {
    setLoading(true);
    fetch(`/api/results/${songId}/pitch/${pitchStem}`)
      .then((r) => r.json())
      .then((data) => { setPoints(data.points || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [songId, pitchStem]);

  // Compute MIDI range
  const { minMidi, maxMidi, tonic } = useMemo(() => {
    if (points.length === 0) return { minMidi: 48, maxMidi: 84, tonic: 60 };
    const midis = points.map((p) => freqToMidi(p.frequency));
    const min = Math.floor(Math.min(...midis) - 2);
    const max = Math.ceil(Math.max(...midis) + 2);
    return { minMidi: min, maxMidi: max, tonic: tonicMidi ?? 60 };
  }, [points, tonicMidi]);

  // Group transcription into phrases
  const phrases = useMemo(() => {
    if (!transcription || transcription.length === 0) return [];
    const result: Phrase[] = [];
    let current: TranscriptionNote[] = [transcription[0]];
    let idx = 0;
    for (let i = 1; i < transcription.length; i++) {
      if (transcription[i].start - transcription[i - 1].end > 0.5) {
        result.push({ startTime: current[0].start, endTime: current[current.length - 1].end, notes: current, index: idx++ });
        current = [transcription[i]];
      } else {
        current.push(transcription[i]);
      }
    }
    if (current.length > 0) {
      result.push({ startTime: current[0].start, endTime: current[current.length - 1].end, notes: current, index: idx });
    }
    return result;
  }, [transcription]);

  const totalWidth = Math.max(800, Math.ceil(duration * PX_PER_SECOND));
  const plotH = PLOT_HEIGHT - MARGIN.top - MARGIN.bottom;

  const xScale = useCallback(
    (t: number) => (t / Math.max(duration, 1)) * totalWidth,
    [duration, totalWidth]
  );
  const yScale = useCallback(
    (midi: number) => MARGIN.top + plotH - ((midi - minMidi) / (maxMidi - minMidi)) * plotH,
    [minMidi, maxMidi, plotH]
  );

  // Build SVG path
  const pathD = useMemo(() => {
    if (points.length === 0) return "";
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

  // Time labels
  const timeLabels = useMemo(() => {
    if (duration <= 0) return [];
    const step = Math.max(5, Math.ceil(duration / (totalWidth / 100)));
    const labels: { time: number; label: string }[] = [];
    for (let t = 0; t <= duration; t += step) {
      labels.push({ time: t, label: formatTime(t) });
    }
    return labels;
  }, [duration, totalWidth]);

  // 60fps RAF loop for playhead + auto-scroll
  useEffect(() => {
    function tick() {
      const container = scrollRef.current;
      const playhead = playheadRef.current;
      const time = currentTimeRef.current ?? 0;

      if (playhead) {
        playhead.style.left = `${xScale(time)}px`;
      }

      if (container && isPlaying) {
        const x = xScale(time);
        const viewWidth = container.clientWidth;
        const target = Math.max(0, x - viewWidth / 2);

        const timeSinceSeek = Date.now() - lastSeekRef.current;
        if (timeSinceSeek < 300 || Math.abs(container.scrollLeft - target) > viewWidth) {
          container.scrollLeft = target;
        } else {
          container.scrollLeft = container.scrollLeft * 0.92 + target * 0.08;
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, xScale, currentTimeRef]);

  // Snap scroll when seeking while paused
  const handleSeekSnap = useCallback(() => {
    if (!isPlaying && scrollRef.current) {
      const x = xScale(currentTimeRef.current ?? 0);
      const viewWidth = scrollRef.current.clientWidth;
      scrollRef.current.scrollLeft = Math.max(0, x - viewWidth / 2);
    }
  }, [isPlaying, xScale, currentTimeRef]);

  useEffect(() => { handleSeekSnap(); }, [handleSeekSnap]);

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    if (!onSeek) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
    const x = e.clientX - rect.left + scrollLeft;
    const time = (x / totalWidth) * duration;
    lastSeekRef.current = Date.now();
    onSeek(Math.max(0, Math.min(duration, time)));
    setTimeout(() => {
      if (scrollRef.current) {
        const viewWidth = scrollRef.current.clientWidth;
        scrollRef.current.scrollLeft = Math.max(0, x - viewWidth / 2);
      }
    }, 0);
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
    const mx = e.clientX - rect.left + scrollLeft;
    const my = e.clientY - rect.top;
    const time = (mx / totalWidth) * duration;

    // Find nearest pitch point by time (binary search)
    let lo = 0, hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (points[mid].time < time) lo = mid + 1;
      else hi = mid;
    }
    const nearest = points[lo];
    if (!nearest || Math.abs(nearest.time - time) > 0.5) {
      setHoverInfo(null);
      return;
    }

    const midi = freqToMidi(nearest.frequency);
    setHoverInfo({
      x: e.clientX - rect.left + 15,
      y: Math.min(my, PLOT_HEIGHT - 80),
      time: nearest.time,
      freq: nearest.frequency,
      midi,
      sargam: midiToNote(midi, tonic),
      western: midiToWestern(midi),
    });
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
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden relative" style={{ height: PLOT_HEIGHT + 36 }}>
      {/* Pitch stem selector */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-card">
        <span className="text-text-faint text-[10px] uppercase tracking-wide mr-1">Pitch:</span>
        {PITCH_STEMS.map((s) => (
          <button
            key={s}
            onClick={() => setPitchStem(s)}
            className={`px-2.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
              pitchStem === s
                ? "bg-accent/20 text-accent"
                : "text-text-faint hover:text-text-muted"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      <div className="flex relative" style={{ height: PLOT_HEIGHT }}>
      {/* Sticky sargam labels */}
      <div className="flex-shrink-0 bg-bg-card border-r border-border z-10" style={{ width: LABEL_WIDTH }}>
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
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoverInfo(null)}
        >
          {/* Plot background */}
          <rect x={0} y={MARGIN.top} width={totalWidth} height={plotH} fill="#0d0a04" />

          {/* Phrase background spans */}
          {phrases.map((phrase) => (
            <rect
              key={phrase.index}
              x={xScale(phrase.startTime)}
              y={MARGIN.top}
              width={xScale(phrase.endTime) - xScale(phrase.startTime)}
              height={plotH}
              fill={phrase.index % 2 === 0 ? "rgba(191, 110, 19, 0.04)" : "rgba(212, 148, 42, 0.04)"}
            />
          ))}

          {/* Sargam grid lines (dotted) */}
          {gridLines.map((line, i) => (
            <line
              key={i}
              x1={0}
              y1={yScale(line.midi)}
              x2={totalWidth}
              y2={yScale(line.midi)}
              stroke={line.isTonic ? "#3a2a14" : "#1a1408"}
              strokeWidth={line.isTonic ? 1.5 : 0.5}
              strokeDasharray={line.isTonic ? "none" : "4 4"}
            />
          ))}

          {/* Vertical time grid lines (dotted) */}
          {timeLabels.map((t, i) => (
            <line
              key={`vgrid-${i}`}
              x1={xScale(t.time)}
              y1={MARGIN.top}
              x2={xScale(t.time)}
              y2={MARGIN.top + plotH}
              stroke="#1a1408"
              strokeWidth={0.5}
              strokeDasharray="4 4"
            />
          ))}

          {/* Transcription note labels */}
          {transcription && transcription.map((note, i) => {
            const x = xScale(note.start);
            const w = xScale(note.end) - x;
            // Only render labels that are wide enough to see
            if (w < 8) return null;
            const y = yScale(note.pitchMidi);
            return (
              <g key={i}>
                {/* Note span bar */}
                <rect
                  x={x}
                  y={y - 8}
                  width={w}
                  height={16}
                  fill="rgba(191, 110, 19, 0.15)"
                  rx={2}
                />
                {/* Sargam label */}
                {w > 20 && (
                  <text
                    x={x + w / 2}
                    y={y + 3}
                    textAnchor="middle"
                    fill="#d4942a"
                    fontSize={9}
                    fontFamily="monospace"
                    opacity={0.8}
                  >
                    {note.sargam}
                  </text>
                )}
              </g>
            );
          })}

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

          {/* Inflection point dots (note start/end boundaries) */}
          {transcription && transcription.map((note, i) => {
            const startX = xScale(note.start);
            const startY = yScale(note.pitchMidi);
            return (
              <circle
                key={`inf-${i}`}
                cx={startX}
                cy={startY}
                r={2.5}
                fill="#ef4444"
                opacity={0.7}
              />
            );
          })}

          {/* Pitch curve */}
          <path d={pathD} fill="none" stroke="#bf6e13" strokeWidth={1.5} opacity={0.9} />
        </svg>

        {/* Playhead */}
        <div
          ref={playheadRef}
          className="absolute top-0 pointer-events-none"
          style={{
            width: 2,
            height: PLOT_HEIGHT - MARGIN.bottom,
            backgroundColor: "#bf6e13",
            opacity: 0.8,
          }}
        />
      </div>

      {/* Hover tooltip */}
      {hoverInfo && (
        <div
          className="absolute pointer-events-none bg-bg-elevated border border-border rounded-lg px-3 py-2 shadow-lg z-20"
          style={{ left: hoverInfo.x + LABEL_WIDTH, top: hoverInfo.y }}
        >
          <div className="text-text-primary text-xs font-mono">
            <span className="text-accent-gold font-bold">{hoverInfo.sargam}</span>
            <span className="text-text-faint ml-2">({hoverInfo.western})</span>
          </div>
          <div className="text-text-faint text-[10px] font-mono mt-0.5">
            {hoverInfo.freq.toFixed(1)} Hz / MIDI {hoverInfo.midi.toFixed(1)}
          </div>
          <div className="text-text-faint text-[10px] font-mono">
            {formatTime(hoverInfo.time)}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
