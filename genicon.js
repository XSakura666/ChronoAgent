// 生成应用图标 assets/icon.png 和 assets/icon.ico（纯 Node，无需额外依赖）
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const W = 256, H = 256;
const px = Buffer.alloc(W * H * 4, 0);

function setPx(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

function fillCircle(cx, cy, rad, r, g, b, a) {
  const rad2 = rad * rad;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy <= rad2) setPx(x, y, r, g, b, a);
  }
}

function drawLine(x1, y1, x2, y2, th, r, g, b, a) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  const th2 = th * th;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let t = ((x - x1) * dx + (y - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const pxx = x1 + t * dx, pyy = y1 + t * dy;
    const ddx = x - pxx, ddy = y - pyy;
    if (ddx * ddx + ddy * ddy <= th2) setPx(x, y, r, g, b, a);
  }
}

const C = W / 2, R = W * 0.46;
// 蓝色底盘 + 白色描边环
fillCircle(C, C, R, 59, 130, 246, 255);
fillCircle(C, C, R, 255, 255, 255, 255);
fillCircle(C, C, R - W * 0.05, 59, 130, 246, 255);
// 表针（时钟图标）
drawLine(C, C, C, C - R * 0.55, W * 0.035, 255, 255, 255, 255);
drawLine(C, C, C + R * 0.48, C + R * 0.15, W * 0.035, 255, 255, 255, 255);
// 中心点
fillCircle(C, C, W * 0.045, 255, 255, 255, 255);

// PNG 编码
const crcTable = (() => {
  const t = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const raw = Buffer.alloc(H * (W * 4 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0;
  px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
}
const idat = zlib.deflateSync(raw);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))
]);

// ICO（嵌入 PNG）
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
const entry = Buffer.alloc(16);
entry[0] = 0; entry[1] = 0; entry[2] = 0; entry[3] = 0;
entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(22, 12);
const ico = Buffer.concat([header, entry, png]);

const dir = path.join(__dirname, 'assets');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'icon.png'), png);
fs.writeFileSync(path.join(dir, 'icon.ico'), ico);
console.log('icons written to', dir);
