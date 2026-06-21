/* Real-browser verification of the rewind feature wired through the shell.
   Loads the page, starts a game, warps into level 1, walks right, then HOLDS
   Backspace and confirms Keen's x winds back (state restored frame-by-frame),
   with the canvas still rendering and no page errors.
   Usage: node web/test/verify-rewind-browser.mjs [ck4|ck5|ck6]  (dev on :5173) */
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

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForSelector(`.episode[data-id=${ep}]`, { timeout: 8000 });
  await page.click(`.episode[data-id=${ep}]`);
  await page.waitForFunction(() => window.__keenEngine?.ready === true, { timeout: 30000 });
  await page.click("#screen", { position: { x: 60, y: 60 } }).catch(() => {});

  let ingame = 0;
  for (let i = 0; i < 50 && !ingame; i++) {
    const k = i < 12 ? "Space" : "Enter";
    await page.keyboard.down(k); await sleep(50); await page.keyboard.up(k);
    await sleep(120); ingame = await st(0);
  }
  if (!ingame) throw new Error("never reached in-game");

  await page.evaluate(() => window.__keenEngine.warp(1));
  let mapon = 0;
  for (let i = 0; i < 60; i++) { mapon = await st(6); if (mapon === 1 && (await st(0)) === 1) break; await sleep(80); }
  if (mapon !== 1) throw new Error("warp failed mapon=" + mapon);
  await sleep(500);

  // walk right, then hold the rewind key (Backspace)
  const xEnter = await st(1);
  await page.keyboard.down("ArrowRight"); await sleep(1300); await page.keyboard.up("ArrowRight");
  await sleep(150);
  const xBefore = await st(1);

  await page.keyboard.down("Backspace");
  let xMin = xBefore;
  for (let i = 0; i < 30; i++) { await sleep(100); xMin = Math.min(xMin, await st(1)); }
  await page.keyboard.up("Backspace");
  const xAfter = await st(1);

  const nonBlank = await page.evaluate(() => {
    const c = document.getElementById("screen");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let nz = 0; for (let i = 0; i < d.length; i += 4) if (d[i] || d[i + 1] || d[i + 2]) nz++;
    return nz;
  });
  await page.screenshot({ path: `/tmp/${ep}_rewind.png` });

  const walked = xBefore > xEnter + 16;
  const rewound = xMin < xBefore - 16;
  const ok = mapon === 1 && walked && rewound && nonBlank > 2000 && errors.length === 0;
  console.log(`[${ep}] enterX=${xEnter} walkedTo=${xBefore} rewoundMin=${xMin} after=${xAfter} canvasPx=${nonBlank}`);
  console.log(`[${ep}] walked=${walked} rewound=${rewound} errors=${errors.length}`);
  console.log(`[${ep}] RESULT: ${ok ? "REWIND IN BROWSER ✅" : "⚠️ needs review"}`);
  if (errors.length) console.log(`[${ep}] errors: ${errors.slice(0, 4).join(" | ")}`);
  await browser.close();
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.log(`[${ep}] FAILED: ${e.message}`, errors.slice(0, 3));
  await page.screenshot({ path: `/tmp/${ep}_rewind_fail.png` }).catch(() => {});
  await browser.close();
  process.exit(2);
}
