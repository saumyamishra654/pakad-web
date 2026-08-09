"use client";

import { useEffect, useState, useCallback } from "react";
import { resolveAudio, requestAudioJob, getResults } from "@/lib/api";
import { ingestDelivery, useJobPolling } from "@/hooks/useJob";
import { AudioDelivery } from "@/hooks/useResults";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const SPEED_OPTIONS = [1, 0.75, 0.5];

export function AudioPlayer({
  stems,
  song,
  audioDelivery,
  isPlaying, currentTime, duration, activeStem, playbackRate,
  loadStem, play, pause, seek, skip, setSpeed,
}: {
  /** Server-side stem URLs, keyed by label. Used directly for uploads; used
   * as the fallback (unreachable post-delivery) reference for YouTube songs. */
  stems: Record<string, string>;
  /** Song identity needed for local-first audio resolution (Plan 011). */
  song?: { id: string; source: string; audioHash: string };
  /** Plan 009 delivery buffer surfaced on the results payload. */
  audioDelivery?: AudioDelivery;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  activeStem: string;
  playbackRate: number;
  loadStem: (url: string | null, stem: string) => void;
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  skip: (seconds: number) => void;
  setSpeed: (rate: number) => void;
}) {
  const isYoutube = song?.source === "youtube";

  // Resolved playback URL per stem label; `null` means "not on this device yet".
  // Undefined (key absent) means "still resolving" -- treated as unavailable
  // for rendering purposes until resolution completes.
  const [resolved, setResolved] = useState<Record<string, string | null>>({});
  const [resolveVersion, setResolveVersion] = useState(0);

  // "Generate audio" job state
  const [audioJobId, setAudioJobId] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [genError, setGenError] = useState("");

  const stemKeys = Object.keys(stems);

  // Resolve each stem's playback URL (local-first for YouTube, server for uploads).
  useEffect(() => {
    let cancelled = false;
    if (!song || stemKeys.length === 0) return;
    (async () => {
      const next: Record<string, string | null> = {};
      for (const label of stemKeys) {
        next[label] = await resolveAudio(song, label, stems[label]);
      }
      if (!cancelled) setResolved(next);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song?.id, song?.source, song?.audioHash, JSON.stringify(stems), resolveVersion]);

  // Load the first available stem once resolution completes.
  useEffect(() => {
    if (stemKeys.length === 0) return;
    const firstAvailable = stemKeys.find((s) => resolved[s]);
    if (firstAvailable) loadStem(resolved[firstAvailable]!, firstAvailable);
  }, [resolved, stemKeys, loadStem]);

  const anyAvailable = stemKeys.some((s) => resolved[s]);
  const needsGenerate = isYoutube && stemKeys.length > 0 && !anyAvailable;

  const handleGenerateAudio = useCallback(async () => {
    if (!song) return;
    setGenError("");
    setRequesting(true);
    try {
      const { jobId } = await requestAudioJob(song.id);
      setAudioJobId(jobId);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Failed to start audio generation");
      setRequesting(false);
    }
  }, [song]);

  const onAudioJobComplete = useCallback(() => {
    (async () => {
      if (song && audioDelivery) {
        // The delivery buffer is short-TTL; re-fetch is not needed here since
        // the job just completed -- but the URLs live on the analysis doc, not
        // the job status, so pull the freshest copy via the results payload.
        try {
          const data = await getResults(song.id);
          if (data.audioDelivery?.available) {
            await ingestDelivery(song.audioHash, data.audioDelivery);
          }
        } catch {
          /* best-effort; user can retry Generate audio */
        }
      }
      setRequesting(false);
      setAudioJobId(null);
      setResolveVersion((v) => v + 1); // re-resolve now that blobs are stored
    })();
  }, [song, audioDelivery]);

  const audioJob = useJobPolling(audioJobId, onAudioJobComplete);

  return (
    <div className="bg-bg-card border border-border rounded-xl overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        {/* Stem toggles */}
        <div className="flex gap-2">
          {stemKeys.map((stem) => {
            const url = resolved[stem];
            const disabled = isYoutube && !url;
            return (
              <button key={stem} disabled={disabled} onClick={() => url && loadStem(url, stem)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  disabled
                    ? "bg-bg-elevated text-text-faint border border-border cursor-not-allowed opacity-50"
                    : activeStem === stem
                    ? "bg-accent text-white"
                    : "bg-bg-elevated text-text-secondary border border-border"
                }`}>
                {stem.charAt(0).toUpperCase() + stem.slice(1)}
              </button>
            );
          })}
        </div>

        {/* Transport controls */}
        <div className="flex items-center gap-3 text-text-secondary">
          {/* Speed selector */}
          <div className="flex gap-1 mr-2">
            {SPEED_OPTIONS.map((rate) => (
              <button
                key={rate}
                onClick={() => setSpeed(rate)}
                className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                  playbackRate === rate ? "bg-accent/20 text-accent" : "text-text-faint hover:text-text-muted"
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>

          <button onClick={() => skip(-10)} disabled={needsGenerate} className="text-lg hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed">&#9664;&#9664;</button>
          <button onClick={isPlaying ? pause : play} disabled={needsGenerate} className="text-2xl text-accent hover:opacity-80 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed">
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button onClick={() => skip(10)} disabled={needsGenerate} className="text-lg hover:text-text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed">&#9654;&#9654;</button>
          <span className="text-xs font-mono text-text-muted ml-2 min-w-[80px]">{formatTime(currentTime)} / {formatTime(duration)}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className={`h-1.5 bg-bg-elevated ${needsGenerate ? "" : "cursor-pointer"}`}
        onClick={(e) => { if (needsGenerate) return; const rect = e.currentTarget.getBoundingClientRect(); seek((e.clientX - rect.left) / rect.width * duration); }}>
        <div className="h-full bg-accent transition-all" style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }} />
      </div>

      {/* "Generate audio" affordance -- YouTube songs with no local audio */}
      {needsGenerate && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 bg-bg-elevated border-t border-border">
          <div className="text-xs text-text-muted">
            {audioJobId && audioJob
              ? (
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-status-warning animate-pulse" />
                  {audioJob.step || "Separating stems…"}
                </span>
              )
              : "Audio isn't on this device yet."}
          </div>
          <button
            onClick={handleGenerateAudio}
            disabled={requesting}
            className="bg-accent text-white text-xs font-medium rounded-md px-3 py-1.5 hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {requesting ? "Generating…" : "Generate audio"}
          </button>
        </div>
      )}
      {genError && (
        <div className="px-4 py-2 text-xs text-status-error border-t border-border">{genError}</div>
      )}
    </div>
  );
}
