/* Shared helper for the headless (Node) engine tests.

   The default engine build is data-independent (link.sh no longer
   --preload-files the game data unless KEEN_PRELOAD=1), so the Node tests must
   populate MEMFS themselves before booting — mirroring what wasmEngine.ts does
   in the browser. Reads the extracted assets from web/public/data/ck<ep>/ and
   writes them to MEMFS root with UPPERCASE names (the engine opens EGADICT.CK4 /
   GAMEMAPS.CK4 / ... and MEMFS is case-sensitive). Any file already present
   (a KEEN_PRELOAD build) is left untouched. */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * @param {{FS: {analyzePath:(p:string)=>{exists:boolean}, writeFile:(p:string,d:Uint8Array)=>void}}} m
 *   the instantiated Emscripten module
 * @param {string|number} ep episode ("4" | "5" | "6")
 * @param {string} webRoot absolute path to the web/ directory
 */
export function loadDataIntoFS(m, ep, webRoot) {
  const dir = path.join(webRoot, "public", "data", `ck${ep}`);
  for (const f of readdirSync(dir)) {
    const dest = "/" + f.toUpperCase();
    if (m.FS.analyzePath(dest).exists) continue; // already baked in (KEEN_PRELOAD)
    m.FS.writeFile(dest, readFileSync(path.join(dir, f)));
  }
}
