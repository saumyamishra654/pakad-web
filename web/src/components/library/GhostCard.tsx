"use client";

import Link from "next/link";

export function GhostCard() {
  return (
    <Link href="/upload" className="rounded-xl border-2 border-dashed border-border flex items-center justify-center min-h-[200px] hover:border-accent/50 transition-colors">
      <div className="text-center text-text-muted">
        <div className="text-2xl mb-1">+</div>
        <div className="text-sm">Upload or drop file</div>
      </div>
    </Link>
  );
}
