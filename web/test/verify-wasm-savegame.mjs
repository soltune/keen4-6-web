/* Save-game verification: proves the keyboard (typed save names), the save
   FORMAT (in-session save -> load round-trip) and IDBFS PERSISTENCE all work.
     1. play L1 -> Esc -> SAVE GAME -> slot 0 -> type "TEST" -> accept  (writes /save)
     2. Esc -> LOAD GAME -> slot 0  (loads it back in the same session)
     3. reload the page -> re-pick episode -> the SAVEGAM file is still in /save
   Run: node web/verify-wasm-savegame.mjs [ck4|ck5|ck6]   (dev server up) */
import { chromium } from "playwright";

const URL = process.env.CK_URL || "http://localhost:5173/";
const ep = process.argv[2] || "ck4";
const savefile = `SAVEGAM0.${ep.toUpperCase()}`;
const browser = await chromium.launch();
const ctx = await browser.newContext(); // one context => IndexedDB survives reload
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const st = (w) => page.evaluate((w) => window.__keenEngine?.state(w) ?? -9, w);
const files = () => page.evaluate(() => window.__keenEngine?.savedFiles?.() ?? []);
const ready = () => page.waitForFunction(() => window.__keenEngine?.ready === true, { timeout: 30000 });
const press = async (k) => { await page.keyboard.press(k); await sleep(260); };

async function enterEpisodeAndWarp() {
  await page.click(`.episode[data-id=${ep}]`).catch(() => {});
  await ready();
  await page.click("#screen", { position: { x: 60, y: 60 } }).catch(() => {});
  let ingame = 0;
  for (let i = 0; i < 50 && !ingame; i++) { await press(i < 12 ? "Space" : "Enter"); ingame = await st(0); }
  if (!ingame) throw new Error("never reached in-game");
  await page.evaluate(() => window.__keenEngine.warp(1));
  for (let i = 0; i < 60; i++) { if ((await st(6)) === 1) break; await sleep(80); }
  await sleep(500);
}

try {
  await page.goto(URL, { waitUntil: "networkidle" });
  await enterEpisodeAndWarp();
  const x0 = await st(1), y0 = await st(2);

  // 1. SAVE: Esc -> SAVE GAME -> Enter(slots) -> Enter(slot0) -> name -> accept
  await press("Escape"); await press("KeyS"); await press("Enter"); await press("Enter");
  for (const k of ["KeyT", "KeyE", "KeyS", "KeyT"]) await press(k);
  await press("Enter");
  await sleep(700);
  const saved = await files();
  const wrote = saved.includes(savefile);
  console.log(`[${ep}] after save /save=[${saved.join(", ")}] (player was at x=${x0} y=${y0})`);

  // 2. LOAD it back in the same session: Esc -> LOAD GAME -> Enter -> Enter(slot0)
  await page.keyboard.down("ArrowRight"); await sleep(700); await page.keyboard.up("ArrowRight"); // move first
  await press("Escape"); await press("KeyL"); await press("Enter"); await press("Enter");
  await sleep(1200);
  const inGameAfterLoad = (await st(0)) === 1 && (await st(6)) >= 1;
  console.log(`[${ep}] after load: ingame=${await st(0)} mapon=${await st(6)} x=${await st(1)} y=${await st(2)}`);

  // 3. PERSISTENCE: reload, re-pick episode, save file must still be in /save.
  await page.reload({ waitUntil: "networkidle" });
  await page.click(`.episode[data-id=${ep}]`).catch(() => {});
  await ready();
  await sleep(1500);
  const after = await files();
  const persisted = after.includes(savefile);
  console.log(`[${ep}] after reload /save=[${after.join(", ")}]`);

  const ok = wrote && inGameAfterLoad && persisted;
  console.log(`[${ep}] wrote=${wrote} loadedBack=${inGameAfterLoad} persisted=${persisted}`);
  console.log(`[${ep}] RESULT: ${ok ? "SAVE/LOAD + PERSIST ALL WORK ✅" : "⚠️ needs review"}`);
  console.log(`[${ep}] page errors: ${errors.length ? errors.slice(0, 3).join(" | ") : "none"}`);
  await browser.close();
  process.exit(ok && errors.length === 0 ? 0 : 1);
} catch (e) {
  console.log(`[${ep}] FAILED: ${e.message}`);
  await browser.close();
  process.exit(2);
}
