"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reanalyze } from "@/lib/api";

interface ForkButtonProps {
  songId: string;
}

export function ForkButton({ songId }: ForkButtonProps) {
  const [forking, setForking] = useState(false);
  const router = useRouter();

  async function handleFork() {
    setForking(true);
    try {
      await reanalyze(songId, {});
      router.push("/library");
    } catch {
      setForking(false);
    }
  }

  return (
    <button
      onClick={handleFork}
      disabled={forking}
      className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium
        bg-accent text-white hover:bg-accent/90 transition-colors
        ${forking ? "opacity-50 cursor-wait" : "cursor-pointer"}
      `}
    >
      {forking ? "Forking..." : "Fork & Analyze"}
    </button>
  );
}
