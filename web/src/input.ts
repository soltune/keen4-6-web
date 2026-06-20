/* ===========================================================================
   Input bridge — merges the two "logical button" sources (gamepad + on-screen
   virtual pad) and feeds the engine as DOS scancodes through a single sink
   (WasmEngine.setKey). The physical keyboard is handled directly in
   wasmEngine.ts (DOM code -> scancode); this module covers everything that
   speaks in *logical* buttons rather than raw keys, so the gamepad logic lives
   in exactly one place.

   Design note — the engine's menus key off LastScan (the single most-recent
   scancode; see ID_US_2.C US_HandleMenu), so:
     * a logical button must map to scancodes the menu actually recognises, and
     * we must never let an irrelevant scancode clobber LastScan in the same
       frame (the original bug: ✕ sent Ctrl *then* Space, and Space — which no
       menu treats as "select" — overwrote LastScan, so confirm never fired).
   Hence menu confirm = Ctrl (button0); the meta keys live off the gameplay
   buttons — Enter (status/score in gameplay) on △/Triangle, Esc (back/menu) on
   Start/Select — so jumping never triggers them; fire = Space; Enter/Esc are
   emitted last so they win LastScan (see flush()).
   =========================================================================== */

/** Logical buttons every input source speaks in. */
export type VirtualButton =
  | "up" | "down" | "left" | "right"
  | "jump" | "pogo" | "fire"
  | "status" | "back" | "pause";

/** The slice the on-screen virtual pad drives. */
export interface VirtualSink {
  setVirtual(button: VirtualButton, pressed: boolean): void;
  clearVirtual(): void;
}

/* Logical button -> DOM KeyboardEvent.code(s). WasmEngine.SCANCODE turns each
   code into the DOS scan code the keyboard ISR expects. Choices match the Keen
   defaults (KbdDefs[0]: Ctrl=jump/button0, Alt=pogo/button1; firescan=Space) so
   the same press works in gameplay *and* in menus:
     jump    -> Ctrl  (button0 => also confirms US_HandleMenu; the pad's "select")
     fire    -> Space (firescan)
     back    -> Esc   (sc_Escape, the only key that backs out of a menu)
     status  -> Enter (sc_Return: status/score panel in-game, confirms in menus) */
const CODES: Record<VirtualButton, readonly string[]> = {
  up: ["ArrowUp"], down: ["ArrowDown"], left: ["ArrowLeft"], right: ["ArrowRight"],
  jump: ["ControlLeft"], pogo: ["AltLeft"], fire: ["Space"],
  status: ["Enter"], back: ["Escape"], pause: ["KeyP"],
};

/* Order for codes pressed within one frame. The menu keys off LastScan (the
   last scancode of the frame), so confirm/back must be emitted LAST to win it
   when pressed alongside a direction. Releases don't touch LastScan. */
const PRESS_ORDER = [
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "AltLeft", "ControlLeft", "Space", "KeyP",
  "Enter", "Escape",
];
const orderOf = (code: string): number => {
  const i = PRESS_ORDER.indexOf(code);
  return i < 0 ? PRESS_ORDER.length : i;
};

const STICK_DEADZONE = 0.4;

export class InputBridge implements VirtualSink {
  private setKey: (code: string, down: boolean) => void;
  private virtual = new Set<VirtualButton>();
  private gamepad = new Set<VirtualButton>();
  private downCodes = new Set<string>(); // codes currently emitted as held
  private padCount = 0;

  /** Notified when the connected-pad count changes (drives a connect toast). */
  onGamepadChange?: (count: number, id: string) => void;

  constructor(setKey: (code: string, down: boolean) => void) {
    this.setKey = setKey;
    // Drop everything held if focus is lost or the pad is unplugged, so keys
    // never get stuck down in the engine.
    window.addEventListener("blur", this.releaseAll);
    window.addEventListener("gamepaddisconnected", this.releaseAll);
  }

  /** Call once per animation frame: re-read pads and push the merged state. */
  poll(): void {
    this.gamepad = this.readGamepad();
    this.flush();
  }

  // --- Virtual pad (touch) -------------------------------------------------
  setVirtual(button: VirtualButton, pressed: boolean): void {
    if (pressed) this.virtual.add(button);
    else this.virtual.delete(button);
    this.flush();
  }

  clearVirtual(): void {
    this.virtual.clear();
    this.flush();
  }

  get gamepadCount(): number {
    return this.padCount;
  }

  // --- Internals -----------------------------------------------------------
  private releaseAll = (): void => {
    this.virtual.clear();
    this.gamepad.clear();
    this.flush();
  };

  private readGamepad(): Set<VirtualButton> {
    const out = new Set<VirtualButton>();
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let live = 0;
    let id = "";
    for (const gp of pads) {
      if (!gp) continue;
      live++;
      id = gp.id;
      const b = gp.buttons;
      const ax = gp.axes;
      const pressed = (i: number) => !!b[i]?.pressed;
      const axX = ax[0] ?? 0;
      const axY = ax[1] ?? 0;
      // D-pad (standard mapping) + left stick. The axes line up even on pads the
      // browser reports as non-standard, so movement degrades gracefully there.
      if (pressed(12) || axY < -STICK_DEADZONE) out.add("up");
      if (pressed(13) || axY > STICK_DEADZONE) out.add("down");
      if (pressed(14) || axX < -STICK_DEADZONE) out.add("left");
      if (pressed(15) || axX > STICK_DEADZONE) out.add("right");
      // Face buttons (standard mapping): ✕ jump (Ctrl confirms menus via
      // button0), ○ pogo, □ fire, △ status/score (Enter). Start/Select = Esc
      // (back/menu) — meta keys kept OFF ✕ so jumping never triggers them.
      if (pressed(0)) out.add("jump");
      if (pressed(1)) out.add("pogo");
      if (pressed(2)) out.add("fire");
      if (pressed(3)) out.add("status");
      if (pressed(8) || pressed(9)) out.add("back");
    }
    if (live !== this.padCount) {
      this.padCount = live;
      this.onGamepadChange?.(live, id);
    }
    return out;
  }

  /** Merge sources -> desired held codes, then emit only the rising/falling
      edges (so held buttons don't spam LastScan / re-confirm menus). */
  private flush(): void {
    const desired = new Set<string>();
    for (const b of this.gamepad) for (const c of CODES[b]) desired.add(c);
    for (const b of this.virtual) for (const c of CODES[b]) desired.add(c);

    // Releases first — they don't affect LastScan.
    for (const code of this.downCodes) {
      if (!desired.has(code)) this.setKey(code, false);
    }
    // Then presses, confirm/back last so they win LastScan this frame.
    const presses: string[] = [];
    for (const code of desired) if (!this.downCodes.has(code)) presses.push(code);
    presses.sort((a, b) => orderOf(a) - orderOf(b));
    for (const code of presses) this.setKey(code, true);

    this.downCodes = desired;
  }
}
