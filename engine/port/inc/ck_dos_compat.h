/* ===========================================================================
   ck_dos_compat.h — force-included prelude for the Keen 4-6 native web port.

   The reconstructed engine is 16-bit DOS Borland C. This header is injected
   (via `-include`) BEFORE any engine source/header so the DOS memory-model
   keywords and segment helpers are neutralised for a flat 32-bit (Emscripten/
   WASM, or native host for tests) address space.

   It deliberately does NOT redefine the engine's own integer typedefs
   (boolean/byte/word/longword) — those are defined by the engine's
   ID_HEADS.H/Types block. We only erase the DOS pointer model and provide the
   segment-arithmetic helpers the platform sources reference.

   The actual DOS *headers* (<DOS.H>, <ALLOC.H>, <MEM.H>, <IO.H>, <PROCESS.H>,
   <BIOS.H>, <CONIO.H>, <SYS\STAT.H>) are satisfied by stub headers that sit
   next to this file on the include path.
   =========================================================================== */
#ifndef CK_DOS_COMPAT_H
#define CK_DOS_COMPAT_H

/* DOS memory-model qualifiers -> nothing on a flat address space. */
#define far
#define near
#define huge
#define _seg
#define cdecl
#define interrupt
#define _loadds
#define _saveregs
#define pascal

/* Segment / far-pointer helpers. On flat memory a "far pointer" is just a
   pointer; the engine's segment bookkeeping is reworked in the ported
   platform layer, but these keep the many FP_SEG/FP_OFF/MK_FP call sites
   compiling. We model a pointer's "segment" as (addr>>4) and "offset" as the
   low nibble-addr, which round-trips through MK_FP. */
#define MK_FP(seg, off) \
    ((void *)(((unsigned char *)0) + (((unsigned long)(unsigned short)(seg) << 4) \
              + (unsigned short)(off))))
#define FP_SEG(p)  ((unsigned short)(((unsigned long)(unsigned char *)(p)) >> 4))
#define FP_OFF(p)  ((unsigned short)(((unsigned long)(unsigned char *)(p)) & 0x0f))

/* Apply a 16-entry EGA palette (logical colour -> 6-bit DAC value). The DOS
   build set these via BIOS int-10h AX=1002, which is a no-op in the port, so
   the SetPalette()/SetPaletteEx() macros (CK_DEF.H) route here instead. Defined
   in the ported video layer (engine/platform/id_vw.c). */
void VL_SetPaletteRegs (const unsigned char *pal);

/* Borland/DOS low-level file open() flags. POSIX has no text/binary
   distinction, so the mode flags are 0; the access-mode bits map to the
   standard owner permission bits. Guarded so a real <fcntl.h>/<sys/stat.h>
   definition wins if present. */
#ifndef O_BINARY
#define O_BINARY 0
#endif
#ifndef O_TEXT
#define O_TEXT 0
#endif
#ifndef S_IREAD
#define S_IREAD 0400
#endif
#ifndef S_IWRITE
#define S_IWRITE 0200
#endif

/* Borland's EINVFMT ("invalid executable format") errno, used by the engine as
   a sentinel for a short/bad read. Pick a value clear of POSIX errno space. */
#ifndef EINVFMT
#define EINVFMT 0x1F00
#endif

/* Borland global argc/argv (the engine's US_CheckParm / startup reads these)
   and sys_errlist (error-message strings). Defined in id_platform.c. */
extern int    _argc;
extern char **_argv;
extern char  *sys_errlist[];

/* Web runtime yield: every engine busy-wait on TimeCount calls this so the
   browser event loop runs (and TimeCount advances). Defined in ck_web.c. */
void CKWEB_Yield (void);

/* Flush the persistent save directory (/save, an IDBFS mount) to IndexedDB.
   The engine calls this right after it writes CONFIG/SAVEGAM so saves, options
   and high scores survive a page reload. No-op off-web. Defined in ck_web.c. */
void CKWEB_PersistFS (void);

/* Directory the engine writes its persistent files (CONFIG.*, SAVEGAM*.*) to.
   On the web that's the IDBFS-backed /save; on DOS it stays the cwd. */
#ifdef __EMSCRIPTEN__
#define CK_SAVEDIR "/save/"
#else
#define CK_SAVEDIR ""
#endif

/* Borland number-to-string helpers (non-standard; used by ID_US text output).
   Defined in id_platform.c. */
char *itoa  (int           value, char *buf, int radix);
char *ltoa  (long          value, char *buf, int radix);
char *ultoa (unsigned long value, char *buf, int radix);

/* Borland conio.h / EGA 16-colour text constants. Some engine code names them
   directly (e.g. VW_ColorBorder(CYAN), #define BACKCOLOR LIGHTGRAY). Force-
   included before the engine headers; each is guarded so the engine's own
   WHITE/BLACK (ID_VW.H, identical values) coexist without conflict. */
#ifndef BLACK
#define BLACK        0
#endif
#ifndef BLUE
#define BLUE         1
#endif
#ifndef GREEN
#define GREEN        2
#endif
#ifndef CYAN
#define CYAN         3
#endif
#ifndef RED
#define RED          4
#endif
#ifndef MAGENTA
#define MAGENTA      5
#endif
#ifndef BROWN
#define BROWN        6
#endif
#ifndef LIGHTGRAY
#define LIGHTGRAY    7
#endif
#ifndef DARKGRAY
#define DARKGRAY     8
#endif
#ifndef LIGHTBLUE
#define LIGHTBLUE    9
#endif
#ifndef LIGHTGREEN
#define LIGHTGREEN   10
#endif
#ifndef LIGHTCYAN
#define LIGHTCYAN    11
#endif
#ifndef LIGHTRED
#define LIGHTRED     12
#endif
#ifndef LIGHTMAGENTA
#define LIGHTMAGENTA 13
#endif
#ifndef YELLOW
#define YELLOW       14
#endif
#ifndef WHITE
#define WHITE        15
#endif

/* Borland random()/randomize() (non-standard). random(n) -> 0..n-1. */
#include <stdlib.h>
#include <time.h>
#ifndef random
#define random(num)  ((int)((num) > 0 ? (rand() % (int)(num)) : 0))
#endif
#ifndef randomize
#define randomize()  srand((unsigned)time((time_t *)0))
#endif

/* Borland far mem/str helpers -> the standard library equivalents (far is a
   no-op on flat memory). The engine calls these as functions. */
#include <string.h>
#ifndef _fmemcpy
#define _fmemcpy(d, s, n)  memcpy ((d), (s), (n))
#endif
#ifndef _fmemset
#define _fmemset(d, c, n)  memset ((d), (c), (n))
#endif
#ifndef _fstrcpy
#define _fstrcpy(d, s)     strcpy ((d), (s))
#endif

/* Borland macro-style max()/min() (text substitution preserves the engine's
   mixed int/word/long argument types). */
#ifndef max
#define max(a, b)  ((a) > (b) ? (a) : (b))
#endif
#ifndef min
#define min(a, b)  ((a) < (b) ? (a) : (b))
#endif

#endif /* CK_DOS_COMPAT_H */
