"use client";

import { useState } from "react";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface CommentInputProps {
  songId: string;
  currentTime: number;
  isAuthenticated: boolean;
  parentCommentId?: string;
  onCommentAdded: () => void;
  onCancel?: () => void;
}

export function CommentInput({
  songId,
  currentTime,
  isAuthenticated,
  parentCommentId,
  onCommentAdded,
  onCancel,
}: CommentInputProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!isAuthenticated) {
    return (
      <p className="text-text-muted text-sm py-3">
        Sign in to comment
      </p>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      const { auth } = await import("@/lib/firebase");
      const user = auth.currentUser;
      if (!user) return;
      const token = await user.getIdToken();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ""}/api/songs/${songId}/comments`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            text: text.trim(),
            timestamp_seconds: currentTime,
            parent_comment_id: parentCommentId || null,
          }),
        }
      );
      if (!res.ok) throw new Error("Failed to post comment");
      setText("");
      onCommentAdded();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-start gap-3">
      <div className="flex-1 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={parentCommentId ? "Write a reply..." : "Add a comment..."}
            className="flex-1 bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-faint focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <span className="text-xs text-text-muted bg-bg-elevated border border-border rounded-md px-2 py-1.5 whitespace-nowrap">
            at {formatTime(currentTime)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={!text.trim() || submitting}
            className="text-sm font-medium text-white bg-accent rounded-lg px-3 py-1.5 hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {submitting ? "Posting..." : parentCommentId ? "Reply" : "Add Comment"}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-sm text-text-muted hover:text-text-secondary transition-colors"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
