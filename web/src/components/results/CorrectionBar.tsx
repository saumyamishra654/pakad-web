"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { reanalyze, listRagas } from "@/lib/api";

const TONIC_OPTIONS = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

interface CorrectionBarProps {
  songId: string;
  currentTonic: string | null;
  currentRaga: string | null;
}

export function CorrectionBar({ songId, currentTonic, currentRaga }: CorrectionBarProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [tonic, setTonic] = useState(currentTonic || "");
  const [raga, setRaga] = useState(currentRaga || "");
  const [ragaSearch, setRagaSearch] = useState("");
  const [instrument, setInstrument] = useState("vocal");
  const [vocalistGender, setVocalistGender] = useState("");
  const [ragaList, setRagaList] = useState<string[]>([]);
  const [ragaDropdownOpen, setRagaDropdownOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchRagas = useCallback(async () => {
    try {
      const ragas = await listRagas();
      if (Array.isArray(ragas)) {
        setRagaList(ragas.map((r: string | { name: string }) => (typeof r === "string" ? r : r.name)));
      }
    } catch {
      // silently ignore -- user can still type manually
    }
  }, []);

  useEffect(() => {
    if (expanded && ragaList.length === 0) {
      fetchRagas();
    }
  }, [expanded, ragaList.length, fetchRagas]);

  const filteredRagas = ragaList.filter((r) =>
    r.toLowerCase().includes(ragaSearch.toLowerCase())
  );

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await reanalyze(songId, {
        tonic: tonic || undefined,
        raga: raga || undefined,
        instrument,
        vocalistGender: vocalistGender || undefined,
      });
      router.push("/library");
    } catch (err) {
      console.error("Re-analyze failed:", err);
      setSubmitting(false);
    }
  }

  const mailtoHref =
    "mailto:sau.mis654@gmail.com?subject=" + encodeURIComponent("Pakad Feedback");

  return (
    <div className="mb-6 bg-bg-card border border-border rounded-xl overflow-hidden">
      {/* Collapsed header row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left group"
      >
        <span className="text-text-secondary text-sm">
          Think the results are wrong?{" "}
          <span className="text-accent font-medium">Adjust &amp; Re-analyze</span>
        </span>
        <div className="flex items-center gap-3">
          {/* Feedback / bug report mailto icon */}
          <a
            href={mailtoHref}
            onClick={(e) => e.stopPropagation()}
            title="Send feedback"
            className="text-text-muted hover:text-accent transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4"
            >
              <path d="M3 4a2 2 0 0 0-2 2v1.161l8.441 4.221a1.25 1.25 0 0 0 1.118 0L19 7.162V6a2 2 0 0 0-2-2H3z" />
              <path d="M19 8.839l-7.556 3.778a2.75 2.75 0 0 1-2.888 0L1 8.839V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.839z" />
            </svg>
          </a>
          {/* Expand/collapse chevron */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`w-4 h-4 text-text-muted transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <path
              fillRule="evenodd"
              d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </button>

      {/* Expanded form */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-border pt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Tonic selector */}
            <div>
              <label className="block text-text-muted text-xs uppercase tracking-wide mb-1">
                Tonic
              </label>
              <select
                value={tonic}
                onChange={(e) => setTonic(e.target.value)}
                className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">Auto-detect</option>
                {TONIC_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* Raga selector (searchable dropdown) */}
            <div className="relative">
              <label className="block text-text-muted text-xs uppercase tracking-wide mb-1">
                Raga
              </label>
              <input
                type="text"
                value={ragaDropdownOpen ? ragaSearch : raga}
                placeholder={raga || "Search ragas..."}
                onFocus={() => {
                  setRagaDropdownOpen(true);
                  setRagaSearch("");
                }}
                onChange={(e) => {
                  setRagaSearch(e.target.value);
                  setRagaDropdownOpen(true);
                }}
                className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
              {ragaDropdownOpen && (
                <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto bg-bg-elevated border border-border rounded-lg shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setRaga("");
                      setRagaSearch("");
                      setRagaDropdownOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-text-muted hover:bg-bg-card"
                  >
                    Auto-detect
                  </button>
                  {filteredRagas.map((r) => (
                    <button
                      type="button"
                      key={r}
                      onClick={() => {
                        setRaga(r);
                        setRagaSearch("");
                        setRagaDropdownOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-bg-card ${
                        r === raga ? "text-accent font-medium" : "text-text-primary"
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                  {filteredRagas.length === 0 && ragaSearch && (
                    <div className="px-3 py-2 text-sm text-text-faint">No matches</div>
                  )}
                </div>
              )}
            </div>

            {/* Instrument selector */}
            <div>
              <label className="block text-text-muted text-xs uppercase tracking-wide mb-1">
                Instrument
              </label>
              <select
                value={instrument}
                onChange={(e) => setInstrument(e.target.value)}
                className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="vocal">Vocal</option>
                <option value="sitar">Sitar</option>
                <option value="sarod">Sarod</option>
                <option value="bansuri">Bansuri</option>
                <option value="sarangi">Sarangi</option>
                <option value="santoor">Santoor</option>
                <option value="harmonium">Harmonium</option>
                <option value="violin">Violin</option>
              </select>
            </div>

            {/* Vocalist gender (only shown when instrument is vocal) */}
            {instrument === "vocal" && (
              <div>
                <label className="block text-text-muted text-xs uppercase tracking-wide mb-1">
                  Vocalist Gender
                </label>
                <select
                  value={vocalistGender}
                  onChange={(e) => setVocalistGender(e.target.value)}
                  className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">Auto</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
            )}
          </div>

          {/* Submit button */}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={submitting}
              onClick={handleSubmit}
              className="bg-accent text-white px-5 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Re-analyze"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
