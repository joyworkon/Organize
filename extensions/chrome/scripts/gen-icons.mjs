/**
 * 生成扩展图标（一次性工具）：纯 node 实现，不引入依赖。
 * 图案为蓝色实心圆 + 白色圆环（"O" 形），边缘做 1px 线性抗锯齿。
 * 用法：node scripts/gen-icons.mjs
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");

// --- CRC32（PNG chunk 需要） ---
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** 平滑阶跃：x 从 a 到 b 线性过渡 0→1（抗锯齿） */
function smooth(edge, x) {
  return Math.min(1, Math.max(0, x - edge + 0.5));
}

function makePng(size) {
  const cx = size / 2;
  const rOuter = size * 0.48; // 蓝色实心圆
  const rRingOuter = size * 0.27; // 白色圆环外沿
  const rRingInner = size * 0.13; // 白色圆环内沿
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cx);
      const disc = 1 - smooth(rOuter, d); // 1 在圆内
      const ring = smooth(rRingInner, d) * (1 - smooth(rRingOuter, d));
      // 白环之上是蓝底：先蓝，环区域混白
      const r = Math.round(37 + (255 - 37) * ring);
      const g = Math.round(99 + (255 - 99) * ring);
      const b = Math.round(235 + (255 - 235) * ring);
      raw[p++] = r;
      raw[p++] = g;
      raw[p++] = b;
      raw[p++] = Math.round(255 * disc);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(join(outDir, `icon${size}.png`), makePng(size));
  console.log(`icon${size}.png written`);
}
