/*
   newpixie CRT — pass 4/4: compose (curvature, ghosting, scanlines, vignette)
   by Mattias Gustavsson, adapted for slang by hunterk
   License: dual MIT / Unlicense (public domain) — see CREDITS.md

   Ported for this project from libretro slang-shaders
   crt/shaders/newpixie/newpixie-crt.slang into the single-file libretro GLSL
   form the runtime loads. `accum1` / `blur2` are the current-frame outputs of
   the accumulate and blur-vert passes, bound by the multi-pass pipeline.

   Port deviations (output-neutral unless noted):
   - Upstream's `#define gl_FragCoord (vTexCoord.xy * OutputSize.xy)` redefines
     a reserved builtin (rejected by ANGLE/WebGL) → NP_FRAGCOORD.
   - Upstream's `#define resolution params.OutputSize.xy` collides with
     tsample's `resolution` parameter under a plain macro → local var in main().
   - tsample() rejects out-of-range coords to emulate slang's default
     clamp_to_border (black) wrap, which WebGL lacks; without this the inset
     image would smear its edge pixels outward.
   - The bezel frame block (use_frame, default 0.0 = off upstream) needs a
     bundled crtframe.png + static-texture plumbing, so it is compiled out
     behind NEWPIXIE_USE_FRAME rather than sampling an unbound texture.
*/

#pragma parameter use_frame "Use Frame Image" 0.0 0.0 1.0 1.0
#pragma parameter curvature "Curvature" 2.0 0.0001 4.0 0.25
#pragma parameter wiggle_toggle "Interference" 0.0 0.0 1.0 1.0
#pragma parameter scanroll "Rolling Scanlines" 1.0 0.0 1.0 1.0
#pragma parameter vignette "Vignette" 1.0 0.0 1.0 0.05
#pragma parameter ghosting "Ghosting" 1.0 0.0 2.0 0.10

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
    TEX0.xy = vec2(TexCoord.x, 1.0 - TexCoord.y);
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

uniform COMPAT_PRECISION int FrameCount;
uniform COMPAT_PRECISION vec2 OutputSize;
uniform COMPAT_PRECISION vec2 TextureSize;
uniform COMPAT_PRECISION vec2 InputSize;
uniform sampler2D Texture;
uniform sampler2D accum1;
uniform sampler2D blur2;
#ifdef NEWPIXIE_USE_FRAME
uniform sampler2D frametexture;
#endif
COMPAT_VARYING vec4 TEX0;

#define vTexCoord TEX0.xy

#ifdef PARAMETER_UNIFORM
uniform COMPAT_PRECISION float use_frame;
uniform COMPAT_PRECISION float curvature;
uniform COMPAT_PRECISION float wiggle_toggle;
uniform COMPAT_PRECISION float scanroll;
uniform COMPAT_PRECISION float vignette;
uniform COMPAT_PRECISION float ghosting;
#else
#define use_frame     0.0
#define curvature     2.0
#define wiggle_toggle 0.0
#define scanroll      1.0
#define vignette      1.0
#define ghosting      1.0
#endif

#define NP_FRAGCOORD (vTexCoord.xy * OutputSize.xy)
#define backbuffer accum1
#define blurbuffer blur2

vec3 tsample( sampler2D samp, vec2 tc, float offs, vec2 resolution )
    {
    tc = tc * vec2(1.025, 0.92) + vec2(-0.0125, 0.04);
    // clamp_to_border emulation (see header): outside [0,1] is black.
    if (tc.x < 0.0 || tc.x > 1.0 || tc.y < 0.0 || tc.y > 1.0) return vec3(0.0);
    vec3 s = pow( abs( COMPAT_TEXTURE( samp, vec2( tc.x, 1.0-tc.y ) ).rgb), vec3( 2.2 ) );
    return s*vec3(1.25);
    }

vec3 filmic( vec3 LinearColor )
    {
    vec3 x = max( vec3(0.0), LinearColor-vec3(0.004));
    return (x*(6.2*x+0.5))/(x*(6.2*x+1.7)+0.06);
    }

vec2 curve( vec2 uv )
    {
    uv = (uv - 0.5);// * 2.0;
//    uv.x *= 0.75;
    uv *= vec2(0.925, 1.095);
   uv *= curvature;
    uv.x *= 1.0 + pow((abs(uv.y) / 4.0), 2.0);
    uv.y *= 1.0 + pow((abs(uv.x) / 3.0), 2.0);
    uv /= curvature;
    uv  += 0.5;
    uv =  uv *0.92 + 0.04;
    return uv;
    }

float rand(vec2 co)
    {
    return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
    }

void main()
{
    vec2 resolution = OutputSize.xy;
   // stop time variable so the screen doesn't wiggle
   float time = mod(float(FrameCount), 849.0) *36.;
    vec2 uv = vTexCoord.xy;
    /* Curve */
    vec2 curved_uv = mix( curve( uv ), uv, 0.4 );
    float scale = -0.101;
    vec2 scuv = curved_uv*(1.0-scale)+scale/2.0+vec2(0.003, -0.001);

    uv = scuv;

    /* Main color, Bleed */
    vec3 col;
    float x = wiggle_toggle* sin(0.1*time+curved_uv.y*13.0)*sin(0.23*time+curved_uv.y*19.0)*sin(0.3+0.11*time+curved_uv.y*23.0)*0.0012;
    float o =sin(NP_FRAGCOORD.y*1.5)/resolution.x;
    x+=o*0.25;
   // make time do something again
   time = mod(float(FrameCount), 640.0) * 1.0;
    col.r = tsample(backbuffer,vec2(x+scuv.x+0.0009,scuv.y+0.0009),resolution.y/800.0, resolution ).x+0.02;
    col.g = tsample(backbuffer,vec2(x+scuv.x+0.0000,scuv.y-0.0011),resolution.y/800.0, resolution ).y+0.02;
    col.b = tsample(backbuffer,vec2(x+scuv.x-0.0015,scuv.y+0.0000),resolution.y/800.0, resolution ).z+0.02;
    float i = clamp(col.r*0.299 + col.g*0.587 + col.b*0.114, 0.0, 1.0 );
    i = pow( 1.0 - pow(i,2.0), 1.0 );
    i = (1.0-i) * 0.85 + 0.15;

    /* Ghosting */
    float ghs = 0.15 * ghosting;
    vec3 r = tsample(blurbuffer, vec2(x-0.014*1.0, -0.027)*0.85+0.007*vec2( 0.35*sin(1.0/7.0 + 15.0*curved_uv.y + 0.9*time),
        0.35*sin( 2.0/7.0 + 10.0*curved_uv.y + 1.37*time) )+vec2(scuv.x+0.001,scuv.y+0.001),
        5.5+1.3*sin( 3.0/9.0 + 31.0*curved_uv.x + 1.70*time),resolution).xyz*vec3(0.5,0.25,0.25);
    vec3 g = tsample(blurbuffer, vec2(x-0.019*1.0, -0.020)*0.85+0.007*vec2( 0.35*cos(1.0/9.0 + 15.0*curved_uv.y + 0.5*time),
        0.35*sin( 2.0/9.0 + 10.0*curved_uv.y + 1.50*time) )+vec2(scuv.x+0.000,scuv.y-0.002),
        5.4+1.3*sin( 3.0/3.0 + 71.0*curved_uv.x + 1.90*time),resolution).xyz*vec3(0.25,0.5,0.25);
    vec3 b = tsample(blurbuffer, vec2(x-0.017*1.0, -0.003)*0.85+0.007*vec2( 0.35*sin(2.0/3.0 + 15.0*curved_uv.y + 0.7*time),
        0.35*cos( 2.0/3.0 + 10.0*curved_uv.y + 1.63*time) )+vec2(scuv.x-0.002,scuv.y+0.000),
        5.3+1.3*sin( 3.0/7.0 + 91.0*curved_uv.x + 1.65*time),resolution).xyz*vec3(0.25,0.25,0.5);

    col += vec3(ghs*(1.0-0.299))*pow(clamp(vec3(3.0)*r,vec3(0.0),vec3(1.0)),vec3(2.0))*vec3(i);
    col += vec3(ghs*(1.0-0.587))*pow(clamp(vec3(3.0)*g,vec3(0.0),vec3(1.0)),vec3(2.0))*vec3(i);
    col += vec3(ghs*(1.0-0.114))*pow(clamp(vec3(3.0)*b,vec3(0.0),vec3(1.0)),vec3(2.0))*vec3(i);

    /* Level adjustment (curves) */
    col *= vec3(0.95,1.05,0.95);
    col = clamp(col*1.3 + 0.75*col*col + 1.25*col*col*col*col*col,vec3(0.0),vec3(10.0));

    /* Vignette */
    float vig = ((1.0-0.99*vignette) + 1.0*16.0*curved_uv.x*curved_uv.y*(1.0-curved_uv.x)*(1.0-curved_uv.y));
    vig = 1.3*pow(vig,0.5);
    col *= vig;

    time *= scanroll;

    /* Scanlines */
    float scans = clamp( 0.35+0.18*sin(6.0*time-curved_uv.y*resolution.y*1.5), 0.0, 1.0);
    float s = pow(scans,0.9);
    col = col * vec3(s);

    /* Vertical lines (shadow mask) */
    col*=1.0-0.23*(clamp((mod(NP_FRAGCOORD.x, 3.0))/2.0,0.0,1.0));

    /* Tone map */
    col = filmic( col );

    /* Noise */
    /*vec2 seed = floor(curved_uv*resolution.xy*vec2(0.5))/resolution.xy;*/
    vec2 seed = curved_uv*resolution.xy;
    /* seed = curved_uv; */
    col -= 0.015*pow(vec3(rand( seed +time ), rand( seed +time*2.0 ), rand( seed +time * 3.0 ) ), vec3(1.5) );

    /* Flicker */
    col *= (1.0-0.004*(sin(50.0*time+curved_uv.y*2.0)*0.5+0.5));

    /* Clamp */
//    if (curved_uv.x < 0.0 || curved_uv.x > 1.0)
//        col *= 0.0;
//    if (curved_uv.y < 0.0 || curved_uv.y > 1.0)
//        col *= 0.0;

#ifdef NEWPIXIE_USE_FRAME
    uv = curved_uv;
    /* Frame */
    vec2 fscale = vec2( 0.026, -0.018);//vec2( -0.018, -0.013 );
    uv = vec2(uv.x, 1.-uv.y);
    vec4 f=COMPAT_TEXTURE(frametexture,vTexCoord.xy);//*((1.0)+2.0*fscale)-fscale-vec2(-0.0, 0.005));
    f.xyz = mix( f.xyz, vec3(0.5,0.5,0.5), 0.5 );
    float fvig = clamp( -0.00+512.0*uv.x*uv.y*(1.0-uv.x)*(1.0-uv.y), 0.2, 0.8 );
    col = mix( col, mix( max( col, 0.0), pow( abs( f.xyz ), vec3( 1.4 ) ) * fvig, f.w * f.w), vec3( use_frame ) );
#endif

    FragColor = vec4( col, 1.0 );
}
#endif
