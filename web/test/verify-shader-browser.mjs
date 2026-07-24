/* Real-browser verification of the WebGL2 shader path.
   Loads the page, drives into a level, then cycles every registered shader
   preset and confirms for each: it activates (no silent fallback to 2D) and the
   rendered canvas changes vs the plain path — with no page/console errors.
   Then chains preset→preset switches WITHOUT resetting to Original in between
   (same GL context, pipeline swap): state leaking across pipelines fails draws
   with a WebGL INVALID_* console warning and a black canvas, which the per-
   preset loop above can't see because it returns to baseline each time.
   Saves a screenshot per preset.
   Usage: node verify-shader-browser.mjs [ck4|ck5|ck6]   (dev server on :5173) */
import { chromium } from "playwright";

const URL = process.env.CK_URL || "http://localhost:5173/";
const ep = process.argv[2] || "ck4";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console:" + m.text());
  // GL draw/state failures surface as warnings (e.g. "WebGL: INVALID_OPERATION:
  // drawArrays: ..."); driver *performance* notes (GPU stall etc.) are noise.
  if (m.type() === "warning" && /WebGL: INVALID_/.test(m.text())) errors.push("console:" + m.text());
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (w) => page.evaluate((w) => window.__keenEngine?.state(w) ?? -9, w);
const press = async (key) => { await page.keyboard.down(key); await sleep(60); await page.keyboard.up(key); };
const shot = () => page.locator("#screen").screenshot();
const setShader = (id) => page.evaluate((id) => { window.__keenDisplay.setShader(id); return window.__keenDisplay.shader; }, id);

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
  await sleep(500);

  const supported = await page.evaluate(() => window.__keenDisplay?.shaderSupported === true);
  const presets = await page.evaluate(() => window.__keenDisplay.availableShaders().filter((id) => id !== "passthrough"));
  console.log(`[${ep}] WebGL2 supported: ${supported} | presets: ${presets.join(", ")}`);

  // Baseline (plain 2D path).
  await setShader(null);
  await sleep(250);
  const before = await shot();
  await page.screenshot({ path: `/tmp/${ep}_shader_off.png` });

  const results = [];
  for (const id of presets) {
    const applied = await setShader(id);
    await sleep(350);
    const after = await shot();
    await page.screenshot({ path: `/tmp/${ep}_shader_${id}.png` });
    const activated = applied === id;
    const changed = !before.equals(after);
    results.push({ id, activated, changed, bytes: after.length });
    console.log(`[${ep}]  ${id}: activated=${activated} changed=${changed} bytes=${after.length}`);
    await setShader(null); // back to baseline between presets
    await sleep(150);
  }

  // Direct preset→preset chain (no Original in between; ends on a wrap-around
  // to the first preset so a multi→single edge is always covered). Consecutive
  // steps must differ — two black frames in a row compare equal and fail.
  let chainOk = true;
  if (supported && presets.length > 1) {
    let prev = await shot();
    for (const id of [...presets, presets[0]]) {
      const applied = await setShader(id);
      await sleep(350);
      const cur = await shot();
      const ok = applied === id && !prev.equals(cur);
      if (!ok) { chainOk = false; console.log(`[${ep}]  chain ->${id}: activated=${applied === id} changed=${!prev.equals(cur)} ⚠️`); }
      prev = cur;
    }
    console.log(`[${ep}] direct-switch chain: ${chainOk ? "OK" : "⚠️ FAILED"}`);
    await setShader(null);
  }

  const allOk = (supported ? results.every((r) => r.activated && r.changed) : true) && chainOk;
  if (!supported) console.log(`[${ep}] NOTE: WebGL2 unavailable; shader path falls back to 2D (some headless setups).`);
  console.log(`[${ep}] RESULT: ${allOk ? "ALL SHADER PRESETS OK ✅" : "⚠️ needs review"}`);
  console.log(`[${ep}] page errors: ${errors.length ? errors.slice(0, 6).join(" | ") : "none"}`);
  await browser.close();
  process.exit(allOk && errors.length === 0 ? 0 : 1);
} catch (e) {
  console.log(`[${ep}] FAILED: ${e.message}`);
  console.log("errors:", errors.slice(0, 6));
  await page.screenshot({ path: `/tmp/${ep}_shader_fail.png` }).catch(() => {});
  await browser.close();
  process.exit(2);
}
