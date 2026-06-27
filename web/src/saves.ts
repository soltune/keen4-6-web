/* ===========================================================================
   Save-data backup / restore (export & import).

   At runtime the engine persists saves through Emscripten's IDBFS, mounted at
   /save. On the episode-selector screen the wasm module isn't loaded yet, so
   this module talks to that same IndexedDB store *directly* — letting the player
   back up or restore SAVEGAMn.CKx / CONFIG.CKx before any episode boots, with no
   page reload (the engine's syncfs(true) picks the files up on the next launch).

   The DB layout below MUST match Emscripten IDBFS exactly (verified against the
   built engine modules — keen[456].js):
     - database name : the mountpoint, "/save"
     - version       : 21  (IDBFS.DB_VERSION)
     - object store  : "FILE_DATA", out-of-line keys
     - key           : full path, e.g. "/save/SAVEGAM0.CK4"
     - value (file)  : { timestamp: Date, mode: number, contents: Uint8Array }
       (directory entries have no `contents` and are skipped here)
   Imported entries are written in that same shape; on a fresh mount the local
   tree is empty, so IDBFS reconcile loads every remote file regardless of its
   timestamp. We do not write the "/save" dir entry — the engine FS.mkdir()s it
   before mounting, and FS.writeFile() into an existing parent works fine.
   =========================================================================== */

const DB_NAME = "/save";
const DB_VERSION = 21;
const STORE = "FILE_DATA";
const MOUNT = "/save/";
const DEFAULT_FILE_MODE = 0o100666; // 33206: a regular file, matches IDBFS writes

export const BACKUP_FORMAT = "keen4-6-web-save";

interface BackupFileEntry {
  mode: number;
  mtime: number; // epoch ms
  data: string; // base64 of the raw file bytes
}
interface Backup {
  format: string;
  version: number;
  savedAt: string;
  files: Record<string, BackupFileEntry>;
}

export interface ImportResult {
  written: number;
  names: string[];
}

/** Open the IDBFS-backed save DB, creating the store on first use. Matches the
    engine's open(name, 21) + createObjectStore("FILE_DATA") so neither side
    triggers an unexpected version upgrade. */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("storage is busy (another tab open?)"));
  });
}

interface RawFile {
  name: string;
  mode: number;
  mtime: number;
  contents: Uint8Array;
}

/** Read every *file* entry under /save (directories are skipped). */
async function readFiles(): Promise<RawFile[]> {
  const db = await openDb();
  try {
    return await new Promise<RawFile[]>((resolve, reject) => {
      const out: RawFile[] = [];
      const cur = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c) {
          resolve(out);
          return;
        }
        const key = String(c.key);
        const v = c.value as { mode?: unknown; timestamp?: unknown; contents?: unknown };
        let contents: Uint8Array | null = null;
        if (v?.contents instanceof Uint8Array) contents = v.contents;
        else if (v?.contents instanceof ArrayBuffer) contents = new Uint8Array(v.contents);
        if (contents && key.startsWith(MOUNT)) {
          out.push({
            name: key.slice(MOUNT.length),
            mode: typeof v.mode === "number" ? v.mode : DEFAULT_FILE_MODE,
            mtime: v.timestamp instanceof Date ? v.timestamp.getTime() : 0,
            contents,
          });
        }
        c.continue();
      };
      cur.onerror = () => reject(cur.error);
    });
  } finally {
    db.close();
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Basename, uppercased, restricted to a safe charset — guards the IDB key
    against path traversal from a hand-edited backup file. Returns null if the
    name is empty or degenerate. */
function sanitizeName(raw: string): string | null {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const name = base.toUpperCase().replace(/[^A-Z0-9._-]/g, "");
  if (!name || name === "." || name === "..") return null;
  return name;
}

/** Bundle all saved games + CONFIG into a single JSON backup Blob. Returns null
    when there is nothing to export yet. */
export async function exportSaveBackup(): Promise<Blob | null> {
  const files = await readFiles();
  const backup: Backup = {
    format: BACKUP_FORMAT,
    version: 1,
    savedAt: new Date().toISOString(),
    files: {},
  };
  for (const f of files) {
    if (!f.name) continue;
    backup.files[f.name] = { mode: f.mode, mtime: f.mtime, data: toBase64(f.contents) };
  }
  if (Object.keys(backup.files).length === 0) return null;
  return new Blob([JSON.stringify(backup)], { type: "application/json" });
}

/** Restore a backup produced by exportSaveBackup() into the /save store.
    Overwrites same-named files. Throws on a malformed file. */
export async function importSaveBackup(file: File): Promise<ImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("not a valid backup file (bad JSON)");
  }
  const backup = parsed as Partial<Backup> | null;
  if (!backup || backup.format !== BACKUP_FORMAT || !backup.files || typeof backup.files !== "object") {
    throw new Error("not a Keen save backup file");
  }

  const entries: { key: string; value: { timestamp: Date; mode: number; contents: Uint8Array } }[] = [];
  for (const [rawName, ent] of Object.entries(backup.files)) {
    const name = sanitizeName(rawName);
    const e = ent as BackupFileEntry | null;
    if (!name || !e || typeof e.data !== "string") continue;
    let contents: Uint8Array;
    try {
      contents = fromBase64(e.data);
    } catch {
      continue; // skip an entry with corrupt base64 rather than failing the lot
    }
    entries.push({
      key: MOUNT + name,
      value: {
        timestamp: new Date(typeof e.mtime === "number" && e.mtime > 0 ? e.mtime : Date.now()),
        mode: typeof e.mode === "number" ? e.mode : DEFAULT_FILE_MODE,
        contents,
      },
    });
  }
  if (entries.length === 0) throw new Error("backup contained no save data");

  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const { key, value } of entries) store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  return { written: entries.length, names: entries.map((e) => e.key.slice(MOUNT.length)) };
}
