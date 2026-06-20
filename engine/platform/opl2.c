/* ===========================================================================
   opl2.c — OPL2/AdLib FM front-end backed by Nuked-OPL3 (cycle-accurate YMF262).

   The opl2.h interface is unchanged: ID_SD.C still makes sound by writing OPL
   registers via alOut() -> OPL2_Write(). Internally those writes now drive the
   Nuked-OPL3 core (nukedopl/opl3.c) instead of the old hand-tuned approximation.

   The chip powers up in OPL2-compatibility mode — the OPL3 "NEW" bit (reg 0x105)
   stays 0 because Commander Keen never sets it — so it behaves exactly like the
   YMF262 inside a Sound Blaster Pro2/16 running Keen, now reproducing the
   tremolo/vibrato LFOs (reg 0xBD, which the engine DOES write via alEffects),
   key-scaling (KSL/KSR) and the true exponential envelope curves that the
   previous synth dropped or approximated.

   Two things stay in this front-end, on top of the FM core:
     * the AdLib-detection status shim (SDL_DetectAdLib reads readstat() ==
       OPL2_Status(); reg 4 timer writes fake the timer-1 overflow it expects);
     * the PC-speaker square wave (Speaker_SetFreq), mixed into the FM output.
   =========================================================================== */

#include "opl2.h"
#include "nukedopl/opl3.h"
#include <math.h>

static opl3_chip	chip;
static double		opl_sr = 44100.0;

/* PC speaker square-wave state */
static double		spk_freq = 0.0, spk_phase = 0.0;

/* AdLib-detection status emulation (see OPL2_Status) */
static unsigned char	detect_status = 0x00;

/* Output gain: Nuked emits full-scale int16; this scales the mono mix back into
   the same ~0.10-0.16 float range the old synth produced, so the downstream
   audio path (worklet / level metering) is unchanged. Plain int16->[-1,1]
   normalisation already lands the ck4 level-1 music peak at ~0.11, matching the
   old synth (verified via web/test/verify-wasm-audio.mjs). */
#define FM_GAIN		(1.0 / 32768.0)

void OPL2_Init (double sampleRate)
{
	opl_sr = sampleRate > 0 ? sampleRate : 44100.0;
	OPL3_Reset (&chip, (uint32_t) opl_sr);
	spk_freq = spk_phase = 0.0;
	detect_status = 0x00;
}

void OPL2_AllOff (void)
{
	int ch;
	/* Drop key-on (and block/fnum-hi) on every melodic channel -> release. */
	for (ch = 0; ch < 9; ch++)
		OPL3_WriteReg (&chip, (uint16_t)(0xb0 + ch), 0);
	spk_freq = spk_phase = 0.0;
}

unsigned char OPL2_Status (void)
{
	return detect_status;
}

void OPL2_Write (unsigned char reg, unsigned char val)
{
	/* AdLib detection shim: reg 4 = timer control. 0x21 starts timer 1 (we
	   pretend it immediately overflows -> 0xc0); 0x60/0x80 reset -> 0x00.
	   This is what SDL_DetectAdLib() expects back from readstat(). */
	if (reg == 0x04) {
		if (val == 0x21)                     detect_status = 0xc0;
		else if (val == 0x80 || val == 0x60) detect_status = 0x00;
	}

	OPL3_WriteReg (&chip, (uint16_t) reg, (uint8_t) val);
}

void OPL2_Render (float *buf, int n)
{
	int i;
	for (i = 0; i < n; i++) {
		int16_t s[2];
		double acc;

		OPL3_GenerateResampled (&chip, s);		/* int16 L,R at opl_sr */
		acc = ((double) s[0] + (double) s[1]) * 0.5 * FM_GAIN;

		if (spk_freq > 0.0) {
			acc += (spk_phase < 0.5 ? 0.2 : -0.2);
			spk_phase += spk_freq / opl_sr;
			spk_phase -= floor (spk_phase);
		}

		buf[i] += (float) acc;
	}
}

double OPL2_SampleRate (void)
{
	return opl_sr;
}

void Speaker_SetFreq (double hz)
{
	spk_freq = hz > 0.0 ? hz : 0.0;
	if (spk_freq == 0.0)
		spk_phase = 0.0;
}
