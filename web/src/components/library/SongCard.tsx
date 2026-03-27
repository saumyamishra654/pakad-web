"use client";

import Link from "next/link";
import { Song } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";

export function SongCard({ song }: { song: Song }) {
  const isYoutube = song.source === "youtube";
  const thumbnailUrl = isYoutube && song.youtubeVideoId
    ? `https://img.youtube.com/vi/${song.youtubeVideoId}/hqdefault.jpg`
    : null;
  const isClickable = song.status === "complete";

  const card = (
    <div className="bg-bg-card rounded-xl overflow-hidden border border-border hover:border-accent/50 transition-colors">
      <div className="relative h-28 bg-bg-elevated flex items-center justify-center overflow-hidden">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className={`w-full h-full object-cover ${song.status === "processing" ? "opacity-40 grayscale-[50%]" : song.status === "failed" ? "opacity-30 grayscale-[80%]" : "opacity-80"}`} />
        ) : (
          <div className="text-center">
            <div className="text-text-muted text-2xl leading-none">&#9835;</div>
            <div className="text-text-faint text-[10px] mt-1">MP3</div>
          </div>
        )}
        <div className={`absolute top-2 right-2 text-white text-[10px] font-semibold px-2 py-0.5 rounded ${isYoutube ? "bg-red-600" : "bg-accent"}`}>
          {isYoutube ? "YT" : "File"}
        </div>
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
