"use client";

import { ResultsData } from "@/hooks/useResults";

export function RagaContext({ data }: { data: ResultsData }) {
  const { ragaInfo } = data;
  if (!ragaInfo.name) return null;
  return (
    <div className="bg-bg-card border border-border rounded-xl p-5 mb-8">
      <h2 className="text-base font-semibold text-text-primary mb-4">About Raga {ragaInfo.name}</h2>
      {(ragaInfo.aroha || ragaInfo.avroh) && (
        <div className="grid grid-cols-2 gap-4 mb-4">
          {ragaInfo.aroha && (
            <div>
              <div className="text-text-muted text-[11px] uppercase tracking-wide mb-1">Aroha (Ascending)</div>
              <div className="text-accent-gold font-mono text-sm tracking-wider">{ragaInfo.aroha.replace(/-/g, " ")}</div>
            </div>
          )}
          {ragaInfo.avroh && (
            <div>
              <div className="text-text-muted text-[11px] uppercase tracking-wide mb-1">Avroh (Descending)</div>
              <div className="text-accent-gold font-mono text-sm tracking-wider">{ragaInfo.avroh.replace(/-/g, " ")}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
