/* Verifies integer scaling: when enabled, the displayed canvas snaps to a whole
   multiple of the 320x200 source (even scanlines / uniform pixels); when off it
   fills the letterbox. Also checks the ⚙-panel pill toggles + persists the
   setting. Usage: node verify-integer-scale.mjs [ck4|ck5|ck6]   (dev on :5173) */
import { chromium } from "playwright";

const URL = process.env.CK_URL || "http://localhost:5173/";
const ep = process.argv[2] || "ck4";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console:" + m.text()); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (w) => page.evaluate((w) => window.__keenEngine?.state(w) ?? -9, w);
const press = async (key) => { await page.keyboard.down(key); await sleep(60); await page.keyboard.up(key); };
const rect = () => page.evaluate(() => {
  const r = document.getElementById("screen").getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
const set = (aspect, integer) => page.evaluate(({ aspect, integer }) => {
  window.__keenDisplay.setAspectMode(aspect);
  window.__keenDisplay.setIntegerScale(integer);
  return { aspect, integer, enabled: window.__keenDisplay.integerScaleEnabled };
}, { aspect, integer });

const results = [];
const check = (name, cond, detail) => { results.push({ name, ok: cond, detail }); console.log(`[${ep}] ${cond ? "OK " : "FAIL"} ${name} — ${detail}`); };

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
  await sleep(400);

  // 4:3 + integer ON -> height a whole multiple of 200.
  await set("4:3", true); await sleep(150);
  let r = await rect();
  check("4:3 integer: height % 200 == 0", r.h % 200 === 0 && r.h >= 200, `${r.w}x${r.h}`);
  await page.screenshot({ path: `/tmp/${ep}_intscale_43_on.png` });

  // pixel + integer ON -> width %320 and height %200.
  await set("pixel", true); await sleep(150);
  r = await rect();
  check("pixel integer: w%320 && h%200", r.w % 320 === 0 && r.h % 200 === 0, `${r.w}x${r.h}`);
  await page.screenshot({ path: `/tmp/${ep}_intscale_px_on.png` });

  // pixel + integer OFF -> fills a container dimension (not forced to a multiple).
  await set("pixel", false); await sleep(150);
  const rOff = await rect();
  check("pixel off: larger than integer fit", rOff.w >= r.w, `off=${rOff.w}x${rOff.h} vs on=${r.w}x${r.h}`);
  await page.screenshot({ path: `/tmp/${ep}_intscale_px_off.png` });

  // UI pill: open ⚙, toggle, confirm display + persisted setting flip.
  await set("4:3", false); await sleep(100);
  await page.click('button[title="表示設定"]'); await sleep(300);
  const pill = 'button[data-role="intscale"]';
  const before = await page.evaluate(() => window.__keenDisplay.integerScaleEnabled);
  await page.click(pill); await sleep(200);
  const after = await page.evaluate(() => window.__keenDisplay.integerScaleEnabled);
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("keen4-6-web:settings") || "{}").integerScale);
  const labelText = await page.$eval(pill, (b) => b.textContent);
  check("pill toggles enabled state", before === false && after === true, `${before} -> ${after}`);
  check("pill persists setting", persisted === true, `localStorage.integerScale=${persisted}`);
  check("pill label reflects ON", labelText.trim() === "ON", `label="${labelText.trim()}"`);
  await page.locator("#shader-panel").screenshot({ path: `/tmp/${ep}_intscale_panel.png` });

  const allOk = results.every((x) => x.ok) && errors.length === 0;
  console.log(`[${ep}] RESULT: ${allOk ? "INTEGER SCALE OK ✅" : "⚠️ needs review"}`);
  console.log(`[${ep}] page errors: ${errors.length ? errors.slice(0, 6).join(" | ") : "none"}`);
  await browser.close();
  process.exit(allOk ? 0 : 1);
} catch (e) {
  console.log(`[${ep}] FAILED: ${e.message}`);
  console.log("errors:", errors.slice(0, 6));
  await page.screenshot({ path: `/tmp/${ep}_intscale_fail.png` }).catch(() => {});
  await browser.close();
  process.exit(2);
}
