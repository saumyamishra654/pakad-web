"use client";

import { useRouter } from "next/navigation";
import { Song } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";

export function SongList({ songs }: { songs: Song[] }) {
  const router = useRouter();

  if (songs.length === 0) {
    return <p className="text-text-muted text-sm py-8 text-center">No songs yet. Upload a recording to get started.</p>;
  }

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-text-muted text-xs uppercase tracking-wide">
            <th className="text-left px-4 py-3 font-medium">Title</th>
            <th className="text-left px-4 py-3 font-medium">Source</th>
            <th className="text-left px-4 py-3 font-medium">Date</th>
            <th className="text-left px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {songs.map((song) => (
            <tr
              key={song.id}
              className={`border-b border-border last:border-b-0 hover:bg-bg-card/50 transition-colors ${song.status === "complete" ? "cursor-pointer" : ""}`}
              onClick={() => { if (song.status === "complete") router.push(`/song/${song.id}`); }}
            >
              <td className="px-4 py-3 text-text-primary font-medium truncate max-w-[300px]">{song.title}</td>
              <td className="px-4 py-3">
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded text-white ${song.source === "youtube" ? "bg-red-600" : "bg-accent"}`}>
                  {song.source === "youtube" ? "YT" : "File"}
                </span>
              </td>
              <td className="px-4 py-3 text-text-muted">
                {new Date(song.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </td>
              <td className="px-4 py-3"><StatusBadge status={song.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
