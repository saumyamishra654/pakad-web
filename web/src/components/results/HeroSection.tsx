"use client";

import { ResultsData } from "@/hooks/useResults";

export function HeroSection({ data }: { data: ResultsData }) {
  const { detection, song } = data;
  return (
    <div className="text-center mb-8">
      <div className="text-text-muted text-xs uppercase tracking-widest mb-2">Detected Raga</div>
      <h1 className="text-4xl font-extrabold text-text-primary mb-3">{detection.raga || "Unknown"}</h1>
      <div className="flex items-center justify-center gap-3 mb-4">
        {detection.tonic && (
          <span className="bg-bg-elevated text-accent-gold px-3 py-1 rounded-md text-sm border border-border">Tonic: {detection.tonic}</span>
        )}
      </div>
      <div className="text-text-secondary text-sm">{song.title}</div>
      <div className="text-text-faint text-xs mt-1">
        {song.source === "youtube" ? "YouTube" : "Uploaded file"}
        {song.createdAt && ` · Analyzed ${new Date(song.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
      </div>
    </div>
  );
}
