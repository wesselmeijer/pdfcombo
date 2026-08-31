/**
 * Rasterise the PDF Combo mark to PNG/ICO without any image dependency.
 *
 * Copied from the Where Wes Went icon generator (frontend/scripts/gen-icons.mjs)
 * with only the glyph and the accent colour swapped — the badge geometry, the
 * 12 degree slant, the supersampling and the PNG/ICO encoders are shared, so
 * both apps' icons come out of the same press.
 *
 * Usage: node gen-icons.mjs <output-dir>
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const ACCENT = [0xea, 0x58, 0x0c]; // --color-combo-600, matches <meta name="theme-color">
const WHITE = [0xff, 0xff, 0xff];

// --- glyph definition, in the original 24x24 coordinate space -------------
// Two sheets, the front one solid. STROKE is thicker than the 2 used on-screen
// so the back sheet survives 16px; GAP is the accent-coloured halo that keeps
// the two sheets from fusing into one blob at that size.
const BACK = { x: 9.5, y: 2, w: 9.5, h: 14, r: 1.4 };
const FRONT = { x: 5, y: 8, w: 9.5, h: 14, r: 1.4 };
const STROKE = 2.2;
const GAP = 2.6;
const SLANT = (12 * Math.PI) / 180;
const GLYPH_FRACTION = 0.78; // of canvas width

/** Signed distance from a glyph-space point to a rounded rectangle. */
function sdRoundRect(x, y, rect) {
  const hw = rect.w / 2;
  const hh = rect.h / 2;
  const px = Math.abs(x - (rect.x + hw)) - hw + rect.r;
  const py = Math.abs(y - (rect.y + hh)) - hh + rect.r;
  const outside = Math.hypot(Math.max(px, 0), Math.max(py, 0));
  return outside + Math.min(Math.max(px, py), 0) - rect.r;
}

/** Signed distance to a rounded rectangle covering the whole canvas. */
function insideRoundedRect(x, y, size, radius) {
  const dx = Math.max(radius - x, x - (size - radius), 0);
  const dy = Math.max(radius - y, y - (size - radius), 0);
  if (dx === 0 || dy === 0) return x >= 0 && y >= 0 && x <= size && y <= size;
  return Math.hypot(dx, dy) <= radius;
}

/** Is this canvas-space point part of the white glyph? */
function inGlyph(x, y, size) {
  const s = (size / 24) * GLYPH_FRACTION;
  const c = size / 2;
  // Undo translate -> scale -> rotate to land back in glyph space.
  const px = (x - c) / s;
  const py = (y - c) / s;
  const cos = Math.cos(-SLANT);
  const sin = Math.sin(-SLANT);
  const gx = px * cos - py * sin + 12;
  const gy = px * sin + py * cos + 12;

  const front = sdRoundRect(gx, gy, FRONT);
  if (front <= 0) return true; // solid front sheet
  if (front <= GAP / 2) return false; // halo — punches through the back sheet
  return Math.abs(sdRoundRect(gx, gy, BACK)) <= STROKE / 2; // back sheet outline
}
/** Render RGBA pixels with 4x4 supersampling. */
function render(size, { rounded }) {
  const radius = rounded ? size * 0.22 : 0;
  const px = Buffer.alloc(size * size * 4);
  const SS = 4;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px_ = x + (sx + 0.5) / SS;
          const py_ = y + (sy + 0.5) / SS;
          if (!rounded || insideRoundedRect(px_, py_, size, radius)) {
            bg++;
            if (inGlyph(px_, py_, size)) fg++;
          }
        }
      }
      const total = SS * SS;
      const alpha = bg / total;
      const glyph = bg > 0 ? fg / bg : 0;
      const o = (y * size + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        px[o + ch] = Math.round(ACCENT[ch] * (1 - glyph) + WHITE[ch] * glyph);
      }
      px[o + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

// --- minimal PNG encoder --------------------------------------------------
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
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO wrapping a PNG payload — valid and understood by every current browser. */
function encodeIco(size, png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry[4] = 1; // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12); // offset
  return Buffer.concat([header, entry, png]);
}

// --- emit -----------------------------------------------------------------
const out = process.argv[2];
const targets = [
  { file: 'favicon-32.png', size: 32, rounded: true },
  { file: 'apple-touch-icon.png', size: 180, rounded: false }, // iOS masks it itself
  { file: 'icon-192.png', size: 192, rounded: true },
  { file: 'icon-512.png', size: 512, rounded: true },
  { file: 'icon-1024.png', size: 1024, rounded: true }, // desktop packaging: icns/ico source
];

for (const t of targets) {
  const png = encodePng(t.size, render(t.size, { rounded: t.rounded }));
  writeFileSync(`${out}/${t.file}`, png);
  console.log(`${t.file.padEnd(22)} ${t.size}x${t.size}  ${png.length} bytes`);
}

const ico = encodeIco(32, encodePng(32, render(32, { rounded: true })));
writeFileSync(`${out}/favicon.ico`, ico);
console.log(`${'favicon.ico'.padEnd(22)} 32x32    ${ico.length} bytes`);
