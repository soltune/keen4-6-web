/* ===========================================================================
   Display layer.

   Owns the on-screen <canvas> rectangle — aspect-correct letterbox, fullscreen —
   and delegates pixel presentation to a FrameRenderer:
     - Canvas2DRenderer (default): putImageData, CSS-upscaled. No shader.
     - WebGL2Renderer:             texture + fragment shader (CRT / scanline / …).

   Switching renderer kind swaps the underlying <canvas> element, since a canvas
   can only ever vend one context type. Selecting a shader falls back to 2D when
   WebGL2 is unavailable or a program fails to build, so the game always renders.
   =========================================================================== */

import { SCREEN_W, SCREEN_H, DISPLAY_ASPECT, type VideoFrame } from "./engine/types";
import type { FrameRenderer, RendererKind } from "./gfx/types";
import { Canvas2DRenderer } from "./gfx/canvas2d";
import { WebGL2Renderer, isWebGL2Available } from "./gfx/webgl2";
import { listShaders } from "./gfx/shaders";

export type AspectMode = "4:3" | "pixel";

export class Display {
  private canvas: HTMLCanvasElement;
  private container: HTMLElement;
  private currentAspect: AspectMode = "4:3";
  private integerScale = false;
  private renderer: FrameRenderer;
  private shaderId: string | null = null;
  private lastRGBA: Uint8Array | null = null; // most recent frame (a volatile wasm-heap view)

  constructor(canvas: HTMLCanvasElement, container: HTMLElement) {
    this.canvas = canvas;
    this.container = container;
    this.renderer = new Canvas2DRenderer(canvas);

    window.addEventListener("resize", this.relayout);
    window.addEventListener("orientationchange", this.relayout);
    document.addEventListener("fullscreenchange", this.relayout);
    this.relayout();
  }

  setAspectMode(mode: AspectMode): void {
    this.currentAspect = mode;
    this.relayout();
  }

  /** The current aspect mode (for the settings panel's segmented control). */
  get aspectMode(): AspectMode {
    return this.currentAspect;
  }

  /** Whether integer scaling is currently enabled. */
  get integerScaleEnabled(): boolean {
    return this.integerScale;
  }

  /**
   * Snap the displayed image to an integer multiple of the source grid. Trades
   * some screen fill (black borders) for uniform pixels / even scanlines, which
   * matters most for CRT & scanline shaders.
   */
  setIntegerScale(on: boolean): void {
    this.integerScale = on;
    this.relayout();
  }

  // --- Shader selection ----------------------------------------------------

  /** Whether a hardware shader path is available on this device. */
  get shaderSupported(): boolean {
    return isWebGL2Available();
  }

  /** Currently active shader preset id, or null for the plain 2D path. */
  get shader(): string | null {
    return this.shaderId;
  }

  /** Ids of all selectable shader presets (for the settings gallery). */
  availableShaders(): string[] {
    return listShaders();
  }

  /**
   * Select a shader preset (null = none / plain 2D). Switching to/from a shader
   * swaps the renderer (and the <canvas>). Falls back to 2D if WebGL2 is
   * unavailable or the program fails to build.
   */
  setShader(id: string | null): void {
    if (id === this.shaderId) return;
    try {
      const wantGL = id !== null;
      if (wantGL && this.renderer.kind !== "webgl2") this.switchRenderer("webgl2");
      else if (!wantGL && this.renderer.kind !== "canvas2d") this.switchRenderer("canvas2d");

      if (this.renderer.kind === "webgl2") {
        (this.renderer as WebGL2Renderer).setShader(id!);
      }
      this.shaderId = this.renderer.kind === "webgl2" ? id : null;
    } catch (err) {
      console.warn("Shader select failed; falling back to 2D:", err);
      if (this.renderer.kind !== "canvas2d") this.switchRenderer("canvas2d");
      this.shaderId = null;
    }
    this.relayout();
  }

  /** Replace the renderer (and its <canvas>) with one of the given kind. */
  private switchRenderer(kind: RendererKind): void {
    const fresh = document.createElement("canvas");
    fresh.id = this.canvas.id;
    fresh.className = this.canvas.className;
    // Construct first: if it throws (e.g. no WebGL2), current state is intact.
    const next = kind === "webgl2"
      ? new WebGL2Renderer(fresh)
      : new Canvas2DRenderer(fresh);
    this.canvas.replaceWith(fresh);
    this.renderer.dispose();
    this.canvas = fresh;
    this.renderer = next;
  }

  // --- Frame presentation (delegated) --------------------------------------

  /** Blit a pre-resolved RGBA frame (the wasm engine's framebuffer). */
  drawRGBA(rgba: Uint8Array): void {
    this.lastRGBA = rgba;
    this.renderer.drawRGBA(rgba);
  }

  /**
   * A *copy* of the most recent RGBA frame (SCREEN_W*SCREEN_H*4), or null if
   * none yet. The engine's frame is a view over the wasm heap valid only until
   * the next call, so we slice it; callers (e.g. the shader-gallery thumbnails)
   * own the returned buffer.
   */
  snapshotFrame(): Uint8Array | null {
    return this.lastRGBA ? this.lastRGBA.slice() : null;
  }

  /** Blit one indexed frame + palette. */
  draw(frame: VideoFrame): void {
    this.renderer.drawIndexed(frame);
  }

  clear(): void {
    this.renderer.clear();
  }

  /** Compute the largest aspect-correct rectangle that fits the window. */
  private relayout = (): void => {
    const cw = this.container.clientWidth || window.innerWidth;
    const ch = this.container.clientHeight || window.innerHeight;
    const target = this.currentAspect === "4:3" ? DISPLAY_ASPECT : SCREEN_W / SCREEN_H;
    let w = cw;
    let h = Math.round(cw / target);
    if (h > ch) {
      h = ch;
      w = Math.round(ch * target);
    }
    // Integer scaling: snap the height down to a whole multiple of the source
    // (200) so each source line maps to a constant number of output rows (even
    // scanlines); width follows the chosen aspect. In pixel mode (target=1.6)
    // this also makes the width an exact 320*k. Skipped when the viewport is too
    // short for even 1x (k<1), where we keep the plain letterbox fit.
    if (this.integerScale) {
      const k = Math.floor(h / SCREEN_H);
      if (k >= 1) {
        h = SCREEN_H * k;
        w = Math.round(h * target);
      }
    }
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    // Cap dpr so the shader's drawing buffer stays sane on hi-dpi mobile.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.resize(w, h, dpr);
  };

  // --- Fullscreen ----------------------------------------------------------
  get isFullscreen(): boolean {
    return document.fullscreenElement != null;
  }

  async toggleFullscreen(): Promise<void> {
    try {
      if (this.isFullscreen) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen({ navigationUI: "hide" });
      }
    } catch (err) {
      console.warn("Fullscreen request failed:", err);
    }
  }
}
