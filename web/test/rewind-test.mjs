/* Verify the in-memory rewind feature (ck_rewind.c) on any episode, using the
   engine's own warp to land deterministically in a level. Walk right (Keen's x
   climbs), then HOLD the rewind key (Backspace) and confirm x winds back toward
   the earlier values — i.e. the game state is restored frame-by-frame from the
   ring buffer, then holds at the oldest snapshot.
   Usage: node web/test/rewind-test.mjs [4|5|6] [level] */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadDataIntoFS } from "./_loadData.mjs";

const ep = process.argv[2] || "4";
const level = +(process.argv[3] || 1);
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const factory = (await import(path.join(dir, `public/engine/keen${ep}.js`))).default;
const engineDir = path.join(dir, "public/engine");

const m = await factory({
  locateFile: (p) => path.join(engineDir, p),
  print: () => {},
  printErr: (t) => { if (/error|abort|assert/i.test(t)) console.log("[err]", t); },
});

loadDataIntoFS(m, ep, dir);

let mainErr = null;
Promise.resolve(m._main()).then(() => {}, (e) => { mainErr = e; });

let abuf = 0;
try { abuf = m._malloc ? m._malloc(2048 * 2 * 4) : 0; } catch {}
const apump = setInterval(() => { try { if (abuf && m._SD_AudioRender) m._SD_AudioRender(abuf, 2048); } catch {} }, 16);

const key = (sc, dn) => m._CKWEB_KeyEvent(sc, dn);
const warp = (n) => (m._CKWEB_Warp ? m._CKWEB_Warp(n) : -9);
const ps = (w) => (m._CKWEB_PlayerState ? m._CKWEB_PlayerState(w) : -9);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => sleep(34); // ~2 engine frames
const BACK = 0x0e, RIGHT = 0x4d, SPACE = 0x39, ENTER = 0x1c;

async function startGame() {
  for (let i = 0; i < 60 && ps(0) !== 1; i++) {
    if (mainErr) throw mainErr;
    if (i < 14) { key(SPACE, 1); key(SPACE, 0); }
    else { key(ENTER, 1); key(ENTER, 0); }
    await sleep(120);
  }
  if (ps(0) !== 1) throw new Error("never reached in-game (title stuck)");
}

try {
  await startGame();
  for (let i = 0; i < 40 && warp(level) !== 1; i++) await tick();
  for (let i = 0; i < 80 && !(ps(6) === level && ps(0) === 1); i++) await tick();
  if (ps(6) !== level) { console.log(`CK${ep}: warp to L${level} failed (mapon=${ps(6)}) ❌`); process.exit(2); }
  for (let i = 0; i < 12; i++) await tick();        // let gravity settle Keen on the ground

  const xEnter = ps(1);
  console.log(`CK${ep}: in L${level}, keen=(${ps(1)},${ps(2)})  — walk right...`);

  // walk right briefly (stay inside the level)
  key(RIGHT, 1);
  let walkedX = xEnter;
  for (let i = 0; i < 18 && ps(6) === level; i++) { walkedX = ps(1); await tick(); }
  key(RIGHT, 0);
  await tick();
  const rewindStart = ps(1);
  console.log(`CK${ep}: walked to x=${rewindStart}  — hold rewind...`);

  // hold the rewind key
  key(BACK, 1);
  let minX = 1e9, lastX = rewindStart;
  for (let i = 0; i < 80 && ps(6) === level; i++) {
    const x = ps(1);
    minX = Math.min(minX, x);
    lastX = x;
    await tick();
  }
  key(BACK, 0);

  clearInterval(apump);
  const walked = walkedX > xEnter + 16;
  const rewound = minX < rewindStart - 16;
  const held = Math.abs(lastX - minX) < 16;   // settled near the oldest snapshot
  const ok = walked && rewound;
  console.log(`\n--- CK${ep} rewind summary ---`);
  console.log(`enterX=${xEnter} walkedTo=${walkedX} rewindStart=${rewindStart} rewoundMin=${minX} restAt=${lastX}`);
  console.log(`walkedRight=${walked} rewoundBack=${rewound} settledAtOldest=${held}`);
  console.log(`RESULT: ${ok ? `REWIND WORKS ✅ (x wound back ${rewindStart} -> ${minX})` : "rewind NOT observed ❌"}`);
  process.exit(ok ? 0 : 1);
} catch (e) {
  clearInterval(apump);
  console.log(`CK${ep} CRASH/ERROR:`, e.message || e);
  process.exit(2);
}
