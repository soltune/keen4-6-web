/* ===========================================================================
   Canvas2DRenderer — the original presentation path.

   Indexed/RGBA frame -> ImageData -> putImageData on a native 320x200 backing
   store, upscaled by the browser via CSS `image-rendering: pixelated`. No GPU,
   no shader. This is the default and the fallback when WebGL2 is unavailable.
   =========================================================================== */

import { SCREEN_W, SCREEN_H, type VideoFrame } from "../engine/types";
import type { FrameRenderer } from "./types";

export class Canvas2DRenderer implements FrameRenderer {
  readonly kind = "canvas2d" as const;

  private ctx: CanvasRenderingContext2D;
  private image: ImageData;
  private rgba: Uint32Array; // view over image.data for fast palette writes
  private paletteLut = new Uint32Array(256); // index -> packed RGBA (LE)

  constructor(canvas: HTMLCanvasElement) {
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    this.image = ctx.createImageData(SCREEN_W, SCREEN_H);
    this.rgba = new Uint32Array(this.image.data.buffer);
  }

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

  drawIndexed(frame: VideoFrame): void {
    this.updatePalette(frame.palette);
    const lut = this.paletteLut;
    const src = frame.indices;
    const dst = this.rgba;
    const count = SCREEN_W * SCREEN_H;
    for (let i = 0; i < count; i++) dst[i] = lut[src[i]];
    this.ctx.putImageData(this.image, 0, 0);
  }

  drawRGBA(rgba: Uint8Array): void {
    this.image.data.set(rgba);
    this.ctx.putImageData(this.image, 0, 0);
  }

  clear(): void {
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }

  // Backing store stays 320x200; Display sets the CSS size, the browser scales.
  resize(): void {}

  dispose(): void {}
}
