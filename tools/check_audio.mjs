#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   check_audio.mjs — can the game's audio be decoded from an EXE + AUDIO pair?

   Locates the embedded AUDIOHEAD (offset table) + AUDIODICT (Huffman dict) in
   the EXE and verifies they decode every chunk of AUDIO (incl. the IMF music).
   Reuses the exact logic from extract.mjs, so PASS here = usable by the port.

   Usage:
     node tools/check_audio.mjs <AUDIO.CKx> <KEENxE.EXE>

   Example:
     node tools/check_audio.mjs keen_complete_pack/base4/Audio.ck4 \
                                keen_complete_pack/base4/Keen4e.exe
   --------------------------------------------------------------------------- */
import { readFileSync } from "node:fs";
import { unlzexe, locateAudio } from "./extract.mjs";

const argv = process.argv.slice(2);
if (argv.length < 2) {
  console.error("usage: node tools/check_audio.mjs <AUDIO.CKx> <EXE>");
  process.exit(2);
}

const audio = readFileSync(argv[0]);
console.log(`AUDIO : ${argv[0]}  (${audio.length} bytes)`);

const exeRaw = readFileSync(argv[1]);
console.log(`EXE   : ${argv[1]}  (${exeRaw.length} bytes)`);

let exe = exeRaw;
try {
  const { out, ver } = unlzexe(exeRaw);
  exe = out;
  console.log(`        LZEXE v0.${ver} → decompressed to ${out.length} bytes`);
} catch (e) {
  console.log(`        not LZEXE-compressed (${e.message}); scanning the raw EXE`);
}

const a = locateAudio(exe, audio);
if (!a) {
  console.log(`\n❌ FAIL — could not locate a matching AUDIOHEAD/AUDIODICT in this EXE.`);
  console.log(`   The EXE and AUDIO are likely different versions. Re-rip BOTH from the same install.`);
  process.exit(1);
}

const chunks = a.offsets.length - 1;
console.log(`\nAUDIOHEAD @${a.headStart}  (${a.offsets.length} offsets, last = ${a.offsets[a.offsets.length - 1]} = file size)`);
console.log(`AUDIODICT @${a.dictStart}  (1024 bytes)`);
console.log(`decoded ${a.stats.okc}/${chunks} chunks (rest are empty slots), ${a.stats.music} music tracks, ${a.stats.fail} failures`);
console.log(`\n✅ PASS — this EXE's AUDIOHEAD/AUDIODICT decode ${argv[0]}. Music/SFX are extractable.`);
console.log(`   Run:  cd web && npm run extract   (writes AUDIO/AUDIOHEAD/AUDIODICT to public/data/<id>/)`);
process.exit(0);
