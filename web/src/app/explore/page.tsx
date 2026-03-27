"use client";

import { useState, useEffect, useMemo } from "react";
import { Header } from "@/components/layout/Header";
import { SongCard } from "@/components/library/SongCard";
import { listPublicSongs } from "@/lib/api";
import { Song } from "@/lib/types";

const sortTabs = [
  { key: "createdAt", label: "Most Recent" },
  { key: "viewCount", label: "Most Viewed" },
] as const;

const songTypeFilters = [
  { key: null, label: "All" },
  { key: "classical", label: "Classical" },
  { key: "semi-classical", label: "Semi-classical" },
  { key: "filmy", label: "Filmy" },
] as const;

type SortKey = (typeof sortTabs)[number]["key"];
type FilterKey = (typeof songTypeFilters)[number]["key"];

export default function ExplorePage() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orderBy, setOrderBy] = useState<SortKey>("createdAt");
  const [songType, setSongType] = useState<FilterKey>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    listPublicSongs({
      orderBy,
      songType: songType ?? undefined,
    })
      .then((data) => {
        if (!cancelled) setSongs(data.songs ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load songs");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [orderBy, songType]);

  const filteredSongs = useMemo(() => {
    if (!search.trim()) return songs;
    const q = search.toLowerCase();
    return songs.filter((s) => s.title.toLowerCase().includes(q));
  }, [songs, search]);

  return (
    <>
      <Header />
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Page title */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary">Explore</h1>
          <p className="text-text-muted text-sm mt-1">
            Browse publicly shared raga analyses
          </p>
        </div>

        {/* Search bar */}
        <div className="mb-5">
          <input
            type="text"
            placeholder="Search songs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-md bg-bg-elevated border border-border rounded-lg px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
          />
        </div>

        {/* Sort tabs */}
        <div className="flex items-center gap-4 mb-4">
          {sortTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setOrderBy(tab.key)}
              className={`text-sm font-medium pb-1 border-b-2 transition-colors ${
                orderBy === tab.key
                  ? "text-accent border-accent"
                  : "text-text-muted border-transparent hover:text-text-secondary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 mb-6">
          {songTypeFilters.map((f) => (
            <button
              key={f.key ?? "all"}
              onClick={() => setSongType(f.key)}
              className={`px-3.5 py-1 rounded-full text-xs border transition-colors ${
                songType === f.key
                  ? "bg-accent text-white border-accent"
                  : "bg-bg-elevated text-text-muted border-border hover:border-accent/50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <p className="text-text-muted text-sm py-12 text-center">Loading...</p>
        ) : error ? (
          <p className="text-status-error text-sm py-12 text-center">{error}</p>
        ) : filteredSongs.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-text-muted text-sm">
              No public analyses yet. Upload a recording to get started.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredSongs.map((song) => (
              <SongCard key={song.id} song={song} onDelete={undefined} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}
