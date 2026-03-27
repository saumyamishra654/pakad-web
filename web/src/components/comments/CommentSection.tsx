"use client";

import { useCallback, useEffect, useState } from "react";
import { CommentInput } from "./CommentInput";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface Comment {
  id: string;
  authorName: string;
  text: string;
  timestampSeconds: number;
  parentCommentId: string | null;
  createdAt: string;
}

interface CommentSectionProps {
  songId: string;
  currentTime: number;
  onSeek: (time: number) => void;
  isAuthenticated: boolean;
}

export function CommentSection({
  songId,
  currentTime,
  onSeek,
  isAuthenticated,
}: CommentSectionProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const fetchComments = useCallback(async () => {
    try {
      const headers: HeadersInit = {};
      const { auth } = await import("@/lib/firebase");
      const user = auth.currentUser;
      if (user) {
        const token = await user.getIdToken();
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || ""}/api/songs/${songId}/comments`,
        { headers }
      );
      if (!res.ok) throw new Error("Failed to fetch comments");
      const data = await res.json();
      setComments(data.comments || []);
    } catch {
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [songId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const topLevel = comments.filter((c) => !c.parentCommentId);
  const replies = (parentId: string) =>
    comments.filter((c) => c.parentCommentId === parentId);

  return (
    <div className="mb-8">
      <h2 className="text-base font-semibold text-text-primary mb-3">
        Comments{" "}
        {comments.length > 0 && (
          <span className="text-text-muted font-normal text-sm">
            ({comments.length})
          </span>
        )}
      </h2>

      <div className="bg-bg-card border border-border rounded-xl p-4">
        {/* New comment input */}
        <div className="mb-4">
          <CommentInput
            songId={songId}
            currentTime={currentTime}
            isAuthenticated={isAuthenticated}
            onCommentAdded={fetchComments}
          />
        </div>

        {/* Comments list */}
        {loading ? (
          <p className="text-text-muted text-sm">Loading comments...</p>
        ) : topLevel.length === 0 ? (
          <p className="text-text-faint text-sm">
            No comments yet. Be the first to comment!
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {topLevel.map((comment) => (
              <div key={comment.id}>
                {/* Top-level comment */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-text-secondary">
                      {comment.authorName}
                    </span>
                    <button
                      onClick={() => onSeek(comment.timestampSeconds)}
                      className="text-accent bg-accent/10 rounded px-1.5 py-0.5 font-mono hover:bg-accent/20 transition-colors"
                    >
                      {formatTime(comment.timestampSeconds)}
                    </button>
                  </div>
                  <p className="text-sm text-text-primary">{comment.text}</p>
                  <button
                    onClick={() =>
                      setReplyTo(replyTo === comment.id ? null : comment.id)
                    }
                    className="text-xs text-text-muted hover:text-text-secondary transition-colors self-start"
                  >
                    Reply
                  </button>
                </div>

                {/* Reply input */}
                {replyTo === comment.id && (
                  <div className="ml-6 mt-2">
                    <CommentInput
                      songId={songId}
                      currentTime={currentTime}
                      isAuthenticated={isAuthenticated}
                      parentCommentId={comment.id}
                      onCommentAdded={() => {
                        setReplyTo(null);
                        fetchComments();
                      }}
                      onCancel={() => setReplyTo(null)}
                    />
                  </div>
                )}

                {/* Threaded replies */}
                {replies(comment.id).length > 0 && (
                  <div className="ml-6 mt-2 flex flex-col gap-2 border-l border-border pl-3">
                    {replies(comment.id).map((reply) => (
                      <div key={reply.id} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-medium text-text-secondary">
                            {reply.authorName}
                          </span>
                          <button
                            onClick={() => onSeek(reply.timestampSeconds)}
                            className="text-accent bg-accent/10 rounded px-1.5 py-0.5 font-mono hover:bg-accent/20 transition-colors"
                          >
                            {formatTime(reply.timestampSeconds)}
                          </button>
                        </div>
                        <p className="text-sm text-text-primary">
                          {reply.text}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
