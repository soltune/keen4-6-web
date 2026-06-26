/* ===========================================================================
   Renderer abstraction for the display layer.

   A FrameRenderer owns the <canvas> drawing surface and presents the engine's
   320x200 frames. Two implementations exist:
     - Canvas2DRenderer: the original putImageData path (no shader).
     - WebGL2Renderer:   uploads the frame as a texture and runs a fragment
                         shader (CRT / scanline / upscalers) at output res.

   Display picks/swaps renderers. Switching kinds requires a fresh <canvas>
   element (a canvas can only ever vend one context type), which Display owns.
   =========================================================================== */

import type { VideoFrame } from "../engine/types";

export type RendererKind = "canvas2d" | "webgl2";

export interface FrameRenderer {
  readonly kind: RendererKind;

  /** Present a pre-resolved RGBA frame (SCREEN_W*SCREEN_H*4 bytes). Hot path. */
  drawRGBA(rgba: Uint8Array): void;

  /** Present an indexed frame + packed-RGB palette. */
  drawIndexed(frame: VideoFrame): void;

  /** Clear to black. */
  clear(): void;

  /**
   * The on-screen rectangle changed. `cssW`/`cssH` are the CSS-pixel size of
   * the (letterboxed) canvas; `dpr` the device pixel ratio. A 2D renderer keeps
   * its 320x200 backing store and ignores this; a WebGL renderer sizes its
   * drawing buffer to cssW*dpr x cssH*dpr so the shader runs per output pixel.
   */
  resize(cssW: number, cssH: number, dpr: number): void;

  /** Release GPU/CPU resources before the canvas is discarded. */
  dispose(): void;
}
