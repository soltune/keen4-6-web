#!/usr/bin/env node
/* ===========================================================================
   Decode a PIC chunk from extracted Keen data and write it as a PNG.

   Validates the whole graphics pipeline end-to-end using the engine's real
   algorithms (id Huffman expand + EGA planar layout): EGADICT + EGAHEAD +
   EGAGRAPH -> STRUCTPIC pic table -> decode pic -> RGB PNG.

   Usage: node tools/render_chunk.mjs <ck4|ck5|ck6> <chunkNumber> [out.png]
   Example (CK4 title screen, chunk 109): node tools/render_chunk.mjs ck4 109
   =========================================================================== */

import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// STRUCTPIC=0; pics start at chunk STARTPICS. For CK4-6 STARTPICS=6
// (STRUCTPIC,STRUCTPICM,STRUCTSPRITE,3x font). pictabletype = {u16 width,height}.
const STRUCTPIC = 0;
const STARTPICS = 6;

const EGA_PALETTE = [
  [0,0,0],[0,0,170],[0,170,0],[0,170,170],[170,0,0],[170,0,170],[170,85,0],[170,170,170],
  [85,85,85],[85,85,255],[85,255,85],[85,255,255],[255,85,85],[255,85,255],[255,255,85],[255,255,255],
];

function load(ep) {
  const base = join(ROOT, "web", "public", "data", ep);
  return {
    dict: readFileSync(join(base, `EGADICT.${ep}`)),
    head: readFileSync(join(base, `EGAHEAD.${ep}`)),
    graph: readFileSync(join(base, `EGAGRAPH.${ep}`)),
  };
}

// 3-byte LE offset table; 0xFFFFFF = sparse/missing.
const grpos = (head, c) => {
  const v = head[c * 3] | (head[c * 3 + 1] << 8) | (head[c * 3 + 2] << 16);
  return v === 0xffffff ? -1 : v;
};

function huffExpand(dict, src, expandedLen) {
  const dst = Buffer.alloc(expandedLen);
  let di = 0, si = 0, cur = 254, mask = 1, byte = src[0];
  while (di < expandedLen) {
    const val = dict.readUInt16LE(cur * 4 + (byte & mask ? 2 : 0));
    if (mask === 0x80) { mask = 1; si++; byte = src[si]; } else mask <<= 1;
    if (val < 256) dst[di++] = val, (cur = 254);
    else cur = val - 256;
  }
  return dst;
}

// Decompress a non-tile chunk (4-byte expanded-length prefix).
function getChunk(d, c) {
  let pos = grpos(d.head, c);
  if (pos < 0) throw new Error(`chunk ${c} is sparse`);
  let next = c + 1;
  while (grpos(d.head, next) < 0) next++;
  const complen = grpos(d.head, next) - pos;
  const expanded = d.graph.readUInt32LE(pos);
  return huffExpand(d.dict, d.graph.subarray(pos + 4, pos + complen), expanded);
}

function decodePic(d, chunk) {
  const table = getChunk(d, STRUCTPIC); // pictable: u16 width,height per pic
  const idx = chunk - STARTPICS;
  const widthBytes = table.readUInt16LE(idx * 4);
  const height = table.readUInt16LE(idx * 4 + 2);
  const w = widthBytes * 8;
  const plane = widthBytes * height;
  const data = getChunk(d, chunk);
  const rgb = Buffer.alloc(w * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < w; x++) {
      const bi = y * widthBytes + (x >> 3);
      const bit = 7 - (x & 7);
      let ci = 0;
      for (let p = 0; p < 4; p++) ci |= ((data[p * plane + bi] >> bit) & 1) << p;
      const [r, g, b] = EGA_PALETTE[ci];
      const o = (y * w + x) * 3;
      rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
    }
  }
  return { w, h: height, rgb, expanded: data.length };
}

function writePng(path, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const idat = deflateSync(raw);
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, RGB
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0)),
  ]);
  writeFileSync(path, png);
}

const ep = process.argv[2] || "ck4";
const chunk = parseInt(process.argv[3] ?? "109", 10);
const outPath = process.argv[4] || `/tmp/${ep}_chunk${chunk}.png`;
const d = load(ep);
const { w, h, rgb, expanded } = decodePic(d, chunk);
writePng(outPath, w, h, rgb);
console.log(`${ep} chunk ${chunk}: ${w}x${h} (expanded ${expanded}B) -> ${outPath}`);
