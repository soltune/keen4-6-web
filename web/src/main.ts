/* ===========================================================================
   Shell entry point. Boots the native (wasm) Commander Keen 4-6 engine and
   wires it to the browser: framebuffer -> canvas, keyboard/gamepad/virtual-pad
   -> DOS scancodes, FM audio out, plus the surrounding UI (episode selector,
   fullscreen, aspect toggle, on-screen pad).

   The engine runs itself (DOS main() under ASYNCIFY); we only present frames
   and feed input — see engine/wasmEngine.ts.
   =========================================================================== */

import { Display } from "./display";
import { VirtualPad } from "./ui/virtualpad";
import { chooseEpisode } from "./ui/selector";
import { WasmEngine } from "./engine/wasmEngine";
import { InputBridge } from "./input";
import { loadSettings, saveSettings } from "./storage";

const stage = document.getElementById("stage") as HTMLElement;
const screen = document.getElementById("screen") as HTMLCanvasElement;
const vpadRoot = document.getElementById("virtualpad") as HTMLElement;

const settings = loadSettings();
const display = new Display(screen, stage);
display.setAspectMode(settings.aspectMode === "pixel" ? "pixel" : "4:3");
const engine = new WasmEngine();
(window as unknown as { __keenEngine: WasmEngine }).__keenEngine = engine; // for verification

// One bridge merges gamepad + on-screen pad into the engine's scancode input.
const input = new InputBridge((code, down) => engine.setKey(code, down));
input.onGamepadChange = (count) => { if (count > 0) toast("🎮 ゲームパッド接続"); };

buildHud();
wireGlobalGestures();

main();

async function main(): Promise<void> {
  const ep = await chooseEpisode(settings.lastEpisode);
  saveSettings({ lastEpisode: ep.id });

  // Virtual pad (touch) shares the same logical-button bridge as the gamepad.
  const vpad = new VirtualPad(vpadRoot, input);
  document.getElementById("vp-toggle")?.addEventListener("click", () => vpad.toggle());

  try {
    await engine.load(String(ep.number));
  } catch (err) {
    console.error(err);
    toast("エンジンの読み込みに失敗しました");
    return;
  }
  engine.start();
  void engine.resumeAudio(); // the episode-selector click is a user gesture
  toast("Space で開始 / ←→ 移動 / Ctrl ジャンプ / Alt ポゴ / Space 発射");

  runLoop();
}

function runLoop(): void {
  const frame = (): void => {
    input.poll();
    const f = engine.frame();
    if (f) display.drawRGBA(f);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// --- HUD --------------------------------------------------------------------
function buildHud(): void {
  const hud = document.createElement("div");
  hud.id = "hud";

  const fs = hudButton("⛶", "フルスクリーン (F)", () => void display.toggleFullscreen());
  const ar = hudButton("▣", "アスペクト比 切替", () => {
    const next = settings.aspectMode === "pixel" ? "4:3" : "pixel";
    settings.aspectMode = next;
    display.setAspectMode(next);
    saveSettings({ aspectMode: next });
    toast(next === "4:3" ? "アスペクト比: 4:3" : "アスペクト比: ピクセル等倍");
  });
  const vp = hudButton("🎮", "バーチャルパッド 切替", () => {});
  vp.id = "vp-toggle";

  hud.append(fs, ar, vp);
  document.body.appendChild(hud);
}

function hudButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "hud-btn";
  b.type = "button";
  b.textContent = label;
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

// --- Global gestures --------------------------------------------------------
function wireGlobalGestures(): void {
  const resumeOnce = () => void engine.resumeAudio();
  window.addEventListener("pointerdown", resumeOnce);
  window.addEventListener("keydown", resumeOnce, { once: true });
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyF" && !e.repeat) void display.toggleFullscreen();
  });
}

// --- Tiny toast -------------------------------------------------------------
let toastEl: HTMLDivElement | null = null;
let toastTimer = 0;
function toast(msg: string): void {
  if (!toastEl) {
    toastEl = document.createElement("div");
    Object.assign(toastEl.style, {
      position: "fixed", left: "50%", bottom: "24px", transform: "translateX(-50%)",
      background: "rgba(17,19,29,0.92)", color: "#e8ecff", border: "1px solid #2a2f45",
      borderRadius: "10px", padding: "8px 14px", font: "12px ui-monospace, monospace",
      zIndex: "30", pointerEvents: "none", transition: "opacity 0.2s",
    } satisfies Partial<CSSStyleDeclaration>);
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.style.opacity = "1";
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (toastEl) toastEl.style.opacity = "0";
  }, 2600);
}
