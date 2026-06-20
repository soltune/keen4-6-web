/* ===========================================================================
   id_vw.c — web-port reimplementation of the Keen 4-6 EGA View Manager.

   This replaces the DOS ID_VW.C *and* its assembly companions ID_VW_A.ASM /
   ID_VW_AE.ASM (the engine build picks engine/platform/id_vw.c ahead of
   engine/game/ID_VW.C). All EGA hardware register banging is gone; instead we
   model EGA video memory exactly as the hardware presents it — four 64 KB bit
   planes — and implement every VW primitive against that flat model.

   EGA planar recap (so the blits below read clearly):
     * One byte offset addresses the SAME byte in all four planes.
     * Within a byte, bit 7 (0x80) is the LEFT-most of 8 horizontal pixels.
     * A pixel's 4-bit colour = plane0.bit | plane1.bit<<1 | ... | plane3.bit<<3
     * Source art in grsegs[] is stored plane-sequential:
         - tiles / pics : plane0[w*h], plane1[w*h], plane2, plane3
         - masked blits : mask[w*h], then the four colour planes (5 total)
       This matches VW_MaskBlock's "mask comes first, then four planes".

   Sub-pixel sprite positioning: the DOS engine pre-shifts each sprite into
   four 2-pixel-stepped copies (CAL_ShiftSprite + the shifttabletable). We drop
   that machinery entirely and instead blit the single unshifted sprite at an
   exact pixel X with a per-pixel masked loop — simpler, pixel-accurate, and it
   lets CAL_ShiftSprite stay a no-op. shifttabletable is defined here only to
   satisfy the (now unused) extern.
   =========================================================================== */

#include "ID_HEADS.H"
#include <string.h>
#include <stdint.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define VW_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define VW_EXPORT
#endif

/*
=============================================================================
                        EGA VIDEO MEMORY MODEL
=============================================================================
*/

#define EGA_PLANES        4
#define VL_VRAM_PLANESIZE 0x10000u          /* 64 KB per plane, as real EGA */

/* [web port] Wrap a VRAM byte offset to 16 bits. The DOS engine addresses
   video memory as a 16-bit segment:offset, so every screen offset
   (screenstart[]/bufferofs/displayofs/masterofs and everything derived from
   them) wraps mod 64 KB. Those offsets are plain `unsigned` here, which is
   32-bit under Emscripten, so they grow past 0x10000 as the world scrolls.
   The DRAW side must wrap exactly like the hardware (and like VW_Present,
   which already masks) — dropping out-of-range writes instead would leave the
   view pages stale, which is what caused the scrolling flicker / teal fill /
   torn split-screen. < 0x10000 is the common case and the mask is then a
   no-op, so this never changes non-wrapping behaviour. */
#define VL_VRAM_WRAP(o)   ((o) & (VL_VRAM_PLANESIZE-1))

static byte vram[EGA_PLANES][VL_VRAM_PLANESIZE];

/* [web port] Direct EGA-plane access for the handful of modules that bypassed
   the VW API and wrote VRAM through segment:offset asm (CK_DEMO's intro/
   transition effects). Returns the base of one bit-plane; callers index it by
   the same byte offset the DOS code used with screenseg. */
byte *VL_VramPlane (int plane)
{
	return vram[plane & 3];
}

unsigned VL_VramPlaneSize (void)
{
	return VL_VRAM_PLANESIZE;
}

/* The CRTC start offset + horizontal pel pan that the *visible* image is read
   from. VW_SetScreen updates these; present() consumes them. */
static unsigned vw_screenstart = 0;
static unsigned vw_pelpan = 0;

/* EGA register shadow state (the EGAWRITEMODE/EGABITMASK/... macros in ID_VW.H
   poke these). The reimplemented primitives don't actually consult them — each
   one applies the precise plane/mask behaviour it needs directly — but the
   globals must exist because the macros and other modules reference them. */
int vw_writemode, vw_bitmask = 0xff, vw_mapmask = 0xf, vw_readmap;

/*
=============================================================================
                        GLOBAL VARIABLES (match ID_VW.H externs)
=============================================================================
*/

cardtype	videocard;
grtype		grmode;

unsigned	bufferofs;
unsigned	displayofs;
unsigned	panx,pany;
unsigned	pansx,pansy;
unsigned	panadjust;

unsigned	screenseg;
unsigned	linewidth;
unsigned	ylookup[VIRTUALHEIGHT];

unsigned	fontnumber;
boolean		screenfaded;

pictabletype	_seg *pictable;
pictabletype	_seg *picmtable;
spritetabletype _seg *spritetable;

int			bordercolor;
boolean		nopan;

int			px,py;
byte		pdrawmode = 0x18, fontcolor = 15;

/* asm-side globals that other modules (font code, RF) expect to link against */
unsigned	*shifttabletable[8];
unsigned	bufferwidth,bufferheight,screenspot;

char colors[7][17]=
{{0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0},
 {0,0,0,0,0,0,0,0,0,1,2,3,4,5,6,7,0},
 {0,0,0,0,0,0,0,0,0x18,0x19,0x1a,0x1b,0x1c,0x1d,0x1e,0x1f,0},
 {0,1,2,3,4,5,6,7,0x18,0x19,0x1a,0x1b,0x1c,0x1d,0x1e,0x1f,0},
 {0,1,2,3,4,5,6,7,0x1f,0x1f,0x1f,0x1f,0x1f,0x1f,0x1f,0x1f,0},
 {0x1f,0x1f,0x1f,0x1f,0x1f,0x1f,0x1f,0x1f,0x1f,0x1f,0x1f,0x1f,0x1f,0x1f,0x1f,0x1f,0x1f}};

/* fade level 0..4 (0 = black, 4 = full bright); present() scales by this. */
static int vw_fadelevel = 4;

/* Active EGA palette registers: logical colour (0..15) -> 6-bit DAC value.
   Written by the game's SetPalette()/SetPaletteEx() (intros, the Star Wars
   crawl, the Keen 5 galaxy ending, fades) via VL_SetPaletteRegs(); VW_Present()
   maps each through vw_ega64[]. Defaults to the canonical 16-colour mapping so
   the title/menus/gameplay are byte-for-byte unchanged. */
static byte vw_pal[16] =
	{0,1,2,3,4,5,6,7,0x18,0x19,0x1a,0x1b,0x1c,0x1d,0x1e,0x1f};

/* cursor (double-buffer overlay) state */
static int		cursorvisible;
static int		cursornumber,cursorwidth,cursorheight,cursorx,cursory;
static memptr	cursorsave;
static unsigned	cursorspot;

/* forward decls for the cursor helpers (called by VW_UpdateScreen above their
   definitions; not declared in ID_VW.H since they were file-local in ID_VW.C) */
void VWL_DrawCursor (void);
void VWL_EraseCursor (void);

/*
=============================================================================
                        LOW-LEVEL PLANE HELPERS
=============================================================================
*/

/* Set the 4-bit colour of one pixel: byte offset + bit index (0=MSB/left). */
static inline void vw_pixel (unsigned ofs, int bit, int color)
{
	byte bm = (byte)(0x80 >> bit);
	ofs = VL_VRAM_WRAP(ofs);
	if (color & 1) vram[0][ofs] |= bm; else vram[0][ofs] &= ~bm;
	if (color & 2) vram[1][ofs] |= bm; else vram[1][ofs] &= ~bm;
	if (color & 4) vram[2][ofs] |= bm; else vram[2][ofs] &= ~bm;
	if (color & 8) vram[3][ofs] |= bm; else vram[3][ofs] &= ~bm;
}

/* Copy `n` bytes within one bit-plane, wrapping both the source and the
   destination byte offsets mod 64 KB exactly as the DOS segment:offset latch
   copies did. The fast path (the run does not straddle the 64 KB boundary)
   is a plain memmove; only a run that wraps falls back to a byte loop. Call
   sites never overlap source/dest (copies go between distinct pages), so a
   forward byte copy is safe. */
static void vw_planecopy (byte *plane, unsigned dst, unsigned src, unsigned n)
{
	dst = VL_VRAM_WRAP(dst);
	src = VL_VRAM_WRAP(src);
	if (dst + n <= VL_VRAM_PLANESIZE && src + n <= VL_VRAM_PLANESIZE)
		memmove (&plane[dst], &plane[src], n);
	else
	{
		unsigned i;
		for (i=0;i<n;i++)
			plane[VL_VRAM_WRAP(dst+i)] = plane[VL_VRAM_WRAP(src+i)];
	}
}

/*
=============================================================================
                        STARTUP / MODE
=============================================================================
*/

cardtype VW_VideoID (void)
{
	return EGAcard;
}

void VW_SetLineWidth (int width)
{
	int i,offset;
	linewidth = width;
	offset = 0;
	for (i=0;i<VIRTUALHEIGHT;i++)
	{
		ylookup[i]=offset;
		offset += width;
	}
}

void VW_SetSplitScreen (int linenum)
{
	(void)linenum;			/* CAT3D only; unused by Keen */
}

void VW_SetScreenMode (int mode)
{
	switch (mode)
	{
	  case EGAGR:  screenseg = 0xa000; break;
	  default:     break;	/* TEXTGR / CGAGR / VGAGR: nothing to do on web */
	}
	VW_SetLineWidth (SCREENWIDTH);
}

void VW_Startup (void)
{
	/* No card detection or -HIDDENCARD/-NOPAN parsing on the web. */
	videocard = EGAcard;
	grmode = EGAGR;
	nopan = false;
	cursorvisible = 0;
	EGAWRITEMODE(0);
}

void VW_Shutdown (void)
{
	VW_SetScreenMode (TEXTGR);
}

/* set the visible window origin (and fine horizontal pan) */
void VW_SetScreen (unsigned CRTC, unsigned pelpan)
{
	vw_screenstart = CRTC;
	vw_pelpan = nopan ? 0 : (pelpan & 7);
	/* [web port] The EGA page flip is the per-frame "present" point. Yield to
	   the browser here so animation/timing loops that pace on TimeCount deltas
	   (ScaleDown, fizzles, the world-map zoom, scrollers, the play loop) advance
	   the wall clock and get drawn, instead of spinning with tics==0. */
	CKWEB_Yield ();
}

void VW_WaitVBL (int number)
{
	/* Wait `number` 70 Hz ticks, yielding to the browser each time so the
	   frame is presented and input is pumped (TimeCount is wall-clock driven). */
	unsigned long target = TimeCount + (number > 0 ? (unsigned long)number : 1UL);
	while (TimeCount < target)
		CKWEB_Yield ();
}

void VW_ClearVideo (int color)
{
	int p;
	for (p=0;p<EGA_PLANES;p++)
		memset (vram[p], (color>>p)&1 ? 0xff : 0x00, VL_VRAM_PLANESIZE);
}

/*
=============================================================================
                        PALETTE / FADES / BORDER
=============================================================================
*/

void VW_ColorBorder (int color)
{
	bordercolor = color;
}

void VW_SetPalette (byte *palette)
{
	byte p;
	word i;
	for (i = 0;i < 15;i++)
	{
		p = palette[i];
		colors[0][i] = 0;
		colors[1][i] = (p > 0x10)? (p & 0x0f) : 0;
		colors[2][i] = (p > 0x10)? p : 0;
		colors[3][i] = p;
		colors[4][i] = (p > 0x10)? 0x1f : p;
		colors[5][i] = 0x1f;
	}
}

void VW_SetDefaultColors (void)
{
	int i;
	colors[3][16] = bordercolor;
	/* Restore the canonical palette registers (row 3 is the default mapping),
	   matching the DOS int-10h AX=1002 default-palette load. Intros/endings set
	   special palettes, so the next gameplay screen must reset them here. */
	for (i = 0; i < 16; i++)
		vw_pal[i] = (byte)(colors[3][i] & 63);
	vw_fadelevel = 4;
	screenfaded = false;
}

void VW_FadeOut (void)	{ vw_fadelevel = 0; screenfaded = true;  }
void VW_FadeIn  (void)	{ vw_fadelevel = 4; screenfaded = false; }
void VW_FadeUp  (void)	{ vw_fadelevel = 4; screenfaded = true;  }
void VW_FadeDown(void)	{ vw_fadelevel = 4; screenfaded = false; }

void VW_SetAtrReg (int reg, int value)
{
	(void)reg; (void)value;
}

/*
=============================================================================
                        BLOCK PRIMITIVES
=============================================================================
*/

/*
= VW_MaskBlock — masked blit. segm = grseg base; the block at +ofs is
=   [mask: planesize][plane0][plane1][plane2][plane3], each plane `planesize`
=   (== wide*height) bytes. dest is a byte offset into VRAM (bufferofs NOT
=   added). For each plane: screen = (screen & mask) | data.
*/
void VW_MaskBlock (memptr segm,unsigned ofs,unsigned dest,
	unsigned wide,unsigned height,unsigned planesize)
{
	byte *seg = (byte *)segm;
	unsigned linedelta = linewidth - wide;
	int plane;

	for (plane=0;plane<EGA_PLANES;plane++)
	{
		const byte *mp = seg + ofs;
		const byte *dp = seg + ofs + planesize*(plane+1);
		unsigned d = dest;
		unsigned y,x;
		for (y=0;y<height;y++)
		{
			for (x=0;x<wide;x++,d++)
			{
				unsigned dw = VL_VRAM_WRAP(d);
				vram[plane][dw] = (byte)((vram[plane][dw] & *mp) | *dp);
				mp++; dp++;
			}
			d += linedelta;
		}
	}
}

/* VW_InverseMask — OR ~source into all four planes (white-out highlight). */
void VW_InverseMask (memptr segm,unsigned ofs,unsigned dest,
	unsigned wide,unsigned height)
{
	byte *seg = (byte *)segm;
	unsigned linedelta = linewidth - wide;
	const byte *sp = seg + ofs;
	unsigned d = dest;
	unsigned y,x;
	int plane;
	for (y=0;y<height;y++)
	{
		for (x=0;x<wide;x++,d++)
		{
			byte v = (byte)~(*sp++);
			unsigned dw = VL_VRAM_WRAP(d);
			for (plane=0;plane<EGA_PLANES;plane++)
				vram[plane][dw] |= v;
		}
		d += linedelta;
	}
}

/* VW_MemToScreen — non-masked blit; source is four sequential planes. */
void VW_MemToScreen (memptr source,unsigned dest,unsigned wide,unsigned height)
{
	byte *src = (byte *)source;
	unsigned linedelta = linewidth - wide;
	unsigned si = 0;
	int plane;
	for (plane=0;plane<EGA_PLANES;plane++)
	{
		unsigned d = dest;
		unsigned y,x;
		for (y=0;y<height;y++)
		{
			for (x=0;x<wide;x++,d++)
			{
				vram[plane][VL_VRAM_WRAP(d)] = src[si];
				si++;
			}
			d += linedelta;
		}
	}
}

/* VW_ScreenToMem — read planes 0-3 into a plane-sequential memory block. */
void VW_ScreenToMem (unsigned source,memptr dest,unsigned wide,unsigned height)
{
	byte *dst = (byte *)dest;
	unsigned linedelta = linewidth - wide;
	unsigned di = 0;
	int plane;
	for (plane=0;plane<EGA_PLANES;plane++)
	{
		unsigned s = source;
		unsigned y,x;
		for (y=0;y<height;y++)
		{
			for (x=0;x<wide;x++,s++)
				dst[di++] = vram[plane][VL_VRAM_WRAP(s)];
			s += linedelta;
		}
	}
}

/* VW_ScreenToScreen — copy a rectangle across all four planes (write mode 1). */
void VW_ScreenToScreen (unsigned source,unsigned dest,unsigned wide,unsigned height)
{
	unsigned y;
	int plane;
	for (y=0;y<height;y++)
	{
		for (plane=0;plane<EGA_PLANES;plane++)
			vw_planecopy (vram[plane], dest, source, wide);
		source += linewidth;
		dest   += linewidth;
	}
}

/*
=============================================================================
                        TILE / PIC DRAWING
=============================================================================
*/

/* VW_DrawTile8 — all 8x8 tiles share grsegs[STARTTILE8]; 4 planes * 8 bytes. */
void VW_DrawTile8 (unsigned x, unsigned y, unsigned tile)
{
	byte *src = (byte *)grsegs[STARTTILE8] + tile*32;
	unsigned dest = bufferofs + ylookup[y] + x;
	int plane,line;
	for (plane=0;plane<EGA_PLANES;plane++)
	{
		unsigned d = dest;
		for (line=0;line<8;line++)
		{
			vram[plane][VL_VRAM_WRAP(d)] = *src;
			src++;
			d += linewidth;
		}
	}
}

#if NUMPICS>0
void VW_DrawPic (unsigned x, unsigned y, unsigned chunknum)
{
	int picnum = chunknum - STARTPICS;
	memptr source = grsegs[chunknum];
	unsigned dest = ylookup[y]+x+bufferofs;
	VW_MemToScreen (source,dest,pictable[picnum].width,pictable[picnum].height);
}
#endif

#if NUMPICM>0
void VW_DrawMPic (unsigned x, unsigned y, unsigned chunknum)
{
	int picnum = chunknum - STARTPICM;
	memptr source = grsegs[chunknum];
	unsigned dest = ylookup[y]+x+bufferofs;
	unsigned width = picmtable[picnum].width;
	unsigned height = picmtable[picnum].height;
	VW_MaskBlock (source,0,dest,width,height,width*height);
}

void VW_ClipDrawMPic (unsigned x, int y, unsigned chunknum)
{
	int picnum = chunknum - STARTPICM;
	memptr source = grsegs[chunknum];
	unsigned dest,width,ofs,plane;
	int height;

	width = picmtable[picnum].width;
	height = picmtable[picnum].height;
	plane = width*height;

	ofs = 0;
	if (y<0)
	{
		ofs = -y*width;
		height += y;
		y = 0;
	}
	else if (y+height>216)
	{
		height -= (y-216);
	}
	dest = ylookup[y]+x+bufferofs;
	if (height<1)
		return;
	VW_MaskBlock (source,ofs,dest,width,height,plane);
}
#endif

/*
=============================================================================
                        SPRITE DRAWING (pixel-exact masked blit)
=============================================================================
*/

#if NUMSPRITES>0
/* Blit the unshifted 5-plane sprite to VRAM at an exact pixel position.
   destbyte = the byte offset of the start-of-row in VRAM; pxbit = sub-byte
   pixel offset (0-7). Mask bit set => transparent. */
static void vw_blit_sprite (spritetype _seg *block, spritetabletype far *spr,
	int x, int y)
{
	unsigned ofs = block->sourceoffset[0];
	unsigned planesize = block->planesize[0];
	unsigned wide = block->width[0];
	unsigned height = spr->height;
	byte *seg = (byte *)block;
	const byte *mask = seg + ofs;
	const byte *p0 = seg + ofs + planesize;
	const byte *p1 = p0 + planesize;
	const byte *p2 = p1 + planesize;
	const byte *p3 = p2 + planesize;
	unsigned row,c;
	int bit;

	for (row=0;row<height;row++)
	{
		int sy = y + (int)row;
		unsigned rowbase;
		if (sy < 0 || sy >= VIRTUALHEIGHT) { mask+=wide; p0+=wide; p1+=wide; p2+=wide; p3+=wide; continue; }
		rowbase = bufferofs + ylookup[sy];
		for (c=0;c<wide;c++)
		{
			byte mb=*mask++, b0=*p0++, b1=*p1++, b2=*p2++, b3=*p3++;
			for (bit=0;bit<8;bit++)
			{
				byte bm = (byte)(0x80>>bit);
				int px,color,byteoff,destbit;
				if (mb & bm)
					continue;				/* transparent */
				color = ((b0&bm)?1:0)|((b1&bm)?2:0)|((b2&bm)?4:0)|((b3&bm)?8:0);
				px = x + (int)(c*8) + bit;
				byteoff = px>>3;			/* arithmetic: floor for negatives */
				destbit = px & 7;
				if (byteoff < 0)
					continue;
				vw_pixel (rowbase + (unsigned)byteoff, destbit, color);
			}
		}
	}
}

void VW_DrawSprite (int x, int y, unsigned chunknum)
{
	spritetabletype far *spr = &spritetable[chunknum-STARTSPRITES];
	spritetype _seg *block = (spritetype _seg *)grsegs[chunknum];
	if (!block)
		return;
	y += spr->orgy>>G_P_SHIFT;
	x += spr->orgx>>G_P_SHIFT;
	vw_blit_sprite (block,spr,x,y);
}
#endif

/*
=============================================================================
                        PIXEL PRIMITIVES
=============================================================================
*/

void VW_Plot (unsigned x, unsigned y, unsigned color)
{
	unsigned dest = bufferofs + ylookup[y] + (x>>3);
	vw_pixel (dest, x&7, color);
}

void VW_Hlin (unsigned xl, unsigned xh, unsigned y, unsigned color)
{
	unsigned rowbase = bufferofs + ylookup[y];
	unsigned x;
	for (x=xl;x<=xh;x++)
		vw_pixel (rowbase + (x>>3), x&7, color);
}

void VW_Vlin (unsigned yl, unsigned yh, unsigned x, unsigned color)
{
	unsigned bx = x>>3, bit = x&7;
	unsigned y;
	for (y=yl;y<=yh;y++)
		vw_pixel (bufferofs + ylookup[y] + bx, bit, color);
}

void VW_Bar (unsigned x, unsigned y, unsigned width, unsigned height,
	unsigned color)
{
	unsigned xh = x+width-1;
	while (height--)
		VW_Hlin (x,xh,y++,color);
}

/*
=============================================================================
                        FONT DRAWING
=============================================================================

  On-disk font chunk layout (bytes):
    0      : word  height (lines)
    2      : word  location[256]  (offset of each glyph's bitmap within chunk)
    514    : byte  width[256]     (each glyph's pixel width)
  Each glyph: ((width+7)/8) bytes per line, `height` lines, 1 bpp, MSB-left.
*/

#if NUMFONT+NUMFONTM>0
typedef struct
{
	uint16_t height;
	uint16_t location[256];
	uint8_t  width[256];
} vw_fontdos;

void VW_MeasurePropString (char far *string, word *width, word *height)
{
	vw_fontdos *font = (vw_fontdos *)grsegs[STARTFONT+fontnumber];
	word w = 0;
	*height = font->height;
	for (;*string;string++)
		w += font->width[*(byte far *)string];
	*width = w;
}

void VW_MeasureMPropString (char far *string, word *width, word *height)
{
	vw_fontdos *font = (vw_fontdos *)grsegs[STARTFONTM+fontnumber];
	word w = 0;
	*height = font->height;
	for (;*string;string++)
		w += font->width[*(byte far *)string];
	*width = w;
}

/* Draw one glyph's set pixels. replace!=0 => set pixel to fontcolor (masked
   font); otherwise blend per pdrawmode function (OR, or XOR when func==3). */
static void vw_draw_glyph (vw_fontdos *font, int ch, int penx, int basey,
	int replace, int func)
{
	unsigned w = font->width[ch & 0xff];
	unsigned loc = font->location[ch & 0xff];
	unsigned bytewide = (w+7)>>3;
	unsigned height = font->height;
	const byte *glyph = (const byte *)font + loc;
	unsigned row,col;

	for (row=0;row<height;row++)
	{
		int sy = basey + (int)row;
		unsigned rowbase;
		if (sy < 0 || sy >= VIRTUALHEIGHT)
			continue;
		rowbase = bufferofs + panadjust + ylookup[sy];
		for (col=0;col<w;col++)
		{
			byte gb = glyph[row*bytewide + (col>>3)];
			if (!(gb & (0x80>>(col&7))))
				continue;
			{
				int px = penx + (int)col;
				unsigned ofs = VL_VRAM_WRAP(rowbase + (px>>3));
				byte bm = (byte)(0x80 >> (px&7));
				int p;
				if (replace)
				{
					for (p=0;p<EGA_PLANES;p++)
						if ((fontcolor>>p)&1) vram[p][ofs]|=bm; else vram[p][ofs]&=~bm;
				}
				else
				{
					for (p=0;p<EGA_PLANES;p++)
					{
						if (!((fontcolor>>p)&1)) continue;
						if (func==3) vram[p][ofs]^=bm; else vram[p][ofs]|=bm;
					}
				}
			}
		}
	}
}
#endif

#if NUMFONT>0
void VW_DrawPropString (char far *string)
{
	vw_fontdos *font = (vw_fontdos *)grsegs[STARTFONT+fontnumber];
	int func = (pdrawmode>>3)&3;
	int startx = px;
	for (;*string;string++)
	{
		int ch = *(byte far *)string;
		vw_draw_glyph (font, ch, px, py, 0, func);
		px += font->width[ch];
	}
	bufferwidth = ((px-startx)+7)>>3;
	bufferheight = font->height;
}
#endif

#if NUMFONTM>0
void VW_DrawMPropString (char far *string)
{
	vw_fontdos *font = (vw_fontdos *)grsegs[STARTFONTM+fontnumber];
	int startx = px;
	for (;*string;string++)
	{
		int ch = *(byte far *)string;
		vw_draw_glyph (font, ch, px, py, 1, 0);
		px += font->width[ch];
	}
	bufferwidth = ((px-startx)+7)>>3;
	bufferheight = font->height;
}
#endif

/*
=============================================================================
                        DOUBLE-BUFFER UPDATE MANAGEMENT
=============================================================================
*/

#define PIXTOBLOCK	4		/* 16 pixels to an update block */

int VW_MarkUpdateBlock (int x1, int y1, int x2, int y2)
{
	int x,y,xt1,yt1,xt2,yt2,nextline;
	byte *mark;

	xt1 = x1>>PIXTOBLOCK;
	yt1 = y1>>PIXTOBLOCK;
	xt2 = x2>>PIXTOBLOCK;
	yt2 = y2>>PIXTOBLOCK;

	if (xt1<0)				xt1=0;
	else if (xt1>=UPDATEWIDE-1)	return 0;

	if (yt1<0)				yt1=0;
	else if (yt1>UPDATEHIGH)	return 0;

	if (xt2<0)				return 0;
	else if (xt2>=UPDATEWIDE-1)	xt2 = UPDATEWIDE-2;

	if (yt2<0)				return 0;
	else if (yt2>=UPDATEHIGH)	yt2 = UPDATEHIGH-1;

	mark = updateptr + uwidthtable[yt1] + xt1;
	nextline = UPDATEWIDE - (xt2-xt1) - 1;

	for (y=yt1;y<=yt2;y++)
	{
		for (x=xt1;x<=xt2;x++)
			*mark++ = 1;
		mark += nextline;
	}
	return 1;
}

/* Scan the update matrix; copy every marked run of 16x16 tiles from the
   master page (bufferofs) to the display page (displayofs); clear the matrix.
   Equivalent to ID_VW_AE.ASM's VWL_UpdateScreenBlocks (write-mode-1 copy). */
void VWL_UpdateScreenBlocks (void)
{
	int total = UPDATEWIDE*UPDATEHIGH;
	int i = 0;
	while (i < total)
	{
		int run,line;
		unsigned srcofs,dstofs,widthbytes;
		if (!updateptr[i]) { i++; continue; }
		run = 0;
		while (i+run < total && updateptr[i+run])
			run++;
		srcofs = bufferofs + blockstarts[i];
		dstofs = displayofs + blockstarts[i];
		widthbytes = (unsigned)run*2;
		for (line=0;line<16;line++)
		{
			int p;
			for (p=0;p<EGA_PLANES;p++)
				vw_planecopy (vram[p], dstofs, srcofs, widthbytes);
			srcofs += linewidth;
			dstofs += linewidth;
		}
		i += run;
	}
	memset (updateptr, 0, total);
}

void VW_CGAFullUpdate (void) { }		/* EGA build: never called */

void VW_UpdateScreen (void)
{
	if (cursorvisible>0)
		VWL_DrawCursor();
	VWL_UpdateScreenBlocks();
	if (cursorvisible>0)
		VWL_EraseCursor();
	/* [web port] per-frame present point for menus/UI loops — yield so the
	   browser shows the frame and input is pumped (see VW_SetScreen). */
	CKWEB_Yield ();
}

void VW_InitDoubleBuffer (void)
{
	VW_SetScreen (displayofs+panadjust,0);
}

void VW_FixRefreshBuffer (void)
{
	VW_ScreenToScreen (displayofs,bufferofs,PORTTILESWIDE*4*CHARWIDTH,
		(PORTTILESHIGH-1)*16);
}

void VW_QuitDoubleBuffer (void) { }

/*
=============================================================================
                        CURSOR (double-buffered overlay)
=============================================================================
*/

void VWL_DrawCursor (void)
{
	cursorspot = bufferofs + ylookup[cursory+pansy]+(cursorx+pansx)/SCREENXDIV;
	VW_ScreenToMem (cursorspot,cursorsave,cursorwidth,cursorheight);
	VWB_DrawSprite (cursorx,cursory,cursornumber);
}

void VWL_EraseCursor (void)
{
	VW_MemToScreen (cursorsave,cursorspot,cursorwidth,cursorheight);
	VW_MarkUpdateBlock ((cursorx+pansx)&SCREENXMASK,cursory+pansy,
		((cursorx+pansx)&SCREENXMASK)+cursorwidth*SCREENXDIV-1,
		cursory+pansy+cursorheight-1);
}

void VW_ShowCursor (void)	{ cursorvisible++; }
void VW_HideCursor (void)	{ cursorvisible--; }

void VW_MoveCursor (int x, int y)
{
	cursorx = x;
	cursory = y;
}

void VW_SetCursor (int spritenum)
{
	VW_FreeCursor ();
	cursornumber = spritenum;
	CA_CacheGrChunk (spritenum);
	MM_SetLock (&grsegs[spritenum],true);
	cursorwidth = spritetable[spritenum-STARTSPRITES].width+1;
	cursorheight = spritetable[spritenum-STARTSPRITES].height;
	MM_GetPtr (&cursorsave,cursorwidth*cursorheight*5);
	MM_SetLock (&cursorsave,true);
}

void VW_FreeCursor (void)
{
	if (cursornumber)
	{
		MM_SetLock (&grsegs[cursornumber],false);
		MM_SetPurge (&grsegs[cursornumber],3);
		MM_SetLock (&cursorsave,false);
		MM_FreePtr (&cursorsave);
		cursornumber = 0;
	}
}

/*
=============================================================================
                        MODE-INDEPENDENT (VWB_*) WRAPPERS
=============================================================================
*/

void VWB_DrawTile8 (int x, int y, int tile)
{
	x+=pansx; y+=pansy;
	if (VW_MarkUpdateBlock (x&SCREENXMASK,y,(x&SCREENXMASK)+7,y+7))
		VW_DrawTile8 (x/SCREENXDIV,y,tile);
}

void VWB_DrawTile8M (int x, int y, int tile)
{
	int xb;
	x+=pansx; y+=pansy;
	xb = x/SCREENXDIV;
	if (VW_MarkUpdateBlock (x&SCREENXMASK,y,(x&SCREENXMASK)+7,y+7))
		VW_DrawTile8M (xb,y,tile);
}

void VWB_DrawTile16 (int x, int y, int tile)
{
	x+=pansx; y+=pansy;
	if (VW_MarkUpdateBlock (x&SCREENXMASK,y,(x&SCREENXMASK)+15,y+15))
		VW_DrawTile16 (x/SCREENXDIV,y,tile);
}

void VWB_DrawTile16M (int x, int y, int tile)
{
	int xb;
	x+=pansx; y+=pansy;
	xb = x/SCREENXDIV;
	if (VW_MarkUpdateBlock (x&SCREENXMASK,y,(x&SCREENXMASK)+15,y+15))
		VW_DrawTile16M (xb,y,tile);
}

#if NUMPICS>0
void VWB_DrawPic (int x, int y, int chunknum)
{
	int picnum = chunknum - STARTPICS;
	memptr source;
	unsigned dest,width,height;
	x+=pansx; y+=pansy; x/=SCREENXDIV;
	source = grsegs[chunknum];
	dest = ylookup[y]+x+bufferofs;
	width = pictable[picnum].width;
	height = pictable[picnum].height;
	if (VW_MarkUpdateBlock (x*SCREENXDIV,y,(x+width)*SCREENXDIV-1,y+height-1))
		VW_MemToScreen (source,dest,width,height);
}
#endif

#if NUMPICM>0
void VWB_DrawMPic (int x, int y, int chunknum)
{
	int picnum = chunknum - STARTPICM;
	memptr source;
	unsigned dest,width,height;
	x+=pansx; y+=pansy; x/=SCREENXDIV;
	source = grsegs[chunknum];
	dest = ylookup[y]+x+bufferofs;
	width = picmtable[picnum].width;
	height = picmtable[picnum].height;
	if (VW_MarkUpdateBlock (x*SCREENXDIV,y,(x+width)*SCREENXDIV-1,y+height-1))
		VW_MaskBlock (source,0,dest,width,height,width*height);
}
#endif

void VWB_Bar (int x, int y, int width, int height, int color)
{
	x+=pansx; y+=pansy;
	if (VW_MarkUpdateBlock (x,y,x+width,y+height-1))
		VW_Bar (x,y,width,height,color);
}

#if NUMFONT>0
void VWB_DrawPropString (char far *string)
{
	int x = px+pansx;
	int y = py+pansy;
	VW_DrawPropString (string);
	VW_MarkUpdateBlock (x,y,x+bufferwidth*8-1,y+bufferheight-1);
}
#endif

#if NUMFONTM>0
void VWB_DrawMPropString (char far *string)
{
	int x = px+pansx;
	int y = py+pansy;
	VW_DrawMPropString (string);
	VW_MarkUpdateBlock (x,y,x+bufferwidth*8-1,y+bufferheight-1);
}
#endif

#if NUMSPRITES>0
void VWB_DrawSprite (int x, int y, int chunknum)
{
	spritetabletype far *spr;
	spritetype _seg *block;
	int dx,dy,width,height;

	x+=pansx; y+=pansy;
	spr = &spritetable[chunknum-STARTSPRITES];
	block = (spritetype _seg *)grsegs[chunknum];
	if (!block)
		return;
	dy = y + (spr->orgy>>G_P_SHIFT);
	dx = x + (spr->orgx>>G_P_SHIFT);
	width = block->width[0];
	height = spr->height;

	/* mark generously: the pixel-exact blit can spill one byte past width */
	if (VW_MarkUpdateBlock (dx&SCREENXMASK,dy,
		(dx&SCREENXMASK)+(width+1)*SCREENXDIV-1,dy+height-1))
		vw_blit_sprite (block,spr,dx,dy);
}
#endif

void VWB_Plot (int x, int y, int color)
{
	x+=pansx; y+=pansy;
	if (VW_MarkUpdateBlock (x,y,x,y))
		VW_Plot (x,y,color);
}

void VWB_Hlin (int x1, int x2, int y, int color)
{
	x1+=pansx; x2+=pansx; y+=pansy;
	if (VW_MarkUpdateBlock (x1,y,x2,y))
		VW_Hlin (x1,x2,y,color);
}

void VWB_Vlin (int y1, int y2, int x, int color)
{
	x+=pansx; y1+=pansy; y2+=pansy;
	if (VW_MarkUpdateBlock (x,y1,x,y2))
		VW_Vlin (y1,y2,x,color);
}

/*
=============================================================================
                        PRESENT (VRAM -> RGBA for the canvas)
=============================================================================
*/

#define VL_SCREEN_W	320
#define VL_SCREEN_H	200

/* Standard EGA/CGA 16-colour palette (RGB). */
static const byte vw_egapal[16][3] =
{
	{0x00,0x00,0x00},{0x00,0x00,0xaa},{0x00,0xaa,0x00},{0x00,0xaa,0xaa},
	{0xaa,0x00,0x00},{0xaa,0x00,0xaa},{0xaa,0x55,0x00},{0xaa,0xaa,0xaa},
	{0x55,0x55,0x55},{0x55,0x55,0xff},{0x55,0xff,0x55},{0x55,0xff,0xff},
	{0xff,0x55,0x55},{0xff,0x55,0xff},{0xff,0xff,0x55},{0xff,0xff,0xff}
};

/* Full 64-entry EGA DAC -> RGB. The 16 canonical registers ({0..7,0x18..0x1f})
   are pinned to vw_egapal[] above, so the default palette renders byte-for-byte
   as before (gameplay/menus unchanged). The other DAC values are decoded to match
   what the game's intro/ending palettes show under DOSBox: bits 0/1/2 = B/G/R at
   full (0xAA); bit 4 = intensity, +0x55 to ALL channels (so DAC 0x10 = mid-grey
   0x55,0x55,0x55 — the star-wars cloud/ground dither — and 0x18..0x1f land on the
   bright CGA colours); bit 3 = +0x55 B, bit 5 = +0x55 R as low trims. Empirically
   checked: STARPALETTE colour 5 -> DAC 0x10 must be grey, not the green a naive
   rgbRGB decode gives. Built once at module load. */
static byte vw_ega64[64][3];

__attribute__((constructor))
static void vw_init_ega64 (void)
{
	static const byte canon[16] =
		{0,1,2,3,4,5,6,7,0x18,0x19,0x1a,0x1b,0x1c,0x1d,0x1e,0x1f};
	int v, k;
	for (v = 0; v < 64; v++)
	{
		int I = ((v>>4)&1)*0x55;					/* bit4: intensity, all channels */
		int r = ((v>>2)&1)*0xaa + ((v>>5)&1)*0x55 + I;
		int g = ((v>>1)&1)*0xaa + I;
		int b = ((v>>0)&1)*0xaa + ((v>>3)&1)*0x55 + I;
		vw_ega64[v][0] = (byte)(r > 0xff ? 0xff : r);
		vw_ega64[v][1] = (byte)(g > 0xff ? 0xff : g);
		vw_ega64[v][2] = (byte)(b > 0xff ? 0xff : b);
	}
	for (k = 0; k < 16; k++)
	{
		vw_ega64[canon[k]][0] = vw_egapal[k][0];
		vw_ega64[canon[k]][1] = vw_egapal[k][1];
		vw_ega64[canon[k]][2] = vw_egapal[k][2];
	}
}

/* SetPalette()/SetPaletteEx() in the game route here (see CK_DEF.H). Capture the
   16 logical-colour -> DAC register values; VW_Present() maps them via vw_ega64.
   Replaces the DOS BIOS int-10h AX=1002 path, which was a no-op in the port and
   left every special palette unapplied. */
void VL_SetPaletteRegs (const unsigned char *pal)
{
	int i;
	if (!pal) return;
	for (i = 0; i < 16; i++)
		vw_pal[i] = (byte)(pal[i] & 63);
}

static uint8_t vw_framebuffer[VL_SCREEN_W*VL_SCREEN_H*4];	/* RGBA */

/* Decode the visible 320x200 window from VRAM (at vw_screenstart, shifted by
   vw_pelpan) into vw_framebuffer as RGBA, dimmed by the current fade level. */
VW_EXPORT void VW_Present (void)
{
	int sy,sx;
	for (sy=0;sy<VL_SCREEN_H;sy++)
	{
		unsigned lineofs = vw_screenstart + (unsigned)sy*linewidth;
		uint8_t *out = vw_framebuffer + sy*VL_SCREEN_W*4;
		for (sx=0;sx<VL_SCREEN_W;sx++)
		{
			int srcpix = sx + (int)vw_pelpan;
			unsigned ofs = (lineofs + (srcpix>>3)) & (VL_VRAM_PLANESIZE-1);
			byte bm = (byte)(0x80 >> (srcpix&7));
			int color = ((vram[0][ofs]&bm)?1:0)|((vram[1][ofs]&bm)?2:0)|
			            ((vram[2][ofs]&bm)?4:0)|((vram[3][ofs]&bm)?8:0);
			const byte *rgb = vw_ega64[vw_pal[color] & 63];
			*out++ = (uint8_t)(rgb[0]*vw_fadelevel/4);
			*out++ = (uint8_t)(rgb[1]*vw_fadelevel/4);
			*out++ = (uint8_t)(rgb[2]*vw_fadelevel/4);
			*out++ = 0xff;
		}
	}
}

VW_EXPORT uint8_t *VW_GetFramebuffer (void) { return vw_framebuffer; }
VW_EXPORT int VW_ScreenWidth  (void) { return VL_SCREEN_W; }
VW_EXPORT int VW_ScreenHeight (void) { return VL_SCREEN_H; }

/* [web port] diagnostic accessor for the JS smoke tests. */
VW_EXPORT int VW_DebugState (int what)
{
	unsigned i, p, n = 0;
	switch (what)
	{
	case 0:	/* count of non-zero bytes across all four planes */
		for (p = 0; p < EGA_PLANES; p++)
			for (i = 0; i < VL_VRAM_PLANESIZE; i++)
				if (vram[p][i]) n++;
		return (int)n;
	case 1: return (int)linewidth;
	case 2: return (int)vw_screenstart;
	case 3: return (int)vw_fadelevel;
	case 4: return (int)vw_pelpan;
	case 5: return (int)bufferofs;
	case 6: return (int)displayofs;
	}
	return -1;
}
