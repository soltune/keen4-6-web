/* BIOS.H stub — Borland <bios.h>. BIOS services are reworked in the platform
   layer; provide trivial fallbacks so headers parse. */
#ifndef CK_STUB_BIOS_H
#define CK_STUB_BIOS_H

#include "ck_dos_compat.h"

static inline long  biostime(int cmd, long newtime) { (void)cmd; (void)newtime; return 0; }
static inline int   bioskey(int cmd)                { (void)cmd; return 0; }

#endif /* CK_STUB_BIOS_H */
