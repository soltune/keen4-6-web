# Keen 4-6 engine port — strategy

Goal: compile the reconstructed Keen 4-6 engine (`../KEEN4-6/`, 16-bit DOS/Borland C,
~45k LOC + 6 ASM) to WebAssembly via Emscripten, driven by the web shell in `../web/`.

## What's proven (foundation)

- **Toolchain**: native `cc` + `emcc` 6.0.0 (`source ~/emsdk/emsdk_env.sh`). `make test` (native) / `make wasm` (Emscripten).
- **Data layer** (`src/ck_data.c`): portable port of the engine's CA decompression
  (id Huffman) + EGA planar decode. Byte-identical to the reference JS decoder and
  renders the real CK4 320x200 screen. Compiles native **and** to WASM.
- **Portability shim** (`src/ck_cross.h`): neutralises DOS `far/near/huge/_seg`,
  `MK_FP`, and the id/Borland integer typedefs for a flat 32-bit address space.

## Module dependency order (port bottom-up)

1. **Platform layer** (rewrite for web, don't port the DOS asm):
   - `ID_MM` memory manager → flat-heap allocator (drop EMS/XMS, segments).
   - `ID_CA` data files → fetch/Emscripten-FS backed; reuse `ck_data` decode.
   - `ID_VW`/`ID_VL` video → render to a **linear 320x200 indexed framebuffer**
     + 16-colour palette (replace EGA planar VRAM / page flipping / `ID_VW_A*.ASM`
     mask blits with portable C). JS blits the framebuffer (see `../web/src/display.ts`).
   - `ID_RF` refresh/tile engine → portable C over the linear framebuffer.
   - `ID_IN` input → query JS controller state (`../web/src/input.ts`).
   - `ID_SD` sound → OPL2 register writes streamed to the AudioWorklet
     (`../web/public/audio/keen-worklet.js`), where Nuked-OPL2 (Phase 4) synthesises.
   - `ID_US` user/menu → mostly portable C.
2. **Game core** (mostly portable C, minimal shimming): `CK_MAIN/GAME/PLAY/STATE/
   KEEN/KEEN2/DEMO/TEXT`.
3. **Episode code**: `KEEN4|5|6/K*_ACT*.C`, `K*_SPEC.C`, `*_DEF.H`, `GFXE/AUDIO` equ/h.

## Hard points / decisions

- **16-bit → flat**: replace `_seg`/`far`/segment arithmetic with flat pointers;
  reimplement `ID_MM` on a flat heap; the engine assumes `int`=16-bit in places — audit
  for overflow/wrap reliance (esp. fixed-point and tile math).
- **Main loop**: DOS blocking loop → `emscripten_set_main_loop` (preferred) with Asyncify
  only for unavoidable blocking input waits (menus). Keep the 70Hz tic timing.
- **Rendering**: target a single linear indexed framebuffer the JS `Display` already
  consumes (`VideoFrame{indices,palette}` in `../web/src/engine/types.ts`).
- **Data**: build with the `*_HEADERLINKED` macros UNDEFINED so `ID_CA` loads
  `EGADICT/EGAHEAD/MAPHEAD/AUDIOHED/AUDIODICT` from files (produced by `tools/extract.mjs`).

## Milestone ladder (vertical slice)

1. ✅ Data extraction + decode proven (renders real CK4 screen).
2. CA + VW/VL minimal → blit one decoded pic in the browser via WASM.
3. RF + maps → render a level's tile map.
4. CK_MAIN/DEMO → boot to title/demo loop.
5. Input + player physics → playable level.
6. ID_SD + OPL → sound (resolve AUDIO-file/EXE version mismatch first — see
   `keen-data-extraction-lzexe` memory).
7. CK5 + CK6.

## Known issues

- **AUDIO mismatch**: `tools/extract.mjs` cannot locate AUDIOHEAD/AUDIODICT — the
  provided `AUDIO.*` files don't end-match the EXE audioheads (ck4 audiohead ends at
  8743 vs AUDIO.CK4=33325). Likely a data/EXE version mismatch. Audio is deferred.
