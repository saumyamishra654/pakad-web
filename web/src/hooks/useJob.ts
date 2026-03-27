"use client";

import { useState, useEffect, useRef } from "react";
import { JobStatus } from "@/lib/types";

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
