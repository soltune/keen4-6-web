/* Verifies persistent storage: the engine writes CONFIG/SAVEGAM to the IDBFS
   /save mount, and those files survive a page reload (same as DOS saving to
   disk). Drives the real engine write path (CKWEB_FlushConfig -> USL_WriteConfig
   -> /save/CONFIG.* -> syncfs) then reloads and checks the file is still there.
   Run: node web/verify-wasm-persist.mjs [ck4|ck5|ck6]   (dev server up) */
import { chromium } from "playwright";

const URL = process.env.CK_URL || "http://localhost:5173/";
const ep = process.argv[2] || "ck4";
const cfg = "CONFIG." + ep.toUpperCase(); // e.g. CONFIG.CK4
const browser = await chromium.launch();
const ctx = await browser.newContext(); // one context => IndexedDB survives reload
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = () => page.waitForFunction(() => window.__keenEngine?.ready === true, { timeout: 30000 });
const files = () => page.evaluate(() => window.__keenEngine?.savedFiles?.() ?? []);

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.click(`.episode[data-id=${ep}]`);
  await ready();
  await sleep(3500); // let main() reach US_Startup so US_Started === true

  // Engine writes options + high scores to /save/CONFIG.<ep>, then syncfs(false).
  await page.evaluate(() => window.__keenEngine.flushConfig());
  await sleep(800); // let the async IndexedDB write settle
  const before = await files();
  console.log(`[${ep}] /save after write: [${before.join(", ")}]`);
  if (!before.includes(cfg)) throw new Error(`engine did not write ${cfg} to /save`);

  // Reload: a fresh module instance must repopulate /save from IndexedDB.
  await page.reload({ waitUntil: "networkidle" });
  await page.click(`.episode[data-id=${ep}]`).catch(() => {});
  await ready();
  await sleep(1500);
  const after = await files();
  console.log(`[${ep}] /save after reload: [${after.join(", ")}]`);

  const ok = after.includes(cfg);
  console.log(`[${ep}] RESULT: ${ok ? "PERSISTS ACROSS RELOAD ✅" : "✗ lost on reload"}`);
  console.log(`[${ep}] page errors: ${errors.length ? errors.slice(0, 3).join(" | ") : "none"}`);
  await browser.close();
  process.exit(ok && errors.length === 0 ? 0 : 1);
} catch (e) {
  console.log(`[${ep}] FAILED: ${e.message}`);
  await browser.close();
  process.exit(2);
}
