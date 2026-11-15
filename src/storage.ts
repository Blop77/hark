import type { LoadedDoc } from "./lib/doc";

export interface Settings {
  voice: string;
  rate: number;
  fontSize: number;
  follow: boolean;
}

const DEFAULTS: Settings = { voice: "kokoro:af_heart", rate: 1, fontSize: 20, follow: true };

export function loadSettings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("hark:settings") ?? "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem("hark:settings", JSON.stringify(s));
  } catch {
    // storage can be unavailable (private mode); settings just won't persist
  }
}

export function loadPosition(id: string): number {
  try {
    const all = JSON.parse(localStorage.getItem("hark:positions") ?? "{}");
    return typeof all[id] === "number" ? all[id] : 0;
  } catch {
    return 0;
  }
}

export function savePosition(id: string, index: number) {
  try {
    const all = JSON.parse(localStorage.getItem("hark:positions") ?? "{}");
    all[id] = index;
    // Keep the 50 most recent documents.
    const keys = Object.keys(all);
    if (keys.length > 50) delete all[keys[0]];
    localStorage.setItem("hark:positions", JSON.stringify(all));
  } catch {
    // ignore
  }
}

// The last opened document lives in IndexedDB because books can be several MB.
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("hark", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("docs");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLastDoc(doc: LoadedDoc): Promise<void> {
  try {
    const d = await db();
    await new Promise<void>((resolve, reject) => {
      const tx = d.transaction("docs", "readwrite");
      tx.objectStore("docs").put(doc, "last");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    d.close();
  } catch {
    // ignore
  }
}

export async function loadLastDoc(): Promise<LoadedDoc | null> {
  try {
    const d = await db();
    const doc = await new Promise<LoadedDoc | null>((resolve, reject) => {
      const req = d.transaction("docs").objectStore("docs").get("last");
      req.onsuccess = () => resolve((req.result as LoadedDoc) ?? null);
      req.onerror = () => reject(req.error);
    });
    d.close();
    return doc && Array.isArray(doc.paragraphs) ? doc : null;
  } catch {
    return null;
  }
}

export async function clearLastDoc(): Promise<void> {
  try {
    const d = await db();
    d.transaction("docs", "readwrite").objectStore("docs").delete("last");
    d.close();
  } catch {
    // ignore
  }
}
