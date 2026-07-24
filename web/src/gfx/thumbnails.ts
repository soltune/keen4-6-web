/* ===========================================================================
   ShaderThumbnailer — live preset previews for the ⚙ gallery.

   Owns one *offscreen* WebGL2 context (independent of the on-screen renderer)
   and, given a snapshot of the current frame, renders that frame through each
   shader preset into a small <canvas> tile. This turns the gallery from a list
   of names into a "see it, tap it" picker.

   Rendering goes through the same ShaderPipeline as the live path, but on
   this context with its own compiled pipelines, so the live render path stays
   untouched. Pipelines are compiled once and cached across opens. Multi-pass
   presets render at frameCount=0 — feedback reads start black, so temporal
   effects (ghost trails) don't show in a one-shot tile, which is fine for a
   preview. Construction throws if WebGL2 is unavailable; callers guard with
   isWebGL2Available() / try-catch.
   =========================================================================== */

import { SCREEN_W, SCREEN_H } from "../engine/types";
import { ShaderPipeline } from "./pipeline";

/** A tile to fill: its target 2D canvas + the preset id (null = original). */
export interface ThumbItem {
  id: string | null;
  canvas: HTMLCanvasElement;
}

export class ShaderThumbnailer {
  private gl: WebGL2RenderingContext;
  private glCanvas: HTMLCanvasElement;
  private tex: WebGLTexture;
  private pipelines = new Map<string, ShaderPipeline>(); // keyed by resolved source id
  private renderW: number;
  private renderH: number;

  /**
   * @param renderW/@param renderH  Internal render resolution (the offscreen
   *   drawing buffer). We render at a *magnification* of the 320x200 source
   *   (default 2x = 640x400) so the upscaler shaders (CRT warp/mask, sharp-
   *   bilinear, xBRZ) run in their intended regime and previews match the live
   *   look; drawImage then downscales the shaded result into each (smaller) tile.
   */
  constructor(renderW = SCREEN_W * 2, renderH = SCREEN_H * 2) {
    this.renderW = Math.max(1, Math.round(renderW));
    this.renderH = Math.max(1, Math.round(renderH));

    const canvas = document.createElement("canvas");
    canvas.width = this.renderW;
    canvas.height = this.renderH;
    // preserveDrawingBuffer so drawImage() can copy the backbuffer reliably
    // after each draw, even across the (synchronous) tile loop.
    const gl = canvas.getContext("webgl2", {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;
    this.glCanvas = canvas;

    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SCREEN_W, SCREEN_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
  }

  /** Upload `rgba` once, then render it through each item's preset into its tile. */
  render(rgba: Uint8Array, items: ThumbItem[]): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SCREEN_W, SCREEN_H, gl.RGBA, gl.UNSIGNED_BYTE, rgba);

    for (const item of items) {
      // null (original) previews via the plain passthrough program.
      const pipeline = this.acquire(item.id ?? "passthrough");
      this.draw(pipeline);
      this.copyTo(item.canvas);
    }
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.tex);
    // The failure fallback aliases ids to one shared pipeline — dedupe.
    for (const p of new Set(this.pipelines.values())) p.dispose();
    this.pipelines.clear();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  /** Compile (or fetch cached) a pipeline; fall back to passthrough on failure. */
  private acquire(id: string): ShaderPipeline {
    const hit = this.pipelines.get(id);
    if (hit) return hit;
    try {
      const pipeline = new ShaderPipeline(this.gl, id, SCREEN_W, SCREEN_H);
      this.pipelines.set(id, pipeline);
      return pipeline;
    } catch (err) {
      console.warn(`Thumbnail shader '${id}' failed; previewing original:`, err);
      const fallback = this.acquire("passthrough"); // never recurses past this
      this.pipelines.set(id, fallback); // memoize so we don't retry a broken shader
      return fallback;
    }
  }

  private draw(pipeline: ShaderPipeline): void {
    const gl = this.gl;
    const filt = pipeline.inputFilterLinear ? gl.LINEAR : gl.NEAREST;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.renderW, this.renderH);
    gl.clear(gl.COLOR_BUFFER_BIT);

    pipeline.render(this.tex, this.renderW, this.renderH, 0);
  }

  /** Copy the offscreen GL result into a tile's 2D canvas (scaled to its size). */
  private copyTo(target: HTMLCanvasElement): void {
    const ctx = target.getContext("2d");
    if (!ctx) return;
    // Smooth the high-res (640x400) shaded result down into the small tile.
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(this.glCanvas, 0, 0, target.width, target.height);
  }
}
