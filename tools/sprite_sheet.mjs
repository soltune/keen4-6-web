#!/usr/bin/env node
/* Contact sheet of sprite chunks using the (now correctly aligned) sprite
   table. STARTSPRITES defaults to the discovered value (ck4=116). Usage:
     node tools/sprite_sheet.mjs ck4 116 300 340  -> chunks 300..340 grid PNG */
import { readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const EGA = [[0,0,0],[0,0,170],[0,170,0],[0,170,170],[170,0,0],[170,0,170],[170,85,0],[170,170,170],
  [85,85,85],[85,85,255],[85,255,85],[85,255,255],[255,85,85],[255,85,255],[255,255,85],[255,255,255]];

const ep = process.argv[2] || "ck4";
const START = parseInt(process.argv[3] ?? "116", 10);
const from = parseInt(process.argv[4] ?? String(START), 10);
const to = parseInt(process.argv[5] ?? String(START + 60), 10);

const base = join(ROOT, "web/public/data", ep);
const head = readFileSync(join(base, `EGAHEAD.${ep}`));
const dict = readFileSync(join(base, `EGADICT.${ep}`));
const graph = readFileSync(join(base, `EGAGRAPH.${ep}`));
const grpos = (c) => { const v = head[c*3]|(head[c*3+1]<<8)|(head[c*3+2]<<16); return v===0xffffff?-1:v; };
function huff(src, exp){ const d=Buffer.alloc(exp); let di=0,si=0,cur=254,m=1,b=src[0];
  while(di<exp){ const v=dict.readUInt16LE(cur*4+((b&m)?2:0)); if(m===0x80){m=1;si++;b=src[si];}else m<<=1;
    if(v<256){d[di++]=v;cur=254;}else cur=v-256; } return d; }
function chunkData(c){ let pos=grpos(c); if(pos<0) return null; let n=c+1; while(grpos(n)<0)n++; const cl=grpos(n)-pos;
  return huff(graph.subarray(pos+4,pos+cl), graph.readUInt32LE(pos)); }

const table = chunkData(2);
function spriteRGBA(c){ // returns {w,h,rgb} with checker bg for transparency
  const i = c - START;
  const wb = table.readInt16LE(i*18), h = table.readInt16LE(i*18+2);
  if(wb<=0||h<=0||wb>8||h>64) return null;
  const data = chunkData(c);
  if(!data || data.length !== wb*h*5) return null;
  const w = wb*8, plane = wb*h;
  const rgb = Buffer.alloc(w*h*3);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const bi=y*wb+(x>>3), bit=7-(x&7);
    const mask=(data[bi]>>bit)&1; // plane 0 = mask
    const o=(y*w+x)*3;
    if(mask){ const ck=((x>>2)+(y>>2))&1; const v=ck?60:40; rgb[o]=v;rgb[o+1]=v;rgb[o+2]=v; }
    else { let ci=0; for(let p=1;p<5;p++) ci|=((data[p*plane+bi]>>bit)&1)<<(p-1);
      const cc=EGA[ci]; rgb[o]=cc[0];rgb[o+1]=cc[1];rgb[o+2]=cc[2]; }
  }
  return { w, h, rgb };
}

// Lay out in a grid; cell = 40x44 with the chunk number bar omitted (eyeball by order).
const cols = 10, cellW = 40, cellH = 44;
const list = [];
for(let c=from;c<=to;c++){ const s=spriteRGBA(c); list.push({c,s}); }
const rows = Math.ceil(list.length/cols);
const W = cols*cellW, H = rows*cellH;
const sheet = Buffer.alloc(W*H*3, 16);
list.forEach((it,idx)=>{
  const cx=(idx%cols)*cellW, cy=Math.floor(idx/cols)*cellH;
  if(!it.s) return;
  const {w,h,rgb}=it.s;
  const ox=cx+Math.max(0,(cellW-w)>>1), oy=cy+Math.max(0,(cellH-4-h)>>1);
  for(let y=0;y<Math.min(h,cellH-4);y++)for(let x=0;x<Math.min(w,cellW);x++){
    const so=(y*w+x)*3, dd=((oy+y)*W+(ox+x))*3;
    sheet[dd]=rgb[so];sheet[dd+1]=rgb[so+1];sheet[dd+2]=rgb[so+2];
  }
});
function png(w,h,rgb){ const raw=Buffer.alloc((w*3+1)*h);
  for(let y=0;y<h;y++){raw[y*(w*3+1)]=0; rgb.copy(raw,y*(w*3+1)+1,y*w*3,(y+1)*w*3);}
  const idat=deflateSync(raw);
  const ct=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
  const crc=(b)=>{let c=0xffffffff;for(const x of b)c=ct[(c^x)&0xff]^(c>>>8);return(c^0xffffffff)>>>0;};
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(t),d]);const cc=Buffer.alloc(4);cc.writeUInt32BE(crc(td));return Buffer.concat([l,td,cc]);};
  const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),ch("IHDR",ih),ch("IDAT",idat),ch("IEND",Buffer.alloc(0))]); }
const out=`/tmp/${ep}_sheet_${from}_${to}.png`;
writeFileSync(out, png(W,H,sheet));
console.log(`${ep} sprites ${from}..${to} (START=${START}), ${cols}/row -> ${out}`);
