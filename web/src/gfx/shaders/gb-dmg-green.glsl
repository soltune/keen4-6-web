/*
    Game Boy DMG green + dot-matrix grid
    A single-pass take on the original Game Boy look: source luminance is
    quantized to the 4 classic DMG green shades, then the same LCD dot-matrix
    grid as lcd-dotmatrix.glsl is applied. No color LUT / shell textures — the
    4-tone palette is hardcoded, so this overrides the EGA colors on purpose.
    by Claude — license: public domain
*/

#pragma parameter dm_grid   "Grid Strength" 0.4500 0.000 1.000 0.05
#pragma parameter dm_gap    "Grid Width"    0.1500 0.000 0.500 0.01
#pragma parameter dm_bright "Brightness"    1.0000 0.500 2.000 0.05

#ifndef PARAMETER_UNIFORM
#define dm_grid          0.450000
#define dm_gap           0.150000
#define dm_bright        1.000000
#endif

#if defined(VERTEX)

#ifdef GL_ES
#define COMPAT_PRECISION mediump
#else
#define COMPAT_PRECISION
#endif

#if __VERSION__ >= 130
#define COMPAT_VARYING out
#define COMPAT_ATTRIBUTE in
#define COMPAT_TEXTURE texture
#else
#define COMPAT_VARYING varying
#define COMPAT_ATTRIBUTE attribute
#define COMPAT_TEXTURE texture2D
#endif

COMPAT_ATTRIBUTE vec4 VertexCoord;
COMPAT_ATTRIBUTE vec4 COLOR;
COMPAT_ATTRIBUTE vec4 TexCoord;
COMPAT_VARYING vec4 COL0;
COMPAT_VARYING vec4 TEX0;

uniform mat4 MVPMatrix;
uniform COMPAT_PRECISION int FrameDirection;
uniform COMPAT_PRECISION int FrameCount;
uniform COMPAT_PRECISION vec2 OutputSize;
uniform COMPAT_PRECISION vec2 TextureSize;
uniform COMPAT_PRECISION vec2 InputSize;

void main()
{
    gl_Position = MVPMatrix * VertexCoord;
    COL0 = COLOR;
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

uniform COMPAT_PRECISION int FrameDirection;
uniform COMPAT_PRECISION int FrameCount;
uniform COMPAT_PRECISION vec2 OutputSize;
uniform COMPAT_PRECISION vec2 TextureSize;
uniform COMPAT_PRECISION vec2 InputSize;
uniform sampler2D Texture;
COMPAT_VARYING vec4 TEX0;

#define Source Texture
#define vTexCoord TEX0.xy

#ifdef PARAMETER_UNIFORM
uniform COMPAT_PRECISION float dm_grid;
uniform COMPAT_PRECISION float dm_gap;
uniform COMPAT_PRECISION float dm_bright;
#endif

// Classic DMG green tones, lightest -> darkest (#9bbc0f .. #0f380f).
const vec3 DMG0 = vec3(0.608, 0.737, 0.059);
const vec3 DMG1 = vec3(0.545, 0.675, 0.059);
const vec3 DMG2 = vec3(0.188, 0.384, 0.188);
const vec3 DMG3 = vec3(0.059, 0.220, 0.059);

void main()
{
    vec3 src = COMPAT_TEXTURE(Source, vTexCoord).rgb;

    // Quantize perceived brightness to the 4 DMG shades.
    float l = dot(src, vec3(0.299, 0.587, 0.114));
    vec3 color = l > 0.75 ? DMG0 : (l > 0.50 ? DMG1 : (l > 0.25 ? DMG2 : DMG3));

    // Same LCD dot-matrix grid as lcd-dotmatrix.glsl.
    vec2 cell = fract(vTexCoord * TextureSize);
    vec2 toBorder = min(cell, 1.0 - cell);
    float edge = min(toBorder.x, toBorder.y);
    float dot_ = smoothstep(0.0, max(dm_gap, 0.0001), edge);
    float lit = mix(1.0 - dm_grid, 1.0, dot_);

    color *= lit * dm_bright;

    FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
#endif
