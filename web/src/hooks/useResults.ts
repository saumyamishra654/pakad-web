"use client";

import { useState, useEffect } from "react";
import { auth } from "@/lib/firebase";
import { ingestDelivery } from "./useJob";
import { hasStem } from "@/lib/localAudio";

export interface AudioDelivery {
  available: boolean;
  urls: Record<string, string>;
  source: string | null;
}

export interface ResultsData {
  song: { id: string; title: string; source: string; youtubeVideoId: string | null; audioHash: string; createdAt: string; uploadedBy: string; visibility: string };
  audioDelivery: AudioDelivery;
  detection: { raga: string | null; tonic: string | null; tonicMidi: number | null; confidence: number | null };
  ragaInfo: { name?: string; aroha?: string; avroh?: string };
  candidates: { raga: string; tonic: string; score: number; rank: number }[];
  histogramCandidates: { raga: string; tonic: string; score: number; rank: number }[];
  transcription: { start: number; end: number; duration: number; sargam: string; pitchMidi: number; pitchHz: number; energy: number }[];
  images: Record<string, string>;
  stems: Record<string, string>;
  vocalsHistogram: {
    highRes: { cents: number; weight: number; smoothed: number }[];
    lowRes: { cents: number; weight: number; smoothed: number; label: string }[];
  };
  accompanimentHistogram: {
    highRes: { cents: number; weight: number; smoothed: number }[];
    lowRes: { cents: number; weight: number; smoothed: number; label: string }[];
  };
  transitionMatrix: { notes: string[]; matrix: number[][] };
  correctionSummary: Record<string, number>;
  patternAnalysis: Record<string, unknown>;
  lmEvidence: {
    raga: string;
    total_score: number;
    top_evidence: {
      ngram: string[];
      order: number;
      entropy_weight: number;
      total_contribution: number;
      occurrence_count: number;
      occurrences: { start: number; end: number; phrase_idx: number }[];
    }[];
    phrases: {
      phrase_idx: number;
      start: number;
      end: number;
      phrase_score: number;
      token_count: number;
    }[];
  } | null;
}

export function useResults(songId: string) {
  const [data, setData] = useState<ResultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const headers: HeadersInit = {};
        const user = auth.currentUser;
        if (user) {
          headers["Authorization"] = `Bearer ${await user.getIdToken()}`;
        }
        const res = await fetch(`/api/results/${songId}`, { headers });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || `Error ${res.status}`);
        }
        const payload: ResultsData = await res.json();
        setData(payload);
        setError(null);

        // Local-first audio hand-off (Plan 011): on first load after a
        // delivery/audio_only job completes, the analysis doc carries a
        // short-TTL audioDelivery buffer. Pull it into IndexedDB once so
        // subsequent playback never depends on that buffer's TTL.
        const delivery = payload.audioDelivery;
        const audioHash = payload.song?.audioHash;
        if (delivery?.available && audioHash) {
          const alreadyLocal = await hasStem(audioHash, Object.keys(delivery.urls)[0] || "original");
          if (!alreadyLocal) {
            await ingestDelivery(audioHash, delivery);
          }
        }
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
