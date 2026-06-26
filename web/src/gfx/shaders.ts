/* ===========================================================================
   Minimal shader registry / runtime for the WebGL2 renderer.

   Each entry is a single-pass program (vertex + fragment, GLSL ES 1.00 — which
   WebGL2 compiles fine). Programs follow the libretro GLSL uniform convention
   (MVPMatrix / Texture / TextureSize / InputSize / OutputSize / FrameCount) so
   that ported libretro shaders slot in here unchanged save for a thin prelude.

   Today: 'passthrough' only (proves the pipeline). Ported OSS presets
   (crt-lottes [Public Domain], crt-pi, zfast-crt, ...) are added here next,
   each parsing its `#pragma parameter` defaults into `params`. Ported shaders
   keep their original license headers; an aggregate listing lives in web/CREDITS.
   =========================================================================== */

// Verbatim libretro/glsl-shaders sources (see web/CREDITS for authors/licenses).
// Each is a single GLSL source guarded by VERTEX/FRAGMENT and uses its built-in
// default parameters when PARAMETER_UNIFORM is left undefined.
import crtLottesGlsl from "./shaders/crt-lottes.glsl?raw"; // Public Domain (T. Lottes)
import crtEasymodeGlsl from "./shaders/crt-easymode.glsl?raw"; // GPL (EasyMode)
import crtGeomGlsl from "./shaders/crt-geom.glsl?raw"; // GPL (cgwg/Themaister/DOLLS) — curvature/geometry
import crtGdvMiniGlsl from "./shaders/crt-gdv-mini.glsl?raw"; // GPL (guest(r)/metallic77) — GDV mini
import scanlinesSineGlsl from "./shaders/scanlines-sine-abs.glsl?raw"; // Public Domain (RiskyJumps)
import xbrzGlsl from "./shaders/xbrz-freescale.glsl?raw"; // MIT (Hyllian)

export interface ShaderParam {
  name: string;
  value: number;
}

/** A user-facing gallery entry (null id = no shader / plain 2D path). */
export interface ShaderPreset {
  id: string | null;
  label: string;
}

export interface ShaderDef {
  id: string;
  program: WebGLProgram;
  params: ShaderParam[];
  /** Source-texture sampling: GL_LINEAR (true) vs GL_NEAREST (false). */
  filterLinear: boolean;
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
  "crt-lottes": { libretro: crtLottesGlsl, filterLinear: false },
  "crt-easymode": { libretro: crtEasymodeGlsl, filterLinear: false },
  "crt-geom": { libretro: crtGeomGlsl, filterLinear: false, parameterUniform: true }, // filter_linear0=false; needs PARAMETER_UNIFORM (lum collision)
  "crt-gdv-mini": { libretro: crtGdvMiniGlsl, filterLinear: true }, // .glslp filter_linear0 = true
  "scanlines-sine-abs": { libretro: scanlinesSineGlsl, filterLinear: false },
  "xbrz-freescale": { libretro: xbrzGlsl, filterLinear: false },
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
  { id: null, label: "オリジナル" }, // no shader (raw output)
  // Each preset shows its upstream libretro shader name (the repo filename),
  // which is more recognizable / searchable than a feature description.
  { id: "crt-lottes", label: "crt-lottes" },
  { id: "crt-easymode", label: "crt-easymode" },
  { id: "crt-geom", label: "crt-geom" },
  { id: "crt-gdv-mini", label: "crt-gdv-mini" },
  { id: "scanlines-sine-abs", label: "scanlines-sine-abs" },
  { id: "xbrz-freescale", label: "xbrz-freescale" },
];

/** Ids of all registered shaders (verification harnesses enumerate these). */
export function listShaders(): string[] {
  return Object.keys(SOURCES);
}

/** Compile + link a shader by id (caller owns deletion of the returned program). */
export function getShaderProgram(gl: WebGL2RenderingContext, id: string): ShaderDef {
  const src = SOURCES[id];
  if (!src) throw new Error(`Unknown shader: ${id}`);
  let program: WebGLProgram;
  if (src.libretro) {
    const pu = src.parameterUniform ?? false;
    try {
      const s = splitLibretro(src.libretro, false, pu);
      program = link(gl, s.vertex, s.fragment);
    } catch (firstErr) {
      // Some shaders need ES 3.00 (array constructors, etc.) despite their
      // declared #version. Retry once forcing ES 3.00; else report the original.
      try {
        const s3 = splitLibretro(src.libretro, true, pu);
        program = link(gl, s3.vertex, s3.fragment);
      } catch {
        throw firstErr;
      }
    }
  } else {
    program = link(gl, src.vertex!, src.fragment!);
  }
  return {
    id,
    program,
    // With parameterUniform, feed the shader its #pragma defaults as uniforms.
    params: src.parameterUniform ? parsePragmaParams(src.libretro!) : (src.params ?? []),
    filterLinear: src.filterLinear ?? false,
  };
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
