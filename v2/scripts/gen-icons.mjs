/* =========================================================================
   gen-icons.mjs —— 生成 PWA 图标（零依赖：手写 PNG 编码）
   图形与 favicon 同源：深底 + 光谱环 + 圆心。
   细节：3× 超采样再盒式降采样拿抗锯齿；四周留 8% 安全边（maskable 友好）。
   用法：node scripts/gen-icons.mjs
   ========================================================================= */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const OUT = root;

/* ---- PNG 编码（RGB8，无 alpha：PWA 图标要实底） ---- */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // color type 2 = truecolor
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---- 光谱色（与 CSS --spectrum 一致：品红 → 琥珀 → 电离青） ---- */
const STOPS = [
  [0.0, [255, 77, 130]],
  [0.5, [255, 156, 63]],
  [1.0, [46, 213, 232]]
];
function spectrum(t) {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [a, ca] = STOPS[i], [b, cb] = STOPS[i + 1];
    if (x <= b || i === STOPS.length - 2) {
      const f = (x - a) / (b - a);
      return [
        ca[0] + (cb[0] - ca[0]) * f,
        ca[1] + (cb[1] - ca[1]) * f,
        ca[2] + (cb[2] - ca[2]) * f
      ];
    }
  }
  return STOPS[0][1];
}

/* ---- 绘制：深底 + 环（角度取色）+ 圆心 ---- */
const BG = [7, 11, 20];
const SS = 3;                       // 超采样倍数
function draw(size) {
  const S = size * SS;
  const cx = S / 2, cy = S / 2;
  const ringR = S * 0.315, ringW = S * 0.075;   // 环心半径 / 线宽
  const dotR = S * 0.105;
  const acc = new Float64Array(size * size * 3);

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const r = Math.hypot(dx, dy);
      let col = BG;

      /* 圆环（带 1px 软边） */
      const ringD = Math.abs(r - ringR) - ringW / 2;
      const ringA = Math.min(1, Math.max(0, 1 - ringD / 1.6));
      /* 圆心（实心） */
      const dotD = r - dotR;
      const dotA = Math.min(1, Math.max(0, 1 - dotD / 1.6));

      if (ringA > 0 || dotA > 0) {
        const ang = (Math.atan2(dy, dx) / (Math.PI * 2) + 1) % 1;
        const sc = spectrum(ang);
        const a = Math.max(ringA, dotA);
        col = [
          BG[0] + (sc[0] - BG[0]) * a,
          BG[1] + (sc[1] - BG[1]) * a,
          BG[2] + (sc[2] - BG[2]) * a
        ];
      }

      /* 累加到目标像素（盒式降采样） */
      const o = (Math.floor(y / SS) * size + Math.floor(x / SS)) * 3;
      acc[o] += col[0]; acc[o + 1] += col[1]; acc[o + 2] += col[2];
    }
  }

  const n = SS * SS;
  const out = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size * 3; i++) out[i] = Math.round(acc[i] / n);
  return out;
}

for (const size of [192, 512]) {
  const png = encodePng(size, size, draw(size));
  const file = path.join(OUT, "icon-" + size + ".png");
  fs.writeFileSync(file, png);
  console.log("✓ " + path.basename(file) + "  " + (png.length / 1024).toFixed(1) + " KB");
}
