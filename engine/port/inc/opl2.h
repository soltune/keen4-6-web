/* ===========================================================================
   opl2.h — embedded OPL2 (Yamaha YM3812 / AdLib) FM synthesiser for the web
   port. The ported ID_SD.C drives sound by writing OPL registers (alOut ->
   OPL2_Write); this synth turns those register writes into PCM, so the whole
   engine — including audio synthesis — lives in wasm. Ported from the proven
   web/public/audio/keen-worklet.js core.
   =========================================================================== */
#ifndef CK_OPL2_H
#define CK_OPL2_H

/* Initialise the synth for a given output sample rate (Hz). */
void OPL2_Init (double sampleRate);

/* Write an OPL register (reg 0x00-0xff, val 0x00-0xff). */
void OPL2_Write (unsigned char reg, unsigned char val);

/* Emulated AdLib status port read, just enough for SDL_DetectAdLib(): returns
   0xc0 once the detection timer has been started, 0x00 otherwise. */
unsigned char OPL2_Status (void);

/* Silence every operator/channel immediately. */
void OPL2_AllOff (void);

/* Render n samples, ADDING the FM + PC-speaker mix into buf (float, mono). */
void OPL2_Render (float *buf, int n);

/* The output sample rate passed to OPL2_Init. */
double OPL2_SampleRate (void);

/* PC speaker emulation (square wave). hz == 0 turns it off. */
void Speaker_SetFreq (double hz);

#endif /* CK_OPL2_H */
