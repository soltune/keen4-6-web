/* ===========================================================================
   ShaderPipeline — executes a preset's pass chain on one WebGL2 context.

   Single-pass presets (everything before newpixie) draw straight to the
   caller's target, exactly as the old single-program path did. Multi-pass
   presets render every intermediate pass into a source-resolution FBO (the
   ported presets all use scale_type=source, scale=1.0) and only the final
   pass at output resolution.

   Coordinate invariant (matches the slang runtime): v=0 is the TOP of the
   frame for every sampled texture, FBOs included. GL writes FBO row 0 at
   NDC y=-1, so FBO passes draw with a v-flipped quad to preserve the
   invariant; the final (default-framebuffer) pass uses the normal quad.

   Cross-pass inputs are resolved by uniform-name introspection against the
   pass list — a fragment shader simply declares the sampler it wants:
   - `<alias>`         that pass's CURRENT-frame output (e.g. accum1, blur2)
   - `PassFeedback<N>` pass N's PREVIOUS-frame output (slang feedback)
   Every intermediate pass is double-buffered — frame f writes tex[f%2],
   feedback reads the other half — so feedback needs no extra bookkeeping,
   at the cost of one spare 320x200 texture per pass. Feedback textures
   start zeroed, which newpixie's `max(prev*0.65, src*0.96)` handles fine.

   Shared by WebGL2Renderer (live path) and ShaderThumbnailer (gallery); each
   owns its own instance on its own context.
   =========================================================================== */

import { getShaderPasses, type ShaderPassDef } from "./shaders";

// Column-major identity; VertexCoord is already in clip space.
const IDENTITY4 = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

const UNIFORM_NAMES = [
  "Texture", "MVPMatrix", "TextureSize", "InputSize", "OutputSize",
  "FrameCount", "FrameDirection",
] as const;

interface PassTarget {
  fb: [WebGLFramebuffer, WebGLFramebuffer];
  tex: [WebGLTexture, WebGLTexture];
}

interface PassRuntime {
  def: ShaderPassDef;
  aVertex: number;
  aTex: number;
  uniforms: Record<string, WebGLUniformLocation | null>;
  paramLocs: { loc: WebGLUniformLocation | null; value: number }[];
  /** Cross-pass samplers found by introspection (bound to units 1..n). */
  extra: { loc: WebGLUniformLocation; passIndex: number; feedback: boolean }[];
  /** Intermediate render target; null = final pass (caller's framebuffer). */
  target: PassTarget | null;
}

export class ShaderPipeline {
  readonly id: string;
  private gl: WebGL2RenderingContext;
  private passes: PassRuntime[];
  private quadNormal: WebGLBuffer;
  private quadFlipped: WebGLBuffer;
  /** Own VAO: scopes vertex-attrib enable/pointer state to this pipeline.
      Without it, an attrib slot enabled by a *previous* pipeline's program
      (attrib locations differ across programs) would outlive that pipeline's
      deleted quad buffers on the shared default VAO — and one enabled attrib
      with no buffer makes WebGL reject every drawArrays (black screen on
      preset→preset switches). */
  private vao: WebGLVertexArrayObject;

  constructor(
    gl: WebGL2RenderingContext,
    id: string,
    private srcW: number,
    private srcH: number,
  ) {
    this.gl = gl;
    this.id = id;
    const defs = getShaderPasses(gl, id); // throws on compile/link failure
    this.vao = gl.createVertexArray()!;

    this.passes = defs.map((def, i) => {
      const uniforms: Record<string, WebGLUniformLocation | null> = {};
      for (const n of UNIFORM_NAMES) uniforms[n] = gl.getUniformLocation(def.program, n);
      return {
        def,
        aVertex: gl.getAttribLocation(def.program, "VertexCoord"),
        aTex: gl.getAttribLocation(def.program, "TexCoord"),
        uniforms,
        paramLocs: def.params.map((p) => ({ loc: gl.getUniformLocation(def.program, p.name), value: p.value })),
        extra: [],
        target: i < defs.length - 1 ? this.makeTarget() : null,
      };
    });

    // Resolve cross-pass sampler uniforms now that every target exists.
    for (const p of this.passes) {
      this.passes.forEach((other, j) => {
        if (other === p || !other.target) return;
        if (other.def.alias) {
          const loc = gl.getUniformLocation(p.def.program, other.def.alias);
          if (loc) p.extra.push({ loc, passIndex: j, feedback: false });
        }
        const fl = gl.getUniformLocation(p.def.program, `PassFeedback${j}`);
        if (fl) p.extra.push({ loc: fl, passIndex: j, feedback: true });
      });
    }

    // x, y (clip space), u, v — normal: v=0 (top of frame) on the top
    // vertices, for drawing to the canvas; flipped: v=0 on the bottom
    // vertices, for drawing into FBOs (see coordinate invariant above).
    this.quadNormal = this.makeQuad([
      -1, -1, 0, 1,
       1, -1, 1, 1,
      -1,  1, 0, 0,
       1,  1, 1, 0,
    ]);
    this.quadFlipped = this.makeQuad([
      -1, -1, 0, 0,
       1, -1, 1, 0,
      -1,  1, 0, 1,
       1,  1, 1, 1,
    ]);
  }

  /** How the caller's source texture should be filtered (pass 0's setting). */
  get inputFilterLinear(): boolean {
    return this.passes[0].def.filterLinear;
  }

  /**
   * Run the chain: `sourceTex` in, final pass onto the *default framebuffer*
   * at outW x outH. The caller is expected to have cleared it. `frameCount`
   * drives animation uniforms and the feedback double-buffer parity, so pass
   * a per-frame counter on the live path (a constant is fine for one-shots).
   */
  render(sourceTex: WebGLTexture, outW: number, outH: number, frameCount: number): void {
    const gl = this.gl;
    const parity = frameCount & 1;
    gl.bindVertexArray(this.vao);

    for (let i = 0; i < this.passes.length; i++) {
      const p = this.passes[i];
      const final = p.target === null;

      gl.bindFramebuffer(gl.FRAMEBUFFER, final ? null : p.target!.fb[parity]);
      gl.viewport(0, 0, final ? outW : this.srcW, final ? outH : this.srcH);
      gl.useProgram(p.def.program);

      gl.bindBuffer(gl.ARRAY_BUFFER, final ? this.quadNormal : this.quadFlipped);
      if (p.aVertex >= 0) {
        gl.enableVertexAttribArray(p.aVertex);
        gl.vertexAttribPointer(p.aVertex, 2, gl.FLOAT, false, 16, 0);
      }
      if (p.aTex >= 0) {
        gl.enableVertexAttribArray(p.aTex);
        gl.vertexAttribPointer(p.aTex, 2, gl.FLOAT, false, 16, 8);
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, i === 0 ? sourceTex : this.passes[i - 1].target!.tex[parity]);
      let unit = 1;
      for (const ex of p.extra) {
        const t = this.passes[ex.passIndex].target!;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, ex.feedback ? t.tex[1 - parity] : t.tex[parity]);
        gl.uniform1i(ex.loc, unit);
        unit++;
      }

      const u = p.uniforms;
      if (u.Texture) gl.uniform1i(u.Texture, 0);
      if (u.MVPMatrix) gl.uniformMatrix4fv(u.MVPMatrix, false, IDENTITY4);
      // Source frame and every intermediate share the source resolution.
      if (u.TextureSize) gl.uniform2f(u.TextureSize, this.srcW, this.srcH);
      if (u.InputSize) gl.uniform2f(u.InputSize, this.srcW, this.srcH);
      if (u.OutputSize) gl.uniform2f(u.OutputSize, final ? outW : this.srcW, final ? outH : this.srcH);
      // FrameCount / FrameDirection are int in the libretro convention.
      if (u.FrameCount) gl.uniform1i(u.FrameCount, frameCount);
      if (u.FrameDirection) gl.uniform1i(u.FrameDirection, 1);
      for (const pl of p.paramLocs) if (pl.loc) gl.uniform1f(pl.loc, pl.value);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.bindVertexArray(null); // back to the default VAO for the caller
    gl.activeTexture(gl.TEXTURE0); // leave unit 0 active for the caller
  }

  dispose(): void {
    const gl = this.gl;
    for (const p of this.passes) {
      gl.deleteProgram(p.def.program);
      if (p.target) {
        for (const fb of p.target.fb) gl.deleteFramebuffer(fb);
        for (const t of p.target.tex) gl.deleteTexture(t);
      }
    }
    gl.deleteBuffer(this.quadNormal);
    gl.deleteBuffer(this.quadFlipped);
    gl.deleteVertexArray(this.vao);
  }

  private makeQuad(data: number[]): WebGLBuffer {
    const gl = this.gl;
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    return buf;
  }

  /** Double-buffered source-resolution RGBA8 target. LINEAR because every
      consumer in the ported presets sets filter_linear=true upstream. */
  private makeTarget(): PassTarget {
    const gl = this.gl;
    const make = (): [WebGLTexture, WebGLFramebuffer] => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      // null data = zeroed — a black first-frame feedback read is correct.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.srcW, this.srcH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return [tex, fb];
    };
    const [tex0, fb0] = make();
    const [tex1, fb1] = make();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb: [fb0, fb1], tex: [tex0, tex1] };
  }
}
