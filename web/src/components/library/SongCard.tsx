"use client";

import Link from "next/link";
import { Song } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";
import { deleteSong } from "@/lib/api";

export function SongCard({ song, onDelete }: { song: Song; onDelete?: () => void }) {
  const isYoutube = song.source === "youtube";
  const thumbnailUrl = isYoutube && song.youtubeVideoId
    ? `https://img.youtube.com/vi/${song.youtubeVideoId}/hqdefault.jpg`
    : null;
  const isClickable = song.status === "complete";

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${song.title}"?`)) return;
    try {
      await deleteSong(song.id);
      onDelete?.();
    } catch {
      alert("Failed to delete song");
    }
  }

  const card = (
    <div className="bg-bg-card rounded-xl overflow-hidden border border-border hover:border-accent/50 transition-colors relative group">
      <div className="relative h-28 bg-bg-elevated flex items-center justify-center overflow-hidden">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className={`w-full h-full object-cover ${song.status === "processing" ? "opacity-40 grayscale-[50%]" : song.status === "failed" ? "opacity-30 grayscale-[80%]" : "opacity-80"}`} />
        ) : (
          <div className="text-center">
            <div className="text-text-muted text-2xl leading-none">&#9835;</div>
            <div className="text-text-faint text-[10px] mt-1">MP3</div>
          </div>
        )}
        <div className={`absolute top-2 right-2 text-white text-[10px] font-semibold px-2 py-0.5 rounded ${isYoutube ? "bg-red-600" : song.source === "recording" ? "bg-emerald-600" : "bg-accent"}`}>
          {isYoutube ? "YT" : song.source === "recording" ? "Rec" : "File"}
        </div>
        {/* Delete button - visible on hover */}
        <button
          onClick={handleDelete}
          className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-status-error/80"
        >
          Delete
        </button>
      </div>
      <div className="p-3.5">
        <div className="text-sm font-semibold text-text-primary mb-1.5 truncate">{song.title}</div>
        <div className="flex items-center justify-between">
          <span className="text-text-faint text-[11px]">
            {new Date(song.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
          <StatusBadge status={song.status} />
        </div>
      </div>
    </div>
  );

  if (isClickable) return <Link href={`/song/${song.id}`}>{card}</Link>;
  return card;
}
