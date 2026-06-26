/* Verifies the ⚙ gallery's live preview tiles actually render.
   Drives into a level, opens the shader panel, then for each preset tile reads
   back its <canvas> and confirms it's non-empty (the game frame rendered through
   that shader). Also checks the CRT tiles differ from the original tile.
   Usage: node verify-thumbnails.mjs [ck4|ck5|ck6]   (dev server on :5173) */
import { chromium } from "playwright";

const URL = process.env.CK_URL || "http://localhost:5173/";
const ep = process.argv[2] || "ck4";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 640 } });
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
  await page.waitForFunction(() => window.__keenEngine?.ready === true, { timeout: 30000 });
  await page.click("#screen", { position: { x: 60, y: 60 } }).catch(() => {});

  let ingame = 0;
  for (let i = 0; i < 50 && !ingame; i++) { await press(i < 12 ? "Space" : "Enter"); await sleep(120); ingame = await st(0); }
  if (!ingame) throw new Error("never reached in-game");
  await page.evaluate(() => window.__keenEngine.warp(1));
  for (let i = 0; i < 60; i++) { if ((await st(6)) === 1 && (await st(0)) === 1) break; await sleep(80); }
  await sleep(600); // let a few frames present so snapshotFrame() has content

  // Open the gallery (⚙) — this triggers renderThumbnails().
  await page.click('button[title="表示設定"]');
  await sleep(500);

  const tiles = await page.evaluate(() => {
    const panel = document.getElementById("shader-panel");
    if (!panel) return null;
    return Array.from(panel.querySelectorAll("canvas")).map((c) => {
      const ctx = c.getContext("2d");
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let nonblack = 0, sum = 0;
      for (let i = 0; i < d.length; i += 4) {
        const lum = d[i] + d[i + 1] + d[i + 2];
        if (lum > 12) nonblack++;
        sum += lum;
      }
      const px = d.length / 4;
      return {
        shader: c.parentElement.dataset.shader || "(original)",
        w: c.width, h: c.height,
        nonblackPct: Math.round((100 * nonblack) / px),
        avg: Math.round(sum / px),
      };
    });
  });

  if (!tiles) throw new Error("shader panel not found");
  await page.locator("#shader-panel").screenshot({ path: `/tmp/${ep}_thumbnails.png` });

  console.log(`[${ep}] preview tiles: ${tiles.length}`);
  for (const t of tiles) {
    console.log(`[${ep}]  ${t.shader.padEnd(18)} ${t.w}x${t.h}  nonblack=${t.nonblackPct}%  avg=${t.avg}`);
  }

  const allRendered = tiles.length === 7 && tiles.every((t) => t.nonblackPct >= 5);
  // CRT/scanline tiles should look different from the plain "original" tile.
  const orig = tiles[0];
  const distinct = tiles.slice(1).filter((t) => Math.abs(t.avg - orig.avg) >= 2 || t.nonblackPct !== orig.nonblackPct).length;
  console.log(`[${ep}] rendered=${allRendered} distinctFromOriginal=${distinct}/${tiles.length - 1}`);
  console.log(`[${ep}] RESULT: ${allRendered && distinct >= 4 ? "THUMBNAILS OK ✅" : "⚠️ needs review"}`);
  console.log(`[${ep}] page errors: ${errors.length ? errors.slice(0, 6).join(" | ") : "none"}`);

  await browser.close();
  process.exit(allRendered && distinct >= 4 && errors.length === 0 ? 0 : 1);
} catch (e) {
  console.log(`[${ep}] FAILED: ${e.message}`);
  console.log("errors:", errors.slice(0, 6));
  await page.screenshot({ path: `/tmp/${ep}_thumbnails_fail.png` }).catch(() => {});
  await browser.close();
  process.exit(2);
}
