/* Verify rewind works from the "Try Again / Exit to Shadowlands" death dialog
   (HandleDeath), not just during the dying animation: induce a death, WAIT (no
   key) for the animation to finish and the dialog to appear, THEN hold Backspace
   and confirm it winds the death back (keenkilled->0) and the game resumes &
   scrolls. Usage: node web/test/rewind-dialog-test.mjs [4|5|6] [level] */
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

async function tryDie(d, secs) {
  key(d, 1);
  for (let i = 0; i < secs * 5; i++) { await sleep(200); if (ps(8) === 1) { key(d, 0); return true; } if (ps(6) !== level) { key(d, 0); return false; } }
  key(d, 0); return false;
}
let killed = await tryDie(LEFT, 16) || await tryDie(RIGHT, 16);
if (!killed) { clearInterval(apump); console.log("RESULT: could not induce a death ❌"); process.exit(2); }
console.log(`died (keenkilled=${ps(8)} x=${ps(1)}). Waiting — NO key — for the death dialog...`);

// wait out the dying animation + let the Try-Again dialog appear (no key pressed)
for (let i = 0; i < 30; i++) await sleep(200);   // ~6 s
const atDialog = { kk: ps(8), mapon: ps(6), x: ps(1), ingame: ps(0) };
console.log(`at dialog: keenkilled=${atDialog.kk} mapon=${atDialog.mapon} x=${atDialog.x} ingame=${atDialog.ingame}`);

// now hold rewind FROM THE DIALOG
key(BACK, 1);
let kkMin = 1;
for (let i = 0; i < 60; i++) { await sleep(100); kkMin = Math.min(kkMin, ps(8)); }
key(BACK, 0);
await sleep(300);

// resumed? check keenkilled cleared and the screen scrolls
const kkNow = ps(8), ox0 = ps(3);
let oxMoved = ox0;
for (const d of [RIGHT, LEFT]) {
  key(d, 1);
  for (let i = 0; i < 16; i++) { await sleep(100); if (ps(3) !== ox0) oxMoved = ps(3); }
  key(d, 0);
  if (oxMoved !== ox0) break;
  await sleep(150);
}
clearInterval(apump);

const reachedDialog = atDialog.kk === 1 && atDialog.mapon === level;   // still "dead" in the level => dialog
const rewoundFromDialog = kkMin === 0;
const resumedAndScrolls = kkNow === 0 && oxMoved !== ox0;
const ok = reachedDialog && rewoundFromDialog && resumedAndScrolls;
console.log(`reachedDialog=${reachedDialog} rewoundFromDialog=${rewoundFromDialog} resumed&scrolls=${resumedAndScrolls} (kkNow=${kkNow} ox ${ox0}->${oxMoved})`);
console.log(`RESULT: ${ok ? "REWIND FROM DEATH DIALOG OK ✅" : "⚠️ needs review"}`);
process.exit(ok ? 0 : 1);
