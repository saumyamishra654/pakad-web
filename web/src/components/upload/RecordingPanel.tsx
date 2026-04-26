"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { listTanpuraTracks, tanpuraAudioUrl } from "@/lib/api";

type RecordingState = "idle" | "recording" | "recorded";

interface RecordingPanelProps {
  onRecordingComplete: (blob: Blob) => void;
  onTanpuraKeyChange: (key: string | null) => void;
}

const TANPURA_TO_TONIC: Record<string, string> = {
  A: "A", Bb: "A#", B: "B", C: "C", Db: "C#", D: "D",
  Eb: "D#", E: "E", F: "F", Gb: "F#", G: "G", Ab: "G#",
};

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  for (const mime of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "audio/webm";
}

export function RecordingPanel({ onRecordingComplete, onTanpuraKeyChange }: RecordingPanelProps) {
  const [tanpuraKeys, setTanpuraKeys] = useState<{ key: string; label: string }[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [state, setState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [error, setError] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tanpuraRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load tanpura track list
  useEffect(() => {
    listTanpuraTracks()
      .then((data) => setTanpuraKeys(data.tracks || []))
      .catch(() => {});
  }, []);

  // Acquire mic permission once on mount, reuse the stream across recordings
  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (tanpuraRef.current) { tanpuraRef.current.pause(); tanpuraRef.current = null; }
      if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    };
  }, [playbackUrl]);

  const handleKeyChange = useCallback((key: string) => {
    setSelectedKey(key);
    onTanpuraKeyChange(key || null);
  }, [onTanpuraKeyChange]);

  async function startRecording() {
    setError("");
    try {
      // Reuse existing stream or request a new one if it was lost
      let stream = streamRef.current;
      if (!stream || stream.getTracks().every((t) => t.readyState === "ended")) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
      }

      // Start tanpura if key selected
      if (selectedKey) {
        const audio = new Audio(tanpuraAudioUrl(selectedKey));
        audio.loop = true;
        audio.volume = 0.4;
        await audio.play();
        tanpuraRef.current = audio;
      }

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const url = URL.createObjectURL(blob);
        setPlaybackUrl(url);
        onRecordingComplete(blob);
        setState("recorded");
        // Stop tanpura
        if (tanpuraRef.current) { tanpuraRef.current.pause(); tanpuraRef.current = null; }
        // Keep mic stream alive for re-recording — only released on unmount
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250); // collect chunks every 250ms
      setState("recording");
      setDuration(0);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Microphone access denied");
    }
  }

  function stopRecording() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }

  function resetRecording() {
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    setPlaybackUrl(null);
    setDuration(0);
    setState("idle");
  }

  function formatTime(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  return (
    <div className="space-y-4">
      {/* Tanpura Key Selector */}
      <div>
        <label className="text-text-secondary text-xs font-medium block mb-1.5">
          Tanpura Key <span className="text-text-faint font-normal">(optional -- plays drone during recording)</span>
        </label>
        <select
          value={selectedKey}
          onChange={(e) => handleKeyChange(e.target.value)}
          disabled={state === "recording"}
          className="w-full bg-bg-elevated border border-border rounded-lg px-3.5 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent disabled:opacity-50"
        >
          <option value="">None</option>
          {tanpuraKeys.map((t) => (
            <option key={t.key} value={t.key}>
              {t.key} {TANPURA_TO_TONIC[t.key] ? `(tonic: ${TANPURA_TO_TONIC[t.key]})` : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Recording Controls */}
      <div className="bg-bg-card border border-border rounded-xl p-6 text-center space-y-4">
        {state === "idle" && (
          <>
            <div className="text-text-muted text-sm">Press the button below to start recording from your microphone.</div>
            <button
              type="button"
              onClick={startRecording}
              className="inline-flex items-center gap-2 bg-red-600 text-white font-semibold rounded-full px-8 py-3 hover:bg-red-700 transition-colors"
            >
              <span className="w-3 h-3 bg-white rounded-full" />
              Start Recording
            </button>
          </>
        )}

        {state === "recording" && (
          <>
            <div className="flex items-center justify-center gap-3">
              <span className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <span className="text-text-primary text-lg font-mono">{formatTime(duration)}</span>
            </div>
            {selectedKey && (
              <div className="text-text-faint text-xs">Tanpura ({selectedKey}) playing in background</div>
            )}
            <button
              type="button"
              onClick={stopRecording}
              className="inline-flex items-center gap-2 bg-bg-elevated text-text-primary border border-border font-semibold rounded-full px-8 py-3 hover:border-accent transition-colors"
            >
              <span className="w-3 h-3 bg-red-500 rounded-sm" />
              Stop Recording
            </button>
          </>
        )}

        {state === "recorded" && playbackUrl && (
          <>
            <div className="text-text-muted text-sm">Recording complete ({formatTime(duration)})</div>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls src={playbackUrl} className="w-full max-w-md mx-auto" />
            <button
              type="button"
              onClick={resetRecording}
              className="text-text-muted text-xs underline hover:text-text-primary"
            >
              Discard and re-record
            </button>
          </>
        )}
      </div>

      {error && <p className="text-status-error text-sm">{error}</p>}
    </div>
  );
}
