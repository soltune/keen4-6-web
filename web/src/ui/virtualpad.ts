/* ===========================================================================
   On-screen virtual gamepad for touch devices (goal requirement #5).

   Builds a D-pad + action buttons inside #virtualpad and forwards presses to
   the Input layer via setVirtual(). Multi-touch capable (each button captures
   its own pointer). Shown automatically on coarse-pointer (touch) devices; can
   also be toggled.
   =========================================================================== */

import type { VirtualButton, VirtualSink } from "../input";

interface PadButton {
  label: string;
  cls: string;
  keys: VirtualButton[];
}

const DPAD: PadButton[] = [
  { label: "▲", cls: "vp-up", keys: ["up"] },
  { label: "◀", cls: "vp-left", keys: ["left"] },
  { label: "▶", cls: "vp-right", keys: ["right"] },
  { label: "▼", cls: "vp-down", keys: ["down"] },
];

const ACTIONS: PadButton[] = [
  { label: "FIRE", cls: "vp-round vp-fire", keys: ["fire"] },
  { label: "POGO", cls: "vp-round vp-pogo", keys: ["pogo"] },
  { label: "JUMP", cls: "vp-round big vp-jump", keys: ["jump"] },
];

// Meta buttons (top of screen, like Start/Select): status panel + menu/back.
// Kept off the gameplay buttons so jumping/pogoing never opens a panel/menu;
// JUMP (Ctrl) still confirms menus via button0, so menus stay navigable.
const META: PadButton[] = [
  { label: "STATUS", cls: "vp-pill", keys: ["status"] },
  { label: "MENU", cls: "vp-pill", keys: ["back"] },
];

export class VirtualPad {
  private root: HTMLElement;
  private input: VirtualSink;
  private enabled = false;

  constructor(root: HTMLElement, input: VirtualSink) {
    this.root = root;
    this.input = input;
    this.build();
    // Auto-enable on touch / coarse pointer devices.
    const coarse = window.matchMedia?.("(pointer: coarse)").matches;
    const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    this.setEnabled(Boolean(coarse || touch));
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.root.hidden = !on;
    if (!on) this.input.clearVirtual();
  }

  toggle(): void {
    this.setEnabled(!this.enabled);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  private build(): void {
    this.root.innerHTML = "";

    const dpad = document.createElement("div");
    dpad.className = "vp-zone vp-dpad";
    for (const def of DPAD) dpad.appendChild(this.makeKey(def));
    this.root.appendChild(dpad);

    const actions = document.createElement("div");
    actions.className = "vp-zone vp-actions";
    for (const def of ACTIONS) actions.appendChild(this.makeKey(def));
    this.root.appendChild(actions);

    const meta = document.createElement("div");
    meta.className = "vp-zone vp-meta";
    for (const def of META) meta.appendChild(this.makeKey(def));
    this.root.appendChild(meta);
  }

  private makeKey(def: PadButton): HTMLElement {
    const el = document.createElement("div");
    el.className = `vp-key ${def.cls}`;
    el.textContent = def.label;

    const press = (on: boolean) => {
      el.classList.toggle("pressed", on);
      for (const k of def.keys) this.input.setVirtual(k, on);
    };

    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      press(true);
    });
    const release = (e: PointerEvent) => {
      if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
      press(false);
    };
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    el.addEventListener("lostpointercapture", () => press(false));
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    return el;
  }
}
