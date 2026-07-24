/*
   newpixie CRT — pass 1/4: accumulate (phosphor persistence)
   by Mattias Gustavsson, adapted for slang by hunterk
   License: dual MIT / Unlicense (public domain) — see CREDITS.md

   Ported for this project from libretro slang-shaders
   crt/shaders/newpixie/accumulate.slang into the single-file libretro GLSL
   form the runtime loads. `PassFeedback1` is the previous frame's output of
   the blur-horiz pass (slang PassFeedback semantics), bound by the multi-pass
   pipeline; the trail this builds is what the final pass reads as ghosting.
*/

#pragma parameter acc_modulate "Accumulate Modulation" 0.65 0.0 1.0 0.01

#if defined(VERTEX)

#if __VERSION__ >= 130
#define COMPAT_VARYING out
#define COMPAT_ATTRIBUTE in
#else
#define COMPAT_VARYING varying
#define COMPAT_ATTRIBUTE attribute
#endif

#ifdef GL_ES
#define COMPAT_PRECISION mediump
#else
#define COMPAT_PRECISION
#endif

COMPAT_ATTRIBUTE vec4 VertexCoord;
COMPAT_ATTRIBUTE vec4 TexCoord;
COMPAT_VARYING vec4 TEX0;

uniform mat4 MVPMatrix;

void main()
{
    gl_Position = MVPMatrix * VertexCoord;
    TEX0.xy = TexCoord.xy;
}

#elif defined(FRAGMENT)

#if __VERSION__ >= 130
#define COMPAT_VARYING in
#define COMPAT_TEXTURE texture
out vec4 FragColor;
#else
#define COMPAT_VARYING varying
#define FragColor gl_FragColor
#define COMPAT_TEXTURE texture2D
#endif

#ifdef GL_ES
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#define COMPAT_PRECISION mediump
#else
#define COMPAT_PRECISION
#endif

uniform sampler2D Texture;
uniform sampler2D PassFeedback1;
COMPAT_VARYING vec4 TEX0;

#define vTexCoord TEX0.xy

#ifdef PARAMETER_UNIFORM
uniform COMPAT_PRECISION float acc_modulate;
#else
#define acc_modulate 0.65
#endif

#define modulate acc_modulate
#define tex0 PassFeedback1
#define tex1 Texture

void main()
{
    vec4 a = COMPAT_TEXTURE(tex0, vTexCoord.xy) * vec4(modulate);
    vec4 b = COMPAT_TEXTURE(tex1, vTexCoord.xy);
    FragColor = max(a, b * 0.96);
}
#endif
