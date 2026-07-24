/* ===========================================================================
   WebGL2Renderer — shader presentation path.

   Uploads the engine's 320x200 RGBA frame as a texture and hands it to the
   selected preset's ShaderPipeline, whose final pass draws a fullscreen quad
   at the canvas's output resolution (CSS size x dpr) so the fragment shader
   runs per output pixel. Speaks the libretro GLSL uniform convention so
   ported presets work unchanged; multi-pass presets (FBOs, feedback) are
   handled inside ShaderPipeline.

   Construction throws if WebGL2 is unavailable; Display catches that and falls
   back to Canvas2DRenderer.
   =========================================================================== */

import { SCREEN_W, SCREEN_H, type VideoFrame } from "../engine/types";
import type { FrameRenderer } from "./types";
import { ShaderPipeline } from "./pipeline";

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
  private pipeline!: ShaderPipeline;

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

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);

    this.setShader("passthrough");
  }

  /** Switch the active shader preset (recompiles its pass chain). */
  setShader(id: string): void {
    const gl = this.gl;
    const pipeline = new ShaderPipeline(gl, id, SCREEN_W, SCREEN_H); // throws → old stays
    if (this.pipeline) this.pipeline.dispose();
    this.pipeline = pipeline;

    const filt = pipeline.inputFilterLinear ? gl.LINEAR : gl.NEAREST;
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
    if (this.pipeline) this.pipeline.dispose();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  private upload(rgba: Uint8Array): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SCREEN_W, SCREEN_H, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  }

  private present(): void {
    this.clear();
    this.pipeline.render(this.tex, this.bufW, this.bufH, this.frameCount);
    this.frameCount++;
  }
}
