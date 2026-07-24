/* ===========================================================================
   Minimal shader registry for the WebGL2 renderer.

   Each entry is one pass or a chain of passes (vertex + fragment, GLSL ES
   1.00 — which WebGL2 compiles fine). Programs follow the libretro GLSL
   uniform convention (MVPMatrix / Texture / TextureSize / InputSize /
   OutputSize / FrameCount) so that ported libretro shaders slot in here
   unchanged save for a thin prelude. Multi-pass presets list their passes in
   preset order; execution, FBOs and cross-pass texture binding live in
   pipeline.ts (ShaderPipeline).

   Ported shaders keep their original license headers; an aggregate listing
   lives in CREDITS.md, each parsing its `#pragma parameter` defaults into
   `params` when parameterUniform is set.
   =========================================================================== */

// Verbatim libretro/glsl-shaders sources (see web/CREDITS for authors/licenses).
// Each is a single GLSL source guarded by VERTEX/FRAGMENT and uses its built-in
// default parameters when PARAMETER_UNIFORM is left undefined.
import crtGeomGlsl from "./shaders/crt-geom.glsl?raw"; // GPL (cgwg/Themaister/DOLLS) — curvature/geometry
import crtGdvMiniUltraGlsl from "./shaders/crt-gdv-mini-ultra-trinitron.glsl?raw"; // GPL (guest(r)/DariusG) — GDV mini ultra, Trinitron preset (ported from slang)
import scanlinesSineGlsl from "./shaders/scanlines-sine-abs.glsl?raw"; // Public Domain (RiskyJumps)
import xbrzGlsl from "./shaders/xbrz-freescale.glsl?raw"; // MIT (Hyllian)
import lcdDotmatrixGlsl from "./shaders/lcd-dotmatrix.glsl?raw"; // Public Domain — handheld LCD grid, color-preserving
import gbDmgGreenGlsl from "./shaders/gb-dmg-green.glsl?raw"; // Public Domain — Game Boy DMG 4-tone green + grid
// newpixie CRT (MIT/Unlicense, Mattias Gustavsson; slang adaptation hunterk) —
// 4-pass chain: accumulate (feedback) → H/V blur → compose. Ported from slang.
import npAccumulateGlsl from "./shaders/newpixie/accumulate.glsl?raw";
import npBlurHorizGlsl from "./shaders/newpixie/blur-horiz.glsl?raw";
import npBlurVertGlsl from "./shaders/newpixie/blur-vert.glsl?raw";
import npFinalGlsl from "./shaders/newpixie/newpixie-crt.glsl?raw";

export interface ShaderParam {
  name: string;
  value: number;
}

/** A user-facing gallery entry (null id = no shader / plain 2D path). */
export interface ShaderPreset {
  id: string | null;
  label: string;
}

/** One compiled pass of a preset (single-pass presets have exactly one). */
export interface ShaderPassDef {
  program: WebGLProgram;
  params: ShaderParam[];
  /** Source-texture sampling: GL_LINEAR (true) vs GL_NEAREST (false). */
  filterLinear: boolean;
  /** Preset-scoped name later passes bind this pass's output by (slang aliasN). */
  alias: string | null;
}

interface ShaderSource {
  /** Pre-split GLSL pair (e.g. passthrough). */
  vertex?: string;
  fragment?: string;
  /** Raw single-file libretro `.glsl`; split + version-adapted at compile time. */
  libretro?: string;
  params?: ShaderParam[];
  filterLinear?: boolean;
  /**
   * Compile with `#define PARAMETER_UNIFORM` and feed each `#pragma parameter`
   * its default value as a real uniform (instead of the `#else #define` path).
   * Needed by shaders whose `#define` fallbacks collide with local identifiers
   * (e.g. crt-geom defines `lum` as a parameter *and* uses it as a local var,
   * which only compiles when `lum` is a uniform that the local can shadow).
   */
  parameterUniform?: boolean;
  /** Multi-pass preset: passes in preset order (last one renders to screen).
      Mutually exclusive with the single-pass fields above. */
  passes?: { libretro: string; alias?: string; filterLinear?: boolean; parameterUniform?: boolean }[];
}

const PRECISION = `#ifdef GL_ES
precision highp float;
#endif
`;

const SOURCES: Record<string, ShaderSource> = {
  passthrough: {
    vertex: `${PRECISION}
attribute vec4 VertexCoord;
attribute vec4 TexCoord;
uniform mat4 MVPMatrix;
varying vec2 vTexCoord;
void main() {
  gl_Position = MVPMatrix * VertexCoord;
  vTexCoord = TexCoord.xy;
}`,
    fragment: `${PRECISION}
uniform sampler2D Texture;
varying vec2 vTexCoord;
void main() {
  gl_FragColor = texture2D(Texture, vTexCoord);
}`,
    filterLinear: false,
  },

  // Ported OSS presets. Each is single-pass and runs with its built-in default
  // parameters (PARAMETER_UNIFORM stays undefined). `filterLinear` mirrors the
  // upstream .glslp `filter_linear0`. See CREDITS.md for authors/licenses.
  "crt-geom": { libretro: crtGeomGlsl, filterLinear: false, parameterUniform: true }, // filter_linear0=false; needs PARAMETER_UNIFORM (lum collision)
  // .slangp sets no filter_linear; sampling is at texel centers so it's moot — NEAREST.
  "crt-gdv-mini-ultra-trinitron": { libretro: crtGdvMiniUltraGlsl, filterLinear: false },
  "scanlines-sine-abs": { libretro: scanlinesSineGlsl, filterLinear: false },
  "xbrz-freescale": { libretro: xbrzGlsl, filterLinear: false },
  // Handheld dot-matrix LCD (single-pass, no extra textures). NEAREST source so
  // each 320x200 texel reads as one crisp LCD dot.
  "lcd-dotmatrix": { libretro: lcdDotmatrixGlsl, filterLinear: false },
  "gb-dmg-green": { libretro: gbDmgGreenGlsl, filterLinear: false },
  // 4-pass chain mirroring upstream newpixie-crt.slangp (all filter_linearN =
  // true, intermediates at scale_type source 1.0). accumulate's ghost trail
  // reads blur1's previous frame (PassFeedback1); the final pass composes
  // accum1 + blur2. The upstream bezel texture stays off (use_frame 0.0).
  "newpixie-crt": {
    passes: [
      { libretro: npAccumulateGlsl, alias: "accum1", filterLinear: true },
      { libretro: npBlurHorizGlsl, alias: "blur1", filterLinear: true },
      { libretro: npBlurVertGlsl, alias: "blur2", filterLinear: true },
      { libretro: npFinalGlsl, filterLinear: true },
    ],
  },
};

/**
 * Split a self-contained libretro `.glsl` (one source guarded by
 * `#if defined(VERTEX)` / `#if defined(FRAGMENT)`) into the two stage sources
 * WebGL needs. We strip `#pragma` metadata lines and let the shader use its
 * compiled-in default parameters.
 *
 * `#version` handling: WebGL2 only accepts GLSL ES (`100` or `300 es`). A
 * desktop `#version >= 130` is remapped to `#version 300 es` (the shaders'
 * COMPAT macros already provide an in/out + `texture()` path under `>=130`);
 * lower/absent versions compile as ES 1.00. With `forceES3` the source is
 * always ES 3.00 — used as a retry for shaders that need ES3-only features
 * (array constructors etc.) regardless of their declared `#version`.
 * The directive is removed from the body since `#define`/code may not precede it.
 */
const ES3_PRELUDE = "#version 300 es\nprecision highp float;\nprecision highp int;\n";

function splitLibretro(glsl: string, forceES3 = false, parameterUniform = false): { vertex: string; fragment: string } {
  let prelude = ""; // "" => GLSL ES 1.00 (no #version directive)
  const kept: string[] = [];
  for (const line of glsl.split("\n")) {
    const t = line.trimStart();
    if (t.startsWith("#pragma")) continue;
    const vm = /^#version\s+(\d+)/.exec(t);
    if (vm) {
      if (parseInt(vm[1], 10) >= 130) prelude = ES3_PRELUDE;
      continue; // drop the original directive either way
    }
    kept.push(line);
  }
  if (forceES3) prelude = ES3_PRELUDE;
  // Take the shader's `#ifdef PARAMETER_UNIFORM` branch (real uniforms) instead
  // of its `#else #define` defaults; the caller then supplies the parsed values.
  const define = parameterUniform ? "#define PARAMETER_UNIFORM\n" : "";
  const body = kept.join("\n");
  return {
    vertex: `${prelude}${define}#define VERTEX\n${body}`,
    fragment: `${prelude}${define}#define FRAGMENT\n${body}`,
  };
}

/**
 * Extract `#pragma parameter NAME "desc" DEFAULT …` lines as {name, default}.
 * Used with `parameterUniform` to seed each tunable's compiled-in default value.
 */
function parsePragmaParams(glsl: string): ShaderParam[] {
  const out: ShaderParam[] = [];
  const re = /^\s*#pragma\s+parameter\s+(\w+)\s+"[^"]*"\s+(-?[0-9.]+)/;
  for (const line of glsl.split("\n")) {
    const m = re.exec(line);
    if (m) out.push({ name: m[1], value: parseFloat(m[2]) });
  }
  return out;
}

/** The user-facing gallery (HUD settings). 'passthrough' is test-only, omitted. */
export const SHADER_PRESETS: ShaderPreset[] = [
  { id: null, label: "Original" }, // no shader (raw output)
  // Each preset shows its upstream libretro shader name (the repo filename),
  // which is more recognizable / searchable than a feature description.
  { id: "crt-geom", label: "crt-geom" },
  { id: "crt-gdv-mini-ultra-trinitron", label: "crt-gdv-mini-ultra-trinitron" },
  { id: "scanlines-sine-abs", label: "scanlines-sine-abs" },
  { id: "xbrz-freescale", label: "xbrz-freescale" },
  { id: "lcd-dotmatrix", label: "lcd-dotmatrix" },
  { id: "gb-dmg-green", label: "gb-dmg-green" },
  { id: "newpixie-crt", label: "newpixie-crt" },
];

/** Ids of all registered shaders (verification harnesses enumerate these). */
export function listShaders(): string[] {
  return Object.keys(SOURCES);
}

/** Compile + link one libretro single-file source (with the ES 3.00 retry). */
function buildLibretro(gl: WebGL2RenderingContext, glsl: string, parameterUniform: boolean): WebGLProgram {
  try {
    const s = splitLibretro(glsl, false, parameterUniform);
    return link(gl, s.vertex, s.fragment);
  } catch (firstErr) {
    // Some shaders need ES 3.00 (array constructors, etc.) despite their
    // declared #version. Retry once forcing ES 3.00; else report the original.
    try {
      const s3 = splitLibretro(glsl, true, parameterUniform);
      return link(gl, s3.vertex, s3.fragment);
    } catch {
      throw firstErr;
    }
  }
}

/**
 * Compile + link a preset's pass chain by id (single-pass presets return one
 * entry). The caller owns deletion of the returned programs; ShaderPipeline
 * is the intended consumer.
 */
export function getShaderPasses(gl: WebGL2RenderingContext, id: string): ShaderPassDef[] {
  const src = SOURCES[id];
  if (!src) throw new Error(`Unknown shader: ${id}`);

  if (src.passes) {
    return src.passes.map((p) => {
      const pu = p.parameterUniform ?? false;
      return {
        program: buildLibretro(gl, p.libretro, pu),
        params: pu ? parsePragmaParams(p.libretro) : [],
        filterLinear: p.filterLinear ?? false,
        alias: p.alias ?? null,
      };
    });
  }

  const program = src.libretro
    ? buildLibretro(gl, src.libretro, src.parameterUniform ?? false)
    : link(gl, src.vertex!, src.fragment!);
  return [{
    program,
    // With parameterUniform, feed the shader its #pragma defaults as uniforms.
    params: src.parameterUniform ? parsePragmaParams(src.libretro!) : (src.params ?? []),
    filterLinear: src.filterLinear ?? false,
    alias: null,
  }];
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("createShader failed");
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile error: ${log}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vsrc: string, fsrc: string): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vsrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsrc);
  const program = gl.createProgram();
  if (!program) throw new Error("createProgram failed");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error: ${log}`);
  }
  return program;
}
