/* Real-browser verification of the wasm engine wired into the shell.
   Loads the page, picks an episode, drives the keyboard through title -> new
   game -> world map, then warps into a level and confirms in-level play, and
   checks the canvas is actually rendering (not a blank frame).
   Usage: node verify-wasm-browser.mjs [ck4|ck5|ck6]   (dev server on :5173) */
import { chromium } from "playwright";

const URL = process.env.CK_URL || "http://localhost:5173/";
const ep = process.argv[2] || "ck4";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console:" + m.text()); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (w) => page.evaluate((w) => window.__keenEngine?.state(w) ?? -9, w);
const press = async (key) => { await page.keyboard.down(key); await sleep(60); await page.keyboard.up(key); };

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector(`.episode[data-id=${ep}]`, { timeout: 8000 });
  await page.click(`.episode[data-id=${ep}]`);

  // wait for the wasm module to finish loading + start
  await page.waitForFunction(() => window.__keenEngine?.ready === true, { timeout: 30000 });
  await page.click("#screen", { position: { x: 60, y: 60 } }).catch(() => {});

  // drive title -> New Game -> difficulty until ingame
  let ingame = 0;
  for (let i = 0; i < 50 && !ingame; i++) {
    await press(i < 12 ? "Space" : "Enter");
    await sleep(120);
    ingame = await st(0);
  }
  const maponWorld = await st(6);
  console.log(`[${ep}] reached in-game: ingame=${ingame} mapon=${maponWorld}`);
  if (!ingame) throw new Error("never reached in-game");

  // warp into level 1 and confirm we are playing a real level
  await page.evaluate(() => window.__keenEngine.warp(1));
  let mapon = 0;
  for (let i = 0; i < 60; i++) { mapon = await st(6); if (mapon === 1 && (await st(0)) === 1) break; await sleep(80); }
  await sleep(400);
  const y0 = await st(2);
  await page.keyboard.down("ArrowRight");
  await sleep(900);
  const x1 = await st(1);
  await page.keyboard.up("ArrowRight");
  await page.keyboard.down("Control"); await sleep(120); await page.keyboard.up("Control");
  await sleep(120);
  const yJump = await st(2);

  // canvas non-blank check: sample the framebuffer pixels
  const nonBlank = await page.evaluate(() => {
    const c = document.getElementById("screen");
    const ctx = c.getContext("2d");
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let nz = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] || d[i + 1] || d[i + 2]) nz++;
    return nz;
  });

  await page.screenshot({ path: `/tmp/${ep}_wasm_play.png` });

  const walked = x1 > 200;       // moved right from spawn
  const jumped = yJump < y0 - 8; // rose when jumping (or already moved)
  console.log(`[${ep}] level=${mapon} walked(x->${x1})=${walked} vertical=${jumped} canvasNonBlankPx=${nonBlank}`);
  const ok = mapon === 1 && nonBlank > 2000 && walked;
  console.log(`[${ep}] RESULT: ${ok ? "PLAYS IN BROWSER ✅" : "⚠️ needs review"}`);
  console.log(`[${ep}] page errors: ${errors.length ? errors.slice(0, 5).join(" | ") : "none"}`);
  await browser.close();
  process.exit(ok && errors.length === 0 ? 0 : 1);
} catch (e) {
  console.log(`[${ep}] FAILED: ${e.message}`);
  console.log("errors:", errors.slice(0, 5));
  await page.screenshot({ path: `/tmp/${ep}_wasm_fail.png` }).catch(() => {});
  await browser.close();
  process.exit(2);
}
