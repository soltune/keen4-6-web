/* ===========================================================================
   Shell <-> Engine contract.

   The web shell (display / input / audio / storage) is engine-agnostic. During
   Phase 1 it drives a MockEngine; in Phase 3+ the same contract is satisfied by
   the Emscripten-compiled ID Engine (the WASM module exposes these as exported
   functions / memory views). Keeping the surface small makes the swap clean.
   =========================================================================== */

/** Commander Keen Galaxy runs at EGA 320x200, 16 colours. */
export const SCREEN_W = 320;
export const SCREEN_H = 200;

/** Authentic display aspect: 320x200 stretched to a 4:3 CRT. */
export const DISPLAY_ASPECT = 4 / 3;

/**
 * Unified player controller, assembled by the input layer from keyboard,
 * Gamepad API and the on-screen virtual pad. Maps onto Keen's controls.
 */
export interface ControllerState {
  /** -1 (left), 0, +1 (right) */
  dx: -1 | 0 | 1;
  /** -1 (up), 0, +1 (down) */
  dy: -1 | 0 | 1;
  jump: boolean;
  pogo: boolean;
  fire: boolean;
}

/** Edge-triggered UI/menu actions (debounced in the input layer). */
export interface UiEdges {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
  pause: boolean;
}

export interface EngineInput {
  controller: ControllerState;
  ui: UiEdges;
}

/**
 * One frame of video the engine wants displayed.
 * `indices` are palette indices (0..palette.length/3-1) for an SCREEN_W*SCREEN_H
 * image. `palette` is packed RGB (3 bytes per colour). The engine owns the
 * buffers; the display layer only reads them.
 */
export interface VideoFrame {
  indices: Uint8Array; // SCREEN_W * SCREEN_H
  palette: Uint8Array; // N*3 (N = 16 for EGA)
}

/**
 * Audio is pull-based to fit Web Audio's AudioWorklet model: the audio graph
 * asks the engine to render `frames` mono samples (Float32, -1..1) at the
 * engine's output rate. The real engine renders OPL2 here; the mock can emit a
 * tone or silence.
 */
export type AudioRenderFn = (out: Float32Array, frames: number) => void;

export interface GameEngine {
  /** Episode id, e.g. "ck4". */
  readonly id: string;
  /** Async one-time setup (loads/decodes game data). */
  init(): Promise<void>;
  /** Advance the simulation by one display frame. `input` is the latest state. */
  tick(input: EngineInput, dtMs: number): void;
  /** Current video output to blit. */
  render(): VideoFrame;
  /** Output sample rate for the audio render callback. */
  readonly audioSampleRate: number;
  /** Pull-based audio renderer (called from the audio thread/worklet). */
  readonly audioRender: AudioRenderFn;
  /** Release resources. */
  dispose(): void;
}
