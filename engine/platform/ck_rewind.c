/* ===========================================================================
   ck_rewind.c — in-memory "rewind" (state snapshot + restore) for the web port.

   Records the full mutable game state every game frame into a ring buffer;
   holding the rewind key replays it backwards (Braid / emulator style). It is
   built on the SAME state definition the disk save uses (CK_GAME.C SaveTheGame):
   gamestate + the three map planes + the object list. Because a rewind restores
   WITHIN THE SAME PROCESS (unlike a disk load across program runs), every
   pointer stays valid, so we can snapshot the object pool, the RF sprite-
   tracking pool and the scroll origin VERBATIM and simply RF_ForceRefresh() to
   repaint — no pointer fix-up and, crucially, no re-running of actor react
   logic (which would double-fire sounds / state side effects).

   Scope: within the current level only — Rewind_Reset() clears the history on
   every level start, so the ring never spans a level transition (which would
   need the other level's graphics re-cached). Audio is not rewound (cosmetic).

   Map planes are captured with change-detection + RLEW compression
   (CA_RLEWCompress, exactly as the save does): an unchanged map is shared by
   reference between frames instead of re-stored, so static stretches cost only
   the ~17 KB object/sprite/state blob per frame.
   =========================================================================== */
#include <stdlib.h>
#include "CK_DEF.H"
#include "ck_rewind.h"

#define REWIND_FRAMES   (15 * 70)   /* ~15 s of history at the 70 Hz tick rate */
#define RLETAG          0xABCD      /* RLEW marker, matches CK_GAME.C           */

/* objarray and the list-management globals live in CK_PLAY.C and have no extern
   in a shared header, so declare them here. (gamestate / player / scoreobj come
   from CK_DEF.H; mapsegs / mapwidth / originxglobal from the ID_* headers.) */
extern objtype  objarray[MAXACTORS];
extern objtype *lastobj, *objfreelist;
extern Uint16   objectcount;

/* --- one compressed map snapshot, shared by every frame since the last change.
   data layout = 3 planes of [unsigned bytelen][bytelen compressed bytes]. */
typedef struct {
	int            refcount;
	unsigned       size;
	unsigned char *data;
} mapblock_t;

/* --- ring buffer ---------------------------------------------------------- */
static unsigned char *framedata = NULL;   /* REWIND_FRAMES * fixedsize bytes   */
static mapblock_t   **framemap  = NULL;   /* per-frame compressed-map reference */
static unsigned       fixedsize = 0;      /* bytes of one frame's fixed part    */
static int            head = 0;           /* next slot to write                 */
static int            count = 0;          /* valid frames currently in the ring */
static int            ready = 0;          /* allocation succeeded               */

/* last raw (uncompressed) map planes — change-detection + restore baseline */
static unsigned char *lastraw = NULL;
static unsigned       lastraw_bytes = 0;

/*
===========================================================================
   fixed-part (everything except the map) serialise / restore
===========================================================================
*/

static unsigned compute_fixedsize (void)
{
	return sizeof(gamestate)
	     + sizeof(objarray)
	     + sizeof(objtype *) * 4          /* player, scoreobj, lastobj, freelist */
	     + sizeof(objectcount)
	     + sizeof(unsigned) * 2           /* originxglobal, originyglobal         */
	     + sizeof(int)                    /* rndindex                             */
	     + RF_RewindSpriteSize()
	     + CK_RewindStateSize();          /* keenkilled / scroll / timers (CK_PLAY)*/
}

static void save_fixed (unsigned char *p)
{
	objtype *heads[4];
	unsigned origin[2];
	int rnd;

	memcpy (p, &gamestate, sizeof(gamestate));   p += sizeof(gamestate);
	memcpy (p, objarray, sizeof(objarray));      p += sizeof(objarray);

	heads[0] = player; heads[1] = scoreobj; heads[2] = lastobj; heads[3] = objfreelist;
	memcpy (p, heads, sizeof(heads));            p += sizeof(heads);
	memcpy (p, &objectcount, sizeof(objectcount)); p += sizeof(objectcount);

	origin[0] = originxglobal; origin[1] = originyglobal;
	memcpy (p, origin, sizeof(origin));          p += sizeof(origin);

	rnd = US_GetRndIndex ();
	memcpy (p, &rnd, sizeof(rnd));               p += sizeof(rnd);

	RF_RewindSpriteSave (p);                     p += RF_RewindSpriteSize ();
	CK_RewindStateSave (p);
}

static void load_fixed (const unsigned char *p)
{
	objtype *heads[4];
	unsigned origin[2];
	int rnd;

	memcpy (&gamestate, p, sizeof(gamestate));   p += sizeof(gamestate);
	memcpy (objarray, p, sizeof(objarray));      p += sizeof(objarray);

	memcpy (heads, p, sizeof(heads));            p += sizeof(heads);
	player = heads[0]; scoreobj = heads[1]; lastobj = heads[2]; objfreelist = heads[3];
	memcpy (&objectcount, p, sizeof(objectcount)); p += sizeof(objectcount);

	memcpy (origin, p, sizeof(origin));          p += sizeof(origin);
	originxglobal = origin[0]; originyglobal = origin[1];

	memcpy (&rnd, p, sizeof(rnd));               p += sizeof(rnd);
	US_SetRndIndex (rnd);

	RF_RewindSpriteLoad (p);                     p += RF_RewindSpriteSize ();
	CK_RewindStateLoad (p);
}

/*
===========================================================================
   map planes: change-detection, compress, expand
===========================================================================
*/

static int map_changed (void)
{
	unsigned planebytes = (unsigned)mapwidth * mapheight * 2;
	int i;

	if (lastraw_bytes != planebytes * 3)
		return 1;                       /* first frame / new level size */
	for (i = 0; i < 3; i++)
		if (memcmp (lastraw + (unsigned)i * planebytes, mapsegs[i], planebytes))
			return 1;
	return 0;
}

static void update_lastraw (void)
{
	unsigned planebytes = (unsigned)mapwidth * mapheight * 2;
	int i;

	if (lastraw_bytes != planebytes * 3)
	{
		free (lastraw);
		lastraw = (unsigned char *) malloc (planebytes * 3);
		lastraw_bytes = lastraw ? planebytes * 3 : 0;
	}
	if (!lastraw)
		return;
	for (i = 0; i < 3; i++)
		memcpy (lastraw + (unsigned)i * planebytes, mapsegs[i], planebytes);
}

static mapblock_t *capture_map (void)
{
	unsigned planebytes = (unsigned)mapwidth * mapheight * 2;
	static unsigned char *tmp = NULL;
	static unsigned tmpcap = 0;
	unsigned need = 3 * (planebytes * 2 + 8);   /* generous: RLEW can expand */
	unsigned char *q;
	unsigned total;
	mapblock_t *mb;
	int i;

	if (tmpcap < need)
	{
		free (tmp);
		tmp = (unsigned char *) malloc (need);
		tmpcap = tmp ? need : 0;
	}
	if (!tmp)
		return NULL;

	q = tmp;
	for (i = 0; i < 3; i++)
	{
		unsigned c = (unsigned) CA_RLEWCompress ((unsigned short *)mapsegs[i],
		                                         (long)planebytes,
		                                         (unsigned short *)(q + sizeof(unsigned)),
		                                         RLETAG);
		*(unsigned *)q = c;
		q += sizeof(unsigned) + c;
	}
	total = (unsigned)(q - tmp);

	mb = (mapblock_t *) malloc (sizeof(mapblock_t));
	if (!mb)
		return NULL;
	mb->data = (unsigned char *) malloc (total);
	if (!mb->data) { free (mb); return NULL; }
	memcpy (mb->data, tmp, total);
	mb->size = total;
	mb->refcount = 1;
	return mb;
}

static void restore_map (mapblock_t *mb)
{
	unsigned planebytes = (unsigned)mapwidth * mapheight * 2;
	unsigned char *q;
	int i;

	if (!mb)
		return;
	q = mb->data;
	for (i = 0; i < 3; i++)
	{
		unsigned c = *(unsigned *)q;
		q += sizeof(unsigned);
		CA_RLEWexpand ((unsigned short *)q, (unsigned short *)mapsegs[i],
		               (long)planebytes, RLETAG);
		q += c;
	}
}

static void mapblock_release (mapblock_t *mb)
{
	if (!mb)
		return;
	if (--mb->refcount <= 0)
	{
		free (mb->data);
		free (mb);
	}
}

/*
===========================================================================
   public API
===========================================================================
*/

void Rewind_Reset (void)
{
	int i;

	if (!ready)
	{
		fixedsize = compute_fixedsize ();
		framedata = (unsigned char *) malloc ((size_t)REWIND_FRAMES * fixedsize);
		framemap  = (mapblock_t **) calloc (REWIND_FRAMES, sizeof(mapblock_t *));
		if (!framedata || !framemap)
		{
			free (framedata); free (framemap);
			framedata = NULL; framemap = NULL;
			return;                     /* out of memory -> rewind disabled */
		}
		ready = 1;
	}

	for (i = 0; i < REWIND_FRAMES; i++)
	{
		mapblock_release (framemap[i]);
		framemap[i] = NULL;
	}
	head = 0;
	count = 0;
	free (lastraw);
	lastraw = NULL;
	lastraw_bytes = 0;
}

void Rewind_Record (void)
{
	mapblock_t *mb;
	unsigned char *slot;

	if (!ready)
		return;

	if (map_changed ())
	{
		mb = capture_map ();
		update_lastraw ();
	}
	else
	{
		/* share the previous frame's (identical) compressed map */
		int prev = (head - 1 + REWIND_FRAMES) % REWIND_FRAMES;
		mb = (count > 0) ? framemap[prev] : NULL;
		if (mb)
			mb->refcount++;
		else
		{
			mb = capture_map ();
			update_lastraw ();
		}
	}

	if (count == REWIND_FRAMES)         /* ring full: drop the slot we overwrite */
		mapblock_release (framemap[head]);

	slot = framedata + (size_t)head * fixedsize;
	save_fixed (slot);
	framemap[head] = mb;

	head = (head + 1) % REWIND_FRAMES;
	if (count < REWIND_FRAMES)
		count++;
}

int Rewind_HasHistory (void)
{
	return ready && count > 1;
}

int Rewind_Step (void)
{
	int curr, prev;

	if (!ready || count <= 1)
		return 0;                       /* nothing earlier to go back to */

	/* the most recent recorded frame is the present; discard it and restore the
	   one before it. */
	curr = (head - 1 + REWIND_FRAMES) % REWIND_FRAMES;
	mapblock_release (framemap[curr]);
	framemap[curr] = NULL;
	head = curr;
	count--;

	prev = (head - 1 + REWIND_FRAMES) % REWIND_FRAMES;
	load_fixed (framedata + (size_t)prev * fixedsize);
	restore_map (framemap[prev]);
	update_lastraw ();                  /* restored map = new change baseline */

	return 1;                           /* caller repaints once via RF_ForceRefresh */
}
