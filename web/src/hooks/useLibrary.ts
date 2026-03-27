"use client";

import { useState, useEffect, useCallback } from "react";
import { Song } from "@/lib/types";
import { listSongs } from "@/lib/api";

type FilterType = "all" | "processing" | "complete" | "youtube" | "uploaded";

export function useLibrary() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");

  const fetchSongs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await listSongs();
      setSongs(data.songs || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load songs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSongs(); }, [fetchSongs]);

  // Auto-refresh when there are processing songs
  useEffect(() => {
    const hasProcessing = songs.some((s) => s.status === "processing");
    if (!hasProcessing) return;
    const interval = setInterval(fetchSongs, 5000);
    return () => clearInterval(interval);
  }, [songs, fetchSongs]);

  const filteredSongs = songs.filter((song) => {
    if (search && !song.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "processing") return song.status === "processing";
    if (filter === "complete") return song.status === "complete";
    if (filter === "youtube") return song.source === "youtube";
    if (filter === "uploaded") return song.source === "file";
    return true;
  });

  return { songs: filteredSongs, totalCount: songs.length, loading, error, search, setSearch, filter, setFilter, refresh: fetchSongs };
}
