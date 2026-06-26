/* Verifies the aspect control moved from the HUD (▣) into the ⚙ display-settings
   panel as a 4:3 / 等倍 segmented control: the ▣ button is gone, the HUD has 3
   buttons, and the segments switch + persist the aspect mode.
   Usage: node verify-aspect-panel.mjs [ck4|ck5|ck6]   (dev server on :5173) */
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
const aspect = () => page.evaluate(() => window.__keenDisplay.aspectMode);
const persisted = () => page.evaluate(() => JSON.parse(localStorage.getItem("keen4-6-web:settings") || "{}").aspectMode);

const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`[${ep}] ${ok ? "OK " : "FAIL"} ${name} — ${detail}`); };

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

  // HUD: ▣ gone, 3 buttons left.
  const hud = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("#hud button"));
    return { count: btns.length, labels: btns.map((b) => b.textContent) };
  });
  check("HUD no ▣", !hud.labels.includes("▣"), `labels=${JSON.stringify(hud.labels)}`);
  check("HUD has 3 buttons", hud.count === 3, `count=${hud.count}`);

  // Open ⚙ panel; segmented control present.
  await page.click('button[title="表示設定"]'); await sleep(300);
  const segs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#shader-panel button[data-aspect]')).map((b) => b.dataset.aspect));
  check("aspect segments present", segs.includes("4:3") && segs.includes("pixel"), `segs=${JSON.stringify(segs)}`);

  // Click 等倍 (pixel) -> mode + persistence flip; then back to 4:3.
  await page.click('#shader-panel button[data-aspect="pixel"]'); await sleep(200);
  check("switch to pixel", (await aspect()) === "pixel" && (await persisted()) === "pixel", `aspect=${await aspect()} persist=${await persisted()}`);
  await page.click('#shader-panel button[data-aspect="4:3"]'); await sleep(200);
  check("switch back to 4:3", (await aspect()) === "4:3" && (await persisted()) === "4:3", `aspect=${await aspect()} persist=${await persisted()}`);

  await page.locator("#shader-panel").screenshot({ path: `/tmp/${ep}_aspect_panel.png` });
  await page.screenshot({ path: `/tmp/${ep}_aspect_hud.png` });

  const allOk = results.every(Boolean) && errors.length === 0;
  console.log(`[${ep}] RESULT: ${allOk ? "ASPECT PANEL OK ✅" : "⚠️ needs review"}`);
  console.log(`[${ep}] page errors: ${errors.length ? errors.slice(0, 6).join(" | ") : "none"}`);
  await browser.close();
  process.exit(allOk ? 0 : 1);
} catch (e) {
  console.log(`[${ep}] FAILED: ${e.message}`);
  console.log("errors:", errors.slice(0, 6));
  await page.screenshot({ path: `/tmp/${ep}_aspect_fail.png` }).catch(() => {});
  await browser.close();
  process.exit(2);
}
