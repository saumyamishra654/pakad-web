"use client";

import { Song } from "@/lib/types";
import { SongCard } from "./SongCard";
import { GhostCard } from "./GhostCard";

export function LibraryGrid({ songs }: { songs: Song[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {songs.map((song) => (<SongCard key={song.id} song={song} />))}
      <GhostCard />
    </div>
  );
}
