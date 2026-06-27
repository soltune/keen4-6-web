/* Regression test for "rewind after a death freezes scrolling": induce a death
   in a level (keenkilled goes 1 during the dying animation, which DOES record
   frames), hold the rewind key back past the death, and confirm keenkilled
   winds back to 0 AND the screen scrolls again afterwards. Before the fix
   (keenkilled not snapshotted) the restored keenkilled stayed 1 and
   ScrollScreen early-outs => no scroll.
   Usage: node web/test/rewind-death-test.mjs [4|5|6] [level] */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadDataIntoFS } from "./_loadData.mjs";

const ep = process.argv[2] || "4";
const level = +(process.argv[3] || 1);
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const factory = (await import(path.join(dir, `public/engine/keen${ep}.js`))).default;
const engineDir = path.join(dir, "public/engine");
const m = await factory({ locateFile: (p) => path.join(engineDir, p), print: () => {}, printErr: (t) => console.log("[err]", t) });
loadDataIntoFS(m, ep, dir);
let mainErr = null;
Promise.resolve(m._main()).then(() => {}, (e) => { mainErr = e; });
let abuf = 0; try { abuf = m._malloc ? m._malloc(2048 * 2 * 4) : 0; } catch {}
const apump = setInterval(() => { try { if (abuf && m._SD_AudioRender) m._SD_AudioRender(abuf, 2048); } catch {} }, 16);
const key = (sc, d) => m._CKWEB_KeyEvent(sc, d);
const warp = (n) => m._CKWEB_Warp(n);
const ps = (w) => m._CKWEB_PlayerState(w);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BACK = 0x0e, LEFT = 0x4b, RIGHT = 0x4d, SPACE = 0x39, ENTER = 0x1c;

for (let i = 0; i < 60 && ps(0) !== 1; i++) { const k = i < 14 ? SPACE : ENTER; key(k, 1); await sleep(40); key(k, 0); await sleep(110); }
for (let i = 0; i < 40 && warp(level) !== 1; i++) await sleep(34);
for (let i = 0; i < 80 && !(ps(6) === level && ps(0) === 1); i++) await sleep(34);
await sleep(500);
console.log(`in L${level} x=${ps(1)} y=${ps(2)} ox=${ps(3)} keenkilled=${ps(8)}`);

// induce a death: walk one way then the other until keenkilled goes 1
async function tryDie(dir, secs) {
  key(dir, 1);
  for (let i = 0; i < secs * 5; i++) { await sleep(200); if (ps(8) === 1) { key(dir, 0); return true; } if (ps(6) !== level) { key(dir, 0); return false; } }
  key(dir, 0); return false;
}
let killed = await tryDie(LEFT, 16) || await tryDie(RIGHT, 16);
console.log(`death induced=${killed} keenkilled=${ps(8)} mapon=${ps(6)} x=${ps(1)}`);
if (!killed) { clearInterval(apump); console.log("RESULT: could not induce a death here ❌ (try another level)"); process.exit(2); }

// hold rewind back through the death
key(BACK, 1);
let kkMin = 1;
for (let i = 0; i < 55; i++) { await sleep(100); kkMin = Math.min(kkMin, ps(8)); }
key(BACK, 0);
await sleep(200);

// now try to scroll
const kkNow = ps(8), ox0 = ps(3);
let oxMoved = ox0;
// try BOTH directions: the rewind may land at a level edge where one way can't scroll
for (const d of [RIGHT, LEFT]) {
  key(d, 1);
  for (let i = 0; i < 16; i++) { await sleep(100); if (ps(3) !== ox0) oxMoved = ps(3); }
  key(d, 0);
  if (oxMoved !== ox0) break;
  await sleep(150);
}
clearInterval(apump);

const rewoundPastDeath = kkMin === 0;
const scrolls = oxMoved !== ox0;
const ok = rewoundPastDeath && scrolls && kkNow === 0;
console.log(`after rewind: keenkilled=${kkNow} kkMin=${kkMin} scroll ox ${ox0}->${oxMoved} scrolls=${scrolls}`);
console.log(`RESULT: ${ok ? "DEATH→REWIND→SCROLL OK ✅" : "⚠️ " + (!rewoundPastDeath ? "keenkilled never wound back to 0" : "scroll still frozen after rewind")}`);
process.exit(ok ? 0 : 1);
