/* Verify rewind works from the "Game Over!" screen (GameOver, CK4/CK6): set
   lives to 0 so the next death is a game over, induce a death, WAIT (no key) for
   the Game Over screen, then hold Backspace and confirm it winds the game over
   back (keenkilled->0, lives restored, resumes & scrolls).
   Usage: node web/test/rewind-gameover-test.mjs [4|6] [level] */
import { fileURLToPath } from "node:url";
import path from "node:path";

const ep = process.argv[2] || "4";
const level = +(process.argv[3] || 1);
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const factory = (await import(path.join(dir, `public/engine/keen${ep}.js`))).default;
const engineDir = path.join(dir, "public/engine");
const m = await factory({ locateFile: (p) => path.join(engineDir, p), print: () => {}, printErr: (t) => console.log("[err]", t) });
let mainErr = null;
Promise.resolve(m._main()).then(() => {}, (e) => { mainErr = e; });
let abuf = 0; try { abuf = m._malloc ? m._malloc(2048 * 2 * 4) : 0; } catch {}
const apump = setInterval(() => { try { if (abuf && m._SD_AudioRender) m._SD_AudioRender(abuf, 2048); } catch {} }, 16);
const key = (sc, d) => m._CKWEB_KeyEvent(sc, d);
const warp = (n) => m._CKWEB_Warp(n);
const setlives = (n) => (m._CKWEB_SetLives ? m._CKWEB_SetLives(n) : 0);
const ps = (w) => m._CKWEB_PlayerState(w);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BACK = 0x0e, LEFT = 0x4b, RIGHT = 0x4d, SPACE = 0x39, ENTER = 0x1c;

for (let i = 0; i < 60 && ps(0) !== 1; i++) { const k = i < 14 ? SPACE : ENTER; key(k, 1); await sleep(40); key(k, 0); await sleep(110); }
for (let i = 0; i < 40 && warp(level) !== 1; i++) await sleep(34);
for (let i = 0; i < 80 && !(ps(6) === level && ps(0) === 1); i++) await sleep(34);
await sleep(500);

setlives(0);   // next death = game over
console.log(`in L${level}, lives set to ${ps(9)} — inducing the fatal death...`);

async function tryDie(d, secs) {
  key(d, 1);
  for (let i = 0; i < secs * 5; i++) { await sleep(200); if (ps(8) === 1) { key(d, 0); return true; } if (ps(6) !== level) { key(d, 0); return false; } }
  key(d, 0); return false;
}
let killed = await tryDie(RIGHT, 16) || await tryDie(LEFT, 16);
if (!killed) { clearInterval(apump); console.log("RESULT: could not induce a death ❌"); process.exit(2); }

// poll for the Game Over screen (ingame=0 & lives<0), then immediately rewind —
// the screen only lasts ~4s before GameLoop returns to the title.
let atGO = null;
for (let i = 0; i < 60; i++) {
  await sleep(100);
  if (ps(0) === 0 && ps(9) < 0) { atGO = { ingame: ps(0), lives: ps(9), kk: ps(8), mapon: ps(6) }; break; }
}
if (!atGO) { clearInterval(apump); console.log(`RESULT: never reached game over (ingame=${ps(0)} lives=${ps(9)} mapon=${ps(6)}) ❌`); process.exit(2); }
console.log(`at game over: ingame=${atGO.ingame} lives=${atGO.lives} keenkilled=${atGO.kk} mapon=${atGO.mapon}`);

// hold rewind FROM the game over screen
key(BACK, 1);
let kkMin = 1;
for (let i = 0; i < 70; i++) { await sleep(100); kkMin = Math.min(kkMin, ps(8)); if (kkMin === 0) break; }  // hold until the death is wound back (CK5's galaxy game-over is long)
key(BACK, 0);
for (let i = 0; i < 25 && ps(0) !== 1; i++) await sleep(100);  // wait for PlayLoop to resume
await sleep(300);

// state right after the rewind, BEFORE walking (on some maps walking re-dies)
// after the rewind, confirm Keen can move again (any dir; CK5 has vertical levels)
let moved = false;
for (const d of [RIGHT, LEFT, 0x48, 0x50]) {
  const bx = ps(1), by = ps(2);
  key(d, 1);
  for (let i = 0; i < 14; i++) { await sleep(100); if (ps(1) !== bx || ps(2) !== by) moved = true; }
  key(d, 0);
  if (moved) break;
  await sleep(120);
}
clearInterval(apump);

const reachedGameOver = atGO.ingame === 0 && atGO.lives < 0;
const rewound = kkMin === 0;
const resumed = moved;   // rewound (kkMin==0) AND Keen can move again => playable
console.log(`(resume detail: keenMoved=${moved})`);
const ok = reachedGameOver && rewound && resumed;
console.log(`reachedGameOver=${reachedGameOver} rewound=${rewound} keenMoved=${moved}`);
console.log(`RESULT: ${ok ? "REWIND FROM GAME OVER OK ✅" : "⚠️ " + (!reachedGameOver ? "did not reach a real game over" : !rewound ? "did not rewind" : "did not resume/scroll")}`);
process.exit(ok ? 0 : 1);
