"use client";

import { useState, useEffect, useRef } from "react";
import { JobStatus } from "@/lib/types";
import { putStem } from "@/lib/localAudio";

/**
 * Pull a completed job's delivered audio (Plan 009's short-TTL signed URLs)
 * into on-device storage (Plan 011). Called once, on the completion
 * transition of a delivery/audio_only job. The server buffer is short-TTL
 * and lifecycle-purged -- this pull is the hand-off to the device.
 */
export async function ingestDelivery(audioHash: string, delivery: { urls: Record<string, string> }) {
  for (const [label, url] of Object.entries(delivery.urls || {})) {
    try {
      const blob = await (await fetch(url)).blob();
      await putStem(audioHash, label, blob);
    } catch {
      /* delivery URL may have expired; user can regenerate */
    }
  }
}

export function useJobPolling(jobId: string | null, onComplete?: () => void) {
  const [job, setJob] = useState<JobStatus | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!jobId) return;

    async function poll() {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (res.ok) {
          const data = await res.json();
          setJob(data);
          if (data.status === "completed" || data.status === "failed") {
            if (intervalRef.current) clearInterval(intervalRef.current);
            if (data.status === "completed" && onComplete) onComplete();
          }
        }
      } catch {
        // silently retry on next interval
      }
    }

    poll();
    intervalRef.current = setInterval(poll, 2000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [jobId, onComplete]);

  return job;
}
