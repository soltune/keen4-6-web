# Bundled display shaders — credits & licenses

These GLSL shaders are vendored **verbatim** from
[libretro/glsl-shaders](https://github.com/libretro/glsl-shaders) and ported to
WebGL2 at runtime (a thin adapter splits the single `VERTEX`/`FRAGMENT` source;
each runs with its built-in default parameters). Original headers are preserved
in each file. This project is GPL-2.0-or-later, with which all of the below are
compatible.

| File | Shader | Author | License |
|---|---|---|---|
| `crt-lottes.glsl` | CRT (Lottes) | Timothy Lottes | Public Domain |
| `crt-easymode.glsl` | CRT (EasyMode) | EasyMode | GPL |
| `crt-geom.glsl` | CRT (Geom) — curvature/geometry | cgwg, Themaister, DOLLS | GPL-2.0+ |
| `crt-gdv-mini.glsl` | CRT (GDV mini) | guest(r), ed. metallic77 | GPL-2.0+ |
| `scanlines-sine-abs.glsl` | Scanlines | RiskyJumps | Public Domain |
| `xbrz-freescale.glsl` | xBRZ freescale (smooth upscale) | Hyllian (sergiogdb) | MIT |

All licenses (Public Domain / MIT / GPL-2.0+) are compatible with this project's
GPL-2.0-or-later. Each file retains its original header.

Upstream: <https://github.com/libretro/glsl-shaders>
- `crt/` · `scanlines/` · `xbrz/`
