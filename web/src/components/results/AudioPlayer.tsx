"use client";

import { useEffect } from "react";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioPlayer({
  stems,
  isPlaying, currentTime, duration, activeStem,
  loadStem, play, pause, seek, skip,
}: {
  stems: Record<string, string>;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  activeStem: string;
  loadStem: (url: string, stem: string) => void;
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  skip: (seconds: number) => void;
}) {
  useEffect(() => {
    const firstStem = Object.keys(stems)[0];
    if (firstStem) loadStem(stems[firstStem], firstStem);
  }, [stems, loadStem]);

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex gap-2">
          {Object.keys(stems).map((stem) => (
            <button key={stem} onClick={() => loadStem(stems[stem], stem)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${activeStem === stem ? "bg-accent text-white" : "bg-bg-elevated text-text-secondary border border-border"}`}>
              {stem.charAt(0).toUpperCase() + stem.slice(1)}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-text-secondary">
          <button onClick={() => skip(-10)} className="text-lg hover:text-text-primary transition-colors">&#9664;&#9664;</button>
          <button onClick={isPlaying ? pause : play} className="text-2xl text-accent hover:opacity-80 transition-opacity">
            {isPlaying ? "\u23F8" : "\u25B6"}
          </button>
          <button onClick={() => skip(10)} className="text-lg hover:text-text-primary transition-colors">&#9654;&#9654;</button>
          <span className="text-xs font-mono text-text-muted ml-2 min-w-[80px]">{formatTime(currentTime)} / {formatTime(duration)}</span>
        </div>
      </div>
      <div className="h-1.5 bg-bg-elevated cursor-pointer"
        onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); seek((e.clientX - rect.left) / rect.width * duration); }}>
        <div className="h-full bg-accent transition-all" style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} />
      </div>
    </div>
  );
}
