"use client";

import { SongStatus } from "@/lib/types";

const statusConfig: Record<SongStatus, { color: string; label: string }> = {
  processing: { color: "bg-status-warning", label: "Processing" },
  complete: { color: "bg-status-success", label: "Complete" },
  failed: { color: "bg-status-error", label: "Error" },
};

export function StatusBadge({ status, progress }: { status: SongStatus; progress?: number }) {
  const config = statusConfig[status];
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${config.color}`} />
      <span className={`text-xs ${status === "complete" ? "text-status-success" : status === "failed" ? "text-status-error" : "text-status-warning"}`}>
        {config.label}
      </span>
      {status === "processing" && progress != null && (
        <div className="ml-1 flex-1 max-w-[60px] bg-bg rounded h-1 overflow-hidden">
          <div className="h-full bg-status-warning rounded transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}
