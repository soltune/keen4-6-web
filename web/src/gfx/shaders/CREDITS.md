# Bundled display shaders — credits & licenses

These GLSL shaders are vendored **verbatim** from
[libretro/glsl-shaders](https://github.com/libretro/glsl-shaders) and ported to
WebGL2 at runtime (a thin adapter splits the single `VERTEX`/`FRAGMENT` source;
each runs with its built-in default parameters). Original headers are preserved
in each file. This project is GPL-2.0-or-later, with which all of the below are
compatible.

| File | Shader | Author | License |
|---|---|---|---|
| `crt-geom.glsl` | CRT (Geom) — curvature/geometry | cgwg, Themaister, DOLLS | GPL-2.0+ |
| `crt-gdv-mini-ultra-trinitron.glsl` | CRT (GDV mini ultra, Trinitron preset)¹ | guest(r), DariusG | GPL-2.0+ |
| `scanlines-sine-abs.glsl` | Scanlines | RiskyJumps | Public Domain |
| `xbrz-freescale.glsl` | xBRZ freescale (smooth upscale) | Hyllian (sergiogdb) | MIT |
| `newpixie/*.glsl` | newpixie CRT (4-pass)² | Mattias Gustavsson (slang adaptation: hunterk) | MIT / Unlicense (dual) |

All licenses (Public Domain / MIT / GPL-2.0+) are compatible with this project's
GPL-2.0-or-later. Each file retains its original header.

¹ Not verbatim: ported here from
[libretro/slang-shaders](https://github.com/libretro/slang-shaders)
`crt/shaders/crt-gdv-mini-ultra.slang` (single pass) into the same libretro
GLSL form as the rest; the `crt-gdv-mini-ultra-trinitron.slangp` preset equals
the shader's default parameters.

² Not verbatim: ported here from
[libretro/slang-shaders](https://github.com/libretro/slang-shaders)
`crt/shaders/newpixie/` (`accumulate` / `blur_horiz` / `blur_vert` /
`newpixie-crt` per `crt/newpixie-crt.slangp`) into the same libretro GLSL
form, run as a 4-pass chain with previous-frame feedback by the multi-pass
pipeline. WebGL-mandated deviations are noted in each file's header. The
upstream bezel image (`crtframe.png`, `use_frame`, off by default) is not
bundled.

Upstream: <https://github.com/libretro/glsl-shaders>
- `crt/` · `scanlines/` · `xbrz/`
