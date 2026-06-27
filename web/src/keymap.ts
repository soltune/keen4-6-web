/* ===========================================================================
   Keyboard remapping — physical key -> game action -> fixed DOS scancode.

   The remap lives entirely in the web shell (the DOM-code -> scancode stage).
   Each game action ALWAYS fires the same DOS scancode the engine's KbdDefs /
   menu logic expects (jump=Ctrl/button0, fire=Space/firescan, back=Esc,
   status=Enter), so the menu's LastScan handling keeps working no matter which
   physical key the player binds — we only change which key produces that
   scancode. This is why rebinding can be done live, without touching the wasm
   engine: macOS users can move jump off Ctrl (whose Ctrl+arrow chords the OS
   steals for Mission Control / Spaces) onto a free key.

   Keys with no action binding fall through to the literal DOM-code -> scancode
   table in wasmEngine.ts, so menu letter shortcuts and typed text (save-game
   names, cheat prompts) still work. See keen-web-input-bridge memory.
   =========================================================================== */

/** The remappable in-game actions. */
export type GameAction =
  | "left" | "right" | "up" | "down"
  | "jump" | "pogo" | "fire"
  | "status" | "back" | "pause";

/** Stable order for display and iteration. */
export const ACTION_ORDER: readonly GameAction[] = [
  "left", "right", "up", "down",
  "jump", "pogo", "fire",
  "status", "back", "pause",
];

/** Human label shown in the bindings panel. */
export const ACTION_LABEL: Record<GameAction, string> = {
  left: "Left", right: "Right", up: "Up", down: "Down",
  jump: "Jump", pogo: "Pogo", fire: "Fire",
  status: "Status", back: "Menu / Back", pause: "Pause",
};

/* Fixed DOS set-1 make code each action fires. These match the engine's
   defaults and the menu's LastScan expectations exactly (see ACTION_SCANCODE
   vs the SCANCODE table in wasmEngine.ts), so a remap never breaks menus. */
export const ACTION_SCANCODE: Record<GameAction, number> = {
  left: 0x4b, right: 0x4d, up: 0x48, down: 0x50,
  jump: 0x1d,   // Ctrl — also confirms US_HandleMenu via button0
  pogo: 0x38,   // Alt
  fire: 0x39,   // Space — firescan
  status: 0x1c, // Enter — status/score panel; confirms in menus
  back: 0x01,   // Esc — the only key that backs out of a menu
  pause: 0x19,  // P
};

/** Per-action physical bindings, as DOM KeyboardEvent.code lists (0–2 each). */
export type Keymap = Record<GameAction, string[]>;

/* Right-hand modifier / numpad-enter variants collapse onto their canonical
   code so a single "Ctrl"/"Alt"/"Enter" binding covers both physical keys. */
const NORMALIZE: Record<string, string> = {
  ControlRight: "ControlLeft",
  AltRight: "AltLeft",
  NumpadEnter: "Enter",
};

export function normalizeCode(code: string): string {
  return NORMALIZE[code] ?? code;
}

/** The DOS defaults (arrows + Ctrl/Alt/Space), matching the pre-remap shell. */
export const DEFAULT_KEYMAP: Keymap = {
  left: ["ArrowLeft"], right: ["ArrowRight"], up: ["ArrowUp"], down: ["ArrowDown"],
  jump: ["ControlLeft"], pogo: ["AltLeft"], fire: ["Space"],
  status: ["Enter"], back: ["Escape"], pause: ["KeyP"],
};

/* DOM codes that the action layer "owns": when one of these is left unbound
   (e.g. the player moved jump off Ctrl), it must go SILENT rather than fall
   through to its literal scancode — otherwise replacing a default key wouldn't
   actually free it. Derived from the default bindings. */
const RESERVED_CODES = new Set<string>(
  Object.values(DEFAULT_KEYMAP).flat().map(normalizeCode),
);

export function cloneKeymap(map: Keymap): Keymap {
  const out = {} as Keymap;
  for (const a of ACTION_ORDER) out[a] = map[a].slice();
  return out;
}

/** Coerce arbitrary stored JSON into a valid Keymap (missing actions fall back
    to the default; an explicitly-empty action is preserved). */
export function sanitizeKeymap(raw: unknown): Keymap {
  const r = (raw ?? {}) as Partial<Record<GameAction, unknown>>;
  const out = {} as Keymap;
  for (const a of ACTION_ORDER) {
    const v = r[a];
    if (Array.isArray(v)) {
      const codes = v
        .filter((c): c is string => typeof c === "string")
        .map(normalizeCode)
        .slice(0, 2);
      out[a] = Array.from(new Set(codes));
    } else {
      out[a] = DEFAULT_KEYMAP[a].slice();
    }
  }
  return out;
}

/** Bind `code` to action `slot` (0 or 1), removing it from any OTHER action
    first (move semantics). Returns the new map + which action it was taken
    from, if any (for a toast). A code can't occupy both slots of one action. */
export function bindKey(
  map: Keymap, action: GameAction, slot: 0 | 1, rawCode: string,
): { map: Keymap; movedFrom: GameAction | null } {
  const code = normalizeCode(rawCode);
  let movedFrom: GameAction | null = null;

  const next = {} as Keymap;
  for (const a of ACTION_ORDER) {
    if (a === action) { next[a] = map[a].slice(); continue; }
    const filtered = map[a].filter((c) => normalizeCode(c) !== code);
    if (filtered.length !== map[a].length) movedFrom = a;
    next[a] = filtered;
  }

  const slots: (string | undefined)[] = [next[action][0], next[action][1]];
  slots[slot] = code;
  const seen = new Set<string>();
  next[action] = slots.filter((c): c is string => {
    if (!c || seen.has(c)) return false;
    seen.add(c);
    return true;
  });

  return { map: next, movedFrom };
}

/** Clear the binding in `slot` of `action`. */
export function clearKey(map: Keymap, action: GameAction, slot: 0 | 1): Keymap {
  const slots: (string | undefined)[] = [map[action][0], map[action][1]];
  slots[slot] = undefined;
  const next = cloneKeymap(map);
  next[action] = slots.filter((c): c is string => !!c);
  return next;
}

/** Friendly label for a DOM KeyboardEvent.code (e.g. KeyZ -> "Z", ArrowUp -> "↑"). */
export function keyLabel(rawCode: string): string {
  const c = normalizeCode(rawCode);
  const named: Record<string, string> = {
    ControlLeft: "Ctrl", AltLeft: "Alt", ShiftLeft: "Shift", ShiftRight: "RShift",
    Space: "Space", Enter: "Enter", Escape: "Esc", Tab: "Tab", CapsLock: "Caps",
    Backspace: "⌫", Delete: "Del",
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]",
    Semicolon: ";", Quote: "'", Backquote: "`", Backslash: "\\",
    Comma: ",", Period: ".", Slash: "/",
  };
  if (named[c]) return named[c];
  if (c.startsWith("Key")) return c.slice(3);
  if (c.startsWith("Digit")) return c.slice(5);
  if (c.startsWith("Numpad")) return "Num" + c.slice(6);
  if (/^F\d{1,2}$/.test(c)) return c;
  return c;
}

/** Resolves a physical DOM code to the scancodes the action layer should fire. */
export class KeymapResolver {
  private codeToScancodes = new Map<string, number[]>();

  constructor(private map: Keymap) {
    this.rebuild();
  }

  setMap(map: Keymap): void {
    this.map = map;
    this.rebuild();
  }

  getMap(): Keymap {
    return this.map;
  }

  private rebuild(): void {
    this.codeToScancodes.clear();
    for (const a of ACTION_ORDER) {
      for (const raw of this.map[a]) {
        const code = normalizeCode(raw);
        const list = this.codeToScancodes.get(code) ?? [];
        list.push(ACTION_SCANCODE[a]);
        this.codeToScancodes.set(code, list);
      }
    }
  }

  /** Scancodes to fire for `rawCode`, or null when the code is NOT controlled by
      the action layer (caller falls back to the literal SCANCODE table). A code
      that is action-owned but currently unbound returns [] (stay silent). */
  resolve(rawCode: string): number[] | null {
    const code = normalizeCode(rawCode);
    const scs = this.codeToScancodes.get(code);
    if (scs && scs.length) return scs;
    if (RESERVED_CODES.has(code)) return [];
    return null;
  }
}
