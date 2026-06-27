/* ===========================================================================
   WasmEngine — drives the native (reconstructed) Commander Keen 4-6 engine
   compiled to WebAssembly.

   Unlike the TypeScript MockEngine/RealDataEngine (which the shell pulls each
   frame), the wasm module keeps the original DOS control flow: main() runs the
   whole game and blocks in busy-waits, suspended/resumed by ASYNCIFY. So this
   class does NOT tick the engine — it lets the engine run itself and instead:

     * feeds DOM keyboard events in as DOS scancodes  (CKWEB_KeyEvent),
     * presents the engine's RGBA framebuffer to the canvas each rAF
       (VW_Present + VW_GetFramebuffer),
     * pulls FM/PC-speaker PCM from the engine for Web Audio (SD_AudioRender) —
       which also steps the engine's sound service, exactly like the DOS timer
       ISR, so sound-gated waits never stall the game.

   The per-episode modules are produced by engine/port/link.sh as ES6 modules
   (public/engine/keen<ep>.js, MODULARIZE + EXPORT_NAME=KeenModule<ep>).
   =========================================================================== */

import { KeymapResolver, normalizeCode, DEFAULT_KEYMAP, type Keymap } from "../keymap";

export interface KeenWasm {
  _CKWEB_Boot(): void;
  _main(): Promise<void> | void;
  _CKWEB_KeyEvent(scancode: number, down: number): void;
  _CKWEB_IsTextInput?(): number;
  _CKWEB_PlayerState(what: number): number;
  _CKWEB_Warp(level: number): number;
  _VW_Present(): void;
  _VW_GetFramebuffer(): number;
  _VW_ScreenWidth(): number;
  _VW_ScreenHeight(): number;
  _SD_AudioRender(bufPtr: number, len: number): void;
  _CKWEB_PersistFS?(): void;
  _CKWEB_FlushConfig?(): void;
  _malloc(bytes: number): number;
  HEAPU8: Uint8Array;
  HEAPF32: Float32Array;
  FS: EmscriptenFS;
}

/** The slice of Emscripten's FS API we use for persistent saves (IDBFS). */
interface EmscriptenFS {
  mkdir(path: string): void;
  mount(type: unknown, opts: object, mountpoint: string): void;
  syncfs(populate: boolean, cb: (err: unknown) => void): void;
  analyzePath(path: string): { exists: boolean };
  readdir(path: string): string[];
  filesystems: { IDBFS: unknown };
}

type KeenFactory = (opts: {
  locateFile?: (p: string) => string;
  print?: (s: string) => void;
  printErr?: (s: string) => void;
}) => Promise<KeenWasm>;

/* Complete DOM KeyboardEvent.code -> DOS set-1 make code map. The engine's
   ID_IN.C keyboard ISR reads raw scan codes, and the menus / name-entry /
   high-score initials / cheat prompts all key off specific letters, so the map
   must be COMPLETE — a partial table silently breaks "type a save-game name",
   the LOAD/SAVE/CONFIGURE letter shortcuts, etc. Movement is the DOS default
   (arrow keys) plus the gamepad / on-screen pad; W/A/S/D therefore send their
   real letter codes so they work in menus and text fields (rebind in Configure
   for WASD movement, exactly like DOS). */
const SCANCODE: Record<string, number> = {
  // Letters A-Z
  KeyA: 0x1e, KeyB: 0x30, KeyC: 0x2e, KeyD: 0x20, KeyE: 0x12, KeyF: 0x21,
  KeyG: 0x22, KeyH: 0x23, KeyI: 0x17, KeyJ: 0x24, KeyK: 0x25, KeyL: 0x26,
  KeyM: 0x32, KeyN: 0x31, KeyO: 0x18, KeyP: 0x19, KeyQ: 0x10, KeyR: 0x13,
  KeyS: 0x1f, KeyT: 0x14, KeyU: 0x16, KeyV: 0x2f, KeyW: 0x11, KeyX: 0x2d,
  KeyY: 0x15, KeyZ: 0x2c,
  // Number row
  Digit1: 0x02, Digit2: 0x03, Digit3: 0x04, Digit4: 0x05, Digit5: 0x06,
  Digit6: 0x07, Digit7: 0x08, Digit8: 0x09, Digit9: 0x0a, Digit0: 0x0b,
  Minus: 0x0c, Equal: 0x0d,
  // Punctuation
  BracketLeft: 0x1a, BracketRight: 0x1b, Semicolon: 0x27, Quote: 0x28,
  Backquote: 0x29, Backslash: 0x2b, Comma: 0x33, Period: 0x34, Slash: 0x35,
  // Editing / whitespace
  Escape: 0x01, Backspace: 0x0e, Tab: 0x0f, Enter: 0x1c, NumpadEnter: 0x1c,
  Space: 0x39, CapsLock: 0x3a,
  // Modifiers — Ctrl = jump, Alt = pogo (the game's defaults)
  ControlLeft: 0x1d, ControlRight: 0x1d, AltLeft: 0x38, AltRight: 0x38,
  ShiftLeft: 0x2a, ShiftRight: 0x36,
  // Arrow keys (DOS movement defaults; numpad-style codes the engine expects)
  ArrowUp: 0x48, ArrowDown: 0x50, ArrowLeft: 0x4b, ArrowRight: 0x4d,
  // Function keys (F1 help, status, etc.)
  F1: 0x3b, F2: 0x3c, F3: 0x3d, F4: 0x3e, F5: 0x3f, F6: 0x40, F7: 0x41,
  F8: 0x42, F9: 0x43, F10: 0x44, F11: 0x57, F12: 0x58,
  // Numpad
  Numpad0: 0x52, Numpad1: 0x4f, Numpad2: 0x50, Numpad3: 0x51, Numpad4: 0x4b,
  Numpad5: 0x4c, Numpad6: 0x4d, Numpad7: 0x47, Numpad8: 0x48, Numpad9: 0x49,
  NumpadAdd: 0x4e, NumpadSubtract: 0x4a, NumpadMultiply: 0x37, NumpadDecimal: 0x53,
};

export class WasmEngine {
  private m: KeenWasm | null = null;
  private audioCtx: AudioContext | null = null;
  private audioNode: ScriptProcessorNode | null = null;
  private audioAnalyser: AnalyserNode | null = null;
  private audioBuf = 0; // wasm heap pointer for the render scratch buffer
  private down = new Set<number>();
  private heldByCode = new Map<string, number[]>(); // physical code -> scancodes it holds
  private resolver = new KeymapResolver(DEFAULT_KEYMAP);
  private capturing = false; // true while grabbing the next key for a rebind
  private keyHandlersAttached = false;
  private started = false;
  private w = 320;
  private h = 200;

  /** Load and instantiate the episode module (does not start the game yet). */
  async load(ep: string, baseUrl = "engine/"): Promise<void> {
    const url = new URL(`${baseUrl}keen${ep}.js`, document.baseURI).href;
    const mod = (await import(/* @vite-ignore */ url)) as { default: KeenFactory };
    this.m = await mod.default({
      locateFile: (p: string) => new URL(`${baseUrl}${p}`, document.baseURI).href,
      print: () => {},
      printErr: (s: string) => {
        if (/error|abort|assert|out of bounds/i.test(s)) console.warn("[keen]", s);
      },
    });
    await this.setupPersistence();
    this.w = this.m._VW_ScreenWidth();
    this.h = this.m._VW_ScreenHeight();
  }

  /** Mount IndexedDB-backed storage at /save and load any persisted CONFIG /
      SAVEGAM files into MEMFS *before* the engine boots (US_Startup reads the
      config early). The engine writes saves/options/high-scores to /save and
      calls CKWEB_PersistFS() to flush them back here. Best-effort: private mode
      or a blocked IndexedDB just means saves don't persist across reloads. */
  private async setupPersistence(): Promise<void> {
    const m = this.m;
    if (!m?.FS?.filesystems?.IDBFS) return;
    try {
      if (!m.FS.analyzePath("/save").exists) m.FS.mkdir("/save");
      m.FS.mount(m.FS.filesystems.IDBFS, {}, "/save");
      await new Promise<void>((resolve) => {
        m.FS.syncfs(true, (err) => {
          if (err) console.warn("[keen] could not load saved games:", err);
          resolve();
        });
      });
    } catch (e) {
      console.warn("[keen] persistent storage unavailable:", e);
    }
  }

  /** Boot + run the engine, attach input, and bring up audio. Idempotent. */
  start(): void {
    if (!this.m || this.started) return;
    this.started = true;
    this.attachKeyboard();
    this.startAudio();
    this.attachPersistenceFlush();
    this.m._CKWEB_Boot();
    // main() runs the whole game; ASYNCIFY suspends/resumes it. Fire-and-forget;
    // a clean exit or a fatal error both resolve/reject the returned promise.
    Promise.resolve(this.m._main()).catch((e) => console.warn("[keen] main exited:", e));
  }

  /** Persist options + high scores when the page is hidden or closed (the DOS
      build only writes them on program exit, which never happens in a tab). */
  private attachPersistenceFlush(): void {
    const flush = (): void => { try { this.m?._CKWEB_FlushConfig?.(); } catch { /* noop */ } };
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
    window.addEventListener("pagehide", flush);
  }

  get ready(): boolean {
    return this.m != null;
  }

  /** Latest player/engine probe values (see CK_PLAY.C CKWEB_PlayerState). */
  state(what: number): number {
    return this.m ? this.m._CKWEB_PlayerState(what) : -1;
  }

  /** In-engine "warp to level" (the W-cheat effect). Returns 1 if queued. */
  warp(level: number): number {
    return this.m ? this.m._CKWEB_Warp(level) : 0;
  }

  /** True while the engine is collecting typed text (save-game name / high-score
      initials / cheat prompt). Used to suspend letter-key hotkeys so the letters
      are typed into the field instead. */
  isTextInput(): boolean {
    return this.m?._CKWEB_IsTextInput ? this.m._CKWEB_IsTextInput() !== 0 : false;
  }

  /** Force-write options + high scores to persistent storage right now. */
  flushConfig(): void {
    this.m?._CKWEB_FlushConfig?.();
  }

  /** Files in the persistent /save directory (saved games + CONFIG). */
  savedFiles(): string[] {
    try {
      return this.m?.FS.readdir("/save").filter((f) => f !== "." && f !== "..") ?? [];
    } catch { return []; }
  }

  /** Resume the audio context (call from a user-gesture handler). */
  async resumeAudio(): Promise<void> {
    await this.audioCtx?.resume();
  }

  // --- Video --------------------------------------------------------------
  /** Rasterise the current EGA screen and return it as a tightly-packed RGBA
      view (w*h*4) over the wasm heap — valid until the next call. */
  frame(): Uint8Array | null {
    if (!this.m) return null;
    this.m._VW_Present();
    const ptr = this.m._VW_GetFramebuffer();
    const n = this.w * this.h * 4;
    return this.m.HEAPU8.subarray(ptr, ptr + n);
  }

  get width(): number { return this.w; }
  get height(): number { return this.h; }

  // --- Input --------------------------------------------------------------
  /** Replace the active keyboard bindings (physical key -> game action). The
      gamepad / on-screen pad keep their own mapping and go through setKey(). */
  setKeymap(map: Keymap): void {
    this.resolver.setMap(map);
  }

  /** Grab the next physical key press for a rebind, then call back with the
      normalized DOM code (null if the player pressed Esc to cancel). Suspends
      gameplay key handling and releases anything held so no key sticks. The
      capture listener runs in the capture phase so it pre-empts the gameplay
      handler; real OS/browser chords (Cmd+…, F5/F11/F12) are ignored. */
  beginKeyCapture(cb: (code: string | null) => void): void {
    if (this.capturing) return;
    this.capturing = true;
    this.releaseAllDown();
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.code === "F5" || e.code === "F11" || e.code === "F12") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      window.removeEventListener("keydown", onKey, true);
      this.capturing = false;
      cb(e.code === "Escape" ? null : normalizeCode(e.code));
    };
    window.addEventListener("keydown", onKey, { capture: true });
  }

  /** Push a single scancode to the engine, suppressing duplicates (auto-repeat
      or two sources holding the same key). */
  private emit(sc: number, isDown: boolean): void {
    if (!this.m) return;
    if (isDown) {
      if (this.down.has(sc)) return;
      this.down.add(sc);
    } else {
      this.down.delete(sc);
    }
    this.m._CKWEB_KeyEvent(sc, isDown ? 1 : 0);
  }

  /** Release every held scancode (focus loss / before a rebind capture). */
  private releaseAllDown(): void {
    if (!this.m) return;
    for (const sc of this.down) this.m._CKWEB_KeyEvent(sc, 0);
    this.down.clear();
    this.heldByCode.clear();
  }

  /** Inject a literal key by DOM code (used by the on-screen pad / gamepad
      bridge, which carries its own mapping and bypasses the remap layer). */
  setKey(code: string, isDown: boolean): void {
    const sc = SCANCODE[code];
    if (sc === undefined) return;
    this.emit(sc, isDown);
  }

  /** Scancodes a physical keyboard event should fire. While the engine is
      collecting typed text (save name / cheat prompt) the remap is bypassed so
      keys type their real letters; otherwise the action layer wins, with the
      literal table as the fallback for keys it doesn't own. */
  private scancodesFor(e: KeyboardEvent): number[] {
    if (this.isTextInput()) {
      const lit = SCANCODE[e.code];
      return lit === undefined ? [] : [lit];
    }
    const mapped = this.resolver.resolve(e.code);
    if (mapped !== null) return mapped; // action key, or an owned-but-freed key ([])
    const lit = SCANCODE[e.code];
    return lit === undefined ? [] : [lit];
  }

  /** Let genuine browser/OS shortcuts through instead of feeding them to the
      game: Cmd+… (mac) and the reserved F5/F11/F12 (reload/fullscreen/devtools).
      We deliberately do NOT treat Ctrl+<key> as a shortcut: Ctrl is the jump
      button, so while it is held every keydown reports ctrlKey===true — keying
      off that swallowed the arrows/Space pressed during a jump, breaking
      simultaneous jump+move/jump+fire on the keyboard. Game input wins; F5 still
      reloads. (Browser-reserved chords like Ctrl+W are handled by the browser
      before the page anyway, so this doesn't trap the user.) */
  private isBrowserShortcut(e: KeyboardEvent): boolean {
    if (e.metaKey) return true;
    return e.code === "F5" || e.code === "F11" || e.code === "F12";
  }

  private attachKeyboard(): void {
    if (this.keyHandlersAttached) return;
    this.keyHandlersAttached = true;
    window.addEventListener("keydown", (e) => {
      if (this.capturing || this.isBrowserShortcut(e)) return;
      const scs = this.scancodesFor(e);
      if (!scs.length) return;
      e.preventDefault();
      if (e.repeat) return; // auto-repeat: already held (suppressed in emit anyway)
      this.heldByCode.set(e.code, scs);
      for (const sc of scs) this.emit(sc, true);
    }, { passive: false });
    window.addEventListener("keyup", (e) => {
      const scs = this.heldByCode.get(e.code);
      if (!scs) return; // release exactly what this physical key pressed
      this.heldByCode.delete(e.code);
      for (const sc of scs) this.emit(sc, false);
    });
    // Releasing everything on blur avoids "stuck" keys when focus is lost.
    window.addEventListener("blur", () => this.releaseAllDown());
  }

  // --- Audio --------------------------------------------------------------
  private startAudio(): void {
    if (!this.m || this.audioCtx) return;
    const Ctx: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    // The engine inits its FM synth at 44.1 kHz (ID_SD.C), so request a matching
    // context rate to keep pitch/tempo correct.
    let ctx: AudioContext;
    try {
      ctx = new Ctx({ sampleRate: 44100, latencyHint: "interactive" });
    } catch {
      ctx = new Ctx();
    }
    const frames = 2048;
    this.audioBuf = this.m._malloc(frames * 4);
    // ScriptProcessor runs on the main thread, so it can call the (main-thread)
    // wasm instance directly; it fires during ASYNCIFY yields. Deprecated but
    // universally supported and simplest for a single-threaded wasm.
    const node = ctx.createScriptProcessor(frames, 0, 1);
    node.onaudioprocess = (ev: AudioProcessingEvent) => {
      const out = ev.outputBuffer.getChannelData(0);
      const m = this.m;
      if (!m || ctx.state !== "running") { out.fill(0); return; }
      m._SD_AudioRender(this.audioBuf, out.length);
      const p = this.audioBuf >> 2;
      out.set(m.HEAPF32.subarray(p, p + out.length));
    };
    // Tap the signal with an analyser (drives the audio-active check / any
    // future visualiser) before it reaches the speakers.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    node.connect(analyser);
    analyser.connect(ctx.destination);
    this.audioCtx = ctx;
    this.audioNode = node;
    this.audioAnalyser = analyser;
  }

  /** Peak |sample| of the live audio output in [0,1] — 0 when silent. Lets the
      shell (and tests) confirm the FM synth is actually producing sound. */
  audioLevel(): number {
    const a = this.audioAnalyser;
    if (!a) return 0;
    const buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > peak) peak = v; }
    return peak;
  }

  dispose(): void {
    try { this.audioNode?.disconnect(); } catch { /* noop */ }
    try { void this.audioCtx?.close(); } catch { /* noop */ }
  }
}
