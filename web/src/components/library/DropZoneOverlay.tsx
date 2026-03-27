"use client";

export function DropZoneOverlay() {
  return (
    <div className="fixed inset-0 z-50 bg-bg/80 flex items-center justify-center">
      <div className="border-2 border-dashed border-accent rounded-2xl p-16 text-center">
        <div className="text-accent text-lg font-medium mb-2">Drop your audio file to start analysis</div>
        <div className="text-text-muted text-sm">Supports MP3, WAV, FLAC, M4A</div>
      </div>
    </div>
  );
}
