"use client";

import { useState } from "react";
import { toggleVisibility } from "@/lib/api";

interface VisibilityToggleProps {
  songId: string;
  initialVisibility: string;
}

export function VisibilityToggle({ songId, initialVisibility }: VisibilityToggleProps) {
  const [visibility, setVisibility] = useState(initialVisibility);
  const [toggling, setToggling] = useState(false);

  async function handleToggle() {
    setToggling(true);
    try {
      const result = await toggleVisibility(songId);
      setVisibility(result.visibility);
    } catch {
      // Silently fail -- user sees no change
    } finally {
      setToggling(false);
    }
  }

  const isPublic = visibility === "public";

  return (
    <button
      onClick={handleToggle}
      disabled={toggling}
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors
        ${isPublic
          ? "bg-accent/10 text-accent border-accent/30 hover:bg-accent/20"
          : "bg-bg-elevated text-text-muted border-border hover:bg-bg-card"
        }
        ${toggling ? "opacity-50 cursor-wait" : "cursor-pointer"}
      `}
    >
      {isPublic ? "Public" : "Private"}
    </button>
  );
}
