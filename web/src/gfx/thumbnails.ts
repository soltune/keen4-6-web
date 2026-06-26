/* ===========================================================================
   ShaderThumbnailer — live preset previews for the ⚙ gallery.

   Owns one *offscreen* WebGL2 context (independent of the on-screen renderer)
   and, given a snapshot of the current frame, renders that frame through each
   shader preset into a small <canvas> tile. This turns the gallery from a list
   of names into a "see it, tap it" picker.

   It deliberately duplicates the minimal quad/uniform plumbing of WebGL2Renderer
   rather than reusing it, so the live render path stays untouched. Programs are
   compiled once and cached across opens. Construction throws if WebGL2 is
   unavailable; callers guard with isWebGL2Available() / try-catch.
   =========================================================================== */

import { SCREEN_W, SCREEN_H } from "../engine/types";
import { getShaderProgram, type ShaderDef } from "./shaders";

// Column-major identity; VertexCoord is already in clip space.
const IDENTITY4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

const UNIFORM_NAMES = [
  "Texture", "MVPMatrix", "TextureSize", "InputSize", "OutputSize",
  "FrameCount", "FrameDirection",
] as const;

/** A tile to fill: its target 2D canvas + the preset id (null = original). */
export interface ThumbItem {
  id: string | null;
  canvas: HTMLCanvasElement;
}

interface Cached {
  def: ShaderDef;
  aVertex: number;
  aTex: number;
  uniforms: Record<string, WebGLUniformLocation | null>;
  paramLocs: { loc: WebGLUniformLocation | null; value: number }[];
}

export class ShaderThumbnailer {
  private gl: WebGL2RenderingContext;
  private glCanvas: HTMLCanvasElement;
  private tex: WebGLTexture;
  private quad: WebGLBuffer;
  private programs = new Map<string, Cached>(); // keyed by resolved source id
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

    // Fullscreen quad: x, y (clip space), u, v. Same orientation as WebGL2Renderer
    // (row 0 of the texture = top of the frame = v=0 on the top vertices).
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 1,
       1, -1, 1, 1,
      -1,  1, 0, 0,
       1,  1, 1, 0,
    ]), gl.STATIC_DRAW);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
  }

  /** Upload `rgba` once, then render it through each item's preset into its tile. */
  render(rgba: Uint8Array, items: ThumbItem[]): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SCREEN_W, SCREEN_H, gl.RGBA, gl.UNSIGNED_BYTE, rgba);

    for (const item of items) {
      // null (original) previews via the plain passthrough program.
      const entry = this.acquire(item.id ?? "passthrough");
      this.draw(entry);
      this.copyTo(item.canvas);
    }
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.tex);
    gl.deleteBuffer(this.quad);
    for (const e of this.programs.values()) gl.deleteProgram(e.def.program);
    this.programs.clear();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  /** Compile (or fetch cached) a program; fall back to passthrough on failure. */
  private acquire(id: string): Cached {
    const hit = this.programs.get(id);
    if (hit) return hit;
    try {
      const entry = this.build(id);
      this.programs.set(id, entry);
      return entry;
    } catch (err) {
      console.warn(`Thumbnail shader '${id}' failed; previewing original:`, err);
      const fallback = this.acquire("passthrough"); // never recurses past this
      this.programs.set(id, fallback); // memoize so we don't retry a broken shader
      return fallback;
    }
  }

  private build(id: string): Cached {
    const gl = this.gl;
    const def = getShaderProgram(gl, id);
    gl.useProgram(def.program);
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const n of UNIFORM_NAMES) uniforms[n] = gl.getUniformLocation(def.program, n);
    return {
      def,
      aVertex: gl.getAttribLocation(def.program, "VertexCoord"),
      aTex: gl.getAttribLocation(def.program, "TexCoord"),
      uniforms,
      paramLocs: def.params.map((p) => ({ loc: gl.getUniformLocation(def.program, p.name), value: p.value })),
    };
  }

  private draw(e: Cached): void {
    const gl = this.gl;
    const filt = e.def.filterLinear ? gl.LINEAR : gl.NEAREST;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);

    gl.viewport(0, 0, this.renderW, this.renderH);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(e.def.program);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    if (e.aVertex >= 0) {
      gl.enableVertexAttribArray(e.aVertex);
      gl.vertexAttribPointer(e.aVertex, 2, gl.FLOAT, false, 16, 0);
    }
    if (e.aTex >= 0) {
      gl.enableVertexAttribArray(e.aTex);
      gl.vertexAttribPointer(e.aTex, 2, gl.FLOAT, false, 16, 8);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);

    const u = e.uniforms;
    if (u.Texture) gl.uniform1i(u.Texture, 0);
    if (u.MVPMatrix) gl.uniformMatrix4fv(u.MVPMatrix, false, IDENTITY4);
    if (u.TextureSize) gl.uniform2f(u.TextureSize, SCREEN_W, SCREEN_H);
    if (u.InputSize) gl.uniform2f(u.InputSize, SCREEN_W, SCREEN_H);
    if (u.OutputSize) gl.uniform2f(u.OutputSize, this.renderW, this.renderH);
    // FrameCount / FrameDirection are int in the libretro convention.
    if (u.FrameCount) gl.uniform1i(u.FrameCount, 0);
    if (u.FrameDirection) gl.uniform1i(u.FrameDirection, 1);
    for (const p of e.paramLocs) if (p.loc) gl.uniform1f(p.loc, p.value);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
