"use client";

import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { Header } from "@/components/layout/Header";

export default function LibraryPage() {
  return (
    <ProtectedRoute>
      <Header />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Your Library</h1>
          <button className="bg-accent text-white px-5 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity">
            + Upload
          </button>
        </div>
        <p className="text-text-muted">
          Your song library will appear here. Upload a recording to get started.
        </p>
      </main>
    </ProtectedRoute>
  );
}
