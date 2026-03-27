"use client";

import { useState, useMemo } from "react";

export interface TranscriptionNote {
  start: number;
  end: number;
  duration: number;
  sargam: string;
  pitchMidi: number;
  pitchHz: number;
  energy: number;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2);
  const sPad = parseFloat(s) < 10 ? `0${s}` : s;
  return `${m}:${sPad}`;
}

const DEFAULT_VISIBLE = 50;

export function TranscriptionGrid({
  notes,
  currentTime,
  onSeek,
}: {
  notes: TranscriptionNote[];
  currentTime: number;
  onSeek: (time: number) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  const displayNotes = showAll ? notes : notes.slice(0, DEFAULT_VISIBLE);

  // Find the index of the currently playing note
  const activeIndex = useMemo(() => {
    for (let i = 0; i < notes.length; i++) {
      if (currentTime >= notes[i].start && currentTime <= notes[i].end) {
        return i;
      }
    }
    return -1;
  }, [notes, currentTime]);

  if (notes.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-xl p-6 text-center">
        <p className="text-text-muted text-sm">No transcription data available</p>
      </div>
    );
  }

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-text-muted text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-2.5 font-medium w-8">#</th>
              <th className="text-left px-4 py-2.5 font-medium">Sargam</th>
              <th className="text-left px-4 py-2.5 font-medium">Start</th>
              <th className="text-left px-4 py-2.5 font-medium">End</th>
              <th className="text-left px-4 py-2.5 font-medium">Duration</th>
              <th className="text-left px-4 py-2.5 font-medium">Pitch (Hz)</th>
            </tr>
          </thead>
          <tbody>
            {displayNotes.map((note, i) => {
              const isActive = i === activeIndex;
              return (
                <tr
                  key={i}
                  onClick={() => onSeek(note.start)}
                  className={`border-b border-border last:border-b-0 cursor-pointer transition-colors ${
                    isActive
                      ? "bg-accent/10"
                      : "hover:bg-bg-elevated"
                  }`}
                >
                  <td className="px-4 py-2 text-text-faint font-mono text-xs">
                    {i + 1}
                  </td>
                  <td
                    className={`px-4 py-2 font-mono font-medium ${
                      isActive ? "text-accent-gold" : "text-text-primary"
                    }`}
                  >
                    {note.sargam}
                  </td>
                  <td className="px-4 py-2 text-text-secondary font-mono text-xs">
                    {formatTime(note.start)}
                  </td>
                  <td className="px-4 py-2 text-text-secondary font-mono text-xs">
                    {formatTime(note.end)}
                  </td>
                  <td className="px-4 py-2 text-text-muted font-mono text-xs">
                    {note.duration.toFixed(3)}s
                  </td>
                  <td className="px-4 py-2 text-text-muted font-mono text-xs">
                    {note.pitchHz.toFixed(1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Show all / Show less toggle */}
      {notes.length > DEFAULT_VISIBLE && (
        <div className="px-4 py-3 border-t border-border">
          <button
            onClick={() => setShowAll(!showAll)}
            className="text-text-faint text-xs hover:text-text-muted transition-colors"
          >
            {showAll
              ? "Show less"
              : `Show all ${notes.length} notes (${notes.length - DEFAULT_VISIBLE} more)`}
          </button>
        </div>
      )}
    </div>
  );
}
