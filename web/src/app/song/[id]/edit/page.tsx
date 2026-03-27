"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { Header } from "@/components/layout/Header";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { AudioPlayer } from "@/components/results/AudioPlayer";
import { PitchContour } from "@/components/results/PitchContour";
import { TranscriptionGrid } from "@/components/editor/TranscriptionGrid";
import { useResults } from "@/hooks/useResults";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";

export default function EditTranscriptionPage() {
  const params = useParams();
  const songId = params.id as string;
  const { data, loading, error } = useResults(songId);
  const player = useAudioPlayer();

  return (
    <ProtectedRoute>
      <Header />
      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Back link */}
        <Link
          href={`/song/${songId}`}
          className="text-text-muted text-sm hover:text-text-primary transition-colors mb-6 block"
        >
          &#8592; Back to Results
        </Link>

        {loading && (
          <div className="flex items-center justify-center min-h-[60vh]">
            <p className="text-text-muted">Loading transcription...</p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <p className="text-status-error">{error}</p>
            <Link
              href={`/song/${songId}`}
              className="text-accent text-sm hover:underline"
            >
              Back to Results
            </Link>
          </div>
        )}

        {data && (
          <>
            {/* Title */}
            <div className="mb-6">
              <h1 className="text-xl font-semibold text-text-primary">
                Edit Transcription
              </h1>
              {data.song.title && (
                <p className="text-text-muted text-sm mt-1">{data.song.title}</p>
              )}
            </div>

            {/* Top section: Audio player + pitch contour */}
            {Object.keys(data.stems).length > 0 && (
              <div className="mb-8">
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

            {/* Bottom section: Transcription grid */}
            <div className="mb-8">
              <h2 className="text-base font-semibold text-text-primary mb-3">
                Transcribed Notes
              </h2>
              <TranscriptionGrid
                notes={data.transcription}
                currentTime={player.currentTime}
                onSeek={player.seek}
              />
            </div>
          </>
        )}
      </main>
    </ProtectedRoute>
  );
}
