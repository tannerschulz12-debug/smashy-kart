// Custom Photo Cutout Studio + Magic LAB Flood-Fill Background Remover + 4 Built-in Starter Characters
const DB_NAME = 'smashy_kart_people_v1';
const STORE_NAME = 'people';
const CUTOUT_SIZE = 256;
const SESSION_MAX_DIM = 384;

const STARTER_SPECS = [
  {
    id: 'default_hero',
    alias: 'starter_tanner',
    name: 'Turbo Tanner',
    useAsCop: false,
    skin: '#f6c39b',
    shirt: '#ef4444',
    accent: '#facc15',
    hair: '#451a03',
    style: 'racer',
  },
  {
    id: 'starter_chaos',
    name: 'Captain Chaos',
    useAsCop: true,
    skin: '#eab086',
    shirt: '#7c3aed',
    accent: '#38bdf8',
    hair: '#facc15',
    style: 'chaos',
  },
  {
    id: 'starter_granny',
    name: 'Granny Nitro',
    useAsCop: true,
    skin: '#f8d2b4',
    shirt: '#ec4899',
    accent: '#fdf2f8',
    hair: '#e2e8f0',
    style: 'granny',
  },
  {
    id: 'starter_donut',
    name: 'Officer Donut',
    useAsCop: true,
    skin: '#e5a57d',
    shirt: '#1d4ed8',
    accent: '#fbbf24',
    hair: '#292524',
    style: 'cop',
  },
];

// Convert sRGB (0..255) to CIE LAB for perceptual background removal
function rgbToLab(r, g, b) {
  let rn = r / 255;
  let gn = g / 255;
  let bn = b / 255;

  rn = rn > 0.04045 ? Math.pow((rn + 0.055) / 1.055, 2.4) : rn / 12.92;
  gn = gn > 0.04045 ? Math.pow((gn + 0.055) / 1.055, 2.4) : gn / 12.92;
  bn = bn > 0.04045 ? Math.pow((bn + 0.055) / 1.055, 2.4) : bn / 12.92;

  let x = (rn * 0.4124 + gn * 0.3576 + bn * 0.1805) / 0.95047;
  let y = rn * 0.2126 + gn * 0.7152 + bn * 0.0722;
  let z = (rn * 0.0193 + gn * 0.1192 + bn * 0.9505) / 1.08883;

  x = x > 0.008856 ? Math.cbrt(x) : 7.787 * x + 16 / 116;
  y = y > 0.008856 ? Math.cbrt(y) : 7.787 * y + 16 / 116;
  z = z > 0.008856 ? Math.cbrt(z) : 7.787 * z + 16 / 116;

  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function labDistance(l1, a1, b1, l2, a2, b2) {
  const dl = (l1 - l2) * 0.72; // Slightly discount pure lighting gradients across walls/sky
  const da = a1 - a2;
  const db = b1 - b2;
  return Math.sqrt(dl * dl + da * da + db * db);
}

function createCanvas2D(w, h) {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return null;
}

function applyStickerOutline(srcCanvas, borderPx = 3) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  const img = srcCtx.getImageData(0, 0, w, h);
  const data = img.data;

  const alpha = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < w * h; p++, i += 4) {
    alpha[p] = data[i + 3];
  }

  const outCanvas = createCanvas2D(w, h);
  const outCtx = outCanvas.getContext('2d');
  const outImg = outCtx.createImageData(w, h);
  const out = outImg.data;

  const offsets = [];
  const rSq = borderPx * borderPx + 1;
  for (let dy = -borderPx; dy <= borderPx; dy++) {
    for (let dx = -borderPx; dx <= borderPx; dx++) {
      if (dx * dx + dy * dy <= rSq) offsets.push([dx, dy]);
    }
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      const a = alpha[idx];
      const o = idx * 4;

      if (a >= 245) {
        out[o] = data[o];
        out[o + 1] = data[o + 1];
        out[o + 2] = data[o + 2];
        out[o + 3] = a;
        continue;
      }

      let maxNeighborA = a;
      for (let k = 0; k < offsets.length; k++) {
        const nx = x + offsets[k][0];
        const ny = y + offsets[k][1];
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          const na = alpha[ny * w + nx];
          if (na > maxNeighborA) {
            maxNeighborA = na;
            if (maxNeighborA >= 240) break;
          }
        }
      }

      if (maxNeighborA > 28) {
        // Blend foreground pixel over crisp white (#ffffff) sticker border
        const fgFrac = a / 255;
        const borderAlpha = Math.min(255, Math.round(maxNeighborA * 1.15));
        out[o] = Math.round(data[o] * fgFrac + 255 * (1 - fgFrac));
        out[o + 1] = Math.round(data[o + 1] * fgFrac + 255 * (1 - fgFrac));
        out[o + 2] = Math.round(data[o + 2] * fgFrac + 255 * (1 - fgFrac));
        out[o + 3] = Math.max(a, borderAlpha);
      }
    }
  }

  outCtx.putImageData(outImg, 0, 0);
  return outCanvas;
}

function exportCompactDataUrl(canvas, maxBytes = 34000) {
  const maxChars = Math.floor(maxBytes * 1.37) + 64;

  // Prefer alpha-supporting WebP for ultra-fast <20KB WebSocket sync
  const qualities = [0.84, 0.72, 0.6];
  for (const q of qualities) {
    try {
      const webp = canvas.toDataURL('image/webp', q);
      if (webp.startsWith('data:image/webp') && webp.length <= maxChars) {
        return webp;
      }
    } catch {
      // Fallback to PNG below
    }
  }

  const pngFull = canvas.toDataURL('image/png');
  if (pngFull.length <= maxChars) return pngFull;

  // Downsample cleanly if PNG exceeds target WebSocket budget
  for (const targetDim of [192, 160, 128]) {
    const small = createCanvas2D(targetDim, targetDim);
    if (!small) break;
    const sctx = small.getContext('2d');
    sctx.drawImage(canvas, 0, 0, targetDim, targetDim);
    try {
      const webpSmall = small.toDataURL('image/webp', 0.7);
      if (webpSmall.startsWith('data:image/webp') && webpSmall.length <= maxChars) {
        return webpSmall;
      }
    } catch {
      // ignore
    }
    const pngSmall = small.toDataURL('image/png');
    if (pngSmall.length <= maxChars || targetDim === 128) {
      return pngSmall;
    }
  }
  return pngFull;
}

function drawStarterCharacterDataUrl(spec) {
  const c = createCanvas2D(CUTOUT_SIZE, CUTOUT_SIZE);
  if (!c) {
    // Headless Node fallback SVG data URL
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><circle cx="128" cy="128" r="108" fill="${spec.shirt}" stroke="#ffffff" stroke-width="8"/><circle cx="128" cy="112" r="62" fill="${spec.skin}"/><circle cx="106" cy="102" r="9" fill="#0f172a"/><circle cx="150" cy="102" r="9" fill="#0f172a"/><path d="M98 134 Q128 162 158 134" stroke="#0f172a" stroke-width="8" fill="none" stroke-linecap="round"/></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }

  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, CUTOUT_SIZE, CUTOUT_SIZE);

  // Shoulders / jacket bust
  ctx.fillStyle = spec.shirt;
  ctx.beginPath();
  ctx.ellipse(128, 224, 78, 52, 0, Math.PI, 0, false);
  ctx.closePath();
  ctx.fill();

  // Collar / racing stripe accent
  ctx.fillStyle = spec.accent;
  ctx.beginPath();
  ctx.moveTo(100, 176);
  ctx.lineTo(156, 176);
  ctx.lineTo(140, 224);
  ctx.lineTo(116, 224);
  ctx.closePath();
  ctx.fill();

  // Neck
  ctx.fillStyle = spec.skin;
  ctx.fillRect(110, 152, 36, 32);

  // Ears
  ctx.beginPath();
  ctx.arc(64, 118, 15, 0, Math.PI * 2);
  ctx.arc(192, 118, 15, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = spec.skin;
  ctx.beginPath();
  ctx.ellipse(128, 114, 64, 70, 0, 0, Math.PI * 2);
  ctx.fill();

  // Cheek warmth
  ctx.fillStyle = 'rgba(244, 63, 94, 0.24)';
  ctx.beginPath();
  ctx.arc(86, 130, 13, 0, Math.PI * 2);
  ctx.arc(170, 130, 13, 0, Math.PI * 2);
  ctx.fill();

  // Character-specific hair, headgear & shades!
  if (spec.style === 'racer') {
    // Turbo Tanner: spiky hair + red racing headband + neon turbo visor shades
    ctx.fillStyle = spec.hair;
    ctx.beginPath();
    ctx.moveTo(64, 96);
    ctx.lineTo(78, 42);
    ctx.lineTo(104, 58);
    ctx.lineTo(128, 32);
    ctx.lineTo(154, 56);
    ctx.lineTo(182, 42);
    ctx.lineTo(192, 96);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ef4444';
    ctx.fillRect(62, 74, 132, 18);
    ctx.fillStyle = '#facc15';
    ctx.fillRect(62, 81, 132, 4);

    // Visor sunglasses
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(74, 98, 108, 28, 8);
    ctx.fill();
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(82, 103, 42, 8);
    ctx.fillRect(132, 103, 42, 8);
  } else if (spec.style === 'chaos') {
    // Captain Chaos: electric yellow lightning spikes + cyan stunt goggles
    ctx.fillStyle = spec.hair;
    ctx.beginPath();
    ctx.moveTo(58, 102);
    ctx.lineTo(50, 48);
    ctx.lineTo(88, 64);
    ctx.lineTo(106, 24);
    ctx.lineTo(132, 56);
    ctx.lineTo(160, 26);
    ctx.lineTo(174, 64);
    ctx.lineTo(206, 50);
    ctx.lineTo(196, 102);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 6;
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.arc(100, 110, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(156, 110, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (spec.style === 'granny') {
    // Granny Nitro: silver turbo bun + hot-pink cat-eye glasses + pearls
    ctx.fillStyle = spec.hair;
    ctx.beginPath();
    ctx.arc(128, 36, 28, 0, Math.PI * 2);
    ctx.arc(128, 82, 68, Math.PI, 0, false);
    ctx.fill();

    ctx.strokeStyle = '#be185d';
    ctx.lineWidth = 6;
    ctx.fillStyle = '#fce7f3';
    ctx.beginPath();
    ctx.moveTo(74, 102);
    ctx.lineTo(120, 108);
    ctx.lineTo(114, 126);
    ctx.lineTo(80, 124);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(182, 102);
    ctx.lineTo(136, 108);
    ctx.lineTo(142, 126);
    ctx.lineTo(176, 124);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(100, 115, 6, 0, Math.PI * 2);
    ctx.arc(156, 115, 6, 0, Math.PI * 2);
    ctx.fill();

    // Pearl necklace
    ctx.fillStyle = '#ffffff';
    for (let px = 100; px <= 156; px += 14) {
      ctx.beginPath();
      ctx.arc(px, 182 + Math.sin(((px - 100) / 56) * Math.PI) * 8, 5.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // Officer Donut: police cap + gold shield + aviators + mustache + pink donut!
    ctx.fillStyle = '#1e3a8a';
    ctx.beginPath();
    ctx.ellipse(128, 62, 72, 28, 0, Math.PI, 0, false);
    ctx.fill();
    ctx.fillRect(62, 58, 132, 20);
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.ellipse(128, 78, 70, 12, 0, 0, Math.PI, false);
    ctx.fill();

    // Gold badge on cap
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(128, 54, 12, 0, Math.PI * 2);
    ctx.fill();

    // Aviator shades
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(78, 98, 44, 26, 10);
    ctx.roundRect(134, 98, 44, 26, 10);
    ctx.fill();
    ctx.fillRect(120, 104, 16, 5);

    // Mustache
    ctx.fillStyle = spec.hair;
    ctx.beginPath();
    ctx.ellipse(112, 144, 22, 9, -0.18, 0, Math.PI * 2);
    ctx.ellipse(144, 144, 22, 9, 0.18, 0, Math.PI * 2);
    ctx.fill();

    // Pink frosted donut in corner
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(190, 198, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ec4899';
    ctx.beginPath();
    ctx.arc(190, 198, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = spec.shirt;
    ctx.beginPath();
    ctx.arc(190, 198, 7, 0, Math.PI * 2);
    ctx.fill();
  }

  // Expressive grin
  if (spec.style !== 'cop') {
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(128, 144, 24, 0.1, Math.PI - 0.1, false);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(108, 145, 40, 8);
  } else {
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(128, 152, 14, 0.15, Math.PI - 0.15, false);
    ctx.stroke();
  }

  const outlined = applyStickerOutline(c, 3);
  return exportCompactDataUrl(outlined, 30000);
}

async function resolveDrawableImage(imgSource) {
  if (!imgSource) throw new Error('Missing image source');
  if (typeof HTMLImageElement !== 'undefined' && imgSource instanceof HTMLImageElement) {
    if (!imgSource.complete) {
      await imgSource.decode();
    }
    return imgSource;
  }
  if (typeof HTMLCanvasElement !== 'undefined' && imgSource instanceof HTMLCanvasElement) {
    return imgSource;
  }
  if (typeof ImageBitmap !== 'undefined' && imgSource instanceof ImageBitmap) {
    return imgSource;
  }
  if (typeof Blob !== 'undefined' && imgSource instanceof Blob) {
    if (typeof createImageBitmap === 'function') {
      return await createImageBitmap(imgSource);
    }
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(imgSource);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }
  if (typeof imgSource === 'string') {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = imgSource;
    });
  }
  return imgSource;
}

export class PhotoStudio {
  constructor() {
    this.people = [];
    this._dbPromise = null;
    this._initialized = false;
  }

  _openDb() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._dbPromise;
  }

  async init() {
    if (this._initialized && this.people.length > 0) {
      return this.getPeople();
    }

    const starters = STARTER_SPECS.map((spec, idx) => ({
      id: spec.id,
      alias: spec.alias || null,
      name: spec.name,
      dataUrl: drawStarterCharacterDataUrl(spec),
      useAsCop: spec.useAsCop,
      builtIn: true,
      createdAt: 1000 + idx,
    }));

    let savedCustom = [];
    try {
      const db = await this._openDb();
      if (db) {
        savedCustom = await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readonly');
          const req = tx.objectStore(STORE_NAME).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
      }
    } catch {
      savedCustom = [];
    }

    const byId = new Map();
    for (const s of starters) {
      byId.set(s.id, s);
    }
    for (const item of savedCustom) {
      if (!item || !item.id || !item.dataUrl) continue;
      if (byId.has(item.id) && byId.get(item.id).builtIn) {
        // Preserve user's custom 'useAsCop' toggle on starter characters if updated
        byId.get(item.id).useAsCop = Boolean(item.useAsCop);
      } else {
        byId.set(item.id, {
          id: item.id,
          name: item.name || 'Custom Driver',
          dataUrl: item.dataUrl,
          useAsCop: item.useAsCop !== false,
          builtIn: false,
          createdAt: item.createdAt || Date.now(),
        });
      }
    }

    this.people = Array.from(byId.values()).sort((a, b) => {
      if (a.builtIn !== b.builtIn) return a.builtIn ? -1 : 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
    this._initialized = true;
    return this.getPeople();
  }

  getPeople() {
    return this.people.slice();
  }

  getPerson(id) {
    if (!id) return this.people[0] || null;
    const direct = this.people.find((p) => p.id === id || p.alias === id);
    return direct || null;
  }

  async savePerson({ id, name, dataUrl, useAsCop = true }) {
    if (!dataUrl) throw new Error('Person requires a cutout dataUrl');
    const cleanId = id || `person_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const existingIdx = this.people.findIndex((p) => p.id === cleanId);
    const isBuiltIn = existingIdx >= 0 ? Boolean(this.people[existingIdx].builtIn) : false;

    const record = {
      id: cleanId,
      name: (name || 'Custom Racer').trim().slice(0, 24) || 'Custom Racer',
      dataUrl,
      useAsCop: Boolean(useAsCop),
      builtIn: isBuiltIn,
      createdAt: existingIdx >= 0 ? this.people[existingIdx].createdAt : Date.now(),
    };

    if (existingIdx >= 0) {
      this.people[existingIdx] = record;
    } else {
      this.people.push(record);
    }

    try {
      const db = await this._openDb();
      if (db) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(record);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
    } catch {
      // Keep in-memory state if IndexedDB quota/private mode blocks persistence
    }

    return record;
  }

  async deletePerson(id) {
    const idx = this.people.findIndex((p) => p.id === id);
    if (idx < 0) return false;
    if (this.people[idx].builtIn) return false;

    this.people.splice(idx, 1);
    try {
      const db = await this._openDb();
      if (db) {
        await new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
    } catch {
      // ignore
    }
    return true;
  }

  async processImageToCutout(imgSource, options = {}) {
    const drawable = await resolveDrawableImage(imgSource);
    const canvas = createCanvas2D(CUTOUT_SIZE, CUTOUT_SIZE);
    if (!canvas) {
      return typeof imgSource === 'string' ? imgSource : '';
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const zoom = Math.max(0.4, Math.min(4.0, Number(options.zoom) || 1.0));
    const rawOffX = Number(options.offsetX) || 0;
    const rawOffY = Number(options.offsetY) || 0;
    const magicCutout = options.magicCutout !== false;
    const tolerance = Math.max(4, Math.min(95, Number(options.tolerance) ?? 36));
    const shape =
      options.shape === 'circle' || options.shape === 'full' ? options.shape : 'cutout';

    // Support normalized (-1..1) pan offsets smoothly across full slider range including -1.0 and +1.0
    const isNormalized =
      options.pixelOffsets !== true &&
      Math.abs(rawOffX) <= 1.0 &&
      Math.abs(rawOffY) <= 1.0;
    const panX = isNormalized ? rawOffX * (CUTOUT_SIZE * 0.5) : rawOffX;
    const panY = isNormalized ? rawOffY * (CUTOUT_SIZE * 0.5) : rawOffY;

    const srcW = drawable.naturalWidth || drawable.videoWidth || drawable.width || CUTOUT_SIZE;
    const srcH = drawable.naturalHeight || drawable.videoHeight || drawable.height || CUTOUT_SIZE;

    // Cover-fit square crop scaled by zoom, leaving a 6px sticker margin when cutout/circle
    const pad = shape === 'full' ? 0 : 6;
    const innerSize = CUTOUT_SIZE - pad * 2;
    const coverScale = Math.max(innerSize / srcW, innerSize / srcH) * zoom;
    const drawW = srcW * coverScale;
    const drawH = srcH * coverScale;
    const dx = (CUTOUT_SIZE - drawW) * 0.5 + panX;
    const dy = (CUTOUT_SIZE - drawH) * 0.5 + panY;

    ctx.clearRect(0, 0, CUTOUT_SIZE, CUTOUT_SIZE);
    ctx.save();
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(CUTOUT_SIZE * 0.5, CUTOUT_SIZE * 0.5, CUTOUT_SIZE * 0.5 - 8, 0, Math.PI * 2);
      ctx.clip();
    } else if (shape === 'cutout') {
      ctx.beginPath();
      ctx.roundRect(pad, pad, innerSize, innerSize, 18);
      ctx.clip();
    }
    ctx.drawImage(drawable, dx, dy, drawW, drawH);
    ctx.restore();

    // Magic corner/border flood-fill background remover in LAB color space
    if (magicCutout && shape !== 'full') {
      const imgData = ctx.getImageData(0, 0, CUTOUT_SIZE, CUTOUT_SIZE);
      const data = imgData.data;
      const total = CUTOUT_SIZE * CUTOUT_SIZE;

      const labL = new Float32Array(total);
      const labA = new Float32Array(total);
      const labB = new Float32Array(total);
      for (let p = 0, i = 0; p < total; p++, i += 4) {
        if (data[i + 3] > 8) {
          const [l, a, b] = rgbToLab(data[i], data[i + 1], data[i + 2]);
          labL[p] = l;
          labA[p] = a;
          labB[p] = b;
        }
      }

      // Collect background seed pixels around top, left, and right outer frame
      // (skipping middle-bottom where torso/shoulders naturally touch the edge!)
      const visited = new Uint8Array(total);
      const bgMask = new Uint8Array(total);
      const queue = new Int32Array(total);
      let qHead = 0;
      let qTail = 0;

      const seeds = [];
      const edgeCoord = shape === 'circle' ? null : pad + 2;

      const trySeed = (sx, sy) => {
        if (sx < 0 || sx >= CUTOUT_SIZE || sy < 0 || sy >= CUTOUT_SIZE) return;
        const idx = sy * CUTOUT_SIZE + sx;
        if (visited[idx]) return;
        if (data[idx * 4 + 3] === 0) {
          visited[idx] = 1;
          bgMask[idx] = 1;
          return;
        }
        visited[idx] = 1;
        bgMask[idx] = 1;
        queue[qTail++] = idx;
        if (seeds.length < 24) {
          seeds.push([labL[idx], labA[idx], labB[idx]]);
        }
      };

      if (shape === 'circle') {
        const cx = CUTOUT_SIZE * 0.5;
        const cy = CUTOUT_SIZE * 0.5;
        const rSeed = CUTOUT_SIZE * 0.5 - 10;
        // Seed along upper 250 degrees of circle rim (avoiding bottom 110 deg shirt zone)
        for (let deg = -205; deg <= 25; deg += 8) {
          const rad = (deg * Math.PI) / 180;
          trySeed(Math.round(cx + Math.cos(rad) * rSeed), Math.round(cy + Math.sin(rad) * rSeed));
        }
      } else {
        const minC = edgeCoord;
        const maxC = CUTOUT_SIZE - 1 - edgeCoord;
        for (let x = minC; x <= maxC; x += 4) {
          trySeed(x, minC); // Top edge
        }
        for (let y = minC; y <= Math.floor(CUTOUT_SIZE * 0.78); y += 4) {
          trySeed(minC, y); // Left edge
          trySeed(maxC, y); // Right edge
        }
      }

      const seedTol = tolerance;
      const stepTol = Math.max(8, tolerance * 0.44);
      const neighborOffsets = [-1, 1, -CUTOUT_SIZE, CUTOUT_SIZE];

      while (qHead < qTail) {
        const cur = queue[qHead++];
        const cx = cur % CUTOUT_SIZE;
        const cl = labL[cur];
        const ca = labA[cur];
        const cb = labB[cur];

        for (let d = 0; d < 4; d++) {
          const off = neighborOffsets[d];
          if ((off === -1 && cx === 0) || (off === 1 && cx === CUTOUT_SIZE - 1)) continue;
          const next = cur + off;
          if (next < 0 || next >= total || visited[next]) continue;
          if (data[next * 4 + 3] <= 8) {
            visited[next] = 1;
            bgMask[next] = 1;
            continue;
          }

          const nl = labL[next];
          const na = labA[next];
          const nb = labB[next];

          // Neighbor must be close to adjacent background pixel AND reasonably close to a border seed
          if (labDistance(cl, ca, cb, nl, na, nb) <= stepTol) {
            let minSeedDist = Infinity;
            for (let s = 0; s < seeds.length; s++) {
              const sd = labDistance(seeds[s][0], seeds[s][1], seeds[s][2], nl, na, nb);
              if (sd < minSeedDist) minSeedDist = sd;
            }
            if (minSeedDist <= seedTol) {
              visited[next] = 1;
              bgMask[next] = 1;
              queue[qTail++] = next;
            }
          }
        }
      }

      // Apply background removal + 1px feathered edge anti-aliasing
      for (let y = 0; y < CUTOUT_SIZE; y++) {
        for (let x = 0; x < CUTOUT_SIZE; x++) {
          const p = y * CUTOUT_SIZE + x;
          if (bgMask[p]) {
            data[p * 4 + 3] = 0;
          } else if (data[p * 4 + 3] > 0) {
            let bgNeighbors = 0;
            if (x > 0 && bgMask[p - 1]) bgNeighbors++;
            if (x < CUTOUT_SIZE - 1 && bgMask[p + 1]) bgNeighbors++;
            if (y > 0 && bgMask[p - CUTOUT_SIZE]) bgNeighbors++;
            if (y < CUTOUT_SIZE - 1 && bgMask[p + CUTOUT_SIZE]) bgNeighbors++;
            if (bgNeighbors >= 3) {
              data[p * 4 + 3] = Math.round(data[p * 4 + 3] * 0.45);
            } else if (bgNeighbors === 2) {
              data[p * 4 + 3] = Math.round(data[p * 4 + 3] * 0.78);
            }
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);
    }

    const finalCanvas = shape === 'full' ? canvas : applyStickerOutline(canvas, 3);
    return exportCompactDataUrl(finalCanvas, 32000);
  }

  async prepareCutoutSession(imgSource, { magicCutout = true, tolerance = 38 } = {}) {
    const drawable = await resolveDrawableImage(imgSource);
    const origW = drawable.naturalWidth || drawable.videoWidth || drawable.width || CUTOUT_SIZE;
    const origH = drawable.naturalHeight || drawable.videoHeight || drawable.height || CUTOUT_SIZE;
    const scale = Math.max(origW, origH) > SESSION_MAX_DIM
      ? SESSION_MAX_DIM / Math.max(1, origW, origH)
      : 1;
    const w = Math.max(1, Math.round(origW * scale));
    const h = Math.max(1, Math.round(origH * scale));

    const rawCanvas = createCanvas2D(w, h);
    if (!rawCanvas) {
      return {
        sourceCanvas: null,
        rawCanvas: null,
        width: w,
        height: h,
        magicCutout: Boolean(magicCutout),
        tolerance: Number(tolerance) ?? 38,
        fallbackSrc: typeof imgSource === 'string' ? imgSource : '',
      };
    }

    const rawCtx = rawCanvas.getContext('2d', { willReadFrequently: true });
    rawCtx.clearRect(0, 0, w, h);
    rawCtx.drawImage(drawable, 0, 0, w, h);

    if (!magicCutout) {
      return {
        sourceCanvas: rawCanvas,
        rawCanvas,
        width: w,
        height: h,
        magicCutout: false,
        tolerance: Number(tolerance) ?? 38,
      };
    }

    const workCanvas = createCanvas2D(w, h);
    const ctx = workCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(rawCanvas, 0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    const total = w * h;
    const cleanTol = Math.max(4, Math.min(95, Number(tolerance) ?? 38));

    const labL = new Float32Array(total);
    const labA = new Float32Array(total);
    const labB = new Float32Array(total);
    for (let p = 0, i = 0; p < total; p++, i += 4) {
      if (data[i + 3] > 8) {
        const [l, a, b] = rgbToLab(data[i], data[i + 1], data[i + 2]);
        labL[p] = l;
        labA[p] = a;
        labB[p] = b;
      }
    }

    const visited = new Uint8Array(total);
    const bgMask = new Uint8Array(total);
    const queue = new Int32Array(total);
    let qHead = 0;
    let qTail = 0;
    let hadOpaqueBorderSeed = false;
    const seeds = [];

    const trySeed = (sx, sy) => {
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) return;
      const idx = sy * w + sx;
      if (visited[idx]) return;
      if (data[idx * 4 + 3] <= 8) {
        visited[idx] = 1;
        bgMask[idx] = 1;
        return;
      }
      hadOpaqueBorderSeed = true;
      visited[idx] = 1;
      bgMask[idx] = 1;
      queue[qTail++] = idx;
      if (seeds.length < 28) {
        seeds.push([labL[idx], labA[idx], labB[idx]]);
      }
    };

    const stepX = Math.max(2, Math.floor(w / 64));
    const stepY = Math.max(2, Math.floor(h / 64));
    for (let x = 0; x < w; x += stepX) {
      trySeed(x, 0);
      if (h > 2) trySeed(x, 1);
    }
    const maxSideY = Math.floor(h * 0.8);
    for (let y = 0; y <= maxSideY; y += stepY) {
      trySeed(0, y);
      trySeed(w - 1, y);
    }

    let removedCount = 0;
    if (hadOpaqueBorderSeed && seeds.length > 0) {
      const seedTol = cleanTol;
      const stepTol = Math.max(8, cleanTol * 0.44);
      const neighborOffsets = [-1, 1, -w, w];

      while (qHead < qTail) {
        const cur = queue[qHead++];
        const cx = cur % w;
        const cl = labL[cur];
        const ca = labA[cur];
        const cb = labB[cur];

        for (let d = 0; d < 4; d++) {
          const off = neighborOffsets[d];
          if ((off === -1 && cx === 0) || (off === 1 && cx === w - 1)) continue;
          const next = cur + off;
          if (next < 0 || next >= total || visited[next]) continue;
          if (data[next * 4 + 3] <= 8) {
            visited[next] = 1;
            bgMask[next] = 1;
            continue;
          }

          const nl = labL[next];
          const na = labA[next];
          const nb = labB[next];

          if (labDistance(cl, ca, cb, nl, na, nb) <= stepTol) {
            let minSeedDist = Infinity;
            for (let s = 0; s < seeds.length; s++) {
              const sd = labDistance(seeds[s][0], seeds[s][1], seeds[s][2], nl, na, nb);
              if (sd < minSeedDist) minSeedDist = sd;
            }
            if (minSeedDist <= seedTol) {
              visited[next] = 1;
              bgMask[next] = 1;
              queue[qTail++] = next;
            }
          }
        }
      }

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (bgMask[p]) {
            if (data[p * 4 + 3] > 0) removedCount++;
            data[p * 4 + 3] = 0;
          } else if (data[p * 4 + 3] > 0) {
            let bgNeighbors = 0;
            if (x > 0 && bgMask[p - 1]) bgNeighbors++;
            if (x < w - 1 && bgMask[p + 1]) bgNeighbors++;
            if (y > 0 && bgMask[p - w]) bgNeighbors++;
            if (y < h - 1 && bgMask[p + w]) bgNeighbors++;
            if (bgNeighbors >= 3) {
              data[p * 4 + 3] = Math.round(data[p * 4 + 3] * 0.45);
            } else if (bgNeighbors === 2) {
              data[p * 4 + 3] = Math.round(data[p * 4 + 3] * 0.78);
            }
          }
        }
      }
      ctx.putImageData(imgData, 0, 0);
    }

    // Apply crisp 3px white sticker outline once onto the cached session canvas
    const sourceCanvas = removedCount > 0 ? applyStickerOutline(workCanvas, 3) : workCanvas;
    return {
      sourceCanvas,
      rawCanvas,
      width: w,
      height: h,
      magicCutout: true,
      tolerance: cleanTol,
    };
  }

  prepareEditableSource(imgSource, options = {}) {
    return this.prepareCutoutSession(imgSource, options);
  }

  renderSessionPreview(
    targetCanvas,
    session,
    { zoom = 1.1, offsetX = 0, offsetY = 0, shape = 'cutout', pixelOffsets = false, normalizedOffsets = false } = {}
  ) {
    if (!targetCanvas || !session) return false;
    const src =
      shape === 'full'
        ? session.rawCanvas || session.sourceCanvas
        : session.sourceCanvas || session.rawCanvas;
    if (!src) return false;

    const tw = targetCanvas.width || CUTOUT_SIZE;
    const th = targetCanvas.height || CUTOUT_SIZE;
    const size = Math.min(tw, th);
    const ctx = targetCanvas.getContext('2d');
    if (!ctx) return false;

    const cleanZoom = Math.max(0.4, Math.min(4.0, Number(zoom) || 1.0));
    const rawOffX = Number(offsetX) || 0;
    const rawOffY = Number(offsetY) || 0;
    const isNormalized =
      normalizedOffsets === true ||
      (pixelOffsets !== true && Math.abs(rawOffX) <= 1.0 && Math.abs(rawOffY) <= 1.0);
    const panX = isNormalized ? rawOffX * (size * 0.5) : rawOffX;
    const panY = isNormalized ? rawOffY * (size * 0.5) : rawOffY;

    const srcW = session.width || src.width || CUTOUT_SIZE;
    const srcH = session.height || src.height || CUTOUT_SIZE;
    const pad = shape === 'full' ? 0 : 6;
    const innerSize = size - pad * 2;
    const coverScale = Math.max(innerSize / srcW, innerSize / srcH) * cleanZoom;
    const drawW = srcW * coverScale;
    const drawH = srcH * coverScale;
    const dx = (tw - drawW) * 0.5 + panX;
    const dy = (th - drawH) * 0.5 + panY;

    ctx.clearRect(0, 0, tw, th);
    ctx.save();
    if (shape === 'circle') {
      ctx.beginPath();
      ctx.arc(tw * 0.5, th * 0.5, size * 0.5 - 8, 0, Math.PI * 2);
      ctx.clip();
    } else if (shape === 'cutout') {
      ctx.beginPath();
      ctx.roundRect(pad, pad, innerSize, innerSize, 18);
      ctx.clip();
    }
    ctx.drawImage(src, dx, dy, drawW, drawH);
    ctx.restore();

    if (shape === 'circle') {
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(tw * 0.5, th * 0.5, size * 0.5 - 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    return true;
  }

  exportSessionDataUrl(session, opts = {}) {
    if (!session) return '';
    const outCanvas = createCanvas2D(CUTOUT_SIZE, CUTOUT_SIZE);
    if (!outCanvas) {
      return session.fallbackSrc || '';
    }
    this.renderSessionPreview(outCanvas, session, opts);
    return exportCompactDataUrl(outCanvas, 32000);
  }

  getCopAvatarPool() {
    return this.people.filter((p) => p.useAsCop).map((p) => p.id);
  }
}
