#!/usr/bin/env node
/* ===========================================================================
   Keen 4-6 data extraction.

   The headers/dicts the engine needs (EGADICT/EGAHEAD/MAPHEAD/AUDIOHED/
   AUDIODICT) are embedded in the LZEXE-compressed game EXE. This tool:

     1. UNLZEXE-decompresses the EXE (faithful JS port of canonical unlzexe.c,
        verified byte-identical to the C tool).
     2. Locates each structure by CONTENT (not by .pat absolute offsets — the
        provided binaries are different builds than the .pat targets, so the
        absolute offsets and even inter-structure spacing differ). We use the
        .pat only for structure SIZES, which are game constants (NUMCHUNKS etc.)
        identical across builds. Anchors:
          - EGAHEAD : run of 3-byte offsets into EGAGRAPH, ending at its size.
          - MAPHEAD : RLEW tag 0xABCD + 100 monotonic offsets into GAMEMAPS.
          - EGADICT : 1024-byte Huffman table that correctly decompresses
                      EGAGRAPH chunks (consuming each chunk's bytes exactly).
          - AUDIO*  : best-effort (see notes); audio is only needed later.
     3. Writes ripped headers + copies EGAGRAPH/GAMEMAPS/AUDIO into
        web/public/data/<id>/.

   Usage: node tools/extract.mjs [ck4|ck5|ck6]
   =========================================================================== */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOS = join(ROOT, "dos");
const STATIC = join(ROOT, "KEEN4-6", "static");
const OUT_BASE = process.env.CK_OUT_BASE
  ? join(ROOT, process.env.CK_OUT_BASE)
  : join(ROOT, "web", "public", "data");

const EPISODES = [
  { id: "ck4", ext: "ck4", dir: process.env.CK4_DIR || "ck4", pat: "ripck4.pat" },
  { id: "ck5", ext: "ck5", dir: "ck5", pat: "ripck5.pat" },
  { id: "ck6", ext: "ck6", dir: "ck6", pat: "ripck6.pat" },
];

const MAIN_BLOBS = ["EGAGRAPH", "GAMEMAPS", "AUDIO"];

/* ---------------------------------------------------------------- UNLZEXE -- */

function unlzexe(input) {
  const ihead = [];
  for (let i = 0; i < 0x10; i++) ihead[i] = input.readUInt16LE(i * 2);
  if (
    (ihead[0] !== 0x5a4d && ihead[0] !== 0x4d5a) ||
    ihead[0x0d] !== 0 ||
    ihead[0x0c] !== 0x1c
  ) {
    throw new Error("not an LZEXE-compressed EXE");
  }
  const marker = input.toString("latin1", 0x1c, 0x20);
  let ver;
  if (marker === "LZ91") ver = 91;
  else if (marker === "LZ90") ver = 90;
  else throw new Error(`unrecognized LZEXE marker: ${marker}`);

  const ohead = ihead.slice();
  const infPos = (ihead[0x0b] + ihead[4]) << 4;
  const inf = [];
  for (let i = 0; i < 8; i++) inf[i] = input.readUInt16LE(infPos + i * 2);
  ohead[0x0a] = inf[0];
  ohead[0x0b] = inf[1];
  ohead[0x08] = inf[2];
  ohead[0x07] = inf[3];
  ohead[0x0c] = 0x1c;

  const reloc = ver === 91 ? reloc91(input, infPos) : reloc90(input, infPos);
  ohead[3] = reloc.count;
  const fpos = 0x1c + reloc.count * 4;
  const pad = (0x200 - fpos) & 0x1ff;
  ohead[4] = (fpos + pad) >> 4;
  const headerSize = ohead[4] << 4;

  const load = unpack(input, ihead, inf);
  const loadsize = load.length;
  if (ihead[6] !== 0) {
    ohead[5] = (ohead[5] - (inf[5] + ((inf[6] + 16 - 1) >> 4) + 9)) & 0xffff;
    if (ihead[6] !== 0xffff) ohead[6] = (ohead[6] - ((ihead[5] - ohead[5]) & 0xffff)) & 0xffff;
  }
  ohead[1] = (loadsize + headerSize) & 0x1ff;
  ohead[2] = ((loadsize + headerSize + 0x1ff) >>> 9) & 0xffff;

  const out = Buffer.alloc(headerSize + loadsize);
  for (let i = 0; i < 0x0e; i++) out.writeUInt16LE(ohead[i] & 0xffff, i * 2);
  reloc.buf.copy(out, 0x1c);
  load.copy(out, headerSize);
  return { out, ver };
}

function reloc91(input, infPos) {
  let pos = infPos + 0x158;
  let relOff = 0;
  let relSeg = 0;
  const entries = [];
  for (;;) {
    let span = input[pos++];
    if (span === 0) {
      const w = input.readUInt16LE(pos);
      pos += 2;
      if (w === 0) { relSeg = (relSeg + 0x0fff) & 0xffff; continue; }
      else if (w === 1) break;
      else span = w;
    }
    relOff = (relOff + span) & 0xffff;
    relSeg = (relSeg + ((relOff & ~0x0f) >> 4)) & 0xffff;
    relOff &= 0x0f;
    entries.push(relOff, relSeg);
  }
  const buf = Buffer.alloc(entries.length * 2);
  for (let i = 0; i < entries.length; i++) buf.writeUInt16LE(entries[i] & 0xffff, i * 2);
  return { buf, count: entries.length / 2 };
}

function reloc90(input, infPos) {
  let pos = infPos + 0x19d;
  let relSeg = 0;
  const entries = [];
  do {
    const c = input.readUInt16LE(pos);
    pos += 2;
    for (let i = 0; i < c; i++) {
      entries.push(input.readUInt16LE(pos), relSeg);
      pos += 2;
    }
    relSeg = (relSeg + 0x1000) & 0xffff;
  } while (relSeg !== 0x0000);
  const buf = Buffer.alloc(entries.length * 2);
  for (let i = 0; i < entries.length; i++) buf.writeUInt16LE(entries[i] & 0xffff, i * 2);
  return { buf, count: entries.length / 2 };
}

function unpack(input, ihead, inf) {
  let sp = (ihead[0x0b] - inf[4] + ihead[4]) << 4;
  let bitbuf = input.readUInt16LE(sp);
  sp += 2;
  let bitcnt = 0x10;
  const getbit = () => {
    const b = bitbuf & 1;
    if (--bitcnt === 0) { bitbuf = input.readUInt16LE(sp); sp += 2; bitcnt = 0x10; }
    else bitbuf >>= 1;
    return b;
  };
  let cap = 1 << 20;
  let out = new Uint8Array(cap);
  let n = 0;
  const ensure = (extra) => {
    if (n + extra <= cap) return;
    while (n + extra > cap) cap <<= 1;
    const bigger = new Uint8Array(cap);
    bigger.set(out.subarray(0, n));
    out = bigger;
  };
  for (;;) {
    ensure(0x2000);
    if (getbit()) { out[n++] = input[sp++]; continue; }
    let len, span;
    if (!getbit()) {
      len = (getbit() << 1) | getbit();
      len += 2;
      span = input[sp++] | 0xff00;
    } else {
      const b1 = input[sp++];
      const b2 = input[sp++];
      span = b1 | (((b2 & ~0x07) << 5) | 0xe000);
      len = (b2 & 0x07) + 2;
      if (len === 2) {
        const b3 = input[sp++];
        if (b3 === 0) break;
        if (b3 === 1) continue;
        len = b3 + 1;
      }
    }
    const s16 = (span << 16) >> 16;
    ensure(len);
    for (let i = 0; i < len; i++) { out[n] = out[n + s16]; n++; }
  }
  return Buffer.from(out.subarray(0, n));
}

/* ---------------------------------------------------- content locators ---- */

// EGAHEAD: 3-byte LE offsets into EGAGRAPH, monotonic (ignoring 0xFFFFFF),
// ending exactly at the EGAGRAPH size.
function findEgahead(out, egagraphSize, minEntries = 256) {
  for (let s = 0; s + 3 <= out.length; s++) {
    let last = -1, count = 0, ended = false;
    for (let p = s; p + 3 <= out.length; p += 3) {
      const v = out[p] | (out[p + 1] << 8) | (out[p + 2] << 16);
      if (v === 0xffffff) { count++; continue; }
      if (v < last || v > egagraphSize) break;
      last = v; count++;
      if (v === egagraphSize) { ended = count >= minEntries; break; }
    }
    if (ended) {
      // The monotonic run can absorb trailing zero-words from the preceding
      // structure (audiohead padding) as leading 0 entries, which would make
      // chunk 0 (STRUCTPIC) look empty. Advance to the last 0 before the first
      // positive offset so entry0=0 (structpic at EGAGRAPH start) and entry1>0.
      const r3 = (i) => out[s + i * 3] | (out[s + i * 3 + 1] << 8) | (out[s + i * 3 + 2] << 16);
      let k = 0;
      while (k < 8 && r3(k) === 0 && r3(k + 1) === 0) k++;
      return s + k * 3;
    }
  }
  return -1;
}

// MAPHEAD: uint16 RLEW tag 0xABCD, then 100 int32 offsets into GAMEMAPS that
// are monotonic among the defined (non-zero) ones.
function findMaphead(out, gamemapsSize) {
  for (let s = 0; s + 402 <= out.length; s++) {
    if (out.readUInt16LE(s) !== 0xabcd) continue;
    let last = -1, def = 0, ok = true;
    for (let i = 0; i < 100; i++) {
      const v = out.readInt32LE(s + 2 + i * 4);
      if (v === 0) continue;
      if (v < 0 || v < last || v > gamemapsSize) { ok = false; break; }
      last = v; def++;
    }
    if (ok && def >= 10) return s;
  }
  return -1;
}

// id Huffman expand. Returns {ok, exact} — ok=correct length produced, exact=
// the compressed bytes were consumed exactly (the signature of the right dict).
function huffExpand(out, dictOff, src, srcLen, expandedLen) {
  let di = 0, si = 0, cur = 254, mask = 1, byte = src[0];
  while (di < expandedLen) {
    if (si >= srcLen) return { ok: false };
    const val = out.readUInt16LE(dictOff + cur * 4 + (byte & mask ? 2 : 0));
    if (mask === 0x80) { mask = 1; si++; byte = src[si]; } else mask <<= 1;
    if (val < 256) { di++; cur = 254; }
    else { const v = val - 256; if (v > 254) return { ok: false }; cur = v; }
  }
  return { ok: true, exact: si >= srcLen - 1 && si <= srcLen };
}

// EGADICT: the 1024-byte Huffman table that decompresses EGAGRAPH chunks with
// exact byte consumption. We scan windows whose u16 values are all valid
// (<=510) and pick the one decompressing the most chunks exactly.
function findEgadict(out, egagraph, eheadStart) {
  const read3 = (i) =>
    out[eheadStart + i * 3] | (out[eheadStart + i * 3 + 1] << 8) | (out[eheadStart + i * 3 + 2] << 16);
  const chunks = [];
  for (let c = 0; c < 300 && chunks.length < 14; c++) {
    const o0 = read3(c), o1 = read3(c + 1);
    if (o0 === 0xffffff || o1 === 0xffffff || o1 <= o0 + 4) continue;
    const explen = egagraph.readUInt32LE(o0);
    if (explen < 4 || explen > 0x6000) continue;
    chunks.push({ o0, o1, explen });
  }
  let best = { exact: -1, s: -1 };
  for (let s = 0; s + 1024 <= out.length; s++) {
    let valid = true;
    for (let p = s; p < s + 1024; p += 2) if (out.readUInt16LE(p) > 510) { valid = false; break; }
    if (!valid) continue;
    let exact = 0, failedEarly = false;
    for (let k = 0; k < chunks.length; k++) {
      const ch = chunks[k];
      const r = huffExpand(out, s, egagraph.subarray(ch.o0 + 4, ch.o1), ch.o1 - ch.o0 - 4, ch.explen);
      if (!r.ok) { if (k < 2) { failedEarly = true; break; } }
      else if (r.exact) exact++;
    }
    if (!failedEarly && exact > best.exact) best = { exact, s };
  }
  return best.exact >= 4 ? best.s : -1;
}

/* -------------------------------------------------------------- .pat parse - */

function parsePat(text) {
  const versions = [];
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const mv = line.match(/^%version\s+(.+)$/i);
    if (mv) { cur = { name: mv[1].trim(), dumps: {} }; versions.push(cur); continue; }
    const md = line.match(/^%dump\s+(\S+)\s+\$([0-9A-Fa-f]+)\s+(\d+)/);
    if (md && cur) cur.dumps[md[1].split(".")[0].toLowerCase()] = { offset: parseInt(md[2], 16), size: parseInt(md[3], 10) };
  }
  return versions;
}

/* ---------------------------------------------------------------- helpers -- */

function findFile(dir, base, ext) {
  const want = `${base}.${ext}`.toLowerCase();
  for (const f of readdirSync(dir)) if (f.toLowerCase() === want) return join(dir, f);
  return null;
}

/* ------------------------------------------------------------------- main -- */

function processEpisode(ep) {
  const dosDir = join(DOS, ep.dir);
  if (!existsSync(dosDir)) {
    // No data provided for this episode — that's fine (the user may only own
    // some of CK4/5/6). Skip cleanly instead of throwing ENOENT, and don't
    // fail the run.
    console.log(`[${ep.id}] no data in dos/${ep.dir} — skipping this episode`);
    return true;
  }
  const exePath =
    findFile(dosDir, `KEEN${ep.ext.slice(2)}E`, "EXE") ||
    findFile(dosDir, `KEEN${ep.ext.slice(2)}`, "EXE") ||
    findFile(dosDir, `Keen${ep.ext.slice(2)}`, "exe");
  const egagraphPath = findFile(dosDir, "EGAGRAPH", ep.ext);
  const gamemapsPath = findFile(dosDir, "GAMEMAPS", ep.ext);
  const audioPath = findFile(dosDir, "AUDIO", ep.ext);
  if (!exePath || !egagraphPath || !gamemapsPath) {
    console.error(`[${ep.id}] missing EXE/EGAGRAPH/GAMEMAPS in ${dosDir}`);
    return false;
  }
  const egagraph = readFileSync(egagraphPath);
  const gamemapsSize = readFileSync(gamemapsPath).length;

  console.log(`[${ep.id}] decompressing ${exePath.split("/").pop()} ...`);
  const { out, ver } = unlzexe(readFileSync(exePath));
  console.log(`[${ep.id}]   LZEXE v0.${ver}, decompressed = ${out.length} bytes`);

  // Sizes are game constants — take them from the .pat's EGA version block.
  const versions = parsePat(readFileSync(join(STATIC, ep.pat), "utf8"));
  const ega = versions.find((v) => v.dumps.egadict && v.dumps.egahead);
  if (!ega) { console.error(`[${ep.id}] .pat has no EGA version`); return false; }
  const size = (k) => ega.dumps[k]?.size;

  const eheadStart = findEgahead(out, egagraph.length);
  const mhStart = findMaphead(out, gamemapsSize);
  if (eheadStart < 0 || mhStart < 0) {
    console.error(`[${ep.id}] could not locate EGAHEAD(${eheadStart}) / MAPHEAD(${mhStart})`);
    return false;
  }
  const edStart = findEgadict(out, egagraph, eheadStart);
  if (edStart < 0) { console.error(`[${ep.id}] could not locate EGADICT`); return false; }
  console.log(`[${ep.id}]   EGAHEAD@${eheadStart} MAPHEAD@${mhStart} EGADICT@${edStart}`);

  const outDir = join(OUT_BASE, ep.id);
  mkdirSync(outDir, { recursive: true });
  const rip = (name, off, len) => writeFileSync(join(outDir, `${name}.${ep.ext}`), Buffer.from(out.subarray(off, off + len)));
  rip("EGAHEAD", eheadStart, size("egahead"));
  rip("EGADICT", edStart, size("egadict"));
  rip("MAPHEAD", mhStart, size("maphead"));

  // Audio: locate the embedded AUDIOHEAD (offset table) + AUDIODICT (Huffman
  // dict) in the EXE and verify they decode every chunk (incl. the IMF music).
  const audio = audioPath ? readFileSync(audioPath) : null;
  if (audio) {
    const a = locateAudio(out, audio, edStart);
    if (a) {
      rip("AUDIODICT", a.dictStart, 1024);
      const ah = Buffer.alloc(a.offsets.length * 4);
      a.offsets.forEach((o, i) => ah.writeUInt32LE(o, i * 4));
      writeFileSync(join(outDir, `AUDIOHEAD.${ep.ext}`), ah);
      console.log(`[${ep.id}]   AUDIOHEAD@${a.headStart} (${a.offsets.length} entries) AUDIODICT@${a.dictStart}` +
        `  — ${a.stats.okc} chunks OK, ${a.stats.music} music, 0 fail`);
    } else {
      console.warn(`[${ep.id}]   WARN: could not locate AUDIOHEAD/AUDIODICT in this EXE; audio data unavailable`);
    }
  }

  for (const base of MAIN_BLOBS) {
    const src = findFile(dosDir, base, ep.ext);
    if (src) writeFileSync(join(outDir, `${base}.${ep.ext}`), readFileSync(src));
    else console.warn(`[${ep.id}]   WARN: ${base}.${ep.ext} missing`);
  }
  console.log(`[${ep.id}] ✓ wrote data to web/public/data/${ep.id}/`);
  return true;
}

// Huffman-decode `expandedLen` bytes from AUDIO at byte `srcStart`; return the
// number of compressed bytes consumed (-1 on error). AUDIO chunks are
// [4-byte expanded length][huffman data].
function huffConsume(out, dictOff, audio, srcStart, expandedLen) {
  let di = 0, si = srcStart, cur = 254, mask = 1, byte = audio[si];
  while (di < expandedLen) {
    if (si >= audio.length) return -1;
    const val = out.readUInt16LE(dictOff + cur * 4 + (byte & mask ? 2 : 0));
    if (mask === 0x80) { mask = 1; si++; byte = audio[si]; } else mask <<= 1;
    if (val < 256) { di++; cur = 254; }
    else { const v = val - 256; if (v > 254) return -1; cur = v; }
  }
  return si - srcStart + (mask === 1 ? 0 : 1);
}

// Candidate AUDIOHEAD tables in the decompressed EXE: a uint32 offset array with
// head[0]==0 and some head[k]==audioSize (the file size). The chunk order is
// PC / AdLib / Sampled(usually empty) / Music, so the table is NOT strictly
// monotonic (sparse/empty chunks have head[c+1] <= head[c]) — which is exactly
// why the old "sequentially decode from byte 0" locator could never work.
function findAudioheads(out, audioSize) {
  const cands = [];
  for (let p = 0; p + 8 <= out.length; p += 2) {
    if (out.readUInt32LE(p) !== 0) continue;
    const e1 = out.readUInt32LE(p + 4);
    if (e1 === 0 || e1 > 4096) continue; // chunk 0 (a tiny PC-speaker sound) is small
    let q = p + 4, k = 1;
    while (q + 4 <= out.length && k < 4096) {
      const v = out.readUInt32LE(q);
      if (v > audioSize) break;
      k++;
      if (v === audioSize) { cands.push({ off: p, entries: k }); break; }
      q += 4;
    }
  }
  return cands;
}

// Decode `explen` bytes from audio[start..] with the 1024-byte dict at out[dictOff];
// returns { used: source bytes touched, nz: non-zero output bytes } or null on overrun.
function audioHuff(out, dictOff, audio, start, explen) {
  let di = 0, si = start, cur = 254, mask = 1, nz = 0;
  if (si >= audio.length) return null;
  let b = audio[si];
  while (di < explen) {
    const v = out.readUInt16LE(dictOff + cur * 4 + ((b & mask) ? 2 : 0));
    if (mask === 0x80) { mask = 1; si++; if (si > audio.length) return null; b = audio[si]; }
    else mask <<= 1;
    if (v < 256) { if (v) nz++; di++; cur = 254; } else { const n = v - 256; if (n > 254) return null; cur = n; }
  }
  return { used: si - start, nz };
}

// Validate a (dict, head) pair by decoding every chunk. The CORRECT dict (a) never
// overruns a chunk's AUDIOHEAD byte range, (b) ends each chunk EXACTLY at its
// boundary (±1 for bit-padding), and (c) produces real (non-zero) output — a wrong
// dict can avoid overruns by emitting all-zeros, so the exact+nonzero tests matter.
function validateAudio(out, dictOff, audio, head) {
  let okc = 0, exact = 0, nz = 0, music = 0;
  for (let c = 0; c < head.length - 1; c++) {
    const start = head[c], end = head[c + 1];
    if (end <= start) continue; // sparse/empty slot
    if (start + 4 > audio.length) return null;
    const explen = audio.readUInt32LE(start);
    if (explen === 0 || explen > 0x40000) return null;
    const r = audioHuff(out, dictOff, audio, start + 4, explen);
    if (!r) return null;
    const endPos = start + 4 + r.used;
    if (endPos > end + 1) return null; // overran into the next chunk
    if (endPos >= end - 1) exact++;
    nz += r.nz; okc++; if (explen > 600) music++;
  }
  return { okc, exact, nz, music };
}

// Scan dict windows in [lo, hi) for one already-read AUDIOHEAD offset table.
function scanDict(out, audio, offsets, headOff, lo, hi) {
  let best = null;
  const c0s = offsets[0], c0e = offsets[1], c0len = audio.readUInt32LE(c0s);
  for (let s = Math.max(0, lo); s + 1024 <= Math.min(out.length, hi); s++) {
    // dict prefilter: valid Huffman nodes (<=510) and not a zero-filled region.
    let ok = true, nzNodes = 0;
    for (let p = s; p < s + 1024; p += 2) {
      const w = out.readUInt16LE(p);
      if (w > 510) { ok = false; break; }
      if (w) nzNodes++;
    }
    if (!ok || nzNodes < 64) continue;
    // fast reject on chunk 0: must decode non-zero and land on its boundary.
    const r0 = audioHuff(out, s, audio, c0s + 4, c0len);
    if (!r0 || r0.nz === 0) continue;
    const e0 = c0s + 4 + r0.used;
    if (e0 < c0e - 1 || e0 > c0e + 1) continue;
    const r = validateAudio(out, s, audio, offsets);
    if (r && r.nz > 1000 && r.exact >= r.okc - 4 && r.music >= 1) {
      if (!best || r.exact > best.stats.exact) best = { dictStart: s, offsets, headStart: headOff, stats: r };
      if (r.exact >= r.okc - 2) return best; // near-perfect = the real dict
    }
  }
  return best;
}

// Locate AUDIOHEAD (offset table) + AUDIODICT (1024-byte Huffman dict) in the EXE.
// `dictHint` (e.g. the EGADICT offset — AUDIODICT sits ~1KB before it) is searched
// first for speed; falls back to a full scan. Returns { dictStart, offsets,
// headStart, stats } or null.
function locateAudio(out, audio, dictHint = -1) {
  const heads = findAudioheads(out, audio.length);
  for (const h of heads) {
    const offsets = [];
    for (let i = 0; i < h.entries; i++) offsets.push(out.readUInt32LE(h.off + i * 4));
    let best = null;
    if (dictHint >= 0) best = scanDict(out, audio, offsets, h.off, dictHint - 8192, dictHint + 2048);
    if (!best) best = scanDict(out, audio, offsets, h.off, 0, out.length);
    if (best) return best;
  }
  return null;
}

function main() {
  const only = process.argv[2];
  const list = only ? EPISODES.filter((e) => e.id === only) : EPISODES;
  if (!list.length) { console.error(`unknown episode '${only}'`); process.exit(1); }
  let ok = true;
  for (const ep of list) {
    try { ok = processEpisode(ep) && ok; }
    catch (err) { console.error(`[${ep.id}] ERROR:`, err.message); ok = false; }
  }
  process.exit(ok ? 0 : 1);
}

// Reusable pieces for standalone diagnostics (e.g. tools/check_audio.mjs).
export { unlzexe, locateAudio, huffConsume };

// Only run the full extraction when invoked directly, not when imported.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
