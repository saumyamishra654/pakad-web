"use client";

import { useParams } from "next/navigation";
import { Header } from "@/components/layout/Header";
import { HeroSection } from "@/components/results/HeroSection";
import { RagaContext } from "@/components/results/RagaContext";
import { AudioPlayer } from "@/components/results/AudioPlayer";
import { PitchContour } from "@/components/results/PitchContour";
import { KaraokeTranscription } from "@/components/results/KaraokeTranscription";
import { Histogram } from "@/components/results/Histogram";
import { TransitionMatrix } from "@/components/results/TransitionMatrix";
import { PatternAnalysis } from "@/components/results/PatternAnalysis";
import { useResults } from "@/hooks/useResults";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import Link from "next/link";

export default function SongResultsPage() {
  const params = useParams();
  const songId = params.id as string;
  const { data, loading, error } = useResults(songId);
  const player = useAudioPlayer();

  if (loading) {
    return (<><Header /><div className="flex items-center justify-center min-h-[60vh]"><p className="text-text-muted">Loading analysis...</p></div></>);
  }

  if (error || !data) {
    return (<><Header /><div className="flex flex-col items-center justify-center min-h-[60vh] gap-4"><p className="text-status-error">{error || "No results found"}</p><Link href="/library" className="text-accent text-sm hover:underline">Back to Library</Link></div></>);
  }

  return (
    <>
      <Header />
      <main className="max-w-4xl mx-auto px-6 py-8">
        <Link href="/library" className="text-text-muted text-sm hover:text-text-primary transition-colors mb-6 block">&#8592; Library</Link>

        <HeroSection data={data} />
        <RagaContext data={data} />

        {/* YouTube embed */}
        {data.song.source === "youtube" && data.song.youtubeVideoId && (
          <div className="mb-8">
            <h2 className="text-base font-semibold text-text-primary mb-3">Performance</h2>
            <div className="rounded-xl overflow-hidden aspect-video">
              <iframe src={`https://www.youtube.com/embed/${data.song.youtubeVideoId}`} className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
            </div>
          </div>
        )}

        {/* Pitch Analysis: player + interactive contour */}
        {Object.keys(data.stems).length > 0 && (
          <div className="mb-8">
            <h2 className="text-base font-semibold text-text-primary mb-3">Pitch Analysis</h2>
            <AudioPlayer stems={data.stems} {...player} />
            <PitchContour
              songId={songId}
              stem={player.activeStem}
              tonicMidi={data.detection.tonicMidi}
              currentTimeRef={player.currentTimeRef}
              duration={player.duration}
              isPlaying={player.isPlaying}
              onSeek={player.seek}
              transcription={data.transcription}
            />
          </div>
        )}

        {/* Karaoke transcription */}
        {data.transcription.length > 0 && (
          <KaraokeTranscription
            notes={data.transcription}
            currentTime={player.currentTime}
            onSeek={player.seek}
          />
        )}

        {/* Pattern analysis */}
        {(data.correctionSummary || data.patternAnalysis) && (
          <PatternAnalysis
            correctionSummary={data.correctionSummary || {}}
            patternAnalysis={data.patternAnalysis || {}}
          />
        )}

        {/* Candidates table */}
        {data.candidates.length > 0 && (
          <div className="mb-8">
            <h2 className="text-base font-semibold text-text-primary mb-3">Raga Candidates</h2>
            <div className="bg-bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-text-muted text-xs uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5 font-medium">Rank</th>
                    <th className="text-left px-4 py-2.5 font-medium">Raga</th>
                    <th className="text-left px-4 py-2.5 font-medium">Tonic</th>
                    <th className="text-left px-4 py-2.5 font-medium">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {data.candidates.slice(0, 10).map((c, i) => (
                    <tr key={i} className={`border-b border-border last:border-b-0 ${i === 0 ? "bg-accent/5" : ""}`}>
                      <td className="px-4 py-2.5 text-text-faint">{c.rank}</td>
                      <td className={`px-4 py-2.5 font-medium ${i === 0 ? "text-accent-gold" : "text-text-secondary"}`}>{c.raga}</td>
                      <td className="px-4 py-2.5 text-text-muted">{c.tonic}</td>
                      <td className="px-4 py-2.5 text-text-muted">{c.score.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Deep Analysis: histograms + transition matrix */}
        <div className="mb-8">
          <h2 className="text-base font-semibold text-text-primary mb-3">Deep Analysis</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {data.vocalsHistogram && data.vocalsHistogram.length > 0 && (
              <Histogram data={data.vocalsHistogram} title="Vocal Pitch Distribution" />
            )}
            {data.accompanimentHistogram && data.accompanimentHistogram.length > 0 && (
              <Histogram data={data.accompanimentHistogram} title="Accompaniment Pitch Distribution" />
            )}
            {data.transitionMatrix && data.transitionMatrix.notes.length > 0 && (
              <TransitionMatrix data={data.transitionMatrix} />
            )}
          </div>
        </div>
      </main>
    </>
  );
}
