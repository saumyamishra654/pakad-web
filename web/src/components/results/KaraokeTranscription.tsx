"use client";

import { useState, useMemo, useEffect, useRef } from "react";

interface Note {
  start: number;
  end: number;
  sargam: string;
}

interface Phrase {
  startTime: number;
  endTime: number;
  notes: Note[];
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function KaraokeTranscription({
  notes,
  currentTime,
  onSeek,
}: {
  notes: Note[];
  currentTime: number;
  onSeek?: (time: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to keep the active phrase visible
  useEffect(() => {
    const el = activeRef.current;
    const container = containerRef.current;
    if (!el || !container) return;
    const elTop = el.offsetTop - container.offsetTop;
    const elBottom = elTop + el.offsetHeight;
    const scrollTop = container.scrollTop;
    const viewHeight = container.clientHeight;
    if (elTop < scrollTop || elBottom > scrollTop + viewHeight) {
      container.scrollTo({ top: Math.max(0, elTop - viewHeight / 3), behavior: "smooth" });
    }
  }, [currentTime]);

  const phrases = useMemo(() => {
    if (notes.length === 0) return [];
    const result: Phrase[] = [];
    let current: Note[] = [notes[0]];
    for (let i = 1; i < notes.length; i++) {
      if (notes[i].start - notes[i - 1].end > 0.5) {
        result.push({
          startTime: current[0].start,
          endTime: current[current.length - 1].end,
          notes: current,
        });
        current = [notes[i]];
      } else {
        current.push(notes[i]);
      }
    }
    if (current.length > 0) {
      result.push({
        startTime: current[0].start,
        endTime: current[current.length - 1].end,
        notes: current,
      });
    }
    return result;
  }, [notes]);

  // Auto-expand when playback reaches phrases beyond the collapsed set
  useEffect(() => {
    if (expanded || phrases.length <= 8) return;
    const activeIdx = phrases.findIndex(
      (p) => currentTime >= p.startTime && currentTime <= p.endTime
    );
    if (activeIdx >= 8) setExpanded(true);
  }, [currentTime, expanded, phrases]);

  const displayPhrases = expanded ? phrases : phrases.slice(0, 8);

  return (
    <div className="mb-8">
      <h2 className="text-base font-semibold text-text-primary mb-3">
        Transcription
      </h2>
      <div
        ref={containerRef}
        className="bg-bg-card border border-border rounded-xl p-4 font-mono overflow-y-auto"
        style={{ maxHeight: 320 }}
      >
        {displayPhrases.map((phrase, i) => {
          const isActive =
            currentTime >= phrase.startTime && currentTime <= phrase.endTime;
          return (
            <div
              key={i}
              ref={isActive ? activeRef : undefined}
              onClick={() => onSeek?.(phrase.startTime)}
              className={`mb-2 px-3 py-1.5 rounded-md cursor-pointer transition-colors ${
                isActive
                  ? "bg-accent/10 border-l-2 border-l-accent"
                  : "hover:bg-bg-elevated"
              }`}
            >
              <span className="text-text-faint text-[10px] mr-3">
                {formatTime(phrase.startTime)}
              </span>
              <span className="text-sm tracking-wider">
                {phrase.notes.map((n, j) => (
                  <span
                    key={j}
                    className={
                      isActive &&
                      currentTime >= n.start &&
                      currentTime <= n.end
                        ? "text-accent-gold font-bold"
                        : "text-text-secondary"
                    }
                  >
                    {n.sargam}{" "}
                  </span>
                ))}
              </span>
            </div>
          );
        })}
        {!expanded && phrases.length > 8 && (
          <button
            onClick={() => setExpanded(true)}
            className="text-text-faint text-xs mt-2 hover:text-text-muted"
          >
            + {phrases.length - 8} more phrases
          </button>
        )}
        {expanded && phrases.length > 8 && (
          <button
            onClick={() => setExpanded(false)}
            className="text-text-faint text-xs mt-2 hover:text-text-muted"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  );
}
