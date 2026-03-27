"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { Header } from "@/components/layout/Header";
import { FileDropZone } from "@/components/upload/FileDropZone";
import { AdvancedOptions } from "@/components/upload/AdvancedOptions";
import { uploadFile, uploadYoutube, checkYoutubeExists, listRagas } from "@/lib/api";
import Link from "next/link";

type Tab = "file" | "youtube";

function UploadForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("file");
  const [file, setFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubePreview, setYoutubePreview] = useState<{ videoId: string; exists: boolean; existingSongId?: string; existingTitle?: string } | null>(null);
  const [title, setTitle] = useState("");
  const [tonic, setTonic] = useState("");
  const [raga, setRaga] = useState("");
  const [instrument, setInstrument] = useState("vocal");
  const [vocalistGender, setVocalistGender] = useState("");
  const [songType, setSongType] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advancedParams, setAdvancedParams] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [ragas, setRagas] = useState<string[]>([]);

  useEffect(() => { listRagas().then((data) => setRagas(data.ragas || [])).catch(() => {}); }, []);

  // Pick up dropped file from library
  useEffect(() => {
    if (searchParams.get("dropped") === "1") {
      const droppedFile = (window as unknown as Record<string, File>).__draggedFile;
      if (droppedFile) {
        setFile(droppedFile);
        setTitle(droppedFile.name.replace(/\.[^/.]+$/, ""));
        delete (window as unknown as Record<string, File>).__draggedFile;
      }
    }
  }, [searchParams]);

  useEffect(() => {
    if (file && !title) setTitle(file.name.replace(/\.[^/.]+$/, ""));
  }, [file, title]);

  // YouTube URL validation and dedup check
  useEffect(() => {
    const match = youtubeUrl.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
    if (!match) { setYoutubePreview(null); return; }
    const videoId = match[1];
    checkYoutubeExists(videoId).then((data) => {
      setYoutubePreview({ videoId, exists: data.exists, existingSongId: data.songId, existingTitle: data.title });
      if (!title && data.title) setTitle(data.title);
    }).catch(() => { setYoutubePreview({ videoId, exists: false }); });
  }, [youtubeUrl, title]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (tab === "file") {
        if (!file) { setError("Please select a file"); setSubmitting(false); return; }
        const formData = new FormData();
        formData.append("file", file);
        formData.append("title", title);
        formData.append("visibility", visibility);
        if (songType) formData.append("song_type", songType);
        if (tonic) formData.append("tonic", tonic);
        if (raga) formData.append("raga", raga);
        formData.append("instrument", instrument);
        if (vocalistGender) formData.append("vocalist_gender", vocalistGender);
        // Append advanced params
        for (const [k, v] of Object.entries(advancedParams)) {
          if (v !== null && v !== undefined && v !== "") formData.append(k, String(v));
        }
        await uploadFile(formData);
      } else {
        if (!youtubeUrl) { setError("Please enter a YouTube URL"); setSubmitting(false); return; }
        const formData = new FormData();
        formData.append("youtube_url", youtubeUrl);
        formData.append("title", title || "Untitled");
        if (songType) formData.append("song_type", songType);
        if (tonic) formData.append("tonic", tonic);
        if (raga) formData.append("raga", raga);
        formData.append("instrument", instrument);
        if (vocalistGender) formData.append("vocalist_gender", vocalistGender);
        for (const [k, v] of Object.entries(advancedParams)) {
          if (v !== null && v !== undefined && v !== "") formData.append(k, String(v));
        }
        await uploadYoutube(formData);
      }
      router.push("/library");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setSubmitting(false);
    }
  }

  const tonicOptions = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  return (
    <main className="max-w-xl mx-auto px-6 py-8">
      <Link href="/library" className="text-text-muted text-sm hover:text-text-primary transition-colors mb-6 block">
        &#8592; Back to Library
      </Link>
      <h1 className="text-2xl font-bold mb-1">Upload a Recording</h1>
      <p className="text-text-muted text-sm mb-7">Upload an MP3 file or paste a YouTube link. We will analyze it and identify the raga.</p>

      {/* Tabs */}
      <div className="flex border-b-2 border-bg-elevated mb-6">
        <button onClick={() => setTab("file")} className={`px-6 py-2.5 text-sm -mb-0.5 ${tab === "file" ? "text-text-primary font-semibold border-b-2 border-accent" : "text-text-muted"}`}>Upload File</button>
        <button onClick={() => setTab("youtube")} className={`px-6 py-2.5 text-sm -mb-0.5 ${tab === "youtube" ? "text-text-primary font-semibold border-b-2 border-accent" : "text-text-muted"}`}>YouTube URL</button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {tab === "file" ? (
          <FileDropZone file={file} onFileChange={setFile} />
        ) : (
          <div>
            <label className="text-text-secondary text-xs font-medium block mb-1.5">YouTube URL</label>
            <input type="url" placeholder="https://youtube.com/watch?v=..." value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)}
              className="w-full bg-bg-elevated border border-border rounded-lg px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" />
            {youtubePreview && (
              <div className="mt-3 bg-bg-card border border-border rounded-xl overflow-hidden">
                <img src={`https://img.youtube.com/vi/${youtubePreview.videoId}/hqdefault.jpg`} alt="Thumbnail" className="w-full h-40 object-cover" />
                {youtubePreview.exists && (
                  <div className="p-3 bg-accent/10 border-t border-border">
                    <div className="text-accent text-xs font-medium">This video has already been analyzed. <Link href={`/song/${youtubePreview.existingSongId}`} className="underline">View results</Link></div>
                    <div className="text-text-faint text-[11px] mt-0.5">You can still proceed to fork with different parameters.</div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Title */}
        <div>
          <label className="text-text-secondary text-xs font-medium block mb-1.5">Title</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title"
            className="w-full bg-bg-elevated border border-border rounded-lg px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" />
        </div>

        {/* Tonic + Raga */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-text-secondary text-xs font-medium block mb-1.5">Tonic <span className="text-text-faint font-normal">(optional)</span></label>
            <select value={tonic} onChange={(e) => setTonic(e.target.value)}
              className="w-full bg-bg-elevated border border-border rounded-lg px-3.5 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent">
              <option value="">Auto-detect</option>
              {tonicOptions.map((t) => (<option key={t} value={t}>{t}</option>))}
            </select>
          </div>
          <div>
            <label className="text-text-secondary text-xs font-medium block mb-1.5">Raga <span className="text-text-faint font-normal">(optional)</span></label>
            <select value={raga} onChange={(e) => setRaga(e.target.value)}
              className="w-full bg-bg-elevated border border-border rounded-lg px-3.5 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent">
              <option value="">Auto-detect</option>
              {ragas.map((r) => (<option key={r} value={r}>{r}</option>))}
            </select>
          </div>
        </div>

        {/* Instrument + Gender */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-text-secondary text-xs font-medium block mb-1.5">Instrument <span className="text-text-faint font-normal">(optional)</span></label>
            <select value={instrument} onChange={(e) => setInstrument(e.target.value)}
              className="w-full bg-bg-elevated border border-border rounded-lg px-3.5 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent">
              <option value="vocal">Vocal (default)</option>
              <option value="sitar">Sitar</option>
              <option value="sarod">Sarod</option>
              <option value="flute">Flute</option>
              <option value="santoor">Santoor</option>
              <option value="sarangi">Sarangi</option>
            </select>
          </div>
          <div>
            <label className="text-text-secondary text-xs font-medium block mb-1.5">Vocalist Gender <span className="text-text-faint font-normal">(optional)</span></label>
            <select value={vocalistGender} onChange={(e) => setVocalistGender(e.target.value)}
              className="w-full bg-bg-elevated border border-border rounded-lg px-3.5 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent">
              <option value="">Auto-detect</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>
        </div>

        {/* Visibility (file tab only) */}
        {tab === "file" && (
          <div className="flex items-center gap-3">
            <label className="text-text-secondary text-xs font-medium">Visibility:</label>
            <button type="button" onClick={() => setVisibility(visibility === "private" ? "public" : "private")}
              className={`px-3 py-1 rounded-full text-xs border ${visibility === "public" ? "bg-accent/10 text-accent border-accent/30" : "bg-bg-elevated text-text-muted border-border"}`}>
              {visibility === "public" ? "Public" : "Private"}
            </button>
          </div>
        )}
        {tab === "youtube" && <div className="text-text-faint text-xs">YouTube uploads are public by default to enable community sharing.</div>}

        {/* Song type */}
        <div>
          <label className="text-text-secondary text-xs font-medium block mb-1.5">Song Type <span className="text-text-faint font-normal">(optional)</span></label>
          <div className="flex gap-2">
            {["classical", "semi-classical", "filmy"].map((type) => (
              <button key={type} type="button" onClick={() => setSongType(songType === type ? "" : type)}
                className={`px-3 py-1 rounded-full text-xs border capitalize ${songType === type ? "bg-accent/10 text-accent border-accent/30" : "bg-bg-elevated text-text-muted border-border"}`}>
                {type.replace("-", " ")}
              </button>
            ))}
          </div>
        </div>

        {/* Advanced options */}
        <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="text-text-muted text-xs flex items-center gap-1.5">
          <span className="text-[10px]">{showAdvanced ? "\u25BC" : "\u25B6"}</span> Advanced options
        </button>
        {showAdvanced && (
          <AdvancedOptions mode="detect" onChange={setAdvancedParams} />
        )}

        {error && <p className="text-status-error text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={submitting}
            className="flex-1 bg-accent text-white font-semibold rounded-lg px-4 py-3 hover:opacity-90 transition-opacity disabled:opacity-50">
            {submitting ? "Starting Analysis..." : "Start Analysis"}
          </button>
          <Link href="/library" className="bg-bg-elevated text-text-muted border border-border rounded-lg px-6 py-3 text-center hover:border-accent transition-colors">Cancel</Link>
        </div>
      </form>
    </main>
  );
}

export default function UploadPage() {
  return (
    <ProtectedRoute>
      <Header />
      <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-text-muted">Loading...</p></div>}>
        <UploadForm />
      </Suspense>
    </ProtectedRoute>
  );
}
