/* ===========================================================================
   Controls panel (⌨) — a corner dropdown, styled like the ⚙ display panel, for
   rebinding the keyboard live. Click a key chip -> "Press a key…" -> the next
   physical key is captured (Esc cancels) and applied immediately, so the player
   can test the new binding without leaving the game. Right-click a chip clears
   it. Presets cover the DOS default and a macOS-friendly layout (jump/pogo off
   Ctrl/Alt). See keymap.ts for the model. The panel never reads input itself —
   capture is delegated to the engine so it pre-empts gameplay input cleanly.
   =========================================================================== */

import {
  ACTION_ORDER, ACTION_LABEL, type GameAction, type Keymap,
  DEFAULT_KEYMAP,
  bindKey, clearKey, keyLabel, cloneKeymap,
} from "../keymap";

export interface KeybindPanelOpts {
  /** Current bindings. */
  getMap(): Keymap;
  /** Apply + persist new bindings (caller updates the engine + storage). */
  setMap(map: Keymap): void;
  /** Grab the next physical key press; code is normalized, or null if cancelled. */
  beginCapture(cb: (code: string | null) => void): void;
  /** Show a transient message. */
  toast(msg: string): void;
}

const ACCENT = "#5b6cff";
const BORDER = "#2a2f45";

export class KeybindPanel {
  readonly el: HTMLDivElement;
  private rows: HTMLDivElement;
  private capturing: { action: GameAction; slot: 0 | 1 } | null = null;

  constructor(private opts: KeybindPanelOpts) {
    this.el = document.createElement("div");
    this.el.id = "keybind-panel";
    Object.assign(this.el.style, {
      position: "fixed", top: "52px", right: "12px", zIndex: "31",
      background: "rgba(17,19,29,0.96)", color: "#e8ecff",
      border: `1px solid ${BORDER}`, borderRadius: "12px", padding: "10px",
      font: "12px ui-monospace, monospace", display: "none", minWidth: "240px",
      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    } satisfies Partial<CSSStyleDeclaration>);

    const title = document.createElement("div");
    title.textContent = "Controls";
    Object.assign(title.style, { opacity: "0.7", margin: "2px 4px 8px", letterSpacing: "0.04em" });
    this.el.appendChild(title);

    this.el.appendChild(this.buildPresetRow());

    this.rows = document.createElement("div");
    this.el.appendChild(this.rows);

    const hint = document.createElement("div");
    hint.textContent = "Click a key to rebind · right-click to clear";
    Object.assign(hint.style, { opacity: "0.5", margin: "10px 4px 2px", fontSize: "11px" });
    this.el.appendChild(hint);

    this.render();
  }

  toggle(): void {
    const opening = this.el.style.display === "none";
    this.el.style.display = opening ? "block" : "none";
    if (!opening) this.capturing = null; // closing mid-capture: forget the pending slot
    this.render();
  }

  // --- Building blocks -----------------------------------------------------
  private buildPresetRow(): HTMLElement {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap",
      margin: "0 2px 4px",
    } satisfies Partial<CSSStyleDeclaration>);

    row.appendChild(this.presetButton("Default", () => this.applyPreset(DEFAULT_KEYMAP, "Default")));
    return row;
  }

  private presetButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    Object.assign(b.style, {
      padding: "3px 10px", borderRadius: "999px", cursor: "pointer",
      font: "inherit", fontSize: "11px", border: `1px solid ${BORDER}`,
      background: "transparent", color: "inherit",
    } satisfies Partial<CSSStyleDeclaration>);
    b.addEventListener("click", onClick);
    return b;
  }

  private render(): void {
    const map = this.opts.getMap();
    this.rows.replaceChildren();
    for (const action of ACTION_ORDER) {
      this.rows.appendChild(this.buildActionRow(action, map));
    }
  }

  private buildActionRow(action: GameAction, map: Keymap): HTMLElement {
    const row = document.createElement("div");
    Object.assign(row.style, {
      display: "flex", justifyContent: "space-between", alignItems: "center",
      gap: "8px", padding: "3px 4px",
    } satisfies Partial<CSSStyleDeclaration>);

    const label = document.createElement("span");
    label.textContent = ACTION_LABEL[action];
    label.style.opacity = "0.85";
    row.appendChild(label);

    const chips = document.createElement("div");
    Object.assign(chips.style, { display: "inline-flex", gap: "4px" });
    chips.appendChild(this.buildChip(action, 0, map[action][0]));
    chips.appendChild(this.buildChip(action, 1, map[action][1]));
    row.appendChild(chips);
    return row;
  }

  private buildChip(action: GameAction, slot: 0 | 1, code: string | undefined): HTMLButtonElement {
    const isCap = this.capturing?.action === action && this.capturing.slot === slot;
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = isCap ? "Press…" : code ? keyLabel(code) : "—";
    Object.assign(b.style, {
      minWidth: "54px", padding: "3px 8px", borderRadius: "6px", cursor: "pointer",
      font: "inherit", fontSize: "11px", textAlign: "center",
      border: `1px solid ${isCap ? ACCENT : BORDER}`,
      background: isCap ? "rgba(91,108,255,0.18)" : "transparent",
      color: "inherit", opacity: code || isCap ? "1" : "0.45",
    } satisfies Partial<CSSStyleDeclaration>);
    b.addEventListener("click", () => this.arm(action, slot));
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (code) {
        this.opts.setMap(clearKey(this.opts.getMap(), action, slot));
        this.render();
      }
    });
    return b;
  }

  // --- Actions -------------------------------------------------------------
  private arm(action: GameAction, slot: 0 | 1): void {
    if (this.capturing) return;
    this.capturing = { action, slot };
    this.render();
    this.opts.beginCapture((code) => {
      const cap = this.capturing;
      this.capturing = null;
      if (!cap || code === null) { this.render(); return; } // cancelled / closed
      const { map, movedFrom } = bindKey(this.opts.getMap(), cap.action, cap.slot, code);
      this.opts.setMap(map);
      if (movedFrom && movedFrom !== cap.action) {
        this.opts.toast(`${keyLabel(code)}: moved from ${ACTION_LABEL[movedFrom]}`);
      }
      this.render();
    });
  }

  private applyPreset(preset: Keymap, name: string): void {
    this.capturing = null;
    this.opts.setMap(cloneKeymap(preset));
    this.opts.toast(`Controls: ${name}`);
    this.render();
  }
}
