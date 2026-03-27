/**
 * FastAPI client with Firebase auth token injection.
 */
import { auth } from "./firebase";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

async function getAuthHeaders(): Promise<HeadersInit> {
  const user = auth.currentUser;
  if (!user) return {};
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...authHeaders, ...options.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(body.detail || `API error: ${res.status}`);
  }
  return res;
}

export async function listSongs() {
  const res = await apiFetch("/api/songs");
  return res.json();
}

export async function getSong(songId: string) {
  const res = await apiFetch(`/api/songs/${songId}`);
  return res.json();
}

export async function deleteSong(songId: string) {
  const res = await apiFetch(`/api/songs/${songId}`, { method: "DELETE" });
  return res.json();
}

export async function checkYoutubeExists(videoId: string) {
  const res = await apiFetch(`/api/songs/youtube/check/${videoId}`);
  return res.json();
}

export async function uploadFile(formData: FormData) {
  const res = await apiFetch("/api/songs/upload-file", { method: "POST", body: formData });
  return res.json();
}

export async function uploadYoutube(formData: FormData) {
  const res = await apiFetch("/api/songs/upload-youtube", { method: "POST", body: formData });
  return res.json();
}

export async function getAnalysis(songId: string) {
  const res = await apiFetch(`/api/songs/${songId}/analysis`);
  return res.json();
}

export async function reanalyze(
  songId: string,
  params: { tonic?: string; raga?: string; instrument?: string; vocalistGender?: string }
) {
  const res = await apiFetch(`/api/songs/${songId}/analysis/reanalyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json();
}

export function audioUrl(songId: string, filename: string): string {
  return `${API_BASE}/api/artifacts/audio/${songId}/${filename}`;
}

export async function getPitchData(songId: string, stem: string = "vocals") {
  const res = await apiFetch(`/api/artifacts/pitch-data/${songId}?stem=${stem}`);
  return res.json();
}

export async function listRagas() {
  const res = await apiFetch("/api/ragas");
  return res.json();
}

export async function toggleVisibility(songId: string) {
  const res = await apiFetch(`/api/songs/${songId}/visibility`, { method: "PATCH" });
  return res.json();
}

export async function listPublicSongs(params?: { orderBy?: string; songType?: string; limit?: number }) {
  const query = new URLSearchParams();
  if (params?.orderBy) query.set("order_by", params.orderBy);
  if (params?.songType) query.set("song_type", params.songType);
  if (params?.limit) query.set("limit", String(params.limit));
  const res = await apiFetch(`/api/explore?${query.toString()}`);
  return res.json();
}
