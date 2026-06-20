/* Capture glitch repro screenshots: world map + Keen walking in a level.
   Usage: node glitch-shot.mjs [ck4] [tag]   (dev server URL via CK_URL) */
import { chromium } from "playwright";

const URL = process.env.CK_URL || "http://localhost:5174/";
const ep = process.argv[2] || "ck4";
const tag = process.argv[3] || "before";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
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

  // title -> New Game -> difficulty until in-game (world map)
  let ingame = 0;
  for (let i = 0; i < 50 && !ingame; i++) {
    await press(i < 12 ? "Space" : "Enter");
    await sleep(120);
    ingame = await st(0);
  }
  console.log(`[${ep}] in-game=${ingame} mapon=${await st(6)}`);

  // let the world map settle and animate a couple seconds, then shoot
  await sleep(1500);
  await page.screenshot({ path: `/tmp/glitch_${ep}_${tag}_worldmap.png` });

  // nudge Keen on the world map to trigger sprite shift
  await page.keyboard.down("ArrowRight"); await sleep(500); await page.keyboard.up("ArrowRight");
  await sleep(300);
  await page.screenshot({ path: `/tmp/glitch_${ep}_${tag}_worldmap2.png` });

  // warp into a level
  await page.evaluate(() => window.__keenEngine.warp(1));
  for (let i = 0; i < 60; i++) { if ((await st(6)) === 1 && (await st(0)) === 1) break; await sleep(80); }
  await sleep(500);
  await page.screenshot({ path: `/tmp/glitch_${ep}_${tag}_level0.png` });

  // walk right and grab several frames mid-stride (catches bad sub-pixel shifts)
  await page.keyboard.down("ArrowRight");
  for (let f = 0; f < 6; f++) { await sleep(150); await page.screenshot({ path: `/tmp/glitch_${ep}_${tag}_walk${f}.png` }); }
  await page.keyboard.up("ArrowRight");

  console.log(`[${ep}] shots saved /tmp/glitch_${ep}_${tag}_*.png  errors=${errors.length}`);
  if (errors.length) console.log(errors.slice(0, 4).join(" | "));
  await browser.close();
} catch (e) {
  console.log(`[${ep}] FAILED: ${e.message}`);
  await page.screenshot({ path: `/tmp/glitch_${ep}_${tag}_FAIL.png` }).catch(() => {});
  await browser.close();
  process.exit(2);
}
