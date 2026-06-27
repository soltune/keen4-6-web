/* Drive CK4 from the world map INTO a real level and verify platform physics
   (gravity pulls Keen down, jump lifts him, walking moves him with collision).
   Strategy: start a game, then roam the world map (cycle directions) while
   pulsing the jump button so CheckEnterLevel fires on a level-entrance tile;
   once mapon != 0 we are in a level — then stop entering and probe physics.
   Usage: node web/test/level-test.mjs [4|5|6]   env: CK_T=secs */
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadDataIntoFS } from "./_loadData.mjs";

const ep = process.argv[2] || "4";
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."); // web/ root (this script lives in web/test/)
const factory = (await import(path.join(dir, `public/engine/keen${ep}.js`))).default;
const engineDir = path.join(dir, "public/engine");

const m = await factory({
  locateFile: (p) => path.join(engineDir, p),
  print: (t) => console.log("[out]", t),
  printErr: (t) => console.log("[err]", t),
});

loadDataIntoFS(m, ep, dir);

let mainErr = null;
Promise.resolve(m._main()).then(() => {}, (e) => { mainErr = e; });

const key = (sc, dn) => m._CKWEB_KeyEvent(sc, dn);
const ps = (w) => (m._CKWEB_PlayerState ? m._CKWEB_PlayerState(w) : -9);
const SECS = +(process.env.CK_T || 30);
const DIRS = [0x4b, 0x4d, 0x48, 0x50]; // L R U D scancodes
let heldDir = -1;

// physics-probe bookkeeping (collected once we are inside a level)
let levelMapon = 0, enterT = -1;
let yAtEntry = null, yMin = 1e9, yMax = -1e9, xMin = 1e9, xMax = -1e9;
let fell = false, jumped = false, phase = "roam";

for (let t = 0; t < SECS * 2; t++) {
  await new Promise((r) => setTimeout(r, 500));
  if (mainErr) { console.log("CRASH at t=", (t / 2).toFixed(1), "s:", mainErr.message); break; }

  const inGame = ps(0), px = ps(1), py = ps(2), mapon = ps(6), oc = ps(5);

  // --- input script ---
  if (t < 6) { key(0x39, 1); key(0x39, 0); }                 // Space: advance title
  else if (t === 6 || t === 7) { key(0x1c, 1); key(0x1c, 0); } // Enter: New Game + difficulty
  else if (mapon === 0 && inGame) {
    // roam the world map: change direction every ~1.5 s, pulse jump every frame
    const want = DIRS[Math.floor((t - 8) / 3) % 4];
    if (want !== heldDir) { if (heldDir >= 0) key(heldDir, 0); key(want, 1); heldDir = want; }
    if (t % 2 === 0) key(0x1d, 1); else key(0x1d, 0);        // pulse jump => CheckEnterLevel
  } else if (mapon > 0) {
    // --- inside a real level: stop entering, probe physics ---
    if (enterT < 0) {
      enterT = t; levelMapon = mapon; yAtEntry = py;
      if (heldDir >= 0) { key(heldDir, 0); heldDir = -1; }
      key(0x1d, 0);
      console.log(`>>> ENTERED LEVEL ${mapon} at t=${(t / 2).toFixed(1)}s  keen=(${px},${py})`);
    }
    const since = t - enterT;
    if (since < 4) { /* phase A: do nothing -> gravity should pull Keen down */ phase = "fall"; }
    else if (since < 6) { phase = "walk"; key(0x4d, 1); }    // hold Right: walk
    else if (since === 6) { phase = "jump"; key(0x4d, 0); key(0x1d, 1); } // jump
    else if (since === 7) { key(0x1d, 0); }
    else { phase = "settle"; }
    if (py >= 0) { yMin = Math.min(yMin, py); yMax = Math.max(yMax, py); }
    if (px >= 0) { xMin = Math.min(xMin, px); xMax = Math.max(xMax, px); }
    if (py > yAtEntry + 8) fell = true;
    if (py < yAtEntry - 8) jumped = true;
  }

  console.log(`t=${(t / 2).toFixed(1)}s inGame=${inGame} mapon=${mapon} keen=(${px},${py}) class=${oc} [${phase}]`);
  if (enterT >= 0 && (t - enterT) > 10) break;
}

console.log(`\n--- level physics summary ---`);
console.log(`enteredLevel=${levelMapon} yEntry=${yAtEntry} yRange=[${yMin === 1e9 ? "-" : yMin}..${yMax === -1e9 ? "-" : yMax}] xRange=[${xMin === 1e9 ? "-" : xMin}..${xMax === -1e9 ? "-" : xMax}]`);
console.log(`gravityObserved(fell)=${fell}  jumpObserved=${jumped}`);
const ok = levelMapon > 0 && (xMax - xMin) > 0 && (fell || jumped);
console.log(`RESULT: ${ok ? "PLAYS A REAL LEVEL ✅ (mapon=" + levelMapon + ", moved+vertical physics)" : (levelMapon > 0 ? "entered level but physics weak ⚠️" : "did not reach a level ❌")}`);
process.exit(0);
