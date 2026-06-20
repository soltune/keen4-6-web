/* Headless audio regression test for the native wasm engine.
   Boots an episode, drives it into a level, and pulls PCM straight from the
   engine's audio sink (SD_AudioRender) — the same call the browser's
   ScriptProcessor makes — measuring whether the OPL2 actually synthesises
   non-silent music. The AUDIOHEAD/AUDIODICT are extracted from the same EXE as
   AUDIO, so any sound that plays is the correct version's music.
   Run: node web/test/verify-wasm-audio.mjs [4|5|6]   (module must be linked). */
import { fileURLToPath } from "node:url";
import path from "node:path";

const ep = process.argv[2] || "4";
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."); // web/ root (this script lives in web/test/)
const engineDir = path.join(dir, "public/engine");
const factory = (await import(path.join(engineDir, `keen${ep}.js`))).default;

const m = await factory({ locateFile: (p) => path.join(engineDir, p), print: () => {}, printErr: () => {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

m._CKWEB_Boot();
Promise.resolve(m._main()).catch((e) => console.log("main rejected:", e?.message));

const FRAMES = 2048;
const buf = m._malloc(FRAMES * 4);
const key = (sc) => { m._CKWEB_KeyEvent(sc, 1); m._CKWEB_KeyEvent(sc, 0); };

// Render `ms` of audio in 2048-sample blocks; return the peak |sample|.
const measure = async (ms) => {
  let peak = 0, rms = 0, n = 0;
  const blocks = Math.ceil((44100 * ms) / 1000 / FRAMES);
  for (let b = 0; b < blocks; b++) {
    m._SD_AudioRender(buf, FRAMES);
    const f = m.HEAPF32.subarray(buf >> 2, (buf >> 2) + FRAMES);
    for (let i = 0; i < FRAMES; i++) { const a = Math.abs(f[i]); if (a > peak) peak = a; rms += f[i] * f[i]; n++; }
    await sleep(8); // let ASYNCIFY yields + main() run between blocks
  }
  return { peak, rms: Math.sqrt(rms / n) };
};

// Drive title -> New Game -> difficulty until ingame, then warp to level 1.
for (let t = 0; t < 6; t++) { await sleep(400); m._VW_Present(); }
let ingame = 0;
for (let i = 0; i < 60 && !ingame; i++) { key(i < 12 ? 0x39 : 0x1c); await sleep(120); ingame = m._CKWEB_PlayerState(0); }
m._CKWEB_Warp(1);
for (let i = 0; i < 60; i++) { if (m._CKWEB_PlayerState(6) === 1 && m._CKWEB_PlayerState(0) === 1) break; await sleep(80); }
await sleep(600); // level music gets loaded + started

const music = await measure(1500);
const mapon = m._CKWEB_PlayerState(6);
console.log(`[ck${ep}] level=${mapon} music: peak=${music.peak.toFixed(4)} rms=${music.rms.toFixed(4)} ${music.peak > 0.01 ? "✓ AUDIBLE" : "✗ silent"}`);

// Fire a shot to exercise a sound effect, then measure the transient.
m._CKWEB_KeyEvent(0x39, 1); await sleep(60); m._CKWEB_KeyEvent(0x39, 0);
const sfx = await measure(500);
console.log(`[ck${ep}] with SFX: peak=${sfx.peak.toFixed(4)} rms=${sfx.rms.toFixed(4)}`);

const ok = music.peak > 0.01;
console.log(`[ck${ep}] RESULT: ${ok ? "AUDIO WORKS ✅" : "⚠️ audio silent — investigate"}`);
process.exit(ok ? 0 : 1);
