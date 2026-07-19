/**
 * Minimal IndexedDB blob store for on-device audio (Plan 011).
 *
 * YouTube-sourced audio is never persisted server-side (Plan 009); instead
 * the server hands off a short-TTL signed URL per stem, which the browser
 * downloads once and keeps here, keyed by `audioHash/label`. Playback for
 * YouTube songs is local-first: if a blob isn't in this store, the caller
 * should offer "Generate audio" (a separation-only job) rather than pointing
 * at a server URL that no longer serves audio.
 */

const DB = "pakad-audio";
const STORE = "stems";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

const key = (audioHash: string, label: string) => `${audioHash}/${label}`;

export async function putStem(audioHash: string, label: string, blob: Blob) {
  const db = await open();
  await new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(blob, key(audioHash, label));
    tx.oncomplete = () => res(null);
    tx.onerror = () => rej(tx.error);
  });
}

export async function getStemUrl(audioHash: string, label: string): Promise<string | null> {
  const db = await open();
  const blob: Blob | undefined = await new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const g = tx.objectStore(STORE).get(key(audioHash, label));
    g.onsuccess = () => res(g.result);
    g.onerror = () => rej(g.error);
  });
  return blob ? URL.createObjectURL(blob) : null;
}

export async function hasStem(audioHash: string, label: string): Promise<boolean> {
  return (await getStemUrl(audioHash, label)) !== null;
}
