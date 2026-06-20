/* ===========================================================================
   id_mm.c — web-port reimplementation of the ID Engine memory manager.

   Replaces the DOS ID_MM.C (EMS/XMS + segment-relocating zone allocator) with
   a flat-heap allocator on the WASM/native C heap. The browser gives us far
   more RAM than the 640K DOS model, so the movable/purgeable/lockable block
   machinery collapses to: malloc on MM_GetPtr, free on MM_FreePtr, and
   no-ops for lock/purge/sort (we simply never purge — cached chunks stay
   resident, which is correct, just less frugal than DOS).

   The public contract (ID_MM.H) is preserved exactly so the rest of the engine
   links unchanged: globals mminfo/bufferseg/mmerror/beforesort/aftersort and
   the MM_* entry points. A small fixed registry (mirroring the original
   mmblocks[MAXBLOCKS]) tracks each allocation so MM_FreePtr/SetLock/SetPurge
   can find a block by its pointer and so we can free everything on shutdown.
   =========================================================================== */

#include "ID_HEADS.H"

/* ---- public globals (declared extern in ID_MM.H) ---------------------- */
mminfotype  mminfo;
memptr      bufferseg;
boolean     mmerror;
void      (*beforesort) (void);
void      (*aftersort)  (void);

/* ---- internal allocation registry ------------------------------------- */
typedef struct
{
    void          *ptr;       /* the malloc'd block (NULL = free slot) */
    unsigned long  size;      /* bytes requested */
    memptr        *useptr;    /* the caller's handle (for symmetry w/ DOS) */
    boolean        locked;    /* honoured as bookkeeping only */
    int            purge;     /* 0..3, honoured as bookkeeping only */
} mmtrack_t;

static mmtrack_t mmtrack[MAXBLOCKS];
static boolean   bombonerror = true;
static boolean   mmstarted   = false;

static mmtrack_t *MML_FindByPtr (void *p)
{
    int i;
    if (!p)
        return 0;
    for (i = 0; i < MAXBLOCKS; i++)
        if (mmtrack[i].ptr == p)
            return &mmtrack[i];
    return 0;
}

static mmtrack_t *MML_FindFree (void)
{
    int i;
    for (i = 0; i < MAXBLOCKS; i++)
        if (!mmtrack[i].ptr)
            return &mmtrack[i];
    return 0;
}

/*
====================
= MM_Startup / MM_Shutdown
====================
*/
void MM_Startup (void)
{
    if (mmstarted)
        MM_Shutdown ();

    memset (mmtrack, 0, sizeof(mmtrack));
    mmerror     = false;
    bombonerror = true;
    beforesort  = 0;
    aftersort   = 0;

    /* Informational free-memory figures. The browser heap dwarfs the DOS
       model; report several MB so ID_CA caches freely and never purges. */
    mminfo.nearheap = 0x0000FFFFL;
    mminfo.farheap  = 0x00100000L;
    mminfo.EMSmem   = 0;
    mminfo.XMSmem   = 0;
    mminfo.mainmem  = 0x01000000L;   /* 16 MB of "conventional" memory */

    mmstarted = true;

    /* The always-available miscellaneous scratch buffer. */
    MM_GetPtr (&bufferseg, BUFFERSIZE);
}

void MM_Shutdown (void)
{
    int i;
    if (!mmstarted)
        return;
    for (i = 0; i < MAXBLOCKS; i++)
        if (mmtrack[i].ptr)
        {
            free (mmtrack[i].ptr);
            mmtrack[i].ptr = 0;
        }
    bufferseg = 0;
    mmstarted = false;
}

/* No expanded memory in the browser. */
void MM_MapEMS (void) { }

/*
====================
= MM_GetPtr — allocate a block and publish it through *baseptr
====================
*/
void MM_GetPtr (memptr *baseptr, unsigned long size)
{
    mmtrack_t *t;
    void      *p;

    t = MML_FindFree ();
    if (!t)
    {
        mmerror = true;
        if (bombonerror)
            Quit ("MM_GetPtr: out of block handles!");
        *baseptr = 0;
        return;
    }

    p = malloc (size ? (size_t)size : 1);
    if (!p)
    {
        mmerror = true;
        if (bombonerror)
            Quit ("MM_GetPtr: out of memory!");
        *baseptr = 0;
        return;
    }

    t->ptr    = p;
    t->size   = size;
    t->useptr = baseptr;
    t->locked = false;
    t->purge  = 0;

    *baseptr = p;
}

/*
====================
= MM_FreePtr — release a block and NULL the caller's handle
====================
*/
void MM_FreePtr (memptr *baseptr)
{
    mmtrack_t *t = MML_FindByPtr (*baseptr);
    if (t)
    {
        free (t->ptr);
        t->ptr    = 0;
        t->size   = 0;
        t->useptr = 0;
        t->locked = false;
        t->purge  = 0;
    }
    *baseptr = 0;
}

/* Purge level / lock state are bookkeeping only on a flat heap (we never move
   or purge). Kept for API fidelity and possible future memory pressure. */
void MM_SetPurge (memptr *baseptr, int purge)
{
    mmtrack_t *t = MML_FindByPtr (*baseptr);
    if (t)
        t->purge = purge;
}

void MM_SetLock (memptr *baseptr, boolean locked)
{
    mmtrack_t *t = MML_FindByPtr (*baseptr);
    if (t)
        t->locked = locked;
}

/* Nothing relocates, so sorting is a no-op — but honour the before/after
   callbacks the engine installs (they refresh cached pointers). */
void MM_SortMem (void)
{
    if (beforesort)
        beforesort ();
    if (aftersort)
        aftersort ();
}

void MM_ShowMemory (void) { }

long MM_UnusedMemory (void)
{
    return mminfo.mainmem;
}

long MM_TotalFree (void)
{
    return mminfo.mainmem + mminfo.EMSmem + mminfo.XMSmem;
}

void MM_BombOnError (boolean bomb)
{
    bombonerror = bomb;
}
