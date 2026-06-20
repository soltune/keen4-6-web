/* Headless SOUND-EFFECT regression test for the native wasm engine.
   Music already plays; this checks that AdLib *sound effects* are audible.
   Boots an episode, drives it into level 1, measures the music-only audio
   floor straight from the engine's sink (SD_AudioRender), then makes Keen JUMP
   (Ctrl = scancode 0x1d = KbdDefs[0].button0, which calls SD_PlaySound(SND_JUMP))
   and checks that a clear transient rises above the music floor.

   Before the fix the SFX pointer was mangled by MK_FP and the AdLibSound struct
   was mis-sized, so jumps added nothing -> this test fails. After the fix the
   jump "boing" pushes the peak well above the music floor.
   Run: node web/test/verify-wasm-sfx.mjs [4|5|6]   (module must be linked). */
import { fileURLToPath } from "node:url";
import path from "node:path";

const ep = process.argv[2] || "4";
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const engineDir = path.join(dir, "public/engine");
const factory = (await import(path.join(engineDir, `keen${ep}.js`))).default;

const m = await factory({ locateFile: (p) => path.join(engineDir, p), print: () => {}, printErr: () => {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

m._CKWEB_Boot();
Promise.resolve(m._main()).catch((e) => console.log("main rejected:", e?.message));

const FRAMES = 2048;
const buf = m._malloc(FRAMES * 4);
const key = (sc) => { m._CKWEB_KeyEvent(sc, 1); m._CKWEB_KeyEvent(sc, 0); };

// Render one 2048-sample block; return {peak, rms} of |sample|.
const block = () => {
  m._SD_AudioRender(buf, FRAMES);
  const f = m.HEAPF32.subarray(buf >> 2, (buf >> 2) + FRAMES);
  let peak = 0, e = 0;
  for (let i = 0; i < FRAMES; i++) { const a = Math.abs(f[i]); if (a > peak) peak = a; e += f[i] * f[i]; }
  return { peak, rms: Math.sqrt(e / FRAMES) };
};
const measure = async (ms) => {
  let peak = 0, rms = 0, n = 0;
  const blocks = Math.ceil((44100 * ms) / 1000 / FRAMES);
  for (let b = 0; b < blocks; b++) { const r = block(); if (r.peak > peak) peak = r.peak; rms += r.rms * r.rms; n++; await sleep(8); }
  return { peak, rms: Math.sqrt(rms / n) };
};

// Title -> New Game -> difficulty until ingame, then warp to level 1.
for (let t = 0; t < 6; t++) { await sleep(400); m._VW_Present(); }
let ingame = 0;
for (let i = 0; i < 60 && !ingame; i++) { key(i < 12 ? 0x39 : 0x1c); await sleep(120); ingame = m._CKWEB_PlayerState(0); }
m._CKWEB_Warp(1);
for (let i = 0; i < 60; i++) { if (m._CKWEB_PlayerState(6) === 1 && m._CKWEB_PlayerState(0) === 1) break; await sleep(80); }
await sleep(600); // level music loads + starts

// 1) music-only floor (max peak over 1.2 s of just the song)
const base = await measure(1200);

// 2) jump repeatedly; capture the loudest window (jump SFX over the music)
let sfxPeak = 0, sfxRms = 0;
for (let j = 0; j < 14; j++) {
  m._CKWEB_KeyEvent(0x1d, 1);            // press Jump (Ctrl)
  let wp = 0, we = 0, wn = 0;
  for (let b = 0; b < 4; b++) { const r = block(); if (r.peak > wp) wp = r.peak; we += r.rms * r.rms; wn++; await sleep(8); }
  m._CKWEB_KeyEvent(0x1d, 0);            // release, let him land before re-jumping
  for (let b = 0; b < 5; b++) { const r = block(); if (r.peak > wp) wp = r.peak; we += r.rms * r.rms; wn++; await sleep(40); }
  if (wp > sfxPeak) sfxPeak = wp;
  const wr = Math.sqrt(we / wn); if (wr > sfxRms) sfxRms = wr;
}

const ratio = sfxPeak / (base.peak || 1e-6);
console.log(`[ck${ep}] level=${m._CKWEB_PlayerState(6)}`);
console.log(`[ck${ep}] music floor : peak=${base.peak.toFixed(4)} rms=${base.rms.toFixed(4)}`);
console.log(`[ck${ep}] jump windows: peak=${sfxPeak.toFixed(4)} rms=${sfxRms.toFixed(4)}`);
console.log(`[ck${ep}] transient ratio=${ratio.toFixed(2)} (peak / music floor)`);
const ok = sfxPeak > base.peak * 1.25;   // jump SFX clearly above the music floor
console.log(`[ck${ep}] RESULT: ${ok ? "SFX AUDIBLE ✅" : "⚠️ no sound effect over music — investigate"}`);
process.exit(ok ? 0 : 1);
