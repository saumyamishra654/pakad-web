"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { Header } from "@/components/layout/Header";
import { LibraryGrid } from "@/components/library/LibraryGrid";
import { SongList } from "@/components/library/SongList";
import { DropZoneOverlay } from "@/components/library/DropZoneOverlay";
import { useLibrary } from "@/hooks/useLibrary";
import Link from "next/link";

type ViewMode = "grid" | "list";

const filters = [
  { key: "all", label: "All" },
  { key: "processing", label: "Processing" },
  { key: "complete", label: "Complete" },
  { key: "youtube", label: "YouTube" },
  { key: "uploaded", label: "Uploaded" },
] as const;

export default function LibraryPage() {
  const router = useRouter();
  const { songs, totalCount, loading, error, search, setSearch, filter, setFilter, refresh } = useLibrary();
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("raga_view_mode") as ViewMode) || "grid";
    }
    return "grid";
  });
  const [isDragging, setIsDragging] = useState(false);

  function handleViewToggle(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem("raga_view_mode", mode);
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      (window as unknown as Record<string, File>).__draggedFile = files[0];
      router.push("/upload?dropped=1");
    }
  }, [router]);

  return (
    <ProtectedRoute>
      <Header />
      <main className="max-w-6xl mx-auto px-6 py-8" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        {isDragging && <DropZoneOverlay />}

        {/* Action bar */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Your Library</h1>
            <span className="bg-bg-elevated text-text-muted px-2.5 py-0.5 rounded-full text-xs">{totalCount} songs</span>
          </div>
          <div className="flex items-center gap-3">
            <input type="text" placeholder="Search songs..." value={search} onChange={(e) => setSearch(e.target.value)}
              className="bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent w-48" />
            <div className="flex bg-bg-elevated rounded-md overflow-hidden border border-border">
              <button onClick={() => handleViewToggle("grid")} className={`px-3 py-1.5 text-xs ${viewMode === "grid" ? "bg-accent text-white" : "text-text-muted"}`}>Grid</button>
              <button onClick={() => handleViewToggle("list")} className={`px-3 py-1.5 text-xs ${viewMode === "list" ? "bg-accent text-white" : "text-text-muted"}`}>List</button>
            </div>
            <Link href="/upload" className="bg-accent text-white px-5 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">+ Upload</Link>
          </div>
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 mb-6">
          {filters.map((f) => (
            <button key={f.key} onClick={() => setFilter(f.key as typeof filter)}
              className={`px-3.5 py-1 rounded-full text-xs border ${filter === f.key ? "bg-accent text-white border-accent" : "bg-bg-elevated text-text-muted border-border"}`}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <p className="text-text-muted text-sm py-8 text-center">Loading...</p>
        ) : error ? (
          <p className="text-status-error text-sm py-8 text-center">{error}</p>
        ) : viewMode === "grid" ? (
          <LibraryGrid songs={songs} onDelete={refresh} />
        ) : (
          <SongList songs={songs} />
        )}
      </main>
    </ProtectedRoute>
  );
}
