/* Reference Carmack+RLEW map decoder — compares against the wasm port's output.
   Decodes GAMEMAPS plane 0 for the map matching given w,h and prints a region.
   Usage: node tools/mapcheck.mjs <dataDir> <ext> <wantW> <wantH>  */
import fs from "node:fs";
import path from "node:path";

const dataDir = process.argv[2] || "engine/build/data_v14/ck4";
const ext = process.argv[3] || "ck4";
const wantW = +(process.argv[4] || 112), wantH = +(process.argv[5] || 63);

const gm = fs.readFileSync(path.join(dataDir, `GAMEMAPS.${ext}`));
const mh = fs.readFileSync(path.join(dataDir, `MAPHEAD.${ext}`));
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const i32 = (b, o) => b.readInt32LE(o);
const rlewtag = u16(mh, 0);

function carmackExpand(src, off, expandedBytes) {
  const out = [], need = expandedBytes / 2; let i = off;
  while (out.length < need) {
    const ch = u16(src, i); i += 2; const hi = ch >> 8;
    if (hi === 0xa7) { // NEAR
      const count = ch & 0xff;
      if (!count) { out.push((ch & 0xff00) | src[i]); i += 1; }
      else { const offw = src[i]; i += 1; let cp = out.length - offw; for (let k = 0; k < count; k++) out.push(out[cp++]); }
    } else if (hi === 0xa8) { // FAR
      const count = ch & 0xff;
      if (!count) { out.push((ch & 0xff00) | src[i]); i += 1; }
      else { const offw = u16(src, i); i += 2; let cp = offw; for (let k = 0; k < count; k++) out.push(out[cp++]); }
    } else out.push(ch);
  }
  return out;
}
function rlewExpand(words, expandedBytes) {
  const out = [], need = expandedBytes / 2; let i = 0;
  while (out.length < need) {
    const v = words[i++];
    if (v !== rlewtag) out.push(v);
    else { const count = words[i++], val = words[i++]; for (let k = 0; k < count; k++) out.push(val); }
  }
  return out;
}

// MAPHEAD: u16 tag, then 100 int32 offsets
for (let mapnum = 0; mapnum < 100; mapnum++) {
  const hofs = i32(mh, 2 + mapnum * 4);
  if (hofs <= 0 || hofs + 38 > gm.length) continue;
  const planestart = [i32(gm, hofs), i32(gm, hofs + 4), i32(gm, hofs + 8)];
  const planelen = [u16(gm, hofs + 12), u16(gm, hofs + 14), u16(gm, hofs + 16)];
  const w = u16(gm, hofs + 18), h = u16(gm, hofs + 20);
  if (w !== wantW || h !== wantH) continue;

  const ps = planestart[0], pl = planelen[0];
  const carmExpLen = u16(gm, ps);
  const carm = carmackExpand(gm, ps + 2, carmExpLen);
  // dump carmack output bytes for diffing against the wasm port
  const carmBuf = Buffer.alloc(carm.length * 2);
  for (let k = 0; k < carm.length; k++) carmBuf.writeUInt16LE(carm[k] & 0xffff, k * 2);
  fs.writeFileSync("/tmp/carm_js.bin", carmBuf);
  const rlewExpLen = carm[0]; // first word of carmack output = rlew-expanded byte length
  const final = rlewExpand(carm.slice(1), rlewExpLen);
  console.log(`map ${mapnum}: w=${w} h=${h} planestart0=${ps} planelen0=${pl} carmExp=${carmExpLen} rlewExp=${rlewExpLen} finalWords=${final.length}`);
  console.log(`  REFERENCE bg plane (rows 7..13, cols 98..111):`);
  for (let r = 7; r <= 13; r++) {
    let s = `  r${String(r).padStart(2)}:`;
    for (let c = 98; c < 112 && c < w; c++) s += String(final[r * w + c]).padStart(6);
    console.log(s);
  }
  console.log(`  garbage spots: (104,11)=${final[11 * w + 104]} (103,12)=${final[12 * w + 103]} (104,12)=${final[12 * w + 104]}`);
}
