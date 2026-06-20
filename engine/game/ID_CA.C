/* Reconstructed Commander Keen 4-6 Source Code
 * Copyright (C) 2021 K1n9_Duk3
 *
 * This file is primarily based on:
 * Catacomb 3-D Source Code
 * Copyright (C) 1993-2014 Flat Rock Software
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program; if not, write to the Free Software Foundation, Inc.,
 * 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
 */

// ID_CA.C

/*
=============================================================================

Id Software Caching Manager
---------------------------

Must be started BEFORE the memory manager, because it needs to get the headers
loaded into the data segment

=============================================================================
*/

#include "ID_HEADS.H"
#pragma hdrstop

#pragma warn -pro
#pragma warn -use

#define THREEBYTEGRSTARTS

/*
=============================================================================

						 LOCAL CONSTANTS

=============================================================================
*/

typedef struct
{
  unsigned short bit0,bit1;	// 0-255 is a character, > is a pointer to a node
				// [web port] MUST be 16-bit: the on-disk EGADICT/
				// AUDIODICT nodes are 2-byte fields (DOS `unsigned`
				// == 2B); `unsigned` is 4B on wasm32 and would
				// double the node stride -> garbage tree -> OOB.
} huffnode;


typedef struct
{
	unsigned short	RLEWtag;	// [web port] on-disk 16-bit (keeps headeroffsets at +2)
	long		headeroffsets[100];
	byte		tileinfo[];
} __attribute__((packed)) mapfiletype;	// [web port] MUST be packed: DOS had no
		// padding after the 2-byte RLEWtag, so headeroffsets[] sits at file
		// offset 2; clang's natural 4-byte `long` alignment would insert 2 pad
		// bytes -> headeroffsets misread by 2 -> garbage map header -> huge size.


/*
=============================================================================

						 GLOBAL VARIABLES

=============================================================================
*/

byte 		_seg	*tinf;
int			mapon;

unsigned short	_seg	*mapsegs[3];	// [web port] 16-bit tile words
maptype		_seg	*mapheaderseg[NUMMAPS];
byte		_seg	*audiosegs[NUMSNDCHUNKS];
void		_seg	*grsegs[NUMCHUNKS];

byte		far	grneeded[NUMCHUNKS];
byte		ca_levelbit,ca_levelnum;

int			profilehandle,debughandle;

void	(*drawcachebox)		(char *title, unsigned numcache);
void	(*updatecachebox)	(void);
void	(*finishcachebox)	(void);

/*
=============================================================================

						 LOCAL VARIABLES

=============================================================================
*/

extern	long	far	CGAhead;
extern	long	far	EGAhead;
extern	byte	CGAdict;
extern	byte	EGAdict;
extern	byte	far	maphead;
extern	byte	mapdict;
extern	byte	far	audiohead;
extern	byte	audiodict;


long		_seg *grstarts;	// array of offsets in egagraph, -1 for sparse
long		_seg *audiostarts;	// array of offsets in audio / audiot

#ifdef GRHEADERLINKED
huffnode	*grhuffman;
#else
huffnode	grhuffman[255];
#endif

#ifdef AUDIOHEADERLINKED
huffnode	*audiohuffman;
#else
huffnode	audiohuffman[255];
#endif


int			grhandle;		// handle to EGAGRAPH
int			maphandle;		// handle to MAPTEMP / GAMEMAPS
int			audiohandle;	// handle to AUDIOT / AUDIO

long		chunkcomplen,chunkexplen;

SDMode		oldsoundmode;



void	CAL_DialogDraw (char *title,unsigned numcache);
void	CAL_DialogUpdate (void);
void	CAL_DialogFinish (void);
void	CAL_CarmackExpand (unsigned short far *source, unsigned short far *dest,
		unsigned length);


#ifdef THREEBYTEGRSTARTS
#define FILEPOSSIZE	3
//#define	GRFILEPOS(c) (*(long far *)(((byte far *)grstarts)+(c)*3)&0xffffff)
long GRFILEPOS(int c)
{
	long value;
	int	offset;
	byte far *p;

	offset = c*3;

	/* [web port] Assemble the 3-byte little-endian offset byte-by-byte instead
	   of an unaligned 4-byte load masked to 24 bits. The original over-read one
	   byte past grstarts for the final chunk and tripped wasm alignment checks;
	   this reads exactly the three stored bytes and is alignment-safe. */
	p = ((byte far *)grstarts)+offset;
	value = (long)p[0] | ((long)p[1] << 8) | ((long)p[2] << 16);

	if (value == 0xffffffl)
		value = -1;

	return value;
};
#else
#define FILEPOSSIZE	4
#define	GRFILEPOS(c) (grstarts[c])
#endif

/*
=============================================================================

					   LOW LEVEL ROUTINES

=============================================================================
*/

/*
============================
=
= CA_OpenDebug / CA_CloseDebug
=
= Opens a binary file with the handle "debughandle"
=
============================
*/

void CA_OpenDebug (void)
{
	unlink ("DEBUG.TXT");
	debughandle = open("DEBUG.TXT", O_CREAT | O_WRONLY | O_TEXT);
}

void CA_CloseDebug (void)
{
	close (debughandle);
}



/*
============================
=
= CAL_GetGrChunkLength
=
= Gets the length of an explicit length chunk (not tiles)
= The file pointer is positioned so the compressed data can be read in next.
=
============================
*/

void CAL_GetGrChunkLength (int chunk)
{
	lseek(grhandle,GRFILEPOS(chunk),SEEK_SET);
	read(grhandle,&chunkexplen,sizeof(chunkexplen));
	chunkcomplen = GRFILEPOS(chunk+1)-GRFILEPOS(chunk)-4;
}


/*
==========================
=
= CA_FarRead
=
= Read from a file to a far pointer
=
==========================
*/

boolean CA_FarRead (int handle, byte far *dest, long length)
{
	/* [web port] was DOS int 21h/3Fh; now a portable read() loop. The 64K
	   contract is kept for fidelity (the engine never single-reads more). */
	byte *p = dest;
	long remaining = length;
	if (length>0xffffl)
		Quit ("CA_FarRead doesn't support 64K reads yet!");
	while (remaining > 0)
	{
		int got = read (handle, p, (unsigned)remaining);
		if (got <= 0)
			return false;
		p += got;
		remaining -= got;
	}
	return	true;
}


/*
==========================
=
= CA_SegWrite
=
= Write from a file to a far pointer
=
==========================
*/

boolean CA_FarWrite (int handle, byte far *source, long length)
{
	/* [web port] was DOS int 21h/40h; now a portable write() loop. */
	byte *p = source;
	long remaining = length;
	if (length>0xffffl)
		Quit ("CA_FarWrite doesn't support 64K reads yet!");
	while (remaining > 0)
	{
		int wrote = write (handle, p, (unsigned)remaining);
		if (wrote <= 0)
			return false;
		p += wrote;
		remaining -= wrote;
	}
	return	true;
}


/*
==========================
=
= CA_ReadFile
=
= Reads a file into an allready allocated buffer
=
==========================
*/

boolean CA_ReadFile (char *filename, memptr *ptr)
{
	int handle;
	long size;

	if ((handle = open(filename,O_RDONLY | O_BINARY, S_IREAD)) == -1)
		return false;

	size = filelength (handle);
	if (!CA_FarRead (handle,*ptr,size))
	{
		close (handle);
		return false;
	}
	close (handle);
	return true;
}



/*
==========================
=
= CA_LoadFile
=
= Allocate space for and load a file
=
==========================
*/

boolean CA_LoadFile (char *filename, memptr *ptr)
{
	int handle;
	long size;

	if ((handle = open(filename,O_RDONLY | O_BINARY, S_IREAD)) == -1)
		return false;

	size = filelength (handle);
	MM_GetPtr (ptr,size);
	if (!CA_FarRead (handle,*ptr,size))
	{
		close (handle);
		return false;
	}
	close (handle);
	return true;
}

/*
============================================================================

		COMPRESSION routines, see JHUFF.C for more

============================================================================
*/



/*
===============
=
= CAL_OptimizeNodes
=
= Goes through a huffman table and changes the 256-511 node numbers to the
= actular address of the node.  Must be called before CAL_HuffExpand
=
===============
*/

void CAL_OptimizeNodes (huffnode *table)
{
  huffnode *node;
  int i;

  node = table;

  for (i=0;i<255;i++)
  {
	/* [web port] CAL_HuffExpand below reads bit0/bit1 as node INDICES
	   (value<256 = leaf byte, else next node = table[value-256]). The DOS
	   pass that rewrote those indices into 16-bit node addresses can't work
	   on a flat 32/64-bit heap (a real pointer won't round-trip through an
	   unsigned), so it is intentionally a no-op here. */
	(void)node; (void)table;
  }
}



/*
======================
=
= CAL_HuffExpand
=
= Length is the length of the EXPANDED data
=
======================
*/

void CAL_HuffExpand (byte huge *source, byte huge *dest,
  long length,huffnode *hufftable)
{
	/* [web port] portable, index-based Huffman expand replacing the DOS inline
	   asm. Identical semantics to id's CAL_HuffExpand and to the validated JS
	   reference decoder: head node = 254; source bits consumed LSB-first;
	   bit clear -> bit0, bit set -> bit1; value<256 = literal byte (then reset
	   to the head node), otherwise next node = hufftable[value-256]. Works on a
	   flat address space (no 16-bit node-address packing). */
	huffnode *headptr = hufftable + 254;
	huffnode *nodeon  = headptr;
	byte     *src     = (byte *)source;
	byte     *dst     = (byte *)dest;
	long      written = 0;
	byte      sbyte;
	byte      mask    = 1;
	unsigned  value;

	if (length <= 0)
		return;

	sbyte = *src++;
	while (written < length)
	{
		value = (sbyte & mask) ? nodeon->bit1 : nodeon->bit0;
		if (mask == 0x80) { sbyte = *src++; mask = 1; }
		else mask <<= 1;

		if (value < 256)
		{
			*dst++ = (byte)value;
			written++;
			nodeon = headptr;
		}
		else
			nodeon = hufftable + (value - 256);
	}
}


/*
======================
=
= CAL_CarmackExpand
=
= Length is the length of the EXPANDED data
=
======================
*/

#define NEARTAG	0xa7
#define FARTAG	0xa8

void CAL_CarmackExpand (unsigned short far *source, unsigned short far *dest, unsigned length)
{	// [web port] source/dest point at 16-bit map words (DOS `unsigned`==2B)
	unsigned	ch,chhigh,count,offset;
	unsigned short	far *copyptr, far *inptr, far *outptr;

	length/=2;

	inptr = source;
	outptr = dest;

	while (length)
	{
		ch = *inptr++;
		chhigh = ch>>8;
		if (chhigh == NEARTAG)
		{
			count = ch&0xff;
			if (!count)
			{				// have to insert a word containing the tag byte
				ch |= *(unsigned char far *)inptr;	// [web port] de-cast lvalue ++
				inptr = (unsigned short far *)((unsigned char far *)inptr + 1);
				*outptr++ = ch;
				length--;
			}
			else
			{
				offset = *(unsigned char far *)inptr;	// [web port] de-cast lvalue ++
				inptr = (unsigned short far *)((unsigned char far *)inptr + 1);
				copyptr = outptr - offset;
				length -= count;
				while (count--)
					*outptr++ = *copyptr++;
			}
		}
		else if (chhigh == FARTAG)
		{
			count = ch&0xff;
			if (!count)
			{				// have to insert a word containing the tag byte
				ch |= *(unsigned char far *)inptr;	// [web port] de-cast lvalue ++
				inptr = (unsigned short far *)((unsigned char far *)inptr + 1);
				*outptr++ = ch;
				length --;
			}
			else
			{
				offset = *inptr++;
				copyptr = dest + offset;
				length -= count;
				while (count--)
					*outptr++ = *copyptr++;
			}
		}
		else
		{
			*outptr++ = ch;
			length --;
		}
	}
}



/*
======================
=
= CA_RLEWcompress
=
======================
*/

long CA_RLEWCompress (unsigned short huge *source, long length, unsigned short huge *dest,
  unsigned rlewtag)
{	// [web port] source/dest are 16-bit map words
  long complength;
  unsigned value,count,i;
  unsigned short huge *start,huge *end;

  start = dest;

  end = source + (length+1)/2;

//
// compress it
//
  do
  {
	count = 1;
	value = *source++;
	while (*source == value && source<end)
	{
	  count++;
	  source++;
	}
	if (count>3 || value == rlewtag)
	{
    //
    // send a tag / count / value string
    //
      *dest++ = rlewtag;
      *dest++ = count;
      *dest++ = value;
    }
    else
    {
    //
    // send word without compressing
    //
      for (i=1;i<=count;i++)
	*dest++ = value;
	}

  } while (source<end);

  complength = 2*(dest-start);
  return complength;
}


/*
======================
=
= CA_RLEWexpand
= length is EXPANDED length
=
======================
*/

void CA_RLEWexpand (unsigned short huge *source, unsigned short huge *dest,long length,
  unsigned rlewtag)
{
	/* [web port] portable RLEW expand (the DOS asm is replaced with the
	   reference C the original kept under #if 0 — same algorithm as the
	   validated map decoder in ck_data.c). source/dest are 16-bit map words. */
	unsigned value,count,i;
	unsigned short huge *end;

	end = dest + (length)/2;

	do
	{
		value = *source++;
		if (value != rlewtag)
		{
			// uncompressed
			*dest++ = value;
		}
		else
		{
			// compressed string
			count = *source++;
			value = *source++;
			for (i=1;i<=count;i++)
				*dest++ = value;
		}
	} while (dest < end);
}



/*
=============================================================================

					 CACHE MANAGER ROUTINES

=============================================================================
*/


/*
======================
=
= CAL_LoadLinkedHeader   [WEBPORT]
=
= The DOS build linked the graphics/map/audio header and Huffman-dictionary
= blobs straight into the executable (the *HEADERLINKED code paths reference
= them as &EGAdict / FP_SEG(&EGAhead) / ...). Free-standing blobs cannot be
= linked the same way under wasm, so we instead load the ripped header/dict
= files (EGADICT/EGAHEAD/MAPHEAD/AUDIODICT/AUDIOHEAD) from the data folder.
= The compressed data files (EGAGRAPH/GAMEMAPS/AUDIO) and the Carmack/RLEW
= decode paths are left exactly as in the linked build, so decompression stays
= byte-for-byte identical.
=
======================
*/

static void *CAL_LoadLinkedHeader (char *filename)
{
	int handle;
	long length;
	memptr buf;

	if ((handle = open(filename, O_RDONLY | O_BINARY, S_IREAD)) == -1)
		Quit ("CAL_LoadLinkedHeader: can't open a header/dict file!");
	length = filelength(handle);
	MM_GetPtr (&buf, length);
	CA_FarRead (handle, buf, length);
	close (handle);
	return buf;
}

/*
======================
=
= CAL_SetupGrFile
=
======================
*/

void CAL_SetupGrFile (void)
{
	int handle;
	memptr compseg;

#ifdef GRHEADERLINKED

#if GRMODE == EGAGR
	grhuffman = (huffnode *)CAL_LoadLinkedHeader(GREXT"DICT."EXTENSION);
	grstarts = (long _seg *)CAL_LoadLinkedHeader(GREXT"HEAD."EXTENSION);
#endif
#if GRMODE == CGAGR
	grhuffman = (huffnode *)&CGAdict;
	grstarts = (long _seg *)FP_SEG(&CGAhead);
#endif

	CAL_OptimizeNodes (grhuffman);

#else

//
// load ???dict.ext (huffman dictionary for graphics files)
//

	if ((handle = open(GREXT"DICT."EXTENSION,
		 O_RDONLY | O_BINARY, S_IREAD)) == -1)
		Quit ("Can't open "GREXT"DICT."EXTENSION"!");

	read(handle, &grhuffman, sizeof(grhuffman));
	close(handle);
	CAL_OptimizeNodes (grhuffman);
//
// load the data offsets from ???head.ext
//
	MM_GetPtr ((memptr *)&grstarts,(NUMCHUNKS+1)*FILEPOSSIZE);

	if ((handle = open(GREXT"HEAD."EXTENSION,
		 O_RDONLY | O_BINARY, S_IREAD)) == -1)
		Quit ("Can't open "GREXT"HEAD."EXTENSION"!");

	CA_FarRead(handle, (memptr)grstarts, (NUMCHUNKS+1)*FILEPOSSIZE);

	close(handle);


#endif

//
// Open the graphics file, leaving it open until the game is finished
//
	grhandle = open(GREXT"GRAPH."EXTENSION, O_RDONLY | O_BINARY);
	if (grhandle == -1)
		Quit ("Cannot open "GREXT"GRAPH."EXTENSION"!");


//
// load the pic and sprite headers into the arrays in the data segment
//
#if NUMPICS>0
	MM_GetPtr((memptr *)&pictable,NUMPICS*sizeof(pictabletype));
	CAL_GetGrChunkLength(STRUCTPIC);		// position file pointer
	MM_GetPtr(&compseg,chunkcomplen);
	CA_FarRead (grhandle,compseg,chunkcomplen);
	CAL_HuffExpand (compseg, (byte huge *)pictable,NUMPICS*sizeof(pictabletype),grhuffman);
	MM_FreePtr(&compseg);
#endif

#if NUMPICM>0
	MM_GetPtr((memptr *)&picmtable,NUMPICM*sizeof(pictabletype));
	CAL_GetGrChunkLength(STRUCTPICM);		// position file pointer
	MM_GetPtr(&compseg,chunkcomplen);
	CA_FarRead (grhandle,compseg,chunkcomplen);
	CAL_HuffExpand (compseg, (byte huge *)picmtable,NUMPICS*sizeof(pictabletype),grhuffman);
	MM_FreePtr(&compseg);
#endif

#if NUMSPRITES>0
	MM_GetPtr((memptr *)&spritetable,NUMSPRITES*sizeof(spritetabletype));
	CAL_GetGrChunkLength(STRUCTSPRITE);	// position file pointer
	MM_GetPtr(&compseg,chunkcomplen);
	CA_FarRead (grhandle,compseg,chunkcomplen);
	CAL_HuffExpand (compseg, (byte huge *)spritetable,NUMSPRITES*sizeof(spritetabletype),grhuffman);
	MM_FreePtr(&compseg);
#endif

}

//==========================================================================


/*
======================
=
= CAL_SetupMapFile
=
======================
*/

void CAL_SetupMapFile (void)
{
	int handle;
	long length;

//
// load maphead.ext (offsets and tileinfo for map file)
//
#ifndef MAPHEADERLINKED
	if ((handle = open("MAPHEAD."EXTENSION,
		 O_RDONLY | O_BINARY, S_IREAD)) == -1)
		Quit ("Can't open MAPHEAD."EXTENSION"!");
	length = filelength(handle);
	MM_GetPtr ((memptr *)&tinf,length);
	CA_FarRead(handle, tinf, length);
	close(handle);
#else

	tinf = (byte _seg *)CAL_LoadLinkedHeader("MAPHEAD."EXTENSION);

#endif

//
// open the data file
//
#ifdef MAPHEADERLINKED
	if ((maphandle = open("GAMEMAPS."EXTENSION,
		 O_RDONLY | O_BINARY, S_IREAD)) == -1)
		Quit ("Can't open GAMEMAPS."EXTENSION"!");
#else
	if ((maphandle = open("MAPTEMP."EXTENSION,
		 O_RDONLY | O_BINARY, S_IREAD)) == -1)
		Quit ("Can't open MAPTEMP."EXTENSION"!");
#endif
}

//==========================================================================


/*
======================
=
= CAL_SetupAudioFile
=
======================
*/

void CAL_SetupAudioFile (void)
{
	int handle;
	long length;

//
// load maphead.ext (offsets and tileinfo for map file)
//
#ifndef AUDIOHEADERLINKED
	if ((handle = open("AUDIOHED."EXTENSION,
		 O_RDONLY | O_BINARY, S_IREAD)) == -1)
		Quit ("Can't open AUDIOHED."EXTENSION"!");
	length = filelength(handle);
	MM_GetPtr ((memptr *)&audiostarts,length);
	CA_FarRead(handle, (byte far *)audiostarts, length);
	close(handle);
#else
	audiohuffman = (huffnode *)CAL_LoadLinkedHeader("AUDIODICT."EXTENSION);
	CAL_OptimizeNodes (audiohuffman);
	audiostarts = (long _seg *)CAL_LoadLinkedHeader("AUDIOHEAD."EXTENSION);
#endif

//
// open the data file
//
#ifndef AUDIOHEADERLINKED
	if ((audiohandle = open("AUDIOT."EXTENSION,
		 O_RDONLY | O_BINARY, S_IREAD)) == -1)
		Quit ("Can't open AUDIOT."EXTENSION"!");
#else
	if ((audiohandle = open("AUDIO."EXTENSION,
		 O_RDONLY | O_BINARY, S_IREAD)) == -1)
		Quit ("Can't open AUDIO."EXTENSION"!");
#endif
}

//==========================================================================


/*
======================
=
= CA_Startup
=
= Open all files and load in headers
=
======================
*/

void CA_Startup (void)
{
#ifdef PROFILE
	unlink ("PROFILE.TXT");
	profilehandle = open("PROFILE.TXT", O_CREAT | O_WRONLY | O_TEXT);
#endif

#ifndef NOMAPS
	CAL_SetupMapFile ();
#endif
#ifndef NOGRAPHICS
	CAL_SetupGrFile ();
#endif
#ifndef NOAUDIO
	CAL_SetupAudioFile ();
#endif

	mapon = -1;
	ca_levelbit = 1;
	ca_levelnum = 0;

	drawcachebox	= CAL_DialogDraw;
	updatecachebox  = CAL_DialogUpdate;
	finishcachebox	= CAL_DialogFinish;
}

//==========================================================================


/*
======================
=
= CA_Shutdown
=
= Closes all files
=
======================
*/

void CA_Shutdown (void)
{
#ifdef PROFILE
	close (profilehandle);
#endif

	close (maphandle);
	close (grhandle);
	close (audiohandle);
}

//===========================================================================

/*
======================
=
= CA_CacheAudioChunk
=
======================
*/

void CA_CacheAudioChunk (int chunk)
{
	long	pos,compressed;
#ifdef AUDIOHEADERLINKED
	long	expanded;
	memptr	bigbufferseg;
	byte	far *source;
#endif

	if (audiosegs[chunk])
	{
		MM_SetPurge ((memptr *)&audiosegs[chunk],0);
		return;							// allready in memory
	}

//
// load the chunk into a buffer, either the miscbuffer if it fits, or allocate
// a larger buffer
//
	pos = audiostarts[chunk];
	compressed = audiostarts[chunk+1]-pos;

	lseek(audiohandle,pos,SEEK_SET);

#ifndef AUDIOHEADERLINKED

	MM_GetPtr ((memptr *)&audiosegs[chunk],compressed);
	if (mmerror)
		return;

	CA_FarRead(audiohandle,audiosegs[chunk],compressed);

#else

	if (compressed<=BUFFERSIZE)
	{
		CA_FarRead(audiohandle,bufferseg,compressed);
		source = bufferseg;
	}
	else
	{
		MM_GetPtr(&bigbufferseg,compressed);
		if (mmerror)
			return;
		MM_SetLock (&bigbufferseg,true);
		CA_FarRead(audiohandle,bigbufferseg,compressed);
		source = bigbufferseg;
	}

	expanded = *(long far *)source;
	source += 4;			// skip over length
	MM_GetPtr ((memptr *)&audiosegs[chunk],expanded);
	if (mmerror)
		goto done;
	CAL_HuffExpand (source,audiosegs[chunk],expanded,audiohuffman);

done:
	if (compressed>BUFFERSIZE)
		MM_FreePtr(&bigbufferseg);
#endif
}

//===========================================================================

/*
======================
=
= CA_LoadAllSounds
=
= Purges all sounds, then loads all new ones (mode switch)
=
======================
*/

void CA_LoadAllSounds (void)
{
	unsigned	start,i;

	switch (oldsoundmode)
	{
	case sdm_Off:
		goto cachein;
	case sdm_PC:
		start = STARTPCSOUNDS;
		break;
	case sdm_AdLib:
		start = STARTADLIBSOUNDS;
		break;
	}

	for (i=0;i<NUMSOUNDS;i++,start++)
		if (audiosegs[start])
			MM_SetPurge ((memptr *)&audiosegs[start],3);		// make purgable

cachein:

	switch (SoundMode)
	{
	case sdm_Off:
		return;
	case sdm_PC:
		start = STARTPCSOUNDS;
		break;
	case sdm_AdLib:
		start = STARTADLIBSOUNDS;
		break;
	}

	for (i=0;i<NUMSOUNDS;i++,start++)
		CA_CacheAudioChunk (start);

	oldsoundmode = SoundMode;
}

//===========================================================================

#if GRMODE == EGAGR

/*
======================
=
= CAL_ShiftSprite
=
= Make a shifted (one byte wider) copy of a sprite into another area
=
======================
*/

unsigned	static	sheight,swidth;

void CAL_ShiftSprite (byte far *base,unsigned source,unsigned dest,
	unsigned width, unsigned height, unsigned pixshift)
{
	/* [web port] Faithful re-implementation of the DOS sprite pre-shift.
	   The original emitted, via shifttabletable, sub-byte-shifted EGA-planar
	   copies of each masked sprite so the mask-blitter could draw at 2-pixel
	   granularity. RF_PlaceSprite / RFL_UpdateSprites (and ShiftScore for the
	   top-left score box) select block->sourceoffset[(pixx&7)/2] by sub-pixel
	   position, so with the old no-op stub every off-grid sprite — Keen while
	   walking, enemies, the score box — read uninitialised data and drew
	   rainbow garbage. This is the SINGLE root cause of the moving-sprite and
	   status-box glitches.

	   We shift the unshifted 5-plane shape (mask + 4 colour planes) right by
	   `pixshift` pixels into a copy one byte wider. New bits at the edges are 0
	   in the colour planes and 1 (transparent) in the mask plane, matching the
	   hardware fill so the widened sprite stays clipped to its silhouette.
	   `base` is the sprite block's real pointer; `source`/`dest` are byte
	   offsets of the unshifted and shifted copies within that block. */
	unsigned srcwidth = width;			/* source bytes per row, per plane  */
	unsigned dstwidth = width + 1;		/* shifted copy is one byte wider   */
	unsigned srcplane = srcwidth * height;
	unsigned dstplane = dstwidth * height;
	unsigned srcbits  = srcwidth * 8;
	unsigned dstbits  = dstwidth * 8;
	int plane;

	sheight = height; swidth = width; (void)sheight; (void)swidth;

	for (plane = 0; plane < 5; plane++)		/* 0 = mask, 1..4 = colour */
	{
		const byte *sp = base + source + (unsigned)plane*srcplane;
		byte *dp = base + dest + (unsigned)plane*dstplane;
		int fill = (plane == 0) ? 1 : 0;	/* mask: new area = transparent */
		unsigned row;
		for (row = 0; row < height; row++)
		{
			const byte *srow = sp + row*srcwidth;
			byte *drow = dp + row*dstwidth;
			unsigned db;
			for (db = 0; db < dstbits; db++)
			{
				byte bm = (byte)(0x80 >> (db & 7));
				int bit;
				if (db < pixshift || db - pixshift >= srcbits)
					bit = fill;			/* edge fill outside the source */
				else
				{
					unsigned sb = db - pixshift;	/* shift right by pixshift */
					bit = (srow[sb >> 3] >> (7 - (sb & 7))) & 1;
				}
				if (bit)
					drow[db >> 3] |= bm;
				else
					drow[db >> 3] &= (byte)~bm;
			}
		}
	}
}

#endif

//===========================================================================

/*
======================
=
= CAL_CacheSprite
=
= Generate shifts and set up sprite structure for a given sprite
=
======================
*/

void CAL_CacheSprite (int chunk, byte far *compressed)
{
	int i;
	unsigned shiftstarts[5];
	unsigned smallplane,bigplane,expanded;
	spritetabletype far *spr;
	spritetype _seg *dest;

#if GRMODE == CGAGR
//
// CGA has no pel panning, so shifts are never needed
//
	spr = &spritetable[chunk-STARTSPRITES];
	smallplane = spr->width*spr->height;
	MM_GetPtr (&grsegs[chunk],smallplane*2+MAXSHIFTS*6);
	if (mmerror)
		return;
	dest = (spritetype _seg *)grsegs[chunk];
	dest->sourceoffset[0] = MAXSHIFTS*6;	// start data after 3 unsigned tables
	dest->planesize[0] = smallplane;
	dest->width[0] = spr->width;

//
// expand the unshifted shape
//
	CAL_HuffExpand (compressed, &dest->data[0],smallplane*2,grhuffman);

#endif


#if GRMODE == EGAGR

//
// calculate sizes
//
	spr = &spritetable[chunk-STARTSPRITES];
	smallplane = spr->width*spr->height;
	bigplane = (spr->width+1)*spr->height;

	shiftstarts[0] = MAXSHIFTS*6;	// start data after 3 unsigned tables
	shiftstarts[1] = shiftstarts[0] + smallplane*5;	// 5 planes in a sprite
	shiftstarts[2] = shiftstarts[1] + bigplane*5;
	shiftstarts[3] = shiftstarts[2] + bigplane*5;
	shiftstarts[4] = shiftstarts[3] + bigplane*5;	// nothing ever put here

	expanded = shiftstarts[spr->shifts];
	MM_GetPtr (&grsegs[chunk],expanded);
	if (mmerror)
		return;
	dest = (spritetype _seg *)grsegs[chunk];

//
// expand the unshifted shape
//
	CAL_HuffExpand (compressed, &dest->data[0],smallplane*5,grhuffman);

//
// make the shifts!
//
	switch (spr->shifts)
	{
	case	1:
		for (i=0;i<4;i++)
		{
			dest->sourceoffset[i] = shiftstarts[0];
			dest->planesize[i] = smallplane;
			dest->width[i] = spr->width;
		}
		break;

	case	2:
		for (i=0;i<2;i++)
		{
			dest->sourceoffset[i] = shiftstarts[0];
			dest->planesize[i] = smallplane;
			dest->width[i] = spr->width;
		}
		for (i=2;i<4;i++)
		{
			dest->sourceoffset[i] = shiftstarts[1];
			dest->planesize[i] = bigplane;
			dest->width[i] = spr->width+1;
		}
		CAL_ShiftSprite ((byte far *)grsegs[chunk],dest->sourceoffset[0],
			dest->sourceoffset[2],spr->width,spr->height,4);
		break;

	case	4:
		dest->sourceoffset[0] = shiftstarts[0];
		dest->planesize[0] = smallplane;
		dest->width[0] = spr->width;

		dest->sourceoffset[1] = shiftstarts[1];
		dest->planesize[1] = bigplane;
		dest->width[1] = spr->width+1;
		CAL_ShiftSprite ((byte far *)grsegs[chunk],dest->sourceoffset[0],
			dest->sourceoffset[1],spr->width,spr->height,2);

		dest->sourceoffset[2] = shiftstarts[2];
		dest->planesize[2] = bigplane;
		dest->width[2] = spr->width+1;
		CAL_ShiftSprite ((byte far *)grsegs[chunk],dest->sourceoffset[0],
			dest->sourceoffset[2],spr->width,spr->height,4);

		dest->sourceoffset[3] = shiftstarts[3];
		dest->planesize[3] = bigplane;
		dest->width[3] = spr->width+1;
		CAL_ShiftSprite ((byte far *)grsegs[chunk],dest->sourceoffset[0],
			dest->sourceoffset[3],spr->width,spr->height,6);

		break;

	default:
		Quit ("CAL_CacheSprite: Bad shifts number!");
	}

#endif
}

//===========================================================================


/*
======================
=
= CAL_ExpandGrChunk
=
= Does whatever is needed with a pointer to a compressed chunk
=
======================
*/

void CAL_ExpandGrChunk (int chunk, byte far *source)
{
	long	expanded;


	if (chunk >= STARTTILE8 && chunk < STARTEXTERNS)
	{
	//
	// expanded sizes of tile8/16/32 are implicit
	//

#if GRMODE == EGAGR
#define BLOCK		32
#define MASKBLOCK	40
#endif

#if GRMODE == CGAGR
#define BLOCK		16
#define MASKBLOCK	32
#endif

		if (chunk<STARTTILE8M)			// tile 8s are all in one chunk!
			expanded = BLOCK*NUMTILE8;
		else if (chunk<STARTTILE16)
			expanded = MASKBLOCK*NUMTILE8M;
		else if (chunk<STARTTILE16M)	// all other tiles are one/chunk
			expanded = BLOCK*4;
		else if (chunk<STARTTILE32)
			expanded = MASKBLOCK*4;
		else if (chunk<STARTTILE32M)
			expanded = BLOCK*16;
		else
			expanded = MASKBLOCK*16;
	}
	else
	{
	//
	// everything else has an explicit size longword
	//
		expanded = *(long far *)source;
		source += 4;			// skip over length
	}

//
// allocate final space, decompress it, and free bigbuffer
// Sprites need to have shifts made and various other junk
//
	if (chunk>=STARTSPRITES && chunk< STARTTILE8)
		CAL_CacheSprite(chunk,source);
	else
	{
		MM_GetPtr (&grsegs[chunk],expanded);
		if (mmerror)
			return;
		CAL_HuffExpand (source,grsegs[chunk],expanded,grhuffman);
	}
}


/*
======================
=
= CAL_ReadGrChunk
=
= Gets a chunk off disk, optimizing reads to general buffer
=
======================
*/

void CAL_ReadGrChunk (int chunk)
{
	long	pos,compressed;
	memptr	bigbufferseg;
	byte	far *source;
	int		next;

//
// load the chunk into a buffer, either the miscbuffer if it fits, or allocate
// a larger buffer
//
	pos = GRFILEPOS(chunk);
	if (pos<0)							// $FFFFFFFF start is a sparse tile
	  return;

	next = chunk +1;
	while (GRFILEPOS(next) == -1)		// skip past any sparse tiles
		next++;

	compressed = GRFILEPOS(next)-pos;

	lseek(grhandle,pos,SEEK_SET);

	if (compressed<=BUFFERSIZE)
	{
		CA_FarRead(grhandle,bufferseg,compressed);
		source = bufferseg;
	}
	else
	{
		MM_GetPtr(&bigbufferseg,compressed);
		if (mmerror)
			return;
		MM_SetLock (&bigbufferseg,true);
		CA_FarRead(grhandle,bigbufferseg,compressed);
		source = bigbufferseg;
	}

	CAL_ExpandGrChunk (chunk,source);

	if (compressed>BUFFERSIZE)
		MM_FreePtr(&bigbufferseg);
}


/*
======================
=
= CA_CacheGrChunk
=
= Makes sure a given chunk is in memory, loadiing it if needed
=
======================
*/

void CA_CacheGrChunk (int chunk)
{
	long	pos,compressed;
	memptr	bigbufferseg;
	byte	far *source;
	int		next;

	grneeded[chunk] |= ca_levelbit;		// make sure it doesn't get removed
	if (grsegs[chunk])
	{
		MM_SetPurge (&grsegs[chunk],0);
		return;							// allready in memory
	}

//
// load the chunk into a buffer, either the miscbuffer if it fits, or allocate
// a larger buffer
//
	pos = GRFILEPOS(chunk);
	if (pos<0)							// $FFFFFFFF start is a sparse tile
	  return;

	next = chunk +1;
	while (GRFILEPOS(next) == -1)		// skip past any sparse tiles
		next++;

	compressed = GRFILEPOS(next)-pos;

	lseek(grhandle,pos,SEEK_SET);

	if (compressed<=BUFFERSIZE)
	{
		CA_FarRead(grhandle,bufferseg,compressed);
		source = bufferseg;
	}
	else
	{
		MM_GetPtr(&bigbufferseg,compressed);
		MM_SetLock (&bigbufferseg,true);
		CA_FarRead(grhandle,bigbufferseg,compressed);
		source = bigbufferseg;
	}

	CAL_ExpandGrChunk (chunk,source);

	if (compressed>BUFFERSIZE)
		MM_FreePtr(&bigbufferseg);
}



//==========================================================================

/*
======================
=
= CA_CacheMap
=
======================
*/

void CA_CacheMap (int mapnum)
{
	long	pos,compressed;
	int		plane;
	memptr	*dest,bigbufferseg;
	unsigned	size;
	unsigned short	far	*source;	// [web port] 16-bit map words
#ifdef MAPHEADERLINKED
	memptr	buffer2seg;
	long	expanded;
#endif


//
// free up memory from last map
//
	if (mapon>-1 && mapheaderseg[mapon])
		MM_SetPurge ((memptr *)&mapheaderseg[mapon],3);
	for (plane=0;plane<MAPPLANES;plane++)
		if (mapsegs[plane])
			MM_FreePtr ((memptr *)&mapsegs[plane]);

	mapon = mapnum;


//
// load map header
// The header will be cached if it is still around
//
	if (!mapheaderseg[mapnum])
	{
		pos = ((mapfiletype	_seg *)tinf)->headeroffsets[mapnum];
		if (pos<0)						// $FFFFFFFF start is a sparse map
		  Quit ("CA_CacheMap: Tried to load a non existent map!");

		MM_GetPtr((memptr *)&mapheaderseg[mapnum],sizeof(maptype));
		lseek(maphandle,pos,SEEK_SET);
		CA_FarRead (maphandle,(memptr)mapheaderseg[mapnum],sizeof(maptype));
	}
	else
		MM_SetPurge ((memptr *)&mapheaderseg[mapnum],0);

//
// load the planes in
// If a plane's pointer still exists it will be overwritten (levels are
// allways reloaded, never cached)
//

	size = mapheaderseg[mapnum]->width * mapheaderseg[mapnum]->height * 2;

	for (plane = 0; plane<MAPPLANES; plane++)
	{
		pos = mapheaderseg[mapnum]->planestart[plane];
		compressed = mapheaderseg[mapnum]->planelength[plane];

		if (!compressed)
			continue;		// the plane is not used in this game

		dest = (memptr *)&mapsegs[plane];
		MM_GetPtr(dest,size);

		lseek(maphandle,pos,SEEK_SET);
		if (compressed<=BUFFERSIZE)
			source = bufferseg;
		else
		{
			MM_GetPtr(&bigbufferseg,compressed);
			MM_SetLock (&bigbufferseg,true);
			source = bigbufferseg;
		}

		CA_FarRead(maphandle,(byte far *)source,compressed);
#ifdef MAPHEADERLINKED
		//
		// unhuffman, then unRLEW
		// The huffman'd chunk has a two byte expanded length first
		// The resulting RLEW chunk also does, even though it's not really
		// needed
		//
		expanded = *source;
		source++;
		MM_GetPtr (&buffer2seg,expanded);
		CAL_CarmackExpand (source, (unsigned short far *)buffer2seg,expanded);
		CA_RLEWexpand (((unsigned short far *)buffer2seg)+1,*dest,size,
		((mapfiletype _seg *)tinf)->RLEWtag);
		MM_FreePtr (&buffer2seg);

#else
		//
		// unRLEW, skipping expanded length
		//
		CA_RLEWexpand (source+1, *dest,size,
		((mapfiletype _seg *)tinf)->RLEWtag);
#endif

		if (compressed>BUFFERSIZE)
			MM_FreePtr(&bigbufferseg);
	}
}

//===========================================================================

/*
======================
=
= CA_UpLevel
=
= Goes up a bit level in the needed lists and clears it out.
= Everything is made purgable
=
======================
*/

void CA_UpLevel (void)
{
	if (ca_levelnum==7)
		Quit ("CA_UpLevel: Up past level 7!");

	ca_levelbit<<=1;
	ca_levelnum++;
}

//===========================================================================

/*
======================
=
= CA_DownLevel
=
= Goes down a bit level in the needed lists and recaches
= everything from the lower level
=
======================
*/

void CA_DownLevel (void)
{
	if (!ca_levelnum)
		Quit ("CA_DownLevel: Down past level 0!");
	ca_levelbit>>=1;
	ca_levelnum--;
	CA_CacheMarks(NULL);
}

//===========================================================================

/*
======================
=
= CA_ClearMarks
=
= Clears out all the marks at the current level
=
======================
*/

void CA_ClearMarks (void)
{
	int i;

	for (i=0;i<NUMCHUNKS;i++)
		grneeded[i]&=~ca_levelbit;
}


//===========================================================================

/*
======================
=
= CA_ClearAllMarks
=
= Clears out all the marks on all the levels
=
======================
*/

void CA_ClearAllMarks (void)
{
	_fmemset (grneeded,0,sizeof(grneeded));
	ca_levelbit = 1;
	ca_levelnum = 0;
}


//===========================================================================

/*
======================
=
= CA_FreeGraphics
=
======================
*/

void CA_FreeGraphics (void)
{
	int	i;

	for (i=0;i<NUMCHUNKS;i++)
		if (grsegs[i])
			MM_SetPurge ((memptr *)&grsegs[i],3);
}


/*
======================
=
= CA_SetAllPurge
=
= Make everything possible purgable
=
======================
*/

void CA_SetAllPurge (void)
{
	int i;

	CA_ClearMarks ();

//
// free cursor sprite and background save
//
	VW_FreeCursor ();

//
// free map headers and map planes
//
	for (i=0;i<NUMMAPS;i++)
		if (mapheaderseg[i])
			MM_SetPurge ((memptr *)&mapheaderseg[i],3);

	for (i=0;i<3;i++)
		if (mapsegs[i])
			MM_FreePtr ((memptr *)&mapsegs[i]);

//
// free sounds
//
	for (i=0;i<NUMSNDCHUNKS;i++)
		if (audiosegs[i])
			MM_SetPurge ((memptr *)&audiosegs[i],3);

//
// free graphics
//
	CA_FreeGraphics ();
}


void CA_SetGrPurge (void)
{
	int i;

//
// free graphics
//
	for (i=0;i<NUMCHUNKS;i++)
		if (grsegs[i])
			MM_SetPurge ((memptr *)&grsegs[i],3);
}


//===========================================================================


/*
======================
=
= CAL_DialogDraw
=
======================
*/

#define NUMBARS	(17l*8)
#define BARSTEP	8

unsigned	thx,thy,lastx;
long		barx,barstep;

void	CAL_DialogDraw (char *title,unsigned numcache)
{
	unsigned	homex,homey,x;

	barstep = (NUMBARS<<16)/numcache;

//
// draw dialog window (masked tiles 12 - 20 are window borders)
//
	US_CenterWindow (20,8);
	homex = PrintX;
	homey = PrintY;

	US_CPrint ("Loading");
	fontcolor = F_SECONDCOLOR;
	US_CPrint (title);
	fontcolor = F_BLACK;

//
// draw thermometer bar
//
	thx = homex + 8;
	thy = homey + 32;
#ifdef CAT3D
	VWB_DrawTile8(thx,thy,0);		// CAT3D numbers
	VWB_DrawTile8(thx,thy+8,3);
	VWB_DrawTile8(thx,thy+16,6);
	VWB_DrawTile8(thx+17*8,thy,2);
	VWB_DrawTile8(thx+17*8,thy+8,5);
	VWB_DrawTile8(thx+17*8,thy+16,8);
	for (x=thx+8;x<thx+17*8;x+=8)
	{
		VWB_DrawTile8(x,thy,1);
		VWB_DrawTile8(x,thy+8,4);
		VWB_DrawTile8(x,thy+16,7);
	}
#else
	VWB_DrawTile8(thx,thy,11);		// KEEN numbers
	VWB_DrawTile8(thx,thy+8,14);
	VWB_DrawTile8(thx,thy+16,17);
	VWB_DrawTile8(thx+17*8,thy,13);
	VWB_DrawTile8(thx+17*8,thy+8,16);
	VWB_DrawTile8(thx+17*8,thy+16,19);
	for (x=thx+8;x<thx+17*8;x+=8)
	{
		VWB_DrawTile8(x,thy,12);
		VWB_DrawTile8(x,thy+8,15);
		VWB_DrawTile8(x,thy+16,18);
	}
#endif

	thx += 4;		// first line location
	thy += 5;
	barx = (long)thx<<16;
	lastx = thx;

	VW_UpdateScreen();
}


/*
======================
=
= CAL_DialogUpdate
=
======================
*/

void	CAL_DialogUpdate (void)
{
	unsigned	x,xh;

	barx+=barstep;
	xh = barx>>16;
	if (xh - lastx > BARSTEP)
	{
		for (x=lastx;x<=xh;x++)
#if GRMODE == EGAGR
			VWB_Vlin (thy,thy+13,x,14);
#endif
#if GRMODE == CGAGR
			VWB_Vlin (thy,thy+13,x,SECONDCOLOR);
#endif
		lastx = xh;
		VW_UpdateScreen();
	}
}

/*
======================
=
= CAL_DialogFinish
=
======================
*/

void	CAL_DialogFinish (void)
{
	unsigned	x,xh;

	xh = thx + NUMBARS;
	for (x=lastx;x<=xh;x++)
#if GRMODE == EGAGR
		VWB_Vlin (thy,thy+13,x,14);
#endif
#if GRMODE == CGAGR
		VWB_Vlin (thy,thy+13,x,SECONDCOLOR);
#endif
	VW_UpdateScreen();

}

//===========================================================================

/*
======================
=
= CA_CacheMarks
=
======================
*/
#define MAXEMPTYREAD	1024

// [web port] On DOS the graphics streamed off disk slowly, so this cache dialog
//   (the level-enter / level-done text, etc.) stayed on screen for ~1-2s and the
//   SND_ENTERLEVEL effect finished during that window. The web port loads
//   instantly, so the message flashed for a single frame and the still-playing
//   sound was then awaited by SD_WaitSoundDone() over a faded-out (black) screen.
//   While a sound is still playing we hold the box up so the text is readable and
//   the sound drains over the message (not the later black screen); with no sound
//   playing (e.g. starting a new game) we don't wait, keeping the instant switch.
//   This define only caps the wait against a stuck/looping sound.
#define CA_MINCACHESHOWTICS	(TickBase*3/2)	// ~1.5 s cap

void CA_CacheMarks (char *title)
{
	boolean dialog;
	int 	i,next,numcache;
	long	pos,endpos,nextpos,nextendpos,compressed;
	long	bufferstart,bufferend;	// file position of general buffer
	byte	far *source;
	memptr	bigbufferseg;
	longword cachestarttime = 0;	// [web port] when the cache dialog appeared

	dialog = (title!=NULL);

	numcache = 0;
//
// go through and make everything not needed purgable
//
	for (i=0;i<NUMCHUNKS;i++)
		if (grneeded[i]&ca_levelbit)
		{
			if (grsegs[i])					// its allready in memory, make
				MM_SetPurge(&grsegs[i],0);	// sure it stays there!
			else
				numcache++;
		}
		else
		{
			if (grsegs[i])					// not needed, so make it purgeable
				MM_SetPurge(&grsegs[i],3);
		}

	if (!numcache)			// nothing to cache!
		return;

	if (dialog)
	{
#ifdef PROFILE
		write(profilehandle,title,strlen(title));
		write(profilehandle,"\n",1);
#endif
		if (drawcachebox)
			drawcachebox(title,numcache);
		cachestarttime = TimeCount;	// [web port] start of on-screen display
	}

//
// go through and load in anything still needed
//
	bufferstart = bufferend = 0;		// nothing good in buffer now

	for (i=0;i<NUMCHUNKS;i++)
		if ( (grneeded[i]&ca_levelbit) && !grsegs[i])
		{
//
// update thermometer
//
			if (dialog && updatecachebox)
				updatecachebox ();

			pos = GRFILEPOS(i);
			if (pos<0)
				continue;

			next = i +1;
			while (GRFILEPOS(next) == -1)		// skip past any sparse tiles
				next++;

			compressed = GRFILEPOS(next)-pos;
			endpos = pos+compressed;

			if (compressed<=BUFFERSIZE)
			{
				if (bufferstart<=pos
				&& bufferend>= endpos)
				{
				// data is allready in buffer
					source = (byte _seg *)bufferseg+(pos-bufferstart);
				}
				else
				{
				// load buffer with a new block from disk
				// try to get as many of the needed blocks in as possible
					while ( next < NUMCHUNKS )
					{
						while (next < NUMCHUNKS &&
						!(grneeded[next]&ca_levelbit && !grsegs[next]))
							next++;
						if (next == NUMCHUNKS)
							continue;

						nextpos = GRFILEPOS(next);
						while (GRFILEPOS(++next) == -1)	// skip past any sparse tiles
							;
						nextendpos = GRFILEPOS(next);
						if (nextpos - endpos <= MAXEMPTYREAD
						&& nextendpos-pos <= BUFFERSIZE)
							endpos = nextendpos;
						else
							next = NUMCHUNKS;			// read pos to posend
					}

					lseek(grhandle,pos,SEEK_SET);
					CA_FarRead(grhandle,bufferseg,endpos-pos);
					bufferstart = pos;
					bufferend = endpos;
					source = bufferseg;
				}
			}
			else
			{
			// big chunk, allocate temporary buffer
				MM_GetPtr(&bigbufferseg,compressed);
				if (mmerror)
					return;
				MM_SetLock (&bigbufferseg,true);
				lseek(grhandle,pos,SEEK_SET);
				CA_FarRead(grhandle,bigbufferseg,compressed);
				source = bigbufferseg;
			}

			CAL_ExpandGrChunk (i,source);
			if (mmerror)
				return;

			if (compressed>BUFFERSIZE)
				MM_FreePtr(&bigbufferseg);

		}

//
// finish up any thermometer remnants
//
		if (dialog && finishcachebox)
			finishcachebox();

	// [web port] If a sound is still playing (the SND_ENTERLEVEL effect from
	//   stepping on a level tile), hold the cache box up until it finishes: this
	//   keeps the level message visible AND drains the sound here, over the
	//   message, instead of later over the faded-out black screen that
	//   SD_WaitSoundDone() would otherwise wait on. With nothing playing (e.g.
	//   starting a new game from the Control Panel) we don't wait at all, keeping
	//   the original instant switch. CA_MINCACHESHOWTICS caps a stuck sound.
	if (dialog)
		while (SD_SoundPlaying() && TimeCount - cachestarttime < CA_MINCACHESHOWTICS)
			CKWEB_Yield ();
}

