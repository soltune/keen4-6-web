/* Deterministic per-episode level verification via the engine's own warp.
   Boots an episode, starts a New Game, then for each target level calls
   CKWEB_Warp(n) (the in-engine "W = warp to level" effect) and probes that
   the level actually loads (mapon==n) and platform physics run (Keen falls
   under gravity, walks with the view scrolling, and jumps).
   Usage: node web/test/warp-test.mjs [4|5|6] [levels csv]   env: CK_LEVELS=1,5,9 */
import { fileURLToPath } from "node:url";
import path from "node:path";

const ep = process.argv[2] || "4";
const levels = (process.argv[3] || process.env.CK_LEVELS || "1")
  .split(",").map((s) => +s.trim()).filter((n) => n >= 1 && n <= 18);
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."); // web/ root (this script lives in web/test/)
const factory = (await import(path.join(dir, `public/engine/keen${ep}.js`))).default;
const engineDir = path.join(dir, "public/engine");

const m = await factory({
  locateFile: (p) => path.join(engineDir, p),
  print: () => {},
  printErr: (t) => { if (/error|abort|assert/i.test(t)) console.log("[err]", t); },
});

let mainErr = null;
Promise.resolve(m._main()).then(() => {}, (e) => { mainErr = e; });

const key = (sc, dn) => m._CKWEB_KeyEvent(sc, dn);
const warp = (n) => (m._CKWEB_Warp ? m._CKWEB_Warp(n) : -9);
const ps = (w) => (m._CKWEB_PlayerState ? m._CKWEB_PlayerState(w) : -9);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => sleep(34); // ~2 engine frames

// --- 1. boot through the title + start a New Game ------------------------
async function startGame() {
  for (let i = 0; i < 60 && !(ps(0) === 1); i++) {
    if (mainErr) throw mainErr;
    if (i < 14) { key(0x39, 1); key(0x39, 0); }       // Space: skip title/demo
    else { key(0x1c, 1); key(0x1c, 0); }              // Enter: New Game + difficulty
    await sleep(120);
  }
  if (ps(0) !== 1) throw new Error("never reached in-game (title stuck)");
}

// --- 2. warp into a level and observe physics ----------------------------
async function probeLevel(n) {
  // raise the warp; wait until the engine has switched to that map
  let queued = -1;
  for (let i = 0; i < 40; i++) { queued = warp(n); if (queued === 1) break; await tick(); }
  let loaded = false;
  for (let i = 0; i < 80; i++) { if (ps(6) === n && ps(0) === 1) { loaded = true; break; } await tick(); }
  if (!loaded) return { n, ok: false, why: `warp(${n}) did not load (mapon=${ps(6)} queued=${queued})` };

  // settle a few frames, then sample physics
  for (let i = 0; i < 6; i++) await tick();
  const y0 = ps(2);
  // A) gravity: stand idle, expect to fall (or already grounded -> stable)
  for (let i = 0; i < 24; i++) await tick();
  const yFell = ps(2);
  // B) walk right, expect x to change + view to scroll
  const x1 = ps(1), ox1 = ps(3);
  key(0x4d, 1);
  for (let i = 0; i < 30; i++) await tick();
  const x2 = ps(1), ox2 = ps(3);
  key(0x4d, 0);
  // C) jump, expect y to rise above the resting value
  let yMin = ps(2);
  key(0x1d, 1);
  for (let i = 0; i < 24; i++) { yMin = Math.min(yMin, ps(2)); await tick(); }
  key(0x1d, 0);
  for (let i = 0; i < 10; i++) { yMin = Math.min(yMin, ps(2)); await tick(); }

  const fell = yFell > y0 + 8;
  const walked = Math.abs(x2 - x1) > 16;
  const scrolled = Math.abs(ox2 - ox1) > 0;
  const jumped = yMin < yFell - 16;
  const ok = (fell || jumped) && (walked || scrolled);
  return { n, ok, y0, yFell, x1, x2, ox1, ox2, yMin, fell, walked, scrolled, jumped };
}

try {
  await startGame();
  console.log(`CK${ep}: in-game (mapon=${ps(6)}). warping levels: ${levels.join(",")}`);
  const results = [];
  for (const n of levels) {
    if (mainErr) { console.log("CRASH:", mainErr.message); break; }
    const r = await probeLevel(n);
    results.push(r);
    if (r.ok) console.log(`  L${n}: ✅ fell=${r.fell} walked=${r.walked} scroll=${r.scrolled} jump=${r.jumped}  y:${r.y0}->${r.yFell} ymin=${r.yMin} x:${r.x1}->${r.x2}`);
    else console.log(`  L${n}: ❌ ${r.why || `fell=${r.fell} walked=${r.walked} scroll=${r.scrolled} jump=${r.jumped}`}`);
  }
  const pass = results.filter((r) => r.ok).length;
  console.log(`\nCK${ep} RESULT: ${pass}/${results.length} levels playable ${pass === results.length && pass > 0 ? "✅" : "⚠️"}`);
  process.exit(pass === results.length && pass > 0 ? 0 : 1);
} catch (e) {
  console.log(`CK${ep} CRASH/ERROR:`, e.message || e);
  process.exit(2);
}
