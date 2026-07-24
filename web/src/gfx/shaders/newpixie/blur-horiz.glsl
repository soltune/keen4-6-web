/*
   newpixie CRT — pass 2/4: 9-tap horizontal Gaussian blur
   by Mattias Gustavsson, adapted for slang by hunterk
   License: dual MIT / Unlicense (public domain) — see CREDITS.md

   Ported for this project from libretro slang-shaders
   crt/shaders/newpixie/blur_horiz.slang into the single-file libretro GLSL
   form the runtime loads. slang's `params.OutputSize.zw` (1/size) becomes
   `1.0 / OutputSize`; the global `blur` initializer moved into main() since
   GLSL ES 1.00 forbids non-constant global initializers.
*/

#pragma parameter blur_x "Horizontal Blur" 1.0 0.0 5.0 0.25

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

uniform COMPAT_PRECISION vec2 OutputSize;
uniform sampler2D Texture;
COMPAT_VARYING vec4 TEX0;

#define Source Texture
#define vTexCoord TEX0.xy

#ifdef PARAMETER_UNIFORM
uniform COMPAT_PRECISION float blur_x;
#else
#define blur_x 1.0
#endif

void main()
{
    vec2 blur = vec2(blur_x, 0.0) / OutputSize.xy;
    vec2 uv = vTexCoord.xy;
    vec4 sum = COMPAT_TEXTURE( Source, uv ) * 0.2270270270;
    sum += COMPAT_TEXTURE(Source, vec2( uv.x - 4.0 * blur.x, uv.y - 4.0 * blur.y ) ) * 0.0162162162;
    sum += COMPAT_TEXTURE(Source, vec2( uv.x - 3.0 * blur.x, uv.y - 3.0 * blur.y ) ) * 0.0540540541;
    sum += COMPAT_TEXTURE(Source, vec2( uv.x - 2.0 * blur.x, uv.y - 2.0 * blur.y ) ) * 0.1216216216;
    sum += COMPAT_TEXTURE(Source, vec2( uv.x - 1.0 * blur.x, uv.y - 1.0 * blur.y ) ) * 0.1945945946;
    sum += COMPAT_TEXTURE(Source, vec2( uv.x + 1.0 * blur.x, uv.y + 1.0 * blur.y ) ) * 0.1945945946;
    sum += COMPAT_TEXTURE(Source, vec2( uv.x + 2.0 * blur.x, uv.y + 2.0 * blur.y ) ) * 0.1216216216;
    sum += COMPAT_TEXTURE(Source, vec2( uv.x + 3.0 * blur.x, uv.y + 3.0 * blur.y ) ) * 0.0540540541;
    sum += COMPAT_TEXTURE(Source, vec2( uv.x + 4.0 * blur.x, uv.y + 4.0 * blur.y ) ) * 0.0162162162;
    FragColor = sum;
}
#endif
