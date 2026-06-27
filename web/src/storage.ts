/* ===========================================================================
   Persistence layer (goal requirement #6): save games + settings in the
   browser, no server required.

     - Binary blobs (SAVEGAMn.CKx, CONFIG.CKx) -> IndexedDB, keyed by filename.
       The engine's platform FS shim will route the game's file writes here.
     - Small UI settings (keymap, aspect mode, last episode) -> localStorage.

   Everything is namespaced per episode so the three games never collide.
   =========================================================================== */

const DB_NAME = "keen4-6-web";
const STORE = "files";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Virtual file store for save games / config blobs, persisted in IndexedDB. */
export class SaveStore {
  constructor(private episode: string) {}

  private key(name: string): string {
    return `${this.episode}/${name.toUpperCase()}`;
  }

  async read(name: string): Promise<Uint8Array | null> {
    const v = await tx<unknown>("readonly", (s) => s.get(this.key(name)));
    if (v == null) return null;
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    return null;
  }

  async write(name: string, data: Uint8Array): Promise<void> {
    // Store a copy so later mutation of the source buffer can't corrupt it.
    await tx("readwrite", (s) => s.put(data.slice(), this.key(name)));
  }

  async delete(name: string): Promise<void> {
    await tx("readwrite", (s) => s.delete(this.key(name)));
  }

  async list(): Promise<string[]> {
    const keys = await tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
    const prefix = `${this.episode}/`;
    return keys
      .filter((k): k is string => typeof k === "string" && k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  }
}

/* --- Settings (localStorage) ------------------------------------------------ */

const SETTINGS_KEY = "keen4-6-web:settings";

export interface Settings {
  lastEpisode?: string;
  aspectMode?: "4:3" | "pixel";
  /** Selected display shader preset id, or null/undefined for the plain path. */
  shaderId?: string | null;
  /** Snap the displayed image to an integer multiple of 320x200 (default off). */
  integerScale?: boolean;
  /** Per-action keyboard bindings (DOM KeyboardEvent.code lists). See keymap.ts. */
  keymap?: Record<string, string[]>;
  [k: string]: unknown;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as Settings) : {};
  } catch {
    return {};
  }
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch (err) {
    console.warn("Failed to persist settings:", err);
  }
  return next;
}
