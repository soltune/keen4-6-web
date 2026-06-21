/* Real-browser regression test for "rewind after a death freezes scrolling".
   Induce a death in a level, hold Backspace back past it, and confirm
   keenkilled winds back to 0 and the screen scrolls again (both directions,
   since the rewind may land at a level edge). Usage:
   node web/test/verify-rewind-death-browser.mjs [ck4|ck5|ck6] [level]  (dev :5173) */
import { chromium } from "playwright";

const URL = process.env.CK_URL || "http://localhost:5173/";
const ep = process.argv[2] || "ck4";
const level = +(process.argv[3] || 1);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console:" + m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (w) => page.evaluate((w) => window.__keenEngine?.state(w) ?? -9, w);

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector(`.episode[data-id=${ep}]`, { timeout: 8000 });
  await page.click(`.episode[data-id=${ep}]`);
  await page.waitForFunction(() => window.__keenEngine?.ready === true, { timeout: 30000 });
  await page.click("#screen", { position: { x: 60, y: 60 } }).catch(() => {});

  let ingame = 0;
  for (let i = 0; i < 50 && !ingame; i++) { const k = i < 12 ? "Space" : "Enter"; await page.keyboard.down(k); await sleep(50); await page.keyboard.up(k); await sleep(120); ingame = await st(0); }
  if (!ingame) throw new Error("never reached in-game");
  await page.evaluate((n) => window.__keenEngine.warp(n), level);
  for (let i = 0; i < 60 && !((await st(6)) === level && (await st(0)) === 1); i++) await sleep(80);
  if ((await st(6)) !== level) throw new Error("warp failed");
  await sleep(500);

  async function tryDie(key, secs) {
    await page.keyboard.down(key);
    for (let i = 0; i < secs * 5; i++) { await sleep(200); if ((await st(8)) === 1) { await page.keyboard.up(key); return true; } if ((await st(6)) !== level) { await page.keyboard.up(key); return false; } }
    await page.keyboard.up(key); return false;
  }
  const killed = (await tryDie("ArrowLeft", 16)) || (await tryDie("ArrowRight", 16));
  if (!killed) { console.log(`[${ep}] could not induce a death at L${level}`); await browser.close(); process.exit(2); }
  console.log(`[${ep}] died: keenkilled=${await st(8)} x=${await st(1)}`);

  await page.keyboard.down("Backspace");
  let kkMin = 1;
  for (let i = 0; i < 50; i++) { await sleep(100); kkMin = Math.min(kkMin, await st(8)); }
  await page.keyboard.up("Backspace");
  await sleep(200);

  const kkNow = await st(8), ox0 = await st(3);
  let oxMoved = ox0;
  for (const d of ["ArrowRight", "ArrowLeft"]) {
    await page.keyboard.down(d);
    for (let i = 0; i < 16; i++) { await sleep(100); const ox = await st(3); if (ox !== ox0) oxMoved = ox; }
    await page.keyboard.up(d);
    if (oxMoved !== ox0) break; await sleep(150);
  }
  const ok = kkMin === 0 && kkNow === 0 && oxMoved !== ox0 && errors.length === 0;
  console.log(`[${ep}] after rewind: keenkilled=${kkNow} kkMin=${kkMin} scroll ${ox0}->${oxMoved} errors=${errors.length}`);
  console.log(`[${ep}] RESULT: ${ok ? "DEATH→REWIND→SCROLL IN BROWSER ✅" : "⚠️ needs review"}`);
  await browser.close();
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.log(`[${ep}] FAILED: ${e.message}`, errors.slice(0, 3));
  await browser.close();
  process.exit(2);
}
