#!/usr/bin/env node
/* Decode a masked sprite from extracted data and write a PNG (transparent =
   magenta) to nail the plane order / mask polarity. Usage:
     node tools/render_sprite.mjs ck4 130 [maskPlane] [maskTransparentBit] */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STRUCTSPRITE = 2;
const STARTSPRITES = { ck4: 124, ck5: 102, ck6: 46 }; // 6+NUMPICS+NUMPICM

const EGA = [[0,0,0],[0,0,170],[0,170,0],[0,170,170],[170,0,0],[170,0,170],[170,85,0],[170,170,170],
  [85,85,85],[85,85,255],[85,255,85],[85,255,255],[255,85,85],[255,85,255],[255,255,85],[255,255,255]];

const ep = process.argv[2] || "ck4";
const chunk = parseInt(process.argv[3] ?? "130", 10);
const maskPlane = parseInt(process.argv[4] ?? "4", 10);
const maskTransBit = parseInt(process.argv[5] ?? "1", 10);

const base = join(ROOT, "web/public/data", ep);
const head = readFileSync(join(base, `EGAHEAD.${ep}`));
const dict = readFileSync(join(base, `EGADICT.${ep}`));
const graph = readFileSync(join(base, `EGAGRAPH.${ep}`));
const grpos = (c) => { const v = head[c*3]|(head[c*3+1]<<8)|(head[c*3+2]<<16); return v===0xffffff?-1:v; };
function huff(src, exp){ const d=Buffer.alloc(exp); let di=0,si=0,cur=254,m=1,b=src[0];
  while(di<exp){ const v=dict.readUInt16LE(cur*4+((b&m)?2:0)); if(m===0x80){m=1;si++;b=src[si];}else m<<=1;
    if(v<256){d[di++]=v;cur=254;}else cur=v-256; } return d; }
function chunkData(c){ let pos=grpos(c),n=c+1; while(grpos(n)<0)n++; const cl=grpos(n)-pos;
  return huff(graph.subarray(pos+4,pos+cl), graph.readUInt32LE(pos)); }

const table = chunkData(STRUCTSPRITE);
const idx = chunk - STARTSPRITES[ep];
const widthBytes = table.readInt16LE(idx*18);
const shifts = table.readInt16LE(idx*18+16);
const data = chunkData(chunk); // 5 planes; length = widthBytes*height*5
const height = Math.floor(data.length / 5 / widthBytes); // table height is unreliable
const w = widthBytes*8, plane = widthBytes*height;
console.log(`${ep} sprite ${chunk}: widthBytes=${widthBytes} (${w}px) height=${height} shifts=${shifts} expanded=${data.length} (need ${plane*5})`);

const rgb = Buffer.alloc(w*height*3);
for(let y=0;y<height;y++)for(let x=0;x<w;x++){
  const bi=y*widthBytes+(x>>3), bit=7-(x&7);
  const mask=(data[maskPlane*plane+bi]>>bit)&1;
  const o=(y*w+x)*3;
  if(mask===maskTransBit){ rgb[o]=255; rgb[o+1]=0; rgb[o+2]=255; } // transparent -> magenta
  else { let ci=0,pi=0; for(let p=0;p<5;p++){ if(p===maskPlane)continue; ci|=((data[p*plane+bi]>>bit)&1)<<pi; pi++; }
    const c=EGA[ci]; rgb[o]=c[0];rgb[o+1]=c[1];rgb[o+2]=c[2]; }
}
// minimal PNG
function png(w,h,rgb){ const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){raw[y*(w*3+1)]=0; rgb.copy(raw,y*(w*3+1)+1,y*w*3,(y+1)*w*3);}
  const idat=deflateSync(raw);
  const ct=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
  const crc=(b)=>{let c=0xffffffff;for(const x of b)c=ct[(c^x)&0xff]^(c>>>8);return(c^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch("IHDR",ih),ch("IDAT",idat),ch("IEND",Buffer.alloc(0))]); }
const out=`/tmp/${ep}_spr${chunk}_m${maskPlane}b${maskTransBit}.png`;
writeFileSync(out, png(w,height,rgb));
console.log("->",out);
