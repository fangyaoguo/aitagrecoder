'use strict';
// 生成应用图标 build/icon.png(512x512,Google 风格:蓝色圆角方块 + 白色 tag 胶囊)
// 纯 Node 实现,不依赖图像库

const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 512;

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 绘制 ----------
const px = new Uint8Array(SIZE * SIZE * 4);

// 圆角矩形 SDF
function roundRectSDF(x, y, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(x - cx) - (halfW - r);
  const qy = Math.abs(y - cy) - (halfH - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

// 胶囊(圆头矩形)水平或垂直
function pillSDF(x, y, cx, cy, len, thick, horiz) {
  const halfT = thick / 2;
  const qx = Math.abs(x - cx) - (horiz ? len / 2 - halfT : 0);
  const qy = Math.abs(y - cy) - (horiz ? 0 : len / 2 - halfT);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - halfT;
}

const BG = [66, 133, 244];       // Google blue #4285f4
const BG2 = [52, 168, 83];       // Google green #34a853(渐变端点)
const WHITE = [255, 255, 255];

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    // 背景圆角方块(带轻微垂直渐变)
    const d = roundRectSDF(x + 0.5, y + 0.5, SIZE / 2, SIZE / 2, SIZE / 2 - 4, SIZE / 2 - 4, 96);
    const a = Math.min(1, Math.max(0, 0.5 - d));
    if (a <= 0) continue;
    const t = y / SIZE;
    const r = Math.round(BG[0] * (1 - t) + BG2[0] * t);
    const g = Math.round(BG[1] * (1 - t) + BG2[1] * t);
    const b = Math.round(BG[2] * (1 - t) + BG2[2] * t);

    // 三个白色 tag 胶囊(形似标签串)
    const pills = [
      { cx: 256, cy: 150, len: 236, thick: 46, horiz: true },
      { cx: 256, cy: 256, len: 296, thick: 46, horiz: true },
      { cx: 256, cy: 362, len: 178, thick: 46, horiz: true },
    ];
    let color = [r, g, b];
    for (const p of pills) {
      const pd = pillSDF(x + 0.5, y + 0.5, p.cx, p.cy, p.len, p.thick, p.horiz);
      const pa = Math.min(1, Math.max(0, 0.5 - pd));
      if (pa > 0) {
        color = [
          Math.round(color[0] * (1 - pa) + WHITE[0] * pa),
          Math.round(color[1] * (1 - pa) + WHITE[1] * pa),
          Math.round(color[2] * (1 - pa) + WHITE[2] * pa),
        ];
      }
    }
    px[i] = color[0];
    px[i + 1] = color[1];
    px[i + 2] = color[2];
    px[i + 3] = Math.round(a * 255);
  }
}

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng(SIZE, SIZE, Buffer.from(px)));
console.log('icon written:', out);
