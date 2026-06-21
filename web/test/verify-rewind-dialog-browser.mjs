/* Real-browser test: rewind FROM the "Try Again / Exit" death dialog. Induce a
   death, WAIT (no key) for the dialog to appear, then hold Backspace and confirm
   it winds the death back and the game resumes & scrolls.
   Usage: node web/test/verify-rewind-dialog-browser.mjs [ck4|ck5|ck6] [level]  (dev :5173) */
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

  // WAIT (no key) for the dying animation to finish + the dialog to appear
  for (let i = 0; i < 30; i++) await sleep(200);
  const atKk = await st(8), atIngame = await st(0), atMapon = await st(6);
  console.log(`[${ep}] at dialog: keenkilled=${atKk} ingame=${atIngame} mapon=${atMapon}`);

  // hold rewind FROM the dialog
  await page.keyboard.down("Backspace");
  let kkMin = 1;
  for (let i = 0; i < 60; i++) { await sleep(100); kkMin = Math.min(kkMin, await st(8)); }
  await page.keyboard.up("Backspace");
  await sleep(300);

  const kkNow = await st(8), ox0 = await st(3);
  let oxMoved = ox0;
  for (const d of ["ArrowRight", "ArrowLeft"]) {
    await page.keyboard.down(d);
    for (let i = 0; i < 16; i++) { await sleep(100); const ox = await st(3); if (ox !== ox0) oxMoved = ox; }
    await page.keyboard.up(d);
    if (oxMoved !== ox0) break; await sleep(150);
  }
  const reachedDialog = atKk === 1 && atIngame === 0 && atMapon === level;
  const ok = reachedDialog && kkMin === 0 && kkNow === 0 && oxMoved !== ox0 && errors.length === 0;
  console.log(`[${ep}] reachedDialog=${reachedDialog} rewound=${kkMin === 0} resumed&scroll=${kkNow === 0 && oxMoved !== ox0} (ox ${ox0}->${oxMoved}) errors=${errors.length}`);
  console.log(`[${ep}] RESULT: ${ok ? "REWIND FROM DEATH DIALOG IN BROWSER ✅" : "⚠️ needs review"}`);
  await browser.close();
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.log(`[${ep}] FAILED: ${e.message}`, errors.slice(0, 3));
  await browser.close();
  process.exit(2);
}
