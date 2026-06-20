/* MEM.H stub — Borland <mem.h> (memcpy/memset/movmem...) => standard string.h. */
#ifndef CK_STUB_MEM_H
#define CK_STUB_MEM_H

#include "ck_dos_compat.h"
#include <string.h>

/* Borland movmem(src,dst,n) / setmem(dst,n,val). */
static inline void movmem(const void *src, void *dst, unsigned n) { memmove(dst, src, n); }
static inline void setmem(void *dst, unsigned n, int val)         { memset(dst, val, n); }

#endif /* CK_STUB_MEM_H */
