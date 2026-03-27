"use client";

interface PatternAnalysisProps {
  correctionSummary: {
    total?: number;
    corrected?: number;
    discarded?: number;
    remaining?: number;
    unchanged?: number;
  };
  patternAnalysis: {
    common_motifs?: { pattern: string; count: number }[];
    aaroh_stats?: Record<string, number>;
    avroh_stats?: Record<string, number>;
    total_phrases?: number;
    total_aaroh_runs?: number;
    total_avroh_runs?: number;
    aaroh_avroh_checker?: {
      score: number;
      matched_checks: number;
      total_checks: number;
    };
    aaroh_avroh_reference?: {
      matched_name: string;
      aaroh_raw: string;
      avroh_raw: string;
    };
  };
}

function StatBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-bg-elevated rounded-lg px-4 py-3 text-center">
      <div className="text-xl font-bold text-text-primary">{value}</div>
      <div className="text-text-faint text-[10px] uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}

export function PatternAnalysis({ correctionSummary, patternAnalysis }: PatternAnalysisProps) {
  const cs = correctionSummary;
  const pa = patternAnalysis;
  const hasCorrection = cs && (cs.total ?? 0) > 0;
  const hasPatterns = pa && ((pa.common_motifs?.length ?? 0) > 0 || pa.aaroh_stats || pa.avroh_stats);

  if (!hasCorrection && !hasPatterns) return null;

  const checker = pa?.aaroh_avroh_checker;
  const reference = pa?.aaroh_avroh_reference;

  // Convert aaroh/avroh stats objects to sorted arrays
  const aarohRuns = pa?.aaroh_stats
    ? Object.entries(pa.aaroh_stats).sort(([, a], [, b]) => b - a).slice(0, 5)
    : [];
  const avrohRuns = pa?.avroh_stats
    ? Object.entries(pa.avroh_stats).sort(([, a], [, b]) => b - a).slice(0, 5)
    : [];

  return (
    <div className="mb-8">
      <h2 className="text-base font-semibold text-text-primary mb-3">Pattern Analysis</h2>

      {/* Correction summary */}
      {hasCorrection && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <StatBox label="Total Notes" value={cs.total ?? 0} />
          <StatBox label="Corrected" value={cs.corrected ?? 0} />
          <StatBox label="Discarded" value={cs.discarded ?? 0} />
          <StatBox label="Valid Remaining" value={cs.remaining ?? 0} />
        </div>
      )}

      {/* Conformance score */}
      {checker && (
        <div className="bg-bg-card border border-border rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-text-secondary text-sm font-medium">Aaroh/Avroh Conformance</span>
            <span className={`text-sm font-bold ${checker.score >= 0.8 ? "text-status-success" : checker.score >= 0.5 ? "text-status-warning" : "text-status-error"}`}>
              {(checker.score * 100).toFixed(0)}% ({checker.matched_checks}/{checker.total_checks} checks)
            </span>
          </div>
          {reference && (
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-text-faint uppercase tracking-wide">Aaroh</span>
                <div className="text-accent-gold font-mono mt-0.5">{reference.aaroh_raw.replace(/-/g, " ")}</div>
              </div>
              <div>
                <span className="text-text-faint uppercase tracking-wide">Avroh</span>
                <div className="text-accent-gold font-mono mt-0.5">{reference.avroh_raw.replace(/-/g, " ")}</div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Common motifs */}
        {pa?.common_motifs && pa.common_motifs.length > 0 && (
          <div className="bg-bg-card border border-border rounded-xl p-4">
            <div className="text-text-secondary text-xs font-medium mb-3 uppercase tracking-wide">Common Motifs</div>
            {pa.common_motifs.slice(0, 8).map((m, i) => (
              <div key={i} className="flex justify-between items-center mb-1.5">
                <span className="text-text-secondary font-mono text-xs">{m.pattern}</span>
                <span className="text-text-faint text-[10px]">{m.count}x</span>
              </div>
            ))}
          </div>
        )}

        {/* Aaroh runs */}
        {aarohRuns.length > 0 && (
          <div className="bg-bg-card border border-border rounded-xl p-4">
            <div className="text-text-secondary text-xs font-medium mb-3 uppercase tracking-wide">
              Ascending Runs
              {pa?.total_aaroh_runs && <span className="text-text-faint font-normal ml-1">({pa.total_aaroh_runs} total)</span>}
            </div>
            {aarohRuns.map(([pattern, count], i) => (
              <div key={i} className="flex justify-between items-center mb-1.5">
                <span className="text-text-secondary font-mono text-xs">{pattern}</span>
                <span className="text-text-faint text-[10px]">{count}x</span>
              </div>
            ))}
          </div>
        )}

        {/* Avroh runs */}
        {avrohRuns.length > 0 && (
          <div className="bg-bg-card border border-border rounded-xl p-4">
            <div className="text-text-secondary text-xs font-medium mb-3 uppercase tracking-wide">
              Descending Runs
              {pa?.total_avroh_runs && <span className="text-text-faint font-normal ml-1">({pa.total_avroh_runs} total)</span>}
            </div>
            {avrohRuns.map(([pattern, count], i) => (
              <div key={i} className="flex justify-between items-center mb-1.5">
                <span className="text-text-secondary font-mono text-xs">{pattern}</span>
                <span className="text-text-faint text-[10px]">{count}x</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
