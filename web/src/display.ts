/* ===========================================================================
   Display layer.

   Responsibilities (goal requirements #3, #4):
     - Blit the engine's indexed framebuffer to a 320x200 canvas.
     - Scale to fill the window while preserving aspect ratio (letterbox).
     - Fullscreen toggle.

   The canvas keeps its native 320x200 backing store and is upscaled by the
   browser with `image-rendering: pixelated`, so we never pay for per-pixel
   scaling in JS and stay crisp at any size.
   =========================================================================== */

import { SCREEN_W, SCREEN_H, DISPLAY_ASPECT, type VideoFrame } from "./engine/types";

export type AspectMode = "4:3" | "pixel";

export class Display {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private image: ImageData;
  private rgba: Uint32Array; // view over image.data for fast palette writes
  private paletteLut = new Uint32Array(256); // index -> packed RGBA (little-endian)
  private aspectMode: AspectMode = "4:3";
  private container: HTMLElement;

  constructor(canvas: HTMLCanvasElement, container: HTMLElement) {
    this.canvas = canvas;
    this.container = container;
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.image = ctx.createImageData(SCREEN_W, SCREEN_H);
    this.rgba = new Uint32Array(this.image.data.buffer);

    window.addEventListener("resize", this.relayout);
    window.addEventListener("orientationchange", this.relayout);
    document.addEventListener("fullscreenchange", this.relayout);
    this.relayout();
  }

  setAspectMode(mode: AspectMode): void {
    this.aspectMode = mode;
    this.relayout();
  }

  /** Compute the largest aspect-correct rectangle that fits the window. */
  private relayout = (): void => {
    const cw = this.container.clientWidth || window.innerWidth;
    const ch = this.container.clientHeight || window.innerHeight;
    const target = this.aspectMode === "4:3" ? DISPLAY_ASPECT : SCREEN_W / SCREEN_H;
    let w = cw;
    let h = Math.round(cw / target);
    if (h > ch) {
      h = ch;
      w = Math.round(ch * target);
    }
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
  };

  private updatePalette(palette: Uint8Array): void {
    const n = (palette.length / 3) | 0;
    for (let i = 0; i < n; i++) {
      const r = palette[i * 3];
      const g = palette[i * 3 + 1];
      const b = palette[i * 3 + 2];
      // ImageData is RGBA little-endian => 0xAABBGGRR
      this.paletteLut[i] = (0xff << 24) | (b << 16) | (g << 8) | r;
    }
  }

  /** Blit one indexed frame. */
  draw(frame: VideoFrame): void {
    this.updatePalette(frame.palette);
    const lut = this.paletteLut;
    const src = frame.indices;
    const dst = this.rgba;
    const count = SCREEN_W * SCREEN_H;
    for (let i = 0; i < count; i++) dst[i] = lut[src[i]];
    this.ctx.putImageData(this.image, 0, 0);
  }

  /** Blit a pre-resolved RGBA frame (e.g. the wasm engine's framebuffer).
      `rgba` must be SCREEN_W*SCREEN_H*4 bytes. */
  drawRGBA(rgba: Uint8Array): void {
    this.image.data.set(rgba);
    this.ctx.putImageData(this.image, 0, 0);
  }

  /** Convenience: clear to a solid palette index 0 colour. */
  clear(): void {
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }

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
