/* CONIO.H stub — Borland console I/O. Reworked in the platform layer; trivial. */
#ifndef CK_STUB_CONIO_H
#define CK_STUB_CONIO_H

#include "ck_dos_compat.h"

static inline int  kbhit(void)        { return 0; }
static inline int  getch(void)        { return 0; }
static inline int  putch(int c)       { return c; }
static inline void clrscr(void)       {}

#endif /* CK_STUB_CONIO_H */
