/* ===========================================================================
   ck_web.c — Emscripten runtime driver glue.

   The reconstructed engine keeps the original DOS control flow: main() runs the
   whole game and blocks in busy-wait loops on the 70 Hz `TimeCount` clock (which
   the PC timer ISR used to advance). A browser is single-threaded and
   cooperative, so:

     * TimeCount is advanced here from the real wall clock (so it ticks even
       before the audio context is unlocked), and
     * every busy-wait yields to the browser via emscripten_sleep() (ASYNCIFY),
       letting requestAnimationFrame present the framebuffer and DOM events feed
       the input layer before the engine loop resumes.

   Build requires -sASYNCIFY.
   =========================================================================== */
#include <emscripten.h>
#include <stdint.h>

/* TimeCount is `longword` (unsigned long, 32-bit on wasm32) in ID_SD.C. */
extern unsigned long TimeCount;

/* When set, SDL_t0Service must NOT also ++TimeCount — the wall clock owns it. */
int ckweb_realtime = 0;

#define CKWEB_TICKBASE 70.0		/* engine TickBase (Hz) */

/* Cap a single pump's advance, in ticks. Normal busy-waits pump every ~1 ms
   (<<1 tick), so this never triggers in steady state; it only bounds the jump
   after a long non-yielding stretch (level decompress, etc.) so a demo that
   just reset TimeCount low can't briefly fast-forward many frames. */
#define CKWEB_MAXJUMP 35.0

/* Wall clock -> TimeCount as a monotonic *delta* accumulator, emulating the PC
   timer ISR (which only ever ++TimeCount). Adding elapsed ticks — rather than
   snapping TimeCount to absolute elapsed time — lets engine writes to TimeCount
   stick. The demo/scroll timing resets TimeCount/lasttimecount low and paces on
   relative deltas (RF_CalcTics' DemoMode branch: while (TimeCount <
   oldtimecount+DEMOTICS*2); ScrollSWText), and PlayLoop rewinds TimeCount on
   MAXTICS. The old absolute snap clobbered those every pump, so the demo
   throttle never waited and the attract demos ran many times too fast. */
static double ckweb_last = -1.0;	/* emscripten_get_now() at previous pump (ms) */
static double ckweb_frac = 0.0;		/* sub-tick remainder carried forward         */

static void ckweb_pump (void)
{
	double now = emscripten_get_now ();
	double elapsed;
	unsigned long whole;

	if (ckweb_last < 0.0) { ckweb_last = now; return; }
	elapsed = (now - ckweb_last) * (CKWEB_TICKBASE / 1000.0) + ckweb_frac;
	ckweb_last = now;
	if (elapsed < 0.0)            elapsed = 0.0;		/* clock went backwards */
	if (elapsed > CKWEB_MAXJUMP)  elapsed = CKWEB_MAXJUMP;
	whole = (unsigned long)elapsed;
	ckweb_frac = elapsed - (double)whole;
	TimeCount += whole;
}

/*
 * CKWEB_Yield — called from every engine busy-wait. Advances the clock and
 * hands control back to the browser event loop, then resumes. ASYNCIFY makes
 * the surrounding (otherwise blocking) engine call stack suspend/resume.
 */
EMSCRIPTEN_KEEPALIVE
void CKWEB_Yield (void)
{
	ckweb_pump ();
	emscripten_sleep (1);		/* ~1 ms: lets rAF / input / audio run */
	ckweb_pump ();
}

/* Called once from JS just before main() starts the engine. */
EMSCRIPTEN_KEEPALIVE
void CKWEB_Boot (void)
{
	ckweb_realtime = 1;
	ckweb_last = -1.0;
	ckweb_frac = 0.0;
}

/* Convenience accessor for the JS shell (frame pacing / debug). */
EMSCRIPTEN_KEEPALIVE
unsigned long CKWEB_TimeCount (void)
{
	return TimeCount;
}

/*
 * CKWEB_PersistFS — flush the /save IDBFS mount to IndexedDB. Called by the
 * engine right after it writes CONFIG/SAVEGAM (see ID_US_1/2.C), so options,
 * high scores and saved games survive a page reload. syncfs is asynchronous;
 * we fire-and-forget (the next write coalesces with any in-flight sync). The
 * mount itself is set up from JS before main() runs (see wasmEngine.ts).
 */
EMSCRIPTEN_KEEPALIVE
void CKWEB_PersistFS (void)
{
	EM_ASM({
		if (typeof FS !== 'undefined' && FS.syncfs)
			FS.syncfs(false, function (err) {
				if (err) console.warn('[keen] persist failed:', err);
			});
	});
}
