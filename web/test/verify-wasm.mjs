/* Smoke test for the native wasm engine: instantiate, run main(), and check
   that it boots far enough to render a non-black screen (title/intro).
   Run: node web/test/verify-wasm.mjs [4|5|6]   (needs the module linked first). */
import { fileURLToPath } from "node:url";
import path from "node:path";

const ep = process.argv[2] || "4";
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), ".."); // web/ root (this script lives in web/test/)
const modUrl = path.join(dir, `public/engine/keen${ep}.js`);

const factory = (await import(modUrl)).default;
const engineDir = path.join(dir, "public/engine");

const logs = [];
const m = await factory({
  locateFile: (p) => path.join(engineDir, p),
  print: (t) => { logs.push(t); console.log("[out]", t); },
  printErr: (t) => { logs.push(t); console.log("[err]", t); },
});
console.log(`module keen${ep} instantiated`);

// list the preloaded data files
try {
  const files = m.FS.readdir("/").filter((f) => /CK/i.test(f));
  console.log("MEMFS data:", files.join(", "));
} catch (e) { console.log("FS readdir failed:", e.message); }

// start the engine (linked with INVOKE_RUN=0). The engine's entry is the DOS
// `void main(void)`, so call the raw export (callMain would pass argc/argv).
let mainErr = null;
try {
  Promise.resolve(m._main()).then(
    () => console.log("main() returned"),
    (e) => { mainErr = e; console.log("main() rejected:", e && e.message); },
  );
} catch (e) { mainErr = e; console.log("main() threw:", e && e.message); }

const W = m._VW_ScreenWidth(), H = m._VW_ScreenHeight();
let best = 0;
const ITERS = +(process.env.CK_T || 16);
let prevScr = -1, scrollChanges = 0;
for (let t = 0; t < ITERS; t++) {
  await new Promise((r) => setTimeout(r, 500));
  m._VW_Present();
  const p = m._VW_GetFramebuffer();
  const fb = m.HEAPU8.subarray(p, p + W * H * 4);
  let nonblack = 0; const colors = new Set();
  for (let i = 0; i < fb.length; i += 4) {
    if (fb[i] || fb[i + 1] || fb[i + 2]) nonblack++;
    colors.add((fb[i] << 16) | (fb[i + 1] << 8) | fb[i + 2]);
  }
  best = Math.max(best, nonblack);
  // [input test] once the intro is up, press Space/Enter to navigate
  // title -> menu -> game and exercise the input path.
  if (m._CKWEB_KeyEvent && t >= 4 && t % 2 === 0) {
    const key = (t % 4 === 0) ? 0x39 : 0x1c; // Space / Enter
    m._CKWEB_KeyEvent(key, 1);
    m._CKWEB_KeyEvent(key, 0);
  }
  const tc = m._CKWEB_TimeCount ? m._CKWEB_TimeCount() : -1;
  const dbg = m._VW_DebugState
    ? `planeNZ=${m._VW_DebugState(0)} lw=${m._VW_DebugState(1)} scr=${m._VW_DebugState(2)} fade=${m._VW_DebugState(3)} pan=${m._VW_DebugState(4)} buf=${m._VW_DebugState(5)} disp=${m._VW_DebugState(6)}`
    : "";
  const scrNow = m._VW_DebugState ? m._VW_DebugState(2) : 0;
  if (prevScr >= 0 && scrNow !== prevScr) scrollChanges++;
  prevScr = scrNow;
  console.log(`t=${((t + 1) * 0.5).toFixed(1)}s  nonblack=${nonblack} colors=${colors.size} TC=${tc}  ${dbg}`);
  if (mainErr) break;
}
console.log(`scroll/state changes observed: ${scrollChanges}`);

console.log("\n--- engine output (last 30 lines) ---");
console.log(logs.slice(-30).join("\n"));
console.log(`\nRESULT: best nonblack = ${best} / ${W * H}  => ${best > 1000 ? "BOOTS & RENDERS ✅" : "no visible render ❌"}`);
process.exit(0);
