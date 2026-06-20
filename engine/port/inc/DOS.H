/* DOS.H stub — Borland <dos.h> shim for the web port.
   Provides just enough declarations for the engine to compile. Hardware I/O,
   interrupts and DOS services are reworked in the ported platform layer; these
   are no-op / trivial fallbacks so non-platform translation units compile. */
#ifndef CK_STUB_DOS_H
#define CK_STUB_DOS_H

#include "ck_dos_compat.h"
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

/* CPU register access (DOS int86 / pseudo-registers). Only referenced by the
   platform layer, which is rewritten; declared here so headers parse. */
struct ck_dos_wordregs { uint16_t ax, bx, cx, dx, si, di, cflag, flags; };
struct ck_dos_byteregs { uint8_t al, ah, bl, bh, cl, ch, dl, dh; };
union REGS { struct ck_dos_wordregs x; struct ck_dos_byteregs h; };
struct SREGS { uint16_t es, cs, ss, ds; };

/* Borland pseudo-register globals (_AX, _BX, _ES ...). */
extern unsigned _AX, _BX, _CX, _DX, _SI, _DI, _ES, _DS, _CS, _SS, _FLAGS;

/* Port I/O — overridden by the platform layer (ID_SD/ID_VW reworks). */
static inline void   outportb(unsigned p, unsigned char v) { (void)p; (void)v; }
static inline void   outport (unsigned p, unsigned v)      { (void)p; (void)v; }
static inline unsigned char inportb(unsigned p)            { (void)p; return 0; }
static inline unsigned      inport (unsigned p)            { (void)p; return 0; }

/* Interrupt vector + flag control — no-ops in the hosted port. */
typedef void (*ck_isr_t)(void);
static inline ck_isr_t getvect(int n)             { (void)n; return 0; }
static inline void     setvect(int n, ck_isr_t f) { (void)n; (void)f; }
static inline void     geninterrupt(int n)        { (void)n; }
static inline int      int86(int n, union REGS *in, union REGS *out) { (void)n; if (out && in) *out = *in; return 0; }
static inline int      int86x(int n, union REGS *in, union REGS *out, struct SREGS *s) { (void)n; (void)s; if (out && in) *out = *in; return 0; }
static inline void     enable(void)  {}
static inline void     disable(void) {}

/* Memory peek/poke — flat-memory equivalents via MK_FP (from ck_dos_compat). */
static inline unsigned char peekb(unsigned s, unsigned o) { return *((unsigned char *)MK_FP(s, o)); }
static inline unsigned      peek (unsigned s, unsigned o) { return *((unsigned short *)MK_FP(s, o)); }
static inline void          pokeb(unsigned s, unsigned o, unsigned char v) { *((unsigned char *)MK_FP(s, o)) = v; }
static inline void          poke (unsigned s, unsigned o, unsigned v)      { *((unsigned short *)MK_FP(s, o)) = (unsigned short)v; }

/* Far block copy. */
static inline void movedata(unsigned ss, unsigned so, unsigned ds, unsigned doff, size_t n) {
    memcpy(MK_FP(ds, doff), MK_FP(ss, so), n);
}
static inline void segread(struct SREGS *s) { if (s) memset(s, 0, sizeof(*s)); }

/* Date/time structs referenced by some ID_US code. */
struct date { int da_year; char da_day, da_mon; };
struct time { unsigned char ti_min, ti_hour, ti_hund, ti_sec; };

#endif /* CK_STUB_DOS_H */
