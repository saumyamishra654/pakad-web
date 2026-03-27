"use client";

import { useState, useEffect } from "react";

export interface ResultsData {
  song: { id: string; title: string; source: string; youtubeVideoId: string | null; createdAt: string };
  detection: { raga: string | null; tonic: string | null; tonicMidi: number | null; confidence: number | null };
  ragaInfo: { name?: string; aroha?: string; avroh?: string };
  candidates: { raga: string; tonic: string; score: number; rank: number }[];
  transcription: { start: number; end: number; duration: number; sargam: string; pitchMidi: number; pitchHz: number; energy: number }[];
  images: Record<string, string>;
  stems: Record<string, string>;
  histogram: { pitchClass: number; sargam: string; weight: number }[];
  vocalsHistogram: { cents: number; label: string; weight: number }[];
  accompanimentHistogram: { cents: number; label: string; weight: number }[];
  transitionMatrix: { notes: string[]; matrix: number[][] };
  correctionSummary: Record<string, number>;
  patternAnalysis: Record<string, unknown>;
}

export function useResults(songId: string) {
  const [data, setData] = useState<ResultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const res = await fetch(`/api/results/${songId}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || `Error ${res.status}`);
        }
        setData(await res.json());
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load results");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [songId]);

  return { data, loading, error };
}
