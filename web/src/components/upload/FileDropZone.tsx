"use client";

import { useState, useCallback, useRef } from "react";

const ACCEPTED_TYPES = [".mp3", ".wav", ".flac", ".m4a"];
const ACCEPTED_MIME = ["audio/mpeg", "audio/wav", "audio/flac", "audio/x-m4a", "audio/mp4"];

export function FileDropZone({ file, onFileChange }: { file: File | null; onFileChange: (file: File | null) => void }) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped && ACCEPTED_MIME.includes(dropped.type)) onFileChange(dropped);
  }, [onFileChange]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onFileChange(e.target.files?.[0] || null);
  }, [onFileChange]);

  if (file) {
    return (
      <div className="border border-border rounded-xl p-4 bg-bg-card flex items-center justify-between">
        <div>
          <div className="text-sm text-text-primary font-medium">{file.name}</div>
          <div className="text-xs text-text-muted">{(file.size / (1024 * 1024)).toFixed(1)} MB</div>
        </div>
        <button onClick={() => onFileChange(null)} className="text-text-muted hover:text-status-error text-sm transition-colors">Remove</button>
      </div>
    );
  }

  return (
    <div onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}
      className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${isDragging ? "border-accent bg-accent/5" : "border-border bg-bg-card"}`}
      onClick={() => inputRef.current?.click()}>
      <div className="text-text-muted text-3xl mb-2">&#8593;</div>
      <div className="text-text-secondary text-sm font-medium mb-1">Drag and drop your audio file here</div>
      <div className="text-text-muted text-xs mb-3">or</div>
      <div className="inline-block bg-bg-elevated text-text-secondary px-4 py-2 rounded-lg text-xs border border-border">Browse files</div>
      <div className="text-text-faint text-[11px] mt-3">Supports MP3, WAV, FLAC, M4A</div>
      <input ref={inputRef} type="file" accept={ACCEPTED_TYPES.join(",")} onChange={handleFileInput} className="hidden" />
    </div>
  );
}
