"use client";

import { useState } from "react";
import type { ResultsData } from "@/hooks/useResults";

type LmEvidence = NonNullable<ResultsData["lmEvidence"]>;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function NgramEvidence({
  evidence,
  onSeek,
}: {
  evidence: LmEvidence;
  onSeek?: (time: number) => void;
}) {
  const [showPhrases, setShowPhrases] = useState(false);

  return (
    <div className="mb-8">
      <h2 className="text-base font-semibold text-text-primary mb-3">
        N-gram Evidence
        <span className="text-text-faint text-xs font-normal ml-2">
          {evidence.raga} (LM score: {evidence.total_score.toFixed(3)})
        </span>
      </h2>

      {/* Top evidence table */}
      <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-text-muted text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-2.5 font-medium">N-gram</th>
              <th className="text-left px-3 py-2.5 font-medium">Order</th>
              <th className="text-left px-3 py-2.5 font-medium">Weight</th>
              <th className="text-left px-3 py-2.5 font-medium">Contribution</th>
              <th className="text-left px-3 py-2.5 font-medium">Count</th>
            </tr>
          </thead>
          <tbody>
            {evidence.top_evidence.map((ev, i) => (
              <tr
                key={i}
                className={`border-b border-border last:border-b-0 cursor-pointer hover:bg-bg-elevated transition-colors ${
                  i === 0 ? "bg-accent/5" : ""
                }`}
                onClick={() => {
                  if (ev.occurrences.length > 0 && onSeek) {
                    onSeek(ev.occurrences[0].start);
                  }
                }}
              >
                <td className="px-4 py-2.5 font-mono text-accent-gold text-xs">
                  {ev.ngram.join(" \u2192 ")}
                </td>
                <td className="px-3 py-2.5 text-text-muted">{ev.order}</td>
                <td className="px-3 py-2.5 text-text-muted">
                  {ev.entropy_weight.toFixed(2)}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={
                      ev.total_contribution >= 0
                        ? "text-status-success"
                        : "text-status-error"
                    }
                  >
                    {ev.total_contribution >= 0 ? "+" : ""}
                    {ev.total_contribution.toFixed(3)}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-text-muted">
                  {ev.occurrence_count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phrase breakdown toggle */}
      {evidence.phrases.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowPhrases(!showPhrases)}
            className="text-text-faint text-xs hover:text-text-muted transition-colors"
          >
            {showPhrases ? "Hide" : "Show"} phrase breakdown ({evidence.phrases.length} phrases)
          </button>

          {showPhrases && (
            <div className="mt-2 bg-bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-text-muted text-[10px] uppercase tracking-wide">
                    <th className="text-left px-4 py-2 font-medium">#</th>
                    <th className="text-left px-3 py-2 font-medium">Time</th>
                    <th className="text-left px-3 py-2 font-medium">Score</th>
                    <th className="text-left px-3 py-2 font-medium">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.phrases.map((p) => (
                    <tr
                      key={p.phrase_idx}
                      className="border-b border-border last:border-b-0 cursor-pointer hover:bg-bg-elevated transition-colors"
                      onClick={() => onSeek?.(p.start)}
                    >
                      <td className="px-4 py-2 text-text-faint">{p.phrase_idx + 1}</td>
                      <td className="px-3 py-2 text-text-muted font-mono text-xs">
                        {formatTime(p.start)} - {formatTime(p.end)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            p.phrase_score >= 0
                              ? "text-status-success"
                              : "text-status-error"
                          }
                        >
                          {p.phrase_score >= 0 ? "+" : ""}
                          {p.phrase_score.toFixed(3)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-text-muted">{p.token_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
