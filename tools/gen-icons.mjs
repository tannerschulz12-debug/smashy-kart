// Zero-dependency 4x-supersampled PNG & ICO generator for Smashy Kart iOS/Android Home Screen icons
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');

// CRC32 table for PNG chunks
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const rowOff = y * stride;
    raw[rowOff] = 0; // Filter type 0 (None)
    const srcOff = y * width * 4;
    rgba.copy(raw, rowOff + 1, srcOff, srcOff + width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIcoFromPng(pngBuf, size) {
  // Valid Windows/Browser ICO header wrapping a 32-bit PNG payload
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type 1 = ICO
  header.writeUInt16LE(1, 4); // 1 image

  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12); // offset = 6 + 16
  return Buffer.concat([header, entry, pngBuf]);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// High-res vector rasterizer in normalized [0..1000] space
class HiCanvas {
  constructor(size) {
    this.size = size;
    this.buf = new Float32Array(size * size * 4);
  }

  blendPixel(px, py, r, g, b, a = 1) {
    if (px < 0 || py < 0 || px >= this.size || py >= this.size || a <= 0) return;
    const idx = (py * this.size + px) * 4;
    const inv = 1 - a;
    this.buf[idx] = this.buf[idx] * inv + r * a;
    this.buf[idx + 1] = this.buf[idx + 1] * inv + g * a;
    this.buf[idx + 2] = this.buf[idx + 2] * inv + b * a;
    this.buf[idx + 3] = 255;
  }

  fillBackground() {
    const s = this.size;
    for (let py = 0; py < s; py++) {
      const ny = py / (s - 1);
      for (let px = 0; px < s; px++) {
        const nx = px / (s - 1);
        // Deep arcade twilight sky -> fiery horizon -> dark asphalt base
        let r, g, b;
        if (ny < 0.48) {
          const t = ny / 0.48;
          r = mix(13, 38, t * t);
          g = mix(20, 48, t);
          b = mix(46, 98, t);
        } else {
          const t = (ny - 0.48) / 0.52;
          r = mix(30, 15, t);
          g = mix(37, 20, t);
          b = mix(54, 32, t);
        }

        // Left crimson police siren spotlight cone & right cyan-blue police spotlight cone
        const dRed = Math.abs((nx - 0.18) + (ny - 0.48) * 0.55);
        if (ny < 0.62 && dRed < 0.24) {
          const glow = Math.pow(1 - dRed / 0.24, 2) * (1 - ny / 0.68) * 0.62;
          r = mix(r, 248, glow);
          g = mix(g, 58, glow);
          b = mix(b, 72, glow);
        }
        const dBlue = Math.abs((nx - 0.82) - (ny - 0.48) * 0.55);
        if (ny < 0.62 && dBlue < 0.24) {
          const glow = Math.pow(1 - dBlue / 0.24, 2) * (1 - ny / 0.68) * 0.66;
          r = mix(r, 56, glow);
          g = mix(g, 189, glow);
          b = mix(b, 248, glow);
        }

        // Warm golden turbo glow behind center car
        const rad = Math.hypot(nx - 0.5, (ny - 0.52) * 1.15);
        if (rad < 0.46) {
          const burst = Math.pow(1 - rad / 0.46, 2.2) * 0.34;
          r = mix(r, 251, burst);
          g = mix(g, 191, burst);
          b = mix(b, 36, burst);
        }

        const idx = (py * s + px) * 4;
        this.buf[idx] = r;
        this.buf[idx + 1] = g;
        this.buf[idx + 2] = b;
        this.buf[idx + 3] = 255;
      }
    }
  }

  // Polygon fill in [0..1000] space
  fillPoly(pts, hex, alpha = 1) {
    const [r, g, b] = hexRgb(hex);
    const scale = this.size / 1000;
    let minY = Infinity, maxY = -Infinity;
    const sp = pts.map(([x, y]) => {
      const sx = x * scale;
      const sy = y * scale;
      if (sy < minY) minY = sy;
      if (sy > maxY) maxY = sy;
      return [sx, sy];
    });
    const y0 = clamp(Math.floor(minY), 0, this.size - 1);
    const y1 = clamp(Math.ceil(maxY), 0, this.size - 1);
    const nodes = [];
    for (let py = y0; py <= y1; py++) {
      const y = py + 0.5;
      nodes.length = 0;
      for (let i = 0, j = sp.length - 1; i < sp.length; j = i++) {
        const [xi, yi] = sp[i];
        const [xj, yj] = sp[j];
        if ((yi < y && yj >= y) || (yj < y && yi >= y)) {
          nodes.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
        }
      }
      nodes.sort((a, c) => a - c);
      for (let k = 0; k + 1 < nodes.length; k += 2) {
        const xStart = clamp(Math.floor(nodes[k]), 0, this.size - 1);
        const xEnd = clamp(Math.ceil(nodes[k + 1]), 0, this.size - 1);
        for (let px = xStart; px <= xEnd; px++) {
          this.blendPixel(px, py, r, g, b, alpha);
        }
      }
    }
  }

  // Rounded rectangle in [0..1000] space with optional rotation (radians)
  fillRoundRect(cx, cy, w, h, rad, hex, angle = 0, alpha = 1) {
    const [r, g, b] = hexRgb(hex);
    const scale = this.size / 1000;
    const scx = cx * scale;
    const scy = cy * scale;
    const hw = (w * scale) * 0.5;
    const hh = (h * scale) * 0.5;
    const sr = Math.min(rad * scale, hw, hh);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const bound = Math.ceil(Math.hypot(hw, hh)) + 2;
    const x0 = clamp(Math.floor(scx - bound), 0, this.size - 1);
    const x1 = clamp(Math.ceil(scx + bound), 0, this.size - 1);
    const y0 = clamp(Math.floor(scy - bound), 0, this.size - 1);
    const y1 = clamp(Math.ceil(scy + bound), 0, this.size - 1);

    for (let py = y0; py <= y1; py++) {
      const dy = py + 0.5 - scy;
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - scx;
        const lx = Math.abs(dx * cos - dy * sin) - (hw - sr);
        const ly = Math.abs(dx * sin + dy * cos) - (hh - sr);
        const dist = Math.hypot(Math.max(lx, 0), Math.max(ly, 0)) + Math.min(Math.max(lx, ly), 0) - sr;
        if (dist <= 0.5) {
          const cov = clamp(0.5 - dist, 0, 1) * alpha;
          this.blendPixel(px, py, r, g, b, cov);
        }
      }
    }
  }

  fillCircle(cx, cy, radius, hex, alpha = 1) {
    this.fillRoundRect(cx, cy, radius * 2, radius * 2, radius, hex, 0, alpha);
  }

  downsample(targetSize) {
    const out = Buffer.alloc(targetSize * targetSize * 4);
    const ratio = this.size / targetSize;
    const samples = Math.max(1, Math.round(ratio));
    const invArea = 1 / (samples * samples);
    for (let ty = 0; ty < targetSize; ty++) {
      for (let tx = 0; tx < targetSize; tx++) {
        let r = 0, g = 0, b = 0;
        const sy0 = Math.floor(ty * ratio);
        const sx0 = Math.floor(tx * ratio);
        for (let dy = 0; dy < samples; dy++) {
          for (let dx = 0; dx < samples; dx++) {
            const idx = ((sy0 + dy) * this.size + (sx0 + dx)) * 4;
            r += this.buf[idx];
            g += this.buf[idx + 1];
            b += this.buf[idx + 2];
          }
        }
        const o = (ty * targetSize + tx) * 4;
        out[o] = clamp(Math.round(r * invArea), 0, 255);
        out[o + 1] = clamp(Math.round(g * invArea), 0, 255);
        out[o + 2] = clamp(Math.round(b * invArea), 0, 255);
        out[o + 3] = 255;
      }
    }
    return out;
  }
}

function drawArtwork(hi, { scaleContent = 1.0 } = {}) {
  hi.fillBackground();

  // Transform helper around (500, 520) for maskable safe-zone scaling
  const T = (x, y) => [500 + (x - 500) * scaleContent, 520 + (y - 520) * scaleContent];
  const S = (v) => v * scaleContent;

  // City skyline silhouette along horizon
  const skyline = [
    [60, 480, 95, 190],
    [165, 480, 80, 250],
    [255, 480, 90, 165],
    [680, 480, 88, 225],
    [778, 480, 95, 270],
    [882, 480, 90, 180],
  ];
  for (const [bx, by, bw, bh] of skyline) {
    const [tx, ty] = T(bx + bw * 0.5, by - bh * 0.5);
    hi.fillRoundRect(tx, ty, S(bw), S(bh), S(8), '#0f172a', 0, 0.85);
    // Warm lit skyscraper windows
    for (let wy = by - bh + 28; wy < by - 25; wy += 36) {
      for (let wx = bx + 20; wx < bx + bw - 16; wx += 28) {
        const [wtx, wty] = T(wx, wy);
        hi.fillRoundRect(wtx, wty, S(12), S(16), S(3), '#fde047', 0, 0.48);
      }
    }
  }

  // Sweeping perspective asphalt highway
  hi.fillPoly(
    [T(350, 470), T(650, 470), T(1040, 1040), T(-40, 1040)],
    '#1e293b',
    1
  );
  // Bright road shoulder curbs (red/white arcade rumble strips!)
  hi.fillPoly([T(336, 470), T(358, 470), T(10, 1040), T(-55, 1040)], '#ef4444', 0.92);
  hi.fillPoly([T(642, 470), T(664, 470), T(1055, 1040), T(990, 1040)], '#38bdf8', 0.92);

  // Perspective yellow road center dashes
  hi.fillPoly([T(490, 500), T(510, 500), T(516, 590), T(484, 590)], '#facc15', 1);
  hi.fillPoly([T(478, 650), T(522, 650), T(536, 800), T(464, 800)], '#facc15', 1);
  hi.fillPoly([T(460, 865), T(540, 865), T(558, 1020), T(442, 1020)], '#facc15', 1);

  // Background chasing Police Cruiser with flashing Red/Blue Lightbar!
  {
    const [px, py] = T(305, 515);
    hi.fillRoundRect(px, py, S(156), S(68), S(16), '#090d16', -0.08, 1);
    hi.fillRoundRect(px, py - S(4), S(142), S(54), S(12), '#f8fafc', -0.08, 1);
    hi.fillRoundRect(px, py - S(34), S(96), S(36), S(10), '#1e293b', -0.08, 1);
    // Siren bar: left red, right cyan-blue + glow halos!
    const [rlx, rly] = T(282, 462);
    const [blx, bly] = T(326, 458);
    hi.fillCircle(rlx, rly, S(34), '#ef4444', 0.42);
    hi.fillCircle(blx, bly, S(34), '#38bdf8', 0.45);
    hi.fillRoundRect(rlx, rly, S(36), S(15), S(6), '#ef4444', -0.08, 1);
    hi.fillRoundRect(blx, bly, S(36), S(15), S(6), '#38bdf8', -0.08, 1);
  }

  // Orange/Cyan Mini-Turbo Drift Sparks under rear tires!
  for (const [sx, sy, sr, col] of [
    [225, 760, 26, '#f97316'],
    [185, 735, 18, '#facc15'],
    [255, 790, 20, '#38bdf8'],
    [775, 745, 24, '#f97316'],
    [810, 720, 16, '#facc15'],
  ]) {
    const [tx, ty] = T(sx, sy);
    hi.fillCircle(tx, ty, S(sr * 1.45), col, 0.35);
    hi.fillCircle(tx, ty, S(sr), col, 0.95);
  }

  // Ground drop shadow under Hero Getaway Car
  {
    const [shx, shy] = T(495, 785);
    hi.fillRoundRect(shx, shy, S(530), S(105), S(48), '#050811', -0.07, 0.78);
  }

  // HERO 3D BLOCKY GETAWAY MUSCLE CAR (tilted -0.07 rad mid-drift!)
  const tilt = -0.07;

  // Rear & Front Chunky Voxel Wheels (with ink outline)
  for (const [wx, wy] of [
    [282, 742],
    [706, 712],
  ]) {
    const [twx, twy] = T(wx, wy);
    hi.fillRoundRect(twx, twy, S(112), S(104), S(24), '#090d16', tilt, 1);
    hi.fillRoundRect(twx, twy, S(88), S(80), S(18), '#1e293b', tilt, 1);
    hi.fillRoundRect(twx, twy, S(44), S(40), S(10), '#94a3b8', tilt, 1);
  }

  // Car Lower Chassis Ink Border + Vibrant Crimson Body + Racing Stripe
  {
    const [cx, cy] = T(494, 672);
    hi.fillRoundRect(cx, cy, S(524), S(168), S(36), '#090d16', tilt, 1);
    hi.fillRoundRect(cx, cy - S(4), S(496), S(140), S(28), '#dc2626', tilt, 1);
    // Top sunlit hood bevel
    const [hx, hy] = T(492, 628);
    hi.fillRoundRect(hx, hy, S(482), S(56), S(20), '#ef4444', tilt, 1);
    // Gold center racing stripe on hood
    const [stx, sty] = T(495, 656);
    hi.fillRoundRect(stx, sty, S(86), S(136), S(10), '#fde047', tilt, 1);
  }

  // Car Cabin + Sky-Cyan Windshield
  {
    const [cabX, cabY] = T(486, 542);
    hi.fillRoundRect(cabX, cabY, S(338), S(136), S(30), '#090d16', tilt, 1);
    hi.fillRoundRect(cabX, cabY, S(312), S(112), S(22), '#f87171', tilt, 1);
    const [winX, winY] = T(488, 548);
    hi.fillRoundRect(winX, winY, S(262), S(72), S(14), '#0f172a', tilt, 1);
    hi.fillRoundRect(winX, winY, S(246), S(58), S(11), '#7dd3fc', tilt, 1);
    // Diagonal windshield reflection
    const [glX, glY] = T(432, 545);
    hi.fillRoundRect(glX, glY, S(46), S(54), S(8), '#e0f2fe', tilt + 0.35, 0.85);
  }

  // Twin-Rocket RPG Launcher Tubes on Roof!
  for (const side of [-1, 1]) {
    const [rx, ry] = T(480 + side * 128, 476 - side * 9);
    hi.fillRoundRect(rx, ry, S(68), S(48), S(12), '#090d16', tilt, 1);
    hi.fillRoundRect(rx, ry, S(54), S(34), S(8), '#4d7c0f', tilt, 1);
    // Red warhead tip poking out!
    hi.fillCircle(rx, ry + S(4), S(13), '#ef4444', 1);
  }

  // Blazing Headlights + Chrome Grille
  for (const [lx, ly] of [
    [318, 682],
    [672, 657],
  ]) {
    const [tlx, tly] = T(lx, ly);
    hi.fillCircle(tlx, tly, S(46), '#fef08a', 0.35);
    hi.fillRoundRect(tlx, tly, S(74), S(46), S(12), '#090d16', tilt, 1);
    hi.fillRoundRect(tlx, tly, S(58), S(32), S(8), '#fef08a', tilt, 1);
  }
  {
    const [gx, gy] = T(496, 684);
    hi.fillRoundRect(gx, gy, S(186), S(44), S(10), '#0f172a', tilt, 1);
    hi.fillRoundRect(gx, gy + S(38), S(136), S(32), S(8), '#facc15', tilt, 1);
  }

  // Floating Sparkling Rainbow/Sugar '?' Mystery Box (Top-Right Arcade Badge!)
  {
    const boxTilt = 0.16;
    const [bx, by] = T(790, 265);
    hi.fillCircle(bx, by, S(132), '#f472b6', 0.32);
    hi.fillRoundRect(bx, by, S(188), S(188), S(38), '#090d16', boxTilt, 1);
    hi.fillRoundRect(bx, by, S(162), S(162), S(30), '#ec4899', boxTilt, 1);
    hi.fillRoundRect(bx - S(14), by - S(14), S(126), S(126), S(22), '#facc15', boxTilt, 0.92);
    // Crisp '?' glyph inside the mystery cube
    const [qx, qy] = T(790, 245);
    hi.fillRoundRect(qx, qy - S(28), S(64), S(22), S(8), '#090d16', boxTilt, 1);
    hi.fillRoundRect(qx + S(22), qy - S(8), S(22), S(38), S(8), '#090d16', boxTilt, 1);
    hi.fillRoundRect(qx + S(6), qy + S(12), S(44), S(22), S(8), '#090d16', boxTilt, 1);
    hi.fillCircle(qx - S(4), qy + S(48), S(13), '#090d16', 1);
  }

  // Bold Golden 5-Star Wanted Emblem (Top-Left / Top-Center!)
  {
    const [sx, sy] = T(235, 225);
    hi.fillCircle(sx, sy, S(120), '#facc15', 0.28);
    const outerR = 96;
    const innerR = 44;
    const starOuter = [];
    const starInner = [];
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5 - 0.12;
      const rOuter = i % 2 === 0 ? outerR + 14 : innerR + 12;
      const rFill = i % 2 === 0 ? outerR : innerR;
      starOuter.push(T(235 + Math.cos(ang) * rOuter, 225 + Math.sin(ang) * rOuter));
      starInner.push(T(235 + Math.cos(ang) * rFill, 225 + Math.sin(ang) * rFill));
    }
    hi.fillPoly(starOuter, '#090d16', 1);
    hi.fillPoly(starInner, '#facc15', 1);
  }
}

// Render 1024x1024 master (2x supersampled for 512, 4x+ for 192 & 180)
const masterFull = new HiCanvas(1024);
drawArtwork(masterFull, { scaleContent: 1.0 });

const png512 = encodePng(512, 512, masterFull.downsample(512));
const png192 = encodePng(192, 192, masterFull.downsample(192));
const png180 = encodePng(180, 180, masterFull.downsample(180));
const png64 = encodePng(64, 64, masterFull.downsample(64));
const ico64 = encodeIcoFromPng(png64, 64);

const masterMaskable = new HiCanvas(1024);
drawArtwork(masterMaskable, { scaleContent: 0.78 });
const pngMaskable512 = encodePng(512, 512, masterMaskable.downsample(512));

fs.writeFileSync(path.join(PUBLIC_DIR, 'icon-512.png'), png512);
fs.writeFileSync(path.join(PUBLIC_DIR, 'icon-maskable-512.png'), pngMaskable512);
fs.writeFileSync(path.join(PUBLIC_DIR, 'icon-192.png'), png192);
fs.writeFileSync(path.join(PUBLIC_DIR, 'icon-180.png'), png180);
fs.writeFileSync(path.join(PUBLIC_DIR, 'favicon.ico'), ico64);

console.log('Generated crisp PNG & ICO app icons:', {
  'icon-180.png': png180.length,
  'icon-192.png': png192.length,
  'icon-512.png': png512.length,
  'icon-maskable-512.png': pngMaskable512.length,
  'favicon.ico': ico64.length,
});
