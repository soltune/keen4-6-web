/* ===========================================================================
   Shell entry point. Boots the native (wasm) Commander Keen 4-6 engine and
   wires it to the browser: framebuffer -> canvas, keyboard/gamepad/virtual-pad
   -> DOS scancodes, FM audio out, plus the surrounding UI (episode selector,
   fullscreen, aspect toggle, on-screen pad).

   The engine runs itself (DOS main() under ASYNCIFY); we only present frames
   and feed input — see engine/wasmEngine.ts.
   =========================================================================== */

import { Display, type AspectMode } from "./display";
import { VirtualPad } from "./ui/virtualpad";
import { chooseEpisode } from "./ui/selector";
import { KeybindPanel } from "./ui/keybind";
import { WasmEngine } from "./engine/wasmEngine";
import { InputBridge } from "./input";
import { sanitizeKeymap, type Keymap } from "./keymap";
import { loadSettings, saveSettings } from "./storage";
import { SHADER_PRESETS } from "./gfx/shaders";
import { ShaderThumbnailer, type ThumbItem } from "./gfx/thumbnails";

const stage = document.getElementById("stage") as HTMLElement;
const screen = document.getElementById("screen") as HTMLCanvasElement;
const vpadRoot = document.getElementById("virtualpad") as HTMLElement;

let shaderPanel: HTMLDivElement | null = null; // ⚙ gallery; built in buildHud()
let shaderTiles: ThumbItem[] = []; // preset id -> its thumbnail <canvas> (WebGL2 path)
let thumbnailer: ShaderThumbnailer | null = null; // lazy; null until first panel open
let thumbnailerDead = false; // set if construction failed, so we stop retrying
let keybindPanel: KeybindPanel | null = null; // ⌨ key-bindings panel; built in buildHud()

const settings = loadSettings();
const display = new Display(screen, stage);
display.setAspectMode(settings.aspectMode === "pixel" ? "pixel" : "4:3");
display.setShader(settings.shaderId ?? null); // falls back to 2D if unsupported
display.setIntegerScale(settings.integerScale ?? false);
(window as unknown as { __keenDisplay: Display }).__keenDisplay = display; // for verification
const engine = new WasmEngine();
(window as unknown as { __keenEngine: WasmEngine }).__keenEngine = engine; // for verification

// Keyboard bindings (shared across all episodes), applied before the engine boots.
let keymap: Keymap = sanitizeKeymap(settings.keymap);
engine.setKeymap(keymap);

// One bridge merges gamepad + on-screen pad into the engine's scancode input.
const input = new InputBridge((code, down) => engine.setKey(code, down));
input.onGamepadChange = (count) => { if (count > 0) toast("🎮 Gamepad connected"); };

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
    await engine.load(ep);
  } catch (err) {
    console.error(err);
    toast("Failed to load engine");
    return;
  }
  engine.start();
  armUnloadGuard(); // game is live — trap accidental reload / tab-close from here on
  void engine.resumeAudio(); // the episode-selector click is a user gesture
  toast("Space: Start · ←→: Move · Ctrl: Jump · Alt: Pogo · Space: Fire");

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

  const fs = hudButton("⛶", "Fullscreen (F)", () => void display.toggleFullscreen());
  // Aspect ratio moved into the ⚙ display-settings panel (low-frequency setting).
  const sh = hudButton("⚙", "Display settings", () => toggleShaderPanel());
  const kb = hudButton("⌨", "Controls (key bindings)", () => keybindPanel?.toggle());
  const vp = hudButton("🎮", "Toggle virtual pad", () => {});
  vp.id = "vp-toggle";

  hud.append(fs, sh, kb, vp);
  document.body.appendChild(hud);
  buildShaderPanel();
  buildKeybindPanel();
}

/** Build the ⌨ key-bindings panel; applies live to the engine + persists. */
function buildKeybindPanel(): void {
  keybindPanel = new KeybindPanel({
    getMap: () => keymap,
    setMap: (m) => {
      keymap = m;
      engine.setKeymap(m);
      saveSettings({ keymap: m });
    },
    beginCapture: (cb) => engine.beginKeyCapture(cb),
    toast,
  });
  document.body.appendChild(keybindPanel.el);
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

// --- Shader gallery (⚙) -----------------------------------------------------
function buildShaderPanel(): void {
  const panel = document.createElement("div");
  panel.id = "shader-panel";
  Object.assign(panel.style, {
    position: "fixed", top: "52px", right: "12px", zIndex: "31",
    background: "rgba(17,19,29,0.96)", color: "#e8ecff",
    border: "1px solid #2a2f45", borderRadius: "12px", padding: "10px",
    font: "12px ui-monospace, monospace", display: "none", minWidth: "160px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
  } satisfies Partial<CSSStyleDeclaration>);

  const title = document.createElement("div");
  title.textContent = "Display";
  Object.assign(title.style, { opacity: "0.7", margin: "2px 4px 8px", letterSpacing: "0.04em" });
  panel.appendChild(title);

  const shaderHead = document.createElement("div");
  shaderHead.textContent = "Shader";
  Object.assign(shaderHead.style, { opacity: "0.5", margin: "0 4px 4px", fontSize: "11px" });
  panel.appendChild(shaderHead);

  const supported = display.shaderSupported;
  shaderTiles = [];
  if (supported) {
    panel.style.minWidth = "330px";
    panel.appendChild(buildThumbGrid());
  } else {
    buildTextList(panel);
    const note = document.createElement("div");
    note.textContent = "Disabled — WebGL2 not supported";
    Object.assign(note.style, { opacity: "0.6", margin: "6px 4px 2px" });
    panel.appendChild(note);
  }

  panel.appendChild(buildAspectRow());        // display geometry: 4:3 vs pixel
  panel.appendChild(buildIntegerScaleRow());  // display option; applies to 2D + shader paths

  document.body.appendChild(panel);
  shaderPanel = panel;
  refreshShaderPanel();
}

/** A panel "settings row": a left label + (caller-appended) right control, with a top divider. */
function optionRow(labelText: string): HTMLElement {
  const row = document.createElement("div");
  Object.assign(row.style, {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    gap: "8px", marginTop: "8px", paddingTop: "8px", borderTop: "1px solid #2a2f45",
  } satisfies Partial<CSSStyleDeclaration>);
  const label = document.createElement("span");
  label.textContent = labelText;
  label.style.opacity = "0.85";
  row.appendChild(label);
  return row;
}

/** Segmented control for the aspect mode (4:3 vs pixel-perfect). */
function buildAspectRow(): HTMLElement {
  const row = optionRow("Aspect ratio");

  const seg = document.createElement("div");
  Object.assign(seg.style, {
    display: "inline-flex", border: "1px solid #2a2f45", borderRadius: "999px", overflow: "hidden",
  } satisfies Partial<CSSStyleDeclaration>);

  const modes: { mode: AspectMode; label: string }[] = [
    { mode: "4:3", label: "4:3" },
    { mode: "pixel", label: "1:1" },
  ];
  const buttons: HTMLButtonElement[] = [];
  const paint = (): void => {
    const cur = display.aspectMode;
    for (const b of buttons) {
      const on = b.dataset.aspect === cur;
      b.style.background = on ? "rgba(91,108,255,0.18)" : "transparent";
      b.style.opacity = on ? "1" : "0.55";
      b.style.fontWeight = on ? "600" : "400";
    }
  };
  for (const m of modes) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.aspect = m.mode; // segment marker; no data-shader => skipped by the shader highlight
    b.textContent = m.label;
    b.title = m.mode === "4:3" ? "4:3 (DOS)" : "Pixel-perfect (1:1)";
    Object.assign(b.style, {
      padding: "3px 14px", cursor: "pointer", font: "inherit", fontSize: "11px",
      border: "none", background: "transparent", color: "inherit",
    } satisfies Partial<CSSStyleDeclaration>);
    b.addEventListener("click", () => {
      if (display.aspectMode === m.mode) return;
      settings.aspectMode = m.mode;
      display.setAspectMode(m.mode);
      saveSettings({ aspectMode: m.mode });
      paint();
      toast(m.mode === "4:3" ? "Aspect: 4:3" : "Aspect: Pixel-perfect");
    });
    buttons.push(b);
    seg.appendChild(b);
  }
  paint();

  row.appendChild(seg);
  return row;
}

/** A labelled ON/OFF toggle for integer scaling (uniform pixels / even scanlines). */
function buildIntegerScaleRow(): HTMLElement {
  const row = optionRow("Integer scale");

  const pill = document.createElement("button");
  pill.type = "button";
  pill.dataset.role = "intscale"; // excluded from the shader-active highlight
  Object.assign(pill.style, {
    padding: "3px 12px", borderRadius: "999px", cursor: "pointer",
    font: "inherit", fontSize: "11px", border: "1px solid #2a2f45",
    background: "transparent", color: "inherit",
  } satisfies Partial<CSSStyleDeclaration>);

  const paint = (): void => {
    const on = display.integerScaleEnabled;
    pill.textContent = on ? "ON" : "OFF";
    pill.style.borderColor = on ? "#5b6cff" : "#2a2f45";
    pill.style.background = on ? "rgba(91,108,255,0.18)" : "transparent";
    pill.style.opacity = on ? "1" : "0.7";
  };
  paint();

  pill.addEventListener("click", () => {
    const next = !display.integerScaleEnabled;
    display.setIntegerScale(next);
    saveSettings({ integerScale: next });
    paint();
    toast(next ? "Integer scale: ON" : "Integer scale: OFF");
  });

  row.appendChild(pill);
  return row;
}

/** WebGL2 path: a 3-column grid of live-preview tiles (canvas + label). */
function buildThumbGrid(): HTMLElement {
  const grid = document.createElement("div");
  Object.assign(grid.style, {
    display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px",
  } satisfies Partial<CSSStyleDeclaration>);

  for (const preset of SHADER_PRESETS) {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.dataset.shader = preset.id ?? "";
    tile.title = preset.label;
    Object.assign(tile.style, {
      display: "flex", flexDirection: "column", gap: "4px", padding: "4px",
      cursor: "pointer", background: "transparent", color: "inherit",
      border: "1px solid transparent", borderRadius: "8px", font: "inherit",
    } satisfies Partial<CSSStyleDeclaration>);

    const thumb = document.createElement("canvas");
    thumb.width = 160; // backing store (8:5); drawn from the offscreen GL result
    thumb.height = 100;
    Object.assign(thumb.style, {
      width: "100%", height: "auto", display: "block", borderRadius: "4px", background: "#000",
    } satisfies Partial<CSSStyleDeclaration>);

    const label = document.createElement("div");
    label.textContent = preset.label;
    Object.assign(label.style, {
      fontSize: "10px", textAlign: "center", whiteSpace: "nowrap",
      overflow: "hidden", textOverflow: "ellipsis", opacity: "0.85",
    } satisfies Partial<CSSStyleDeclaration>);

    tile.append(thumb, label);
    tile.addEventListener("click", () => selectShader(preset.id));
    grid.appendChild(tile);
    shaderTiles.push({ id: preset.id, canvas: thumb });
  }
  return grid;
}

/** Fallback (no WebGL2): the original vertical text list. */
function buildTextList(panel: HTMLElement): void {
  for (const preset of SHADER_PRESETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = preset.label;
    b.dataset.shader = preset.id ?? "";
    Object.assign(b.style, {
      display: "block", width: "100%", textAlign: "left", margin: "3px 0",
      padding: "7px 10px", cursor: "pointer", background: "transparent",
      color: "inherit", border: "1px solid transparent", borderRadius: "8px", font: "inherit",
    } satisfies Partial<CSSStyleDeclaration>);
    if (preset.id !== null) {
      b.disabled = true;
      b.style.opacity = "0.4";
      b.style.cursor = "default";
    }
    b.addEventListener("click", () => selectShader(preset.id));
    panel.appendChild(b);
  }
}

/** Render the current frame through every preset into its tile (live previews). */
function renderThumbnails(): void {
  if (!shaderTiles.length || thumbnailerDead) return;
  const frame = display.snapshotFrame();
  if (!frame) return; // no frame yet; tiles fill on a later open
  if (!thumbnailer) {
    try {
      thumbnailer = new ShaderThumbnailer();
    } catch (err) {
      console.warn("Thumbnail preview unavailable:", err);
      thumbnailerDead = true;
      return;
    }
  }
  thumbnailer.render(frame, shaderTiles);
}

function toggleShaderPanel(): void {
  if (!shaderPanel) return;
  const opening = shaderPanel.style.display === "none";
  shaderPanel.style.display = opening ? "block" : "none";
  if (opening) renderThumbnails(); // snapshot the current frame into the preview tiles
}

function selectShader(id: string | null): void {
  display.setShader(id);
  const applied = display.shader; // null if WebGL2/compile fell back to 2D
  saveSettings({ shaderId: applied });
  refreshShaderPanel();
  const preset = SHADER_PRESETS.find((p) => p.id === applied);
  toast(`Shader: ${preset?.label ?? "Original"}`);
}

function refreshShaderPanel(): void {
  if (!shaderPanel) return;
  const active = display.shader ?? "";
  for (const b of Array.from(shaderPanel.querySelectorAll("button"))) {
    if (!b.hasAttribute("data-shader")) continue; // skip the integer-scale pill
    const on = (b.dataset.shader ?? "") === active;
    b.style.borderColor = on ? "#5b6cff" : "transparent";
    b.style.background = on ? "rgba(91,108,255,0.18)" : "transparent";
  }
}

// --- Global gestures --------------------------------------------------------
function wireGlobalGestures(): void {
  const resumeOnce = () => void engine.resumeAudio();
  window.addEventListener("pointerdown", resumeOnce);
  window.addEventListener("keydown", resumeOnce, { once: true });
  window.addEventListener("keydown", (e) => {
    // Suspend the F=fullscreen hotkey while the engine is collecting typed text
    // (e.g. a save-game name) so "f" types into the field instead.
    if (e.code === "KeyF" && !e.repeat && !engine.isTextInput()) void display.toggleFullscreen();
  });
}

// --- Unload guard -----------------------------------------------------------
// Once a game is running, intercept reload / tab-close / navigate-away with the
// browser's native "Leave site?" confirmation so progress isn't lost by mistake.
// NB: the dialog text is fixed by the browser — a custom message isn't allowed.
let unloadGuardArmed = false;
function armUnloadGuard(): void {
  if (unloadGuardArmed) return;
  unloadGuardArmed = true;
  window.addEventListener("beforeunload", (e) => {
    e.preventDefault();
    e.returnValue = ""; // Chrome requires returnValue to be set to trigger the prompt
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
