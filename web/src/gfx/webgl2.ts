/* ===========================================================================
   WebGL2Renderer — shader presentation path.

   Uploads the engine's 320x200 RGBA frame as a texture and draws a fullscreen
   quad through the selected shader program, at the canvas's output resolution
   (CSS size x dpr) so the fragment shader runs per output pixel. Speaks the
   libretro GLSL uniform convention so ported presets work unchanged.

   Construction throws if WebGL2 is unavailable; Display catches that and falls
   back to Canvas2DRenderer. The quad feeds VertexCoord with a size-2 pointer
   against a vec4 attribute, so the GPU fills (x, y, 0, 1) automatically.
   =========================================================================== */

import { SCREEN_W, SCREEN_H, type VideoFrame } from "../engine/types";
import type { FrameRenderer } from "./types";
import { getShaderProgram, type ShaderDef } from "./shaders";

// Column-major identity; VertexCoord is already in clip space.
const IDENTITY4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

const UNIFORM_NAMES = [
  "Texture", "MVPMatrix", "TextureSize", "InputSize", "OutputSize",
  "FrameCount", "FrameDirection",
] as const;

export function isWebGL2Available(): boolean {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

export class WebGL2Renderer implements FrameRenderer {
  readonly kind = "webgl2" as const;

  private gl: WebGL2RenderingContext;
  private tex: WebGLTexture;
  private quad: WebGLBuffer;
  private def!: ShaderDef;
  private aVertex = -1;
  private aTex = -1;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private paramLocs: { loc: WebGLUniformLocation | null; value: number }[] = [];

  private rgba = new Uint8Array(SCREEN_W * SCREEN_H * 4);
  private rgba32 = new Uint32Array(this.rgba.buffer);
  private paletteLut = new Uint32Array(256);

  private bufW = SCREEN_W;
  private bufH = SCREEN_H;
  private frameCount = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.gl = gl;

    this.tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SCREEN_W, SCREEN_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    // Fullscreen quad: x, y (clip space), u, v. Row 0 of the texture (= top of
    // the frame) maps to v=0, which we place on the top (clip y=+1) vertices.
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

    this.setShader("passthrough");
  }

  /** Switch the active shader program (recompiles, rebinds locations). */
  setShader(id: string): void {
    const gl = this.gl;
    const def = getShaderProgram(gl, id);
    if (this.def) gl.deleteProgram(this.def.program);
    this.def = def;

    gl.useProgram(def.program);
    this.aVertex = gl.getAttribLocation(def.program, "VertexCoord");
    this.aTex = gl.getAttribLocation(def.program, "TexCoord");
    this.uniforms = {};
    for (const n of UNIFORM_NAMES) this.uniforms[n] = gl.getUniformLocation(def.program, n);
    this.paramLocs = def.params.map((p) => ({
      loc: gl.getUniformLocation(def.program, p.name),
      value: p.value,
    }));

    const filt = def.filterLinear ? gl.LINEAR : gl.NEAREST;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filt);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filt);
  }

  drawRGBA(rgba: Uint8Array): void {
    this.upload(rgba);
    this.present();
  }

  drawIndexed(frame: VideoFrame): void {
    const pal = frame.palette;
    const n = (pal.length / 3) | 0;
    const lut = this.paletteLut;
    for (let i = 0; i < n; i++) {
      // texImage2D RGBA byte order => pack as 0xAABBGGRR (little-endian)
      lut[i] = (0xff << 24) | (pal[i * 3 + 2] << 16) | (pal[i * 3 + 1] << 8) | pal[i * 3];
    }
    const src = frame.indices;
    const dst = this.rgba32;
    const count = SCREEN_W * SCREEN_H;
    for (let i = 0; i < count; i++) dst[i] = lut[src[i]];
    this.upload(this.rgba);
    this.present();
  }

  clear(): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.bufW, this.bufH);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.bufW = Math.max(1, Math.round(cssW * dpr));
    this.bufH = Math.max(1, Math.round(cssH * dpr));
    this.canvas.width = this.bufW;
    this.canvas.height = this.bufH;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.tex);
    gl.deleteBuffer(this.quad);
    if (this.def) gl.deleteProgram(this.def.program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private upload(rgba: Uint8Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SCREEN_W, SCREEN_H, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  }

  private present(): void {
    const gl = this.gl;
    gl.viewport(0, 0, this.bufW, this.bufH);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.def.program);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    if (this.aVertex >= 0) {
      gl.enableVertexAttribArray(this.aVertex);
      gl.vertexAttribPointer(this.aVertex, 2, gl.FLOAT, false, 16, 0);
    }
    if (this.aTex >= 0) {
      gl.enableVertexAttribArray(this.aTex);
      gl.vertexAttribPointer(this.aTex, 2, gl.FLOAT, false, 16, 8);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);

    const u = this.uniforms;
    if (u.Texture) gl.uniform1i(u.Texture, 0);
    if (u.MVPMatrix) gl.uniformMatrix4fv(u.MVPMatrix, false, IDENTITY4);
    if (u.TextureSize) gl.uniform2f(u.TextureSize, SCREEN_W, SCREEN_H);
    if (u.InputSize) gl.uniform2f(u.InputSize, SCREEN_W, SCREEN_H);
    if (u.OutputSize) gl.uniform2f(u.OutputSize, this.bufW, this.bufH);
    // FrameCount / FrameDirection are int in the libretro convention.
    if (u.FrameCount) gl.uniform1i(u.FrameCount, this.frameCount);
    if (u.FrameDirection) gl.uniform1i(u.FrameDirection, 1);
    for (const p of this.paramLocs) if (p.loc) gl.uniform1f(p.loc, p.value);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.frameCount++;
  }
}
