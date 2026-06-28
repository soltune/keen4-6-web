/*
    LCD Dot-Matrix grid
    A light, single-pass handheld-LCD grid that keeps the source colors.

    Each 320x200 source pixel becomes an LCD "dot": a thin dark gap is drawn
    around every texel border so the picture reads as a dot-matrix panel, while
    the EGA palette is left untouched (no color LUT, no console-shell texture).
    by Claude — license: public domain
*/

#pragma parameter dm_grid   "Grid Strength" 0.4500 0.000 1.000 0.05
#pragma parameter dm_gap    "Grid Width"    0.1500 0.000 0.500 0.01
#pragma parameter dm_desat  "Desaturation"  0.4000 0.000 1.000 0.05
#pragma parameter dm_bright "Brightness"    1.1000 0.500 2.000 0.05

#ifndef PARAMETER_UNIFORM
#define dm_grid          0.450000
#define dm_gap           0.150000
#define dm_desat         0.400000
#define dm_bright        1.100000
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
uniform COMPAT_PRECISION float dm_desat;
uniform COMPAT_PRECISION float dm_bright;
#endif

void main()
{
    vec3 color = COMPAT_TEXTURE(Source, vTexCoord).rgb;

    // GBC LCD wash: pull colors toward their luminance so the vivid EGA palette
    // reads as the muted, low-saturation tones of a Game Boy Color screen.
    float luminance = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(color, vec3(luminance), dm_desat);

    // Position inside the current 320x200 source texel (0..1 per axis).
    vec2 cell = fract(vTexCoord * TextureSize);
    // Distance to the nearest texel border: 0 at a border, 0.5 at the center.
    vec2 toBorder = min(cell, 1.0 - cell);
    float edge = min(toBorder.x, toBorder.y);

    // Dot body = 1 well inside the texel, fading to 0 across the gap band.
    float dot = smoothstep(0.0, max(dm_gap, 0.0001), edge);
    // Gaps don't go fully black; the panel keeps a lit floor between dots.
    float lit = mix(1.0 - dm_grid, 1.0, dot);

    color *= lit * dm_bright;

    FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
#endif
