/* ===========================================================================
   id_platform.c — small web-port support definitions.

   Provides the handful of Borland/DOS globals the engine references that have
   no Emscripten equivalent: the command-line argc/argv pair and the
   sys_errlist[] error-string table. There is no real command line in the
   browser, so argv is a single program name.
   =========================================================================== */

#include <string.h>

/* No real command line in the browser. */
static char *ck_argv_storage[2] = { "keen", 0 };
int    _argc = 1;
char **_argv = ck_argv_storage;

/* Error-message strings, indexed by errno. Filled from strerror() at load so
   ID_US's disk-error dialog has something to print. */
char *sys_errlist[256];

__attribute__((constructor))
static void ck_init_errlist (void)
{
    int i;
    for (i = 0; i < 256; i++)
    {
        const char *m = strerror (i);
        sys_errlist[i] = (char *)(m ? m : "");
    }
}

/* ---------------------------------------------------------------------------
   Borland register pseudo-variables (_AX, _BX, ...). The DOS code reads these
   right after an int86()/inline-asm call to pick up BIOS / mouse / joystick
   driver results. With no real BIOS here they stay 0, which the engine reads as
   "no device" (e.g. INL_StartMouse() returns false, joystick auto-detect fails).
   CK_STATE also (ab)uses `if ((_AX = tinf[...]) != 0)` as a scratch, which works
   correctly with a real global.
   --------------------------------------------------------------------------- */
unsigned _AX, _BX, _CX, _DX, _SI, _DI, _BP, _ES, _DS, _CS, _SS;

/* ---------------------------------------------------------------------------
   The signon / intro text screen. In the DOS build this was a 4000-byte 80x25
   text-mode image linked into the executable (referenced as `introscn`). The
   browser has no text mode, so this is a zeroed placeholder that satisfies the
   symbol; the cosmetic text-mode signon is simply not shown.
   --------------------------------------------------------------------------- */
char introscn[4096];

/* ---------------------------------------------------------------------------
   Borland itoa / ltoa / ultoa: convert an integer to a string in any radix
   (2..36). Standard C only has the radix-10 *printf family, so reimplement the
   engine's expected behaviour. ltoa/itoa treat the value as signed only for
   radix 10 (matching Borland); other radices format the raw bit pattern.
   --------------------------------------------------------------------------- */
static char *ck_ultoa_core (unsigned long value, char *buf, int radix)
{
    char tmp[34];
    int i = 0;
    if (radix < 2 || radix > 36) { buf[0] = '\0'; return buf; }
    do {
        int d = (int)(value % (unsigned long)radix);
        tmp[i++] = (char)(d < 10 ? '0' + d : 'a' + d - 10);
        value /= (unsigned long)radix;
    } while (value);
    {
        char *p = buf;
        while (i > 0) *p++ = tmp[--i];
        *p = '\0';
    }
    return buf;
}

char *ultoa (unsigned long value, char *buf, int radix)
{
    return ck_ultoa_core (value, buf, radix);
}

char *ltoa (long value, char *buf, int radix)
{
    if (radix == 10 && value < 0)
    {
        buf[0] = '-';
        ck_ultoa_core ((unsigned long)(-value), buf + 1, radix);
        return buf;
    }
    return ck_ultoa_core ((unsigned long)value, buf, radix);
}

char *itoa (int value, char *buf, int radix)
{
    if (radix == 10 && value < 0)
    {
        buf[0] = '-';
        ck_ultoa_core ((unsigned long)(-value), buf + 1, radix);
        return buf;
    }
    return ck_ultoa_core ((unsigned long)(unsigned int)value, buf, radix);
}

/* ---------------------------------------------------------------------------
   Borland conio text-mode output and the DOS critical-error hook. None of these
   have a browser equivalent (there is no text screen and no INT 24h), so they
   are harmless no-ops. cputs/gotoxy are only used by the signon / TED-launch
   text UI; harderr would install a disk "Abort/Retry/Fail" handler.
   --------------------------------------------------------------------------- */
int cputs (const char *s) { (void)s; return 0; }
int gotoxy (int x, int y) { (void)x; (void)y; return 0; }
int harderr (void *handler) { (void)handler; return 0; }
