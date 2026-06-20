/* In-level movement probe. Boots the engine, optionally drives input, and
   samples the live player/scroll state (via CKWEB_PlayerState) to prove that
   the game loop actually moves Keen and scrolls the view — not just a static
   render. Usage: node web/test/play-test.mjs [4|5|6]   env: CK_T=secs CK_DRIVE=1 */
import { fileURLToPath } from "node:url";
import path from "node:path";

const ep = process.argv[2] || "4";
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."); // web/ root (this script lives in web/test/)
const factory = (await import(path.join(dir, `public/engine/keen${ep}.js`))).default;
const engineDir = path.join(dir, "public/engine");

const m = await factory({
  locateFile: (p) => path.join(engineDir, p),
  print: (t) => console.log("[out]", t),
  printErr: (t) => console.log("[err]", t),
});

let mainErr = null;
Promise.resolve(m._main()).then(
  () => console.log("main() returned"),
  (e) => { mainErr = e; console.log("main() rejected:", e && e.message); },
);

const key = (sc, dn) => m._CKWEB_KeyEvent(sc, dn);
const SECS = +(process.env.CK_T || 18);
const DRIVE = process.env.CK_DRIVE === "1";
const ps = (w) => (m._CKWEB_PlayerState ? m._CKWEB_PlayerState(w) : -9);

let started = false, downHeld = false;
let firstX = null, minX = 1e9, maxX = 1e9 === firstX ? 0 : -1e9, moves = 0, prevX = null;
maxX = -1e9;
for (let t = 0; t < SECS * 2; t++) {
  await new Promise((r) => setTimeout(r, 500));
  if (mainErr) { console.log("CRASH at t=", t / 2, "s"); break; }

  const inLevel = ps(0), px = ps(1), py = ps(2), ox = ps(3), oc = ps(5);

  if (DRIVE) {
    // Phase 1 (0-3s): tap through title screens + main menu to start a game.
    if (t < 6) { key(0x39, 1); key(0x39, 0); }            // Space to advance
    else if (t === 6 || t === 7) { key(0x1c, 1); key(0x1c, 0); } // Enter: New Game / difficulty
    // Phase 2 (>=4s): hold Right and bunny-hop to force movement + scroll.
    else if (process.env.CK_IDLE !== "1") {
      const dir = parseInt(process.env.CK_DIR || "4d", 16); // default Right; 4b=L 48=U 50=D
      if (!downHeld) { key(dir, 1); downHeld = true; }      // hold a direction
      if (process.env.CK_NOJUMP !== "1") {
        if (t % 2 === 0) { key(0x1d, 1); } else { key(0x1d, 0); } // pulse jump (Ctrl)
      }
    }
  }

  if (inLevel === 1 && px >= 0) {
    if (firstX === null) firstX = px;
    if (prevX !== null && px !== prevX) moves++;
    prevX = px; minX = Math.min(minX, px); maxX = Math.max(maxX, px);
  }
  console.log(`t=${(t / 2).toFixed(1)}s ingame=${inLevel} keenX=${px} keenY=${py} scrollX=${ox} class=${oc}`);
}

console.log(`\n--- movement summary ---`);
console.log(`firstX=${firstX} minX=${minX === 1e9 ? "-" : minX} maxX=${maxX === -1e9 ? "-" : maxX} distinctMoves=${moves}`);
const moved = firstX !== null && (maxX - minX) > 0;
console.log(`RESULT: ${moved ? "KEEN MOVES IN-LEVEL ✅ (Δx=" + (maxX - minX) + ")" : "no movement detected ❌"}`);
process.exit(0);
