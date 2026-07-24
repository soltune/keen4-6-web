/*
   CRT - Guest - Nomask w. Curvature (crt-gdv-mini-ultra)
   With work by DariusG to create a cut down extra fast version

   Copyright (C) 2017-2018 guest(r) - guest.r@gmail.com

   This program is free software; you can redistribute it and/or
   modify it under the terms of the GNU General Public License
   as published by the Free Software Foundation; either version 2
   of the License, or (at your option) any later version.

   This program is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.

   You should have received a copy of the GNU General Public License
   along with this program; if not, write to the Free Software
   Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA  02111-1307, USA.

   Ported for this project from libretro slang-shaders
   crt/shaders/crt-gdv-mini-ultra.slang into the single-file libretro GLSL
   form the runtime loads. The crt-gdv-mini-ultra-trinitron.slangp preset
   sets no parameter overrides, so the defaults below ARE the Trinitron
   preset (shadowMask 11 = Trinitron-style aperture grille). Upstream
   output-affecting quirks (e.g. the no-op `cNN*cNN;` statements in glow0)
   are kept verbatim so results match RetroArch.
*/

// Parameter lines go here:
#pragma parameter scanline "Scanline Adjust" 10.0 1.0 15.0 1.0
#pragma parameter beam_min "Scanline Dark" 1.5 0.5 3.0 0.05
#pragma parameter beam_max "Scanline Bright" 2.0 0.5 3.0 0.05
#pragma parameter h_sharp "Horizontal Sharpness" 2.5 1.0 5.0 0.05
#pragma parameter shadowMask "CRT Mask: 0:CGWG, 1-4:Lottes, 5-6:Trinitron" 11.0 -1.0 11.0 1.0
#pragma parameter thres "Mask Effect Threshold" 0.4 0.0 0.9 0.02
#pragma parameter masksize "CRT Mask Size (2.0 is nice in 4k)" 1.0 1.0 2.0 1.0
#pragma parameter mcut "Mask 5-7-10 cutoff" 0.2 0.0 0.5 0.05
#pragma parameter maskDark "Lottes maskDark" 0.0 0.0 2.0 0.1
#pragma parameter maskLight "Lottes maskLight" 1.5 0.0 2.0 0.1
#pragma parameter CGWG "CGWG Mask Str." 1.0 0.0 1.0 0.1
#pragma parameter warpX "CurvatureX (default 0.03)" 0.0 0.0 0.25 0.01
#pragma parameter warpY "CurvatureY (default 0.04)" 0.05 0.0 0.25 0.01
#pragma parameter vignette "Vignette On/Off" 1.0 0.0 1.0 1.0
#pragma parameter gamma_out_red "Gamma out Red" 2.2 1.0 4.0 0.1
#pragma parameter gamma_out_green "Gamma out Green" 2.2 1.0 4.0 0.1
#pragma parameter gamma_out_blue "Gamma out Blue" 2.2 1.0 4.0 0.1
#pragma parameter brightboost "Bright boost" 1.2 0.5 2.0 0.05
#pragma parameter sat "Saturation adjustment" 1.2 0.0 2.0 0.05
#pragma parameter glow "Glow Strength" 0.35 0.0 1.0 0.01
#pragma parameter gdv_mono "Mono Display On/Off" 0.0 0.0 1.0 1.0
#pragma parameter gdv_R "Mono Red/Channel" 1.0 0.0 2.0 0.01
#pragma parameter gdv_G "Mono Green/Channel" 1.0 0.0 2.0 0.01
#pragma parameter gdv_B "Mono Blue/Channel" 1.0 0.0 2.0 0.01

#if defined(VERTEX)

#if __VERSION__ >= 130
#define COMPAT_VARYING out
#define COMPAT_ATTRIBUTE in
#define COMPAT_TEXTURE texture
#else
#define COMPAT_VARYING varying
#define COMPAT_ATTRIBUTE attribute
#define COMPAT_TEXTURE texture2D
#endif

#ifdef GL_ES
#define COMPAT_PRECISION mediump
#else
#define COMPAT_PRECISION
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
    TEX0.xy = TexCoord.xy * 1.0001;
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

// compatibility #defines
#define Source Texture
#define vTexCoord TEX0.xy

#ifdef PARAMETER_UNIFORM
uniform COMPAT_PRECISION float scanline;
uniform COMPAT_PRECISION float beam_min;
uniform COMPAT_PRECISION float beam_max;
uniform COMPAT_PRECISION float h_sharp;
uniform COMPAT_PRECISION float shadowMask;
uniform COMPAT_PRECISION float thres;
uniform COMPAT_PRECISION float masksize;
uniform COMPAT_PRECISION float mcut;
uniform COMPAT_PRECISION float maskDark;
uniform COMPAT_PRECISION float maskLight;
uniform COMPAT_PRECISION float CGWG;
uniform COMPAT_PRECISION float warpX;
uniform COMPAT_PRECISION float warpY;
uniform COMPAT_PRECISION float vignette;
uniform COMPAT_PRECISION float gamma_out_red;
uniform COMPAT_PRECISION float gamma_out_green;
uniform COMPAT_PRECISION float gamma_out_blue;
uniform COMPAT_PRECISION float brightboost;
uniform COMPAT_PRECISION float sat;
uniform COMPAT_PRECISION float glow;
uniform COMPAT_PRECISION float gdv_mono;
uniform COMPAT_PRECISION float gdv_R;
uniform COMPAT_PRECISION float gdv_G;
uniform COMPAT_PRECISION float gdv_B;
#else
#define scanline        10.0
#define beam_min        1.5
#define beam_max        2.0
#define h_sharp         2.5
#define shadowMask      11.0
#define thres           0.4
#define masksize        1.0
#define mcut            0.2
#define maskDark        0.0
#define maskLight       1.5
#define CGWG            1.0
#define warpX           0.0
#define warpY           0.05
#define vignette        1.0
#define gamma_out_red   2.2
#define gamma_out_green 2.2
#define gamma_out_blue  2.2
#define brightboost     1.2
#define sat             1.2
#define glow            0.35
#define gdv_mono        0.0
#define gdv_R           1.0
#define gdv_G           1.0
#define gdv_B           1.0
#endif

float sw(float x, float l)
{
	float d = x;
	float bm = scanline;
	float b = mix(beam_min, beam_max, l);
	d = exp2(-bm*pow(d,b));
	return d;
}

vec3 toGrayscale(vec3 color)
{
  float average = (color.r + color.g + color.b) / 3.0;
  return vec3(average);
}

vec3 colorize(vec3 grayscale, vec3 color)
{
    return (grayscale * color);
}

// Shadow mask (1-4 from PD CRT Lottes shader).
vec3 Mask(vec2 pos, vec3 c)
{
	pos = floor(pos / masksize);
	vec3 mask = vec3(maskDark, maskDark, maskDark);

	// No mask
	if (shadowMask == -1.0)
	{
		mask = vec3(1.0);
	}

	// Phosphor.
	else if (shadowMask == 0.0)
	{
		pos.x = fract(pos.x*0.5);
		float mc = 1.0 - CGWG;
		if (pos.x < 0.5) { mask.r = 1.1; mask.g = mc; mask.b = 1.1; }
		else { mask.r = mc; mask.g = 1.1; mask.b = mc; }
	}

	// Very compressed TV style shadow mask.
	else if (shadowMask == 1.0)
	{
		float line = maskLight;
		float odd  = 0.0;

		if (fract(pos.x/6.0) < 0.5)
			odd = 1.0;
		if (fract((pos.y + odd)/2.0) < 0.5)
			line = maskDark;

		pos.x = fract(pos.x/3.0);

		if      (pos.x < 0.333) mask.b = maskLight;
		else if (pos.x < 0.666) mask.g = maskLight;
		else                    mask.r = maskLight;

		mask*=line;
	}

	// Aperture-grille.
	else if (shadowMask == 2.0)
	{
		pos.x = fract(pos.x/3.0);

		if      (pos.x < 0.333) mask.b = maskLight;
		else if (pos.x < 0.666) mask.g = maskLight;
		else                    mask.r = maskLight;
	}

	// Stretched VGA style shadow mask (same as prior shaders).
	else if (shadowMask == 3.0)
	{
		pos.x += pos.y*3.0;
		pos.x  = fract(pos.x/6.0);

		if      (pos.x < 0.333) mask.b = maskLight;
		else if (pos.x < 0.666) mask.g = maskLight;
		else                    mask.r = maskLight;
	}

	// VGA style shadow mask.
	else if (shadowMask == 4.0)
	{
		pos.xy = floor(pos.xy*vec2(1.0, 0.5));
		pos.x += pos.y*3.0;
		pos.x  = fract(pos.x/6.0);

		if      (pos.x < 0.333) mask.b = maskLight;
		else if (pos.x < 0.666) mask.g = maskLight;
		else                    mask.r = maskLight;
	}

	// Alternate mask 5
	else if (shadowMask == 5.0)
	{
		float mx = max(max(c.r,c.g),c.b);
		vec3 maskTmp = vec3( min( 1.25*max(mx-mcut,0.0)/(1.0-mcut) ,maskDark + 0.2*(1.0-maskDark)*mx));
		float adj = 0.80*maskLight - 0.5*(0.80*maskLight - 1.0)*mx + 0.75*(1.0-mx);
		mask = maskTmp;
		pos.x = fract(pos.x/2.0);
		if  (pos.x < 0.5)
		{	mask.r  = adj;
			mask.b  = adj;
		}
		else     mask.g = adj;
	}

	// Alternate mask 6
	else if (shadowMask == 6.0)
	{
		float mx = max(max(c.r,c.g),c.b);
		vec3 maskTmp = vec3( min( 1.33*max(mx-mcut,0.0)/(1.0-mcut) ,maskDark + 0.225*(1.0-maskDark)*mx));
		float adj = 0.80*maskLight - 0.5*(0.80*maskLight - 1.0)*mx + 0.75*(1.0-mx);
		mask = maskTmp;
		pos.x = fract(pos.x/3.0);
		if      (pos.x < 0.333) mask.r = adj;
		else if (pos.x < 0.666) mask.g = adj;
		else                    mask.b = adj;
	}

	// Alternate mask 7
	else if (shadowMask == 7.0)
	{
		float mc = 1.0 - CGWG;
		float mx = max(max(c.r,c.g),c.b);
		float maskTmp = min(1.6*max(mx-mcut,0.0)/(1.0-mcut) , mc);
		mask = vec3(maskTmp);
		pos.x = fract(pos.x/2.0);
		if  (pos.x < 0.5) mask = vec3(1.0 + 0.6*(1.0-mx));
	}
	else if (shadowMask == 8.0)
	{
		float line = maskLight;
		float odd  = 0.0;

		if (fract(pos.x/4.0) < 0.5)
			odd = 1.0;
		if (fract((pos.y + odd)/2.0) < 0.5)
			line = maskDark;

		pos.x = fract(pos.x/2.0);

		if  (pos.x < 0.5) {mask.r = maskLight; mask.b = maskLight;}
		else  mask.g = maskLight;
		mask*=line;
	}

	else if (shadowMask == 9.0)
    {
        vec3 Mask = vec3(maskDark);

        float bright = maskLight;
        float left  = 0.0;


        if (fract(pos.x/6.0) < 0.5)
            left = 1.0;


        float m = fract(pos.x/3.0);

        if      (m < 0.3333) Mask.b = 0.9;
        else if (m < 0.6666) Mask.g = 0.9;
        else                 Mask.r = 0.9;

        if      (mod(pos.y,2.0)==1.0 && left == 1.0 || mod(pos.y,2.0)==0.0 && left == 0.0 ) Mask*=bright;

        return Mask;
    }

	 else if (shadowMask == 10.0)
    {
        vec3 Mask = vec3(maskDark);
        float line = maskLight;
		float odd  = 0.0;

		if (fract(pos.x/6.0) < 0.5)
			odd = 1.0;
		if (fract((pos.y + odd)/2.0) < 0.5)
			line = 1.0;

        float m = fract(pos.x/3.0);
        float y = fract(pos.y/2.0);

        if      (m > 0.3333)  {Mask.r = 1.0; Mask.b = 1.0;}
        else if (m > 0.6666) Mask.g = 1.0;
        else                 Mask = vec3(mcut);
        if (m>0.333) Mask*=line;
        return Mask;
    }

	else if (shadowMask == 11.0)
	{
		vec3 Mask = vec3(maskDark);
		pos.x = fract(pos.x/3.0);

		if      (pos.x > 0.333) Mask = vec3(1.0);
		return Mask;
	}

	return mask;
}

mat3 vign( float l )
{
    vec2 vpos = vTexCoord;

    vpos *= 1.0 - vpos.xy;
    float vig = vpos.x * vpos.y * 45.0;
    vig = min(pow(vig, 0.15), 1.0);
    if (vignette == 0.0) vig = 1.0;

    return mat3(vig, 0.0, 0.0,
                0.0, vig, 0.0,
                0.0, 0.0, vig);
}

// Distortion of scanlines, and end of screen alpha.
vec2 Warp(vec2 pos)
{
	pos  = pos*2.0-1.0;
    pos *= vec2(1.0 + (pos.y*pos.y)*warpX, 1.0 + (pos.x*pos.x)*warpY);
	return pos*0.5 + 0.5;
}

vec3 saturation (vec3 textureColor)
{
    float lum=length(textureColor.rgb)*0.5775;

    vec3 luminanceWeighting = vec3(0.3,0.6,0.1);
    if (lum<0.5) luminanceWeighting.rgb=(luminanceWeighting.rgb*luminanceWeighting.rgb)+(luminanceWeighting.rgb*luminanceWeighting.rgb);

    float luminance = dot(textureColor.rgb, luminanceWeighting);
    vec3 greyScaleColor = vec3(luminance);

    vec3 color1 = vec3(mix(greyScaleColor, textureColor.rgb, sat));
    return color1;
}

vec3 glow0 (vec2 texcoord, vec3 col)
{
   vec3 sum = vec3(0.0);
   vec2 blurSize = 1.0 / TextureSize.xy;

   vec3 c20 = COMPAT_TEXTURE(Source, vec2(texcoord.x - 2.0 * blurSize.x, texcoord.y)).rgb; c20*c20;
   vec3 c10 = COMPAT_TEXTURE(Source, vec2(texcoord.x - blurSize.x,       texcoord.y)).rgb; c10*c10;
   vec3 c11 = COMPAT_TEXTURE(Source, vec2(texcoord.x,                  texcoord.y)).rgb; c11*c11;
   vec3 c12 = COMPAT_TEXTURE(Source, vec2(texcoord.x + blurSize.x,       texcoord.y)).rgb; c12*c12;
   vec3 c21 = COMPAT_TEXTURE(Source, vec2(texcoord.x + 2.0 * blurSize.x, texcoord.y)).rgb; c21*c21;

   vec3 c22 = COMPAT_TEXTURE(Source, vec2(texcoord.x - 2.0 * blurSize.x, texcoord.y - blurSize.y)).rgb; c22*c22;
   vec3 c23 = COMPAT_TEXTURE(Source, vec2(texcoord.x - blurSize.x,       texcoord.y - 2.0 * blurSize.y)).rgb; c23*c23;
   vec3 c13 = COMPAT_TEXTURE(Source, vec2(texcoord.x - blurSize.x,       texcoord.y - blurSize.y)).rgb; c13*c13;
   vec3 c14 = COMPAT_TEXTURE(Source, vec2(texcoord.x + blurSize.x,       texcoord.y + blurSize.y)).rgb; c14*c14;
   vec3 c24 = COMPAT_TEXTURE(Source, vec2(texcoord.x + blurSize.x,       texcoord.y + 2.0 * blurSize.y)).rgb; c24*c24;
   vec3 c25 = COMPAT_TEXTURE(Source, vec2(texcoord.x + 2.0 * blurSize.x, texcoord.y + blurSize.y)).rgb; c25*c25;

   vec3 c26 = COMPAT_TEXTURE(Source, vec2(texcoord.x - 2.0 * blurSize.x, texcoord.y + blurSize.y)).rgb; c26*c26;
   vec3 c27 = COMPAT_TEXTURE(Source, vec2(texcoord.x - blurSize.x,       texcoord.y + 2.0 * blurSize.y)).rgb; c27*c27;
   vec3 c15 = COMPAT_TEXTURE(Source, vec2(texcoord.x - blurSize.x,       texcoord.y + blurSize.y)).rgb; c15*c15;
   vec3 c16 = COMPAT_TEXTURE(Source, vec2(texcoord.x + blurSize.x,       texcoord.y - blurSize.y)).rgb; c16*c16;
   vec3 c28 = COMPAT_TEXTURE(Source, vec2(texcoord.x + blurSize.x,       texcoord.y - 2.0 * blurSize.y)).rgb; c28*c28;
   vec3 c29 = COMPAT_TEXTURE(Source, vec2(texcoord.x + 2.0 * blurSize.x, texcoord.y - blurSize.y)).rgb; c29*c29;

   vec3 c30 = COMPAT_TEXTURE(Source, vec2(texcoord.x,                  texcoord.y - 2.0 * blurSize.y)).rgb; c30*c30;
   vec3 c17 = COMPAT_TEXTURE(Source, vec2(texcoord.x,                  texcoord.y - blurSize.y)).rgb; c17*c17;
   vec3 c18 = COMPAT_TEXTURE(Source, vec2(texcoord.x,                  texcoord.y + blurSize.y)).rgb; c18*c18;
   vec3 c31 = COMPAT_TEXTURE(Source, vec2(texcoord.x,                  texcoord.y + 2.0 * blurSize.y)).rgb; c31*c31;
  	sum = (3.0*c11 + 2.5 *(c10+c12+c13+c14+c15+c16+c17+c18) + 1.5*(c20+c21+c22+c23+c24+c25+c26+c27+c28+c29+c30+c31))/45.0;
   return sum * glow;
}

void main()
{
	vec2 pos = Warp(vTexCoord);

	vec2 ps = 1.0 / TextureSize.xy;
	vec2 OGL2Pos = pos * TextureSize.xy;
	vec2 fp = fract(OGL2Pos);
	vec2 dx = vec2(ps.x,0.0);
	vec2 dy = vec2(0.0, ps.y);

	vec2 pC4 = floor(OGL2Pos) * ps + 0.5*ps;

	// Reading the texels
	vec3 ul = COMPAT_TEXTURE(Source, pC4     ).xyz;
	vec3 ur = COMPAT_TEXTURE(Source, pC4 + dx).xyz;
	vec3 dl = COMPAT_TEXTURE(Source, pC4 + dy).xyz;
	vec3 dr = COMPAT_TEXTURE(Source, pC4 + ps).xyz;

	float lx = fp.x;        lx = pow(lx, h_sharp);
	float rx = 1.0 - fp.x;  rx = pow(rx, h_sharp);

	vec3 color1 = (ur*lx + ul*rx)/(lx+rx);
	vec3 color2 = (dr*lx + dl*rx)/(lx+rx);

	float f = fp.y;
	float luma1 = color1.r*0.3+color1.g*0.6+color1.b*0.1;
	float luma2 = color2.r*0.3+color2.g*0.6+color2.b*0.1;

	color1 = (2.0*pow(color1,vec3(2.8))) - pow(color1,vec3(3.6));
	color2 = (2.0*pow(color2,vec3(2.8))) - pow(color2,vec3(3.6));

	color1 = color1 * mix(Mask(vTexCoord * OutputSize.xy, color1),vec3(1.0),luma1*thres);
	color2 = color2 * mix(Mask(vTexCoord * OutputSize.xy, color2),vec3(1.0),luma2*thres);

	vec3 color = color1*sw(f,luma1) + color2*sw(1.0-f,luma2);

	if (InputSize.y >= 400.0) {color = (color1 + color2)/2.0;}

	color = min(color, 1.0);
	float lum = color.r*0.3+color.g*0.6+color.b*0.1;

	color = pow(color, vec3(1.0/gamma_out_red,1.0,1.0));
	color = pow(color, vec3(1.0,1.0/gamma_out_green,1.0));
	color = pow(color, vec3(1.0,1.0,1.0/gamma_out_blue));
	color += glow0(pC4,color);
	color*= mix(1.0,brightboost,lum);

	color = saturation(color);
	color*= vign(lum);

	if (gdv_mono == 1.0)
	{
	vec3 col1 = toGrayscale (color);
	vec3 c = vec3(gdv_R, gdv_G, gdv_B);
	color = colorize (col1, c);
	}

	// Upstream preset relies on wrap_mode clamp_to_border, which WebGL lacks
	// (renderer uses CLAMP_TO_EDGE): black out samples the curvature warp
	// pushes outside the source so curved edges don't smear the border rows.
	if (pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0) color = vec3(0.0);

	FragColor = vec4(color, 1.0);
}
#endif
