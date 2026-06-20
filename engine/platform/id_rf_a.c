/* ===========================================================================
   id_rf_a.c — C port of the EGA refresh inner loops from ID_RF_A.ASM
   (RFL_NewTile / RFL_UpdateTiles / RFL_MaskForegroundTiles).

   The original used EGA hardware (SC_MAPMASK plane selection, write mode 1
   latch copies, GC_READMAP) to composite and copy 16x16 tiles. Here the same
   operations are expressed against the four-plane software framebuffer through
   the View Manager primitives, which already model that hardware:

     * VW_MemToScreen   — four-plane blit            (write mode 0)
     * VW_MaskBlock     — (screen & mask) | data     (masked composite)
     * VW_ScreenToScreen— copy across all four planes (write mode 1 latch copy)

   The update-matrix scan (runs of 1s for tile copies, 3s for masked foreground
   tiles) is reproduced exactly so the per-frame refresh behaviour matches the
   DOS game.
   =========================================================================== */
#include "ID_HEADS.H"
#include <stdint.h>

/* These ID_RF.C globals have no extern declaration in the engine headers. */
extern byte     *updatestart[2];
extern unsigned  originmap;

#if GRMODE == EGAGR

/*
=================
= RFL_NewTile
=
= Draws a composite two-plane tile to the master screen and marks the update
= spot as 1 in both update pages, forcing the tile to be copied to the view
= pages on the next two refreshes. Called for newly scrolled-on strips and for
= animating tiles.
=================
*/
void RFL_NewTile (unsigned updateoffset)
{
	unsigned mapspot;		/* byte offset into a map plane            */
	unsigned screen;		/* plane offset of the tile on the master  */
	uint16_t fg, bg;		/* foreground / background tile numbers    */

	/* mark both update lists at this spot */
	updatestart[0][updateoffset] = 1;
	updatestart[1][updateoffset] = 1;

	mapspot = updatemapofs[updateoffset] + originmap;
	screen  = blockstarts[updateoffset] + masterofs;

	/* tile numbers are 16-bit words in the map planes */
	fg = *(uint16_t *)((byte *)mapsegs[1] + mapspot);	/* foreground */
	bg = *(uint16_t *)((byte *)mapsegs[0] + mapspot);	/* background */

	/* background 16x16 tile: four sequential planes, two bytes wide */
	VW_MemToScreen (grsegs[STARTTILE16 + bg], screen, 2, 16);

	/*
	 * If there is a foreground tile, composite it on top:
	 * screen = (screen & mask) | data. The background we just wrote provides
	 * the "screen" operand, so the result matches the assembly's single-pass
	 * (bg & mask) | data exactly.
	 */
	if (fg && (unsigned)(STARTTILE16M + fg) < NUMCHUNKS && grsegs[STARTTILE16M + fg])
		VW_MaskBlock (grsegs[STARTTILE16M + fg], 0, screen, 2, 16, 32);
}

/*
=================
= RFL_UpdateTiles
=
= Scans the update matrix at updateptr for 1s. Each 1 marks a tile that must be
= copied from the master screen to the current view page. Horizontally adjacent
= marked tiles are copied as a single run.
=================
*/
void RFL_UpdateTiles (void)
{
	byte *scan = updateptr;
	byte *end  = updateptr + UPDATEWIDE * UPDATEHIGH + 1;

	while (scan < end)
	{
		byte    *runstart;
		unsigned pos, runlen, bs;

		while (scan < end && *scan != 1)	/* find next tile marked 1 */
			scan++;
		if (scan >= end)
			break;

		runstart = scan;
		pos = (unsigned)(runstart - updateptr);	/* tile position in matrix */
		while (scan < end && *scan == 1)	/* extend over adjacent 1s */
			scan++;
		runlen = (unsigned)(scan - runstart);

		bs = blockstarts[pos];
		/* latch copy master -> current page, runlen tiles (2 bytes each) x16 */
		VW_ScreenToScreen (masterofs + bs, bufferofs + bs, runlen * 2, 16);
	}
}

/*
=================
= RFL_MaskForegroundTiles
=
= Scans the update matrix for 3s. Where the foreground map tile at that spot is
= a masked (in-front) tile, draw it over the current view page.
=================
*/
void RFL_MaskForegroundTiles (void)
{
	byte *scan = updateptr;
	byte *end  = updateptr + UPDATEWIDE * UPDATEHIGH + 2;

	while (scan < end)
	{
		unsigned pos, mapspot, bs;
		uint16_t fg;

		while (scan < end && *scan != 3)	/* find next tile marked 3 */
			scan++;
		if (scan >= end)
			break;

		pos = (unsigned)(scan - updateptr);
		scan++;

		mapspot = updatemapofs[pos] + originmap;
		fg = *(uint16_t *)((byte *)mapsegs[1] + mapspot);	/* foreground tile # */
		if (!fg)
			continue;

		/* high bit of the tile-info INTILE flag means "masked foreground" */
		if (!(((byte *)tinf)[INTILE + fg] & 0x80))
			continue;

		bs = blockstarts[pos];
		/* [web port] Guard the masked-tile chunk index. The update-matrix scan can
		   momentarily index updatemapofs[] one or two past its end (the matrix is
		   terminated a couple of bytes beyond UPDATEWIDE*UPDATEHIGH), which yields a
		   garbage foreground tile number such as 0xFFFF. On 16-bit DOS the resulting
		   grsegs[] read wrapped harmlessly inside the 64 KB segment; on wasm the huge
		   index is a hard out-of-bounds trap. A real masked tile is always < NUMCHUNKS
		   and cached, so skipping anything else is safe (it never elides a valid tile)
		   and merely declines to draw the bogus one. */
		if ((unsigned)(STARTTILE16M + fg) >= NUMCHUNKS || !grsegs[STARTTILE16M + fg])
			continue;
		VW_MaskBlock (grsegs[STARTTILE16M + fg], 0, bufferofs + bs, 2, 16, 32);
	}
}

#endif	/* GRMODE == EGAGR */
