/* End-to-end browser audio check: confirms the wasm engine's FM synth is heard
   through the real Web Audio graph (ScriptProcessor -> analyser -> speakers),
   not just in the headless SD_AudioRender unit test. Drives into a level and
   samples the live output peak via WasmEngine.audioLevel().
   Run: node web/verify-wasm-audio-browser.mjs [ck4|ck5|ck6]   (dev server up) */
import { chromium } from "playwright";

const URL = process.env.CK_URL || "http://localhost:5173/";
const ep = process.argv[2] || "ck4";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (w) => page.evaluate((w) => window.__keenEngine?.state(w) ?? -9, w);
const level = () => page.evaluate(() => window.__keenEngine?.audioLevel?.() ?? -1);

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector(`.episode[data-id=${ep}]`, { timeout: 8000 });
  await page.click(`.episode[data-id=${ep}]`);
  await page.waitForFunction(() => window.__keenEngine?.ready === true, { timeout: 30000 });
  // A user gesture is needed to unlock audio; click the canvas + resume.
  await page.click("#screen", { position: { x: 60, y: 60 } }).catch(() => {});
  await page.evaluate(() => window.__keenEngine?.resumeAudio?.());

  // Drive to in-game and warp into level 1 (level music + ambience play there).
  let ingame = 0;
  for (let i = 0; i < 50 && !ingame; i++) {
    await page.keyboard.press(i < 12 ? "Space" : "Enter");
    await sleep(120);
    ingame = await st(0);
  }
  if (!ingame) throw new Error("never reached in-game");
  await page.evaluate(() => window.__keenEngine.warp(1));
  for (let i = 0; i < 60; i++) { if ((await st(6)) === 1 && (await st(0)) === 1) break; await sleep(80); }

  // Sample the live audio peak for ~2 s; music should make it non-zero.
  let best = 0;
  for (let i = 0; i < 20; i++) { const l = await level(); if (l > best) best = l; await sleep(100); }

  const ok = best > 0.01;
  console.log(`[${ep}] live audio peak=${best.toFixed(4)}  ${ok ? "✓ AUDIBLE IN BROWSER" : "✗ silent"}`);
  console.log(`[${ep}] page errors: ${errors.length ? errors.slice(0, 3).join(" | ") : "none"}`);
  await browser.close();
  process.exit(ok && errors.length === 0 ? 0 : 1);
} catch (e) {
  console.log(`[${ep}] FAILED: ${e.message}`);
  await browser.close();
  process.exit(2);
}
