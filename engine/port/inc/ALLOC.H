/* ALLOC.H stub — Borland far-heap allocator shim. Flat memory => malloc/free. */
#ifndef CK_STUB_ALLOC_H
#define CK_STUB_ALLOC_H

#include "ck_dos_compat.h"
#include <stdlib.h>

static inline void *farmalloc(unsigned long size)        { return malloc((size_t)size); }
static inline void  farfree(void *p)                     { free(p); }
static inline void *farrealloc(void *p, unsigned long s) { return realloc(p, (size_t)s); }
/* Plenty of "far core" on a modern heap; used only for sizing decisions. */
static inline unsigned long farcoreleft(void)            { return 0x4000000UL; }
static inline unsigned long coreleft(void)               { return 0x4000000UL; }

#endif /* CK_STUB_ALLOC_H */
