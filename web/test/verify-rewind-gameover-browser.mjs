/* Real-browser test: rewind FROM a Game Over. Sets lives to 0, induces a death
   (= game over), then holds Backspace and confirms it does NOT hang (the CK5
   galaxy game-over had a busy-wait) and that the game rewinds, resumes, and Keen
   can move. Usage: node web/test/verify-rewind-gameover-browser.mjs [ck4|ck5|ck6] [level] */
import { chromium } from "playwright";

const URL = process.env.CK_URL || "http://localhost:5173/";
const ep = process.argv[2] || "ck5";
const level = +(process.argv[3] || 2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console:" + m.text()); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (w) => page.evaluate((w) => window.__keenEngine?.state(w) ?? -9, w);
const setlives = (n) => page.evaluate((n) => window.__keenEngine?.m?._CKWEB_SetLives(n), n);

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
  await setlives(0);

  async function tryDie(key, secs) {
    await page.keyboard.down(key);
    for (let i = 0; i < secs * 5; i++) { await sleep(200); if ((await st(8)) === 1) { await page.keyboard.up(key); return true; } if ((await st(6)) !== level) { await page.keyboard.up(key); return false; } }
    await page.keyboard.up(key); return false;
  }
  const killed = (await tryDie("ArrowRight", 16)) || (await tryDie("ArrowLeft", 16));
  if (!killed) { console.log(`[${ep}] could not induce a death`); await browser.close(); process.exit(2); }

  // reach the Game Over screen (ingame=0 & lives<0) — must NOT hang (busy-wait fix)
  let atGO = false;
  for (let i = 0; i < 100; i++) { await sleep(100); if ((await st(0)) === 0 && (await st(9)) < 0) { atGO = true; break; } }
  console.log(`[${ep}] game over reached=${atGO} (ingame=${await st(0)} lives=${await st(9)})`);

  // hold rewind: skips the galaxy via LastScan, then winds the death back
  await page.keyboard.down("Backspace");
  let kkMin = 1;
  for (let i = 0; i < 80; i++) { await sleep(100); kkMin = Math.min(kkMin, await st(8)); if (kkMin === 0) break; }
  await page.keyboard.up("Backspace");
  for (let i = 0; i < 25 && (await st(0)) !== 1; i++) await sleep(100);
  await sleep(300);

  let moved = false;
  for (const d of ["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"]) {
    const bx = await st(1), by = await st(2);
    await page.keyboard.down(d);
    for (let i = 0; i < 14; i++) { await sleep(100); if ((await st(1)) !== bx || (await st(2)) !== by) moved = true; }
    await page.keyboard.up(d);
    if (moved) break; await sleep(120);
  }
  const ok = atGO && kkMin === 0 && moved && errors.length === 0;
  console.log(`[${ep}] gameOver=${atGO} rewound=${kkMin === 0} keenMoved=${moved} errors=${errors.length}`);
  console.log(`[${ep}] RESULT: ${ok ? "GAME-OVER REWIND IN BROWSER ✅ (no hang)" : "⚠️ needs review"}`);
  await browser.close();
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.log(`[${ep}] FAILED: ${e.message}`);
  await browser.close();
  process.exit(2);
}
