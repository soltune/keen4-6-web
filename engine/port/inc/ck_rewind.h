/* ===========================================================================
   ck_rewind.h — in-memory "rewind" (game-state snapshot + restore).

   Public interface for the web port's rewind feature. The core ring-buffer
   lives in engine/platform/ck_rewind.c; the two pairs of accessors below are
   implemented in the files that own the otherwise file-local state they expose
   (the RF sprite-tracking pool in ID_RF.C, the RNG table index in id_us_a.c).
   =========================================================================== */
#ifndef __CK_REWIND_H__
#define __CK_REWIND_H__

/* --- core API, driven from CK_PLAY.C's PlayLoop --------------------------- */
void Rewind_Reset  (void);   /* clear the history (call once at level start)  */
void Rewind_Record (void);   /* snapshot the current frame into the ring      */
int  Rewind_Step   (void);   /* restore the previous frame (1 = ok, 0 = end)  */
int  Rewind_HasHistory (void); /* 1 if an earlier frame exists to rewind to   */

/* --- sub-system state accessors used by Rewind_Record / Rewind_Step ------- */
unsigned RF_RewindSpriteSize (void);        /* size of the sprite-pool blob    */
void     RF_RewindSpriteSave (void *buf);   /* serialise the sprite pool       */
void     RF_RewindSpriteLoad (const void *buf);
int      US_GetRndIndex (void);             /* RNG table position (rndindex)   */
void     US_SetRndIndex (int v);
unsigned CK_RewindStateSize (void);         /* PlayLoop per-level loop state    */
void     CK_RewindStateSave (void *buf);    /* keenkilled, centerlevel, ...     */
void     CK_RewindStateLoad (const void *buf);

#endif
