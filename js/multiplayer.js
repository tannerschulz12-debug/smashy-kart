// ISO/IEC 18004 Standards-Compliant QR Code SVG Generator + Real-Time WebSocket Party Client
import { ABILITIES, COP_VEHICLES, cloneItemWeights, createDefaultItemWeights } from './config.js';

const VALID_CLOUD_COP_IDS = new Set(COP_VEHICLES.map((c) => c.id));

// ============================================================================
// 1. Genuine ISO/IEC 18004 QR Code Generator (Byte Mode 0100, Level L, V1..V6)
// ============================================================================

// Version 1..6 specs for Error Correction Level L (ISO/IEC 18004 Table 7 & Table 9)
const QR_LEVEL_L_SPECS = [
  null,
  { version: 1, size: 21, numBlocks: 1, dataPerBlock: 19, ecPerBlock: 7,  align: [] },
  { version: 2, size: 25, numBlocks: 1, dataPerBlock: 34, ecPerBlock: 10, align: [6, 18] },
  { version: 3, size: 29, numBlocks: 1, dataPerBlock: 55, ecPerBlock: 15, align: [6, 22] },
  { version: 4, size: 33, numBlocks: 1, dataPerBlock: 80, ecPerBlock: 20, align: [6, 26] },
  { version: 5, size: 37, numBlocks: 1, dataPerBlock: 108, ecPerBlock: 26, align: [6, 30] },
  { version: 6, size: 41, numBlocks: 2, dataPerBlock: 68, ecPerBlock: 18, align: [6, 34] },
];

// GF(256) log/antilog tables with primitive polynomial 0x11D (x^8 + x^4 + x^3 + x^2 + 1)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let v = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = v;
    GF_LOG[v] = i;
    v <<= 1;
    if (v & 0x100) v ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function buildRsGenerator(ecLen) {
  let poly = [1];
  for (let i = 0; i < ecLen; i++) {
    const next = new Array(poly.length + 1).fill(0);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function computeRsCodewords(dataBytes, ecLen) {
  const gen = buildRsGenerator(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < dataBytes.length; i++) {
    const factor = dataBytes[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

function computeFormatBits(ecLevelBits, maskPattern) {
  const data5 = ((ecLevelBits & 0x3) << 3) | (maskPattern & 0x7);
  let rem = data5 << 10;
  for (let bit = 14; bit >= 10; bit--) {
    if ((rem >> bit) & 1) {
      rem ^= 0x537 << (bit - 10);
    }
  }
  return ((data5 << 10) | rem) ^ 0x5412;
}

function testMaskBit(mask, r, c) {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

function scoreQrPenalty(grid, size) {
  let penalty = 0;
  let darkCount = 0;

  // Rule 1: 5+ consecutive same-color modules in rows & columns
  for (let r = 0; r < size; r++) {
    let runColor = grid[r * size];
    let runLen = 1;
    for (let c = 1; c < size; c++) {
      const v = grid[r * size + c];
      if (v === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = v;
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  for (let c = 0; c < size; c++) {
    let runColor = grid[c];
    let runLen = 1;
    for (let r = 1; r < size; r++) {
      const v = grid[r * size + c];
      if (v === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = v;
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  // Rule 2: 2x2 blocks of identical color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = grid[r * size + c];
      if (
        v === grid[r * size + c + 1] &&
        v === grid[(r + 1) * size + c] &&
        v === grid[(r + 1) * size + c + 1]
      ) {
        penalty += 3;
      }
    }
  }

  // Rule 3: 1:1:3:1:1 finder-like ratio patterns with 4 light modules on either side
  const patA = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const patB = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      let matchA = true;
      let matchB = true;
      for (let k = 0; k < 11; k++) {
        const val = grid[r * size + c + k];
        if (val !== patA[k]) matchA = false;
        if (val !== patB[k]) matchB = false;
      }
      if (matchA || matchB) penalty += 40;
    }
  }
  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - 11; r++) {
      let matchA = true;
      let matchB = true;
      for (let k = 0; k < 11; k++) {
        const val = grid[(r + k) * size + c];
        if (val !== patA[k]) matchA = false;
        if (val !== patB[k]) matchB = false;
      }
      if (matchA || matchB) penalty += 40;
    }
  }

  // Rule 4: Dark/light module balance
  for (let i = 0; i < size * size; i++) {
    if (grid[i]) darkCount++;
  }
  const percent = (darkCount * 100) / (size * size);
  const fiveSteps = Math.floor(Math.abs(percent - 50) / 5);
  penalty += fiveSteps * 10;

  return penalty;
}

function writeFormatInfo(modules, reserved, size, maskPattern) {
  // Error Correction Level L = 0b01 in ISO/IEC 18004
  const bits = computeFormatBits(0b01, maskPattern);
  const setMod = (r, c, dark) => {
    modules[r * size + c] = dark ? 1 : 0;
    if (reserved) reserved[r * size + c] = 1;
  };

  // Copy 1 around Top-Left finder
  const tlCoords = [
    [0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8],
    [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
  ];
  for (let i = 0; i < 15; i++) {
    setMod(tlCoords[i][0], tlCoords[i][1], ((bits >> i) & 1) === 1);
  }

  // Copy 2 split across Top-Right and Bottom-Left finders
  for (let i = 0; i < 8; i++) {
    setMod(8, size - 1 - i, ((bits >> i) & 1) === 1);
  }
  for (let i = 8; i < 15; i++) {
    setMod(size - 15 + i, 8, ((bits >> i) & 1) === 1);
  }
  // Fixed dark module
  setMod(size - 8, 8, true);
}

export function generateQrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  let spec = null;
  for (let v = 1; v <= 6; v++) {
    const candidate = QR_LEVEL_L_SPECS[v];
    const totalDataBytes = candidate.numBlocks * candidate.dataPerBlock;
    // Byte mode overhead on V1..V9: 4 bits mode + 8 bits count = 12 bits -> max (totalDataBytes - 2) bytes
    if (bytes.length <= totalDataBytes - 2) {
      spec = candidate;
      break;
    }
  }
  if (!spec) {
    throw new Error(`QR text length (${bytes.length} bytes) exceeds Version 6 capacity (134 bytes)`);
  }

  const totalDataBytes = spec.numBlocks * spec.dataPerBlock;
  const bitBuf = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i--) {
      bitBuf.push((val >> i) & 1);
    }
  };

  // Byte mode (0100) + 8-bit byte count + payload bytes
  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (let i = 0; i < bytes.length; i++) {
    pushBits(bytes[i], 8);
  }

  // Terminator (up to 4 zero bits) + pad to byte boundary + 0xEC/0x11 pad bytes
  const capacityBits = totalDataBytes * 8;
  const termBits = Math.min(4, capacityBits - bitBuf.length);
  pushBits(0, termBits);
  while (bitBuf.length % 8 !== 0) bitBuf.push(0);

  const dataCodewords = new Uint8Array(totalDataBytes);
  for (let i = 0; i < bitBuf.length / 8; i++) {
    let b = 0;
    for (let bit = 0; bit < 8; bit++) b = (b << 1) | bitBuf[i * 8 + bit];
    dataCodewords[i] = b;
  }
  const padBytes = [0xec, 0x11];
  for (let i = bitBuf.length / 8, p = 0; i < totalDataBytes; i++, p++) {
    dataCodewords[i] = padBytes[p & 1];
  }

  // Split into blocks, compute Reed-Solomon EC per block, and interleave
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let b = 0; b < spec.numBlocks; b++) {
    const blockData = dataCodewords.subarray(offset, offset + spec.dataPerBlock);
    offset += spec.dataPerBlock;
    dataBlocks.push(blockData);
    ecBlocks.push(computeRsCodewords(blockData, spec.ecPerBlock));
  }

  const finalCodewords = [];
  for (let i = 0; i < spec.dataPerBlock; i++) {
    for (let b = 0; b < spec.numBlocks; b++) {
      finalCodewords.push(dataBlocks[b][i]);
    }
  }
  for (let i = 0; i < spec.ecPerBlock; i++) {
    for (let b = 0; b < spec.numBlocks; b++) {
      finalCodewords.push(ecBlocks[b][i]);
    }
  }

  // Build base matrix with function patterns
  const size = spec.size;
  const baseModules = new Uint8Array(size * size);
  const reserved = new Uint8Array(size * size);

  const setFunctionModule = (r, c, dark) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    baseModules[r * size + c] = dark ? 1 : 0;
    reserved[r * size + c] = 1;
  };

  // 3 Finder patterns (7x7) + 1-module white separators
  const placeFinder = (topR, leftC) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const ring =
          inside &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        setFunctionModule(topR + dr, leftC + dc, ring);
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Alignment patterns (5x5) skipping corners occupied by finders
  for (const ar of spec.align) {
    for (const ac of spec.align) {
      if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 9) || (ar >= size - 9 && ac <= 8)) {
        continue;
      }
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunctionModule(ar + dr, ac + dc, dark);
        }
      }
    }
  }

  // Timing patterns along row 6 and column 6
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6 * size + i]) setFunctionModule(6, i, i % 2 === 0);
    if (!reserved[i * size + 6]) setFunctionModule(i, 6, i % 2 === 0);
  }

  // Reserve format info cells before placing data bits
  writeFormatInfo(baseModules, reserved, size, 0);

  // Zig-zag upward/downward 2-column data codeword placement
  const streamBits = [];
  for (let i = 0; i < finalCodewords.length; i++) {
    const cw = finalCodewords[i];
    for (let bit = 7; bit >= 0; bit--) streamBits.push((cw >> bit) & 1);
  }

  let bitIdx = 0;
  let upward = true;
  for (let rightCol = size - 1; rightCol >= 1; rightCol -= 2) {
    if (rightCol === 6) rightCol = 5; // Skip vertical timing column
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dc = 0; dc < 2; dc++) {
        const c = rightCol - dc;
        if (!reserved[r * size + c]) {
          baseModules[r * size + c] = bitIdx < streamBits.length ? streamBits[bitIdx++] : 0;
        }
      }
    }
    upward = !upward;
  }

  // Evaluate all 8 ISO masks & pick lowest penalty score
  let bestGrid = null;
  let bestMask = 0;
  let bestScore = Infinity;

  for (let mask = 0; mask < 8; mask++) {
    const candidate = baseModules.slice();
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const idx = r * size + c;
        if (!reserved[idx] && testMaskBit(mask, r, c)) {
          candidate[idx] ^= 1;
        }
      }
    }
    writeFormatInfo(candidate, null, size, mask);
    const score = scoreQrPenalty(candidate, size);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
      bestGrid = candidate;
    }
  }

  return {
    version: spec.version,
    size,
    mask: bestMask,
    modules: bestGrid,
    codewords: finalCodewords,
    ecPerBlock: spec.ecPerBlock,
  };
}

export function renderQrCodeSvg(text, options = {}) {
  const { version, size, mask, modules } = generateQrMatrix(text);
  const margin = Number.isFinite(options.margin) ? options.margin : 4;
  const darkColor = options.darkColor || '#0f172a';
  const lightColor = options.lightColor || '#ffffff';
  const totalSize = size + margin * 2;

  // Merge horizontal runs per row into compact crisp SVG path commands
  let pathD = '';
  for (let r = 0; r < size; r++) {
    let c = 0;
    while (c < size) {
      if (modules[r * size + c]) {
        let run = 1;
        while (c + run < size && modules[r * size + c + run]) run++;
        const x = c + margin;
        const y = r + margin;
        pathD += `M${x} ${y}h${run}v1h-${run}z`;
        c += run;
      } else {
        c++;
      }
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" ` +
    `shape-rendering="crispEdges" data-qr-version="${version}" data-qr-size="${size}" data-qr-mask="${mask}">` +
    `<rect width="${totalSize}" height="${totalSize}" fill="${lightColor}"/>` +
    `<path d="${pathD}" fill="${darkColor}"/>` +
    `</svg>`
  );
}

// ============================================================================
// 2. Zero-Dependency MQTT 3.1.1 over WSS Client (Works Anywhere: 5G + Wi-Fi!)
// ============================================================================

const CLOUD_MQTT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081',
];

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SAFE_AVATAR_RE = /^data:image\/(?:png|webp|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/;
const VALID_CLOUD_SOUND_SLOTS = new Set(['boost', 'crash', 'item', 'horn', 'busted', 'nuke']);
const SAFE_AUDIO_DATA_URL_RE = /^data:audio\/(?:wav|mpeg|mp3|ogg|webm|mp4);base64,[A-Za-z0-9+/=]+$/;
const MAX_SOUND_DATA_URL_LEN = 190000;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function encodeMqttVarLen(len) {
  const bytes = [];
  let x = len >>> 0;
  do {
    let encoded = x & 0x7f;
    x >>>= 7;
    if (x > 0) encoded |= 0x80;
    bytes.push(encoded);
  } while (x > 0);
  return bytes;
}

function decodeMqttVarLen(buf, startIdx) {
  let multiplier = 1;
  let value = 0;
  let idx = startIdx;
  while (idx < buf.length) {
    const byte = buf[idx++];
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) {
      return { value, bytesRead: idx - startIdx };
    }
    multiplier *= 128;
    if (multiplier > 128 * 128 * 128) return null;
  }
  return null; // Incomplete header in stream buffer
}

function concatUint8(...arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function sanitizeCloudProfile(raw = {}, fallbackName = 'Player') {
  const out = {
    name: String(raw.name || fallbackName).trim().slice(0, 16) || fallbackName,
    playerRole: raw.playerRole === 'cop' ? 'cop' : 'runner',
    copVehicleId:
      typeof raw.copVehicleId === 'string' && VALID_CLOUD_COP_IDS.has(raw.copVehicleId)
        ? raw.copVehicleId
        : 'cop_heli',
    characterMode:
      raw.characterMode === 'photo_car' || raw.characterMode === 'runner'
        ? raw.characterMode
        : 'car_driver',
    vehicleId: typeof raw.vehicleId === 'string' ? raw.vehicleId.slice(0, 24) : 'sedan',
    primaryColor: typeof raw.primaryColor === 'string' ? raw.primaryColor.slice(0, 16) : '#ef4444',
    accentColor: typeof raw.accentColor === 'string' ? raw.accentColor.slice(0, 16) : '#fef08a',
    avatarId: typeof raw.avatarId === 'string' ? raw.avatarId.slice(0, 48) : 'default_hero',
    avatarDataUrl:
      typeof raw.avatarDataUrl === 'string' &&
      raw.avatarDataUrl.length <= 240 * 1024 &&
      SAFE_AVATAR_RE.test(raw.avatarDataUrl)
        ? raw.avatarDataUrl
        : null,
    ready: raw.ready !== undefined ? Boolean(raw.ready) : true,
  };
  return out;
}

function defaultCloudRoomSettings() {
  const enabledItems = {};
  for (const ab of ABILITIES) enabledItems[ab.id] = true;
  return {
    biome: 'city',
    aiCopsEnabled: true,
    copIntensity: 1.0,
    startStars: 1,
    trafficDensity: 1.0,
    itemBoxDensity: 1.2,
    sugarBoxRate: 1.0,
    nukeKillDoubleOdds: true,
    gravityMult: 1.0,
    worldSeed: Math.floor(100000 + Math.random() * 900000),
    enabledItems,
    itemWeights: createDefaultItemWeights(),
    lobbyRules: {
      lockStats: true,
      allowCarChoice: true,
      allowModeChoice: true,
      allowCustomPhotos: true,
      allowPlayerCops: true,
      shareHostSounds: true,
      universalSpeedMult: 1.0,
      universalDriftMult: 1.0,
      universalMassMult: 1.0,
      universalScaleMult: 1.0,
      universalVehicleId: 'sedan',
      universalCharacterMode: 'car_driver',
    },
  };
}

function sanitizeCloudRoomSettings(current = {}, patch = {}) {
  const base = { ...defaultCloudRoomSettings(), ...(current || {}) };
  const next = { ...base };

  if (patch.biome === 'city' || patch.biome === 'desert' || patch.biome === 'snow') {
    next.biome = patch.biome;
  }
  if (patch.aiCopsEnabled !== undefined) {
    next.aiCopsEnabled = Boolean(patch.aiCopsEnabled);
  } else {
    next.aiCopsEnabled = next.aiCopsEnabled !== false;
  }
  if (patch.copIntensity !== undefined && patch.copIntensity !== null && Number.isFinite(Number(patch.copIntensity))) {
    next.copIntensity = Math.max(0.4, Math.min(2.0, Number(patch.copIntensity)));
  }
  if (patch.startStars !== undefined && patch.startStars !== null && Number.isFinite(Number(patch.startStars))) {
    next.startStars = Math.max(1, Math.min(5, Math.round(Number(patch.startStars))));
  }
  if (patch.trafficDensity !== undefined && patch.trafficDensity !== null && Number.isFinite(Number(patch.trafficDensity))) {
    next.trafficDensity = Math.max(0, Math.min(2.0, Number(patch.trafficDensity)));
  }
  if (patch.itemBoxDensity !== undefined && patch.itemBoxDensity !== null && Number.isFinite(Number(patch.itemBoxDensity))) {
    next.itemBoxDensity = Math.round(Math.max(0.1, Math.min(5.0, Number(patch.itemBoxDensity))) * 100) / 100;
  } else {
    next.itemBoxDensity = Math.round(Math.max(0.1, Math.min(5.0, Number(next.itemBoxDensity ?? 1.2))) * 100) / 100;
  }
  if (patch.sugarBoxRate !== undefined && patch.sugarBoxRate !== null && Number.isFinite(Number(patch.sugarBoxRate))) {
    next.sugarBoxRate = Math.round(Math.max(0.0, Math.min(5.0, Number(patch.sugarBoxRate))) * 100) / 100;
  } else {
    next.sugarBoxRate = Math.round(Math.max(0.0, Math.min(5.0, Number(next.sugarBoxRate ?? 1.0))) * 100) / 100;
  }
  if (patch.nukeKillDoubleOdds !== undefined) {
    next.nukeKillDoubleOdds = Boolean(patch.nukeKillDoubleOdds);
  } else {
    next.nukeKillDoubleOdds = next.nukeKillDoubleOdds !== false;
  }
  if (patch.gravityMult !== undefined && patch.gravityMult !== null && Number.isFinite(Number(patch.gravityMult))) {
    next.gravityMult = Math.max(0.4, Math.min(1.6, Number(patch.gravityMult)));
  }
  if (patch.worldSeed !== undefined && patch.worldSeed !== null && Number.isFinite(Number(patch.worldSeed))) {
    next.worldSeed = Math.floor(Math.abs(Number(patch.worldSeed))) || 777123;
  }
  if (patch.enabledItems && typeof patch.enabledItems === 'object') {
    next.enabledItems = { ...(next.enabledItems || {}) };
    for (const [k, v] of Object.entries(patch.enabledItems)) {
      next.enabledItems[k] = Boolean(v);
    }
  }
  if (patch.itemWeights && typeof patch.itemWeights === 'object') {
    next.itemWeights = cloneItemWeights({ ...(next.itemWeights || {}), ...patch.itemWeights });
  } else {
    next.itemWeights = cloneItemWeights(next.itemWeights);
  }
  if (patch.lobbyRules && typeof patch.lobbyRules === 'object') {
    const curR = next.lobbyRules || {};
    const pr = patch.lobbyRules;
    next.lobbyRules = {
      lockStats: pr.lockStats !== undefined ? Boolean(pr.lockStats) : curR.lockStats !== false,
      allowCarChoice: pr.allowCarChoice !== undefined ? Boolean(pr.allowCarChoice) : curR.allowCarChoice !== false,
      allowModeChoice: pr.allowModeChoice !== undefined ? Boolean(pr.allowModeChoice) : curR.allowModeChoice !== false,
      allowCustomPhotos: pr.allowCustomPhotos !== undefined ? Boolean(pr.allowCustomPhotos) : curR.allowCustomPhotos !== false,
      allowPlayerCops: pr.allowPlayerCops !== undefined ? Boolean(pr.allowPlayerCops) : curR.allowPlayerCops !== false,
      shareHostSounds: pr.shareHostSounds !== undefined ? Boolean(pr.shareHostSounds) : curR.shareHostSounds !== false,
      universalSpeedMult: Number.isFinite(Number(pr.universalSpeedMult))
        ? Math.max(0.6, Math.min(1.7, Number(pr.universalSpeedMult)))
        : curR.universalSpeedMult ?? 1.0,
      universalDriftMult: Number.isFinite(Number(pr.universalDriftMult))
        ? Math.max(0.6, Math.min(1.7, Number(pr.universalDriftMult)))
        : curR.universalDriftMult ?? 1.0,
      universalMassMult: Number.isFinite(Number(pr.universalMassMult))
        ? Math.max(0.6, Math.min(1.9, Number(pr.universalMassMult)))
        : curR.universalMassMult ?? 1.0,
      universalScaleMult: Number.isFinite(Number(pr.universalScaleMult))
        ? Math.max(0.65, Math.min(1.7, Number(pr.universalScaleMult)))
        : curR.universalScaleMult ?? 1.0,
      universalVehicleId:
        typeof pr.universalVehicleId === 'string'
          ? pr.universalVehicleId.slice(0, 24)
          : curR.universalVehicleId || 'sedan',
      universalCharacterMode:
        pr.universalCharacterMode === 'photo_car' || pr.universalCharacterMode === 'runner'
          ? pr.universalCharacterMode
          : pr.universalCharacterMode === 'car_driver'
            ? 'car_driver'
            : curR.universalCharacterMode || 'car_driver',
    };
  }
  return next;
}

class MqttWssClient {
  constructor(onTopicMessage, onDisconnect) {
    this.onTopicMessage = onTopicMessage;
    this.onDisconnect = onDisconnect;
    this.ws = null;
    this.connected = false;
    this.brokerUrl = null;
    this._rxBuf = new Uint8Array(0);
    this._pingTimer = null;
    this._pktId = 1;
    this._subWaiters = new Map();
  }

  async connect(brokers = CLOUD_MQTT_BROKERS) {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) return this;
    let lastErr = null;
    for (const url of brokers) {
      try {
        await this._connectSingle(url);
        return this;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('All internet party relays unreachable');
  }

  _connectSingle(url) {
    return new Promise((resolve, reject) => {
      let settled = false;
      this._rxBuf = new Uint8Array(0);
      const ws = new WebSocket(url, 'mqtt');
      ws.binaryType = 'arraybuffer';

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { ws.close(); } catch {}
          reject(new Error(`MQTT timeout on ${url}`));
        }
      }, 4500);

      ws.addEventListener('open', () => {
        const cid = 'sk_' + Math.random().toString(36).slice(2, 12);
        const cidBytes = textEncoder.encode(cid);
        const varHdr = new Uint8Array([
          0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, // "MQTT"
          0x04, // Level 4 (MQTT 3.1.1)
          0x02, // Clean Session
          0x00, 0x2d, // KeepAlive 45s
          (cidBytes.length >> 8) & 0xff, cidBytes.length & 0xff,
        ]);
        const body = concatUint8(varHdr, cidBytes);
        const pkt = concatUint8(new Uint8Array([0x10, ...encodeMqttVarLen(body.length)]), body);
        ws.send(pkt);
      });

      ws.addEventListener('message', (ev) => {
        const chunk = new Uint8Array(ev.data);
        this._rxBuf = this._rxBuf.length === 0 ? chunk : concatUint8(this._rxBuf, chunk);

        while (this._rxBuf.length >= 2) {
          const typeFlags = this._rxBuf[0];
          const pktType = typeFlags & 0xf0;
          const rem = decodeMqttVarLen(this._rxBuf, 1);
          if (!rem) break;
          const totalLen = 1 + rem.bytesRead + rem.value;
          if (this._rxBuf.length < totalLen) break;

          const bodyStart = 1 + rem.bytesRead;
          const body = this._rxBuf.subarray(bodyStart, totalLen);
          this._rxBuf = this._rxBuf.subarray(totalLen);

          if (pktType === 0x20) {
            // CONNACK
            clearTimeout(timeout);
            if (body[1] === 0) {
              this.ws = ws;
              this.connected = true;
              this.brokerUrl = url;
              this._startPing();
              if (!settled) {
                settled = true;
                resolve(this);
              }
            } else if (!settled) {
              settled = true;
              reject(new Error(`CONNACK refused: ${body[1]}`));
            }
          } else if (pktType === 0x90) {
            // SUBACK
            const id = (body[0] << 8) | body[1];
            const waiter = this._subWaiters.get(id);
            if (waiter) {
              this._subWaiters.delete(id);
              waiter();
            }
          } else if (pktType === 0x30) {
            // PUBLISH
            const topicLen = (body[0] << 8) | body[1];
            let pos = 2 + topicLen;
            const topic = textDecoder.decode(body.subarray(2, pos));
            const qos = (typeFlags >> 1) & 0x03;
            if (qos > 0) {
              const pidHi = body[pos];
              const pidLo = body[pos + 1];
              pos += 2;
              if (qos === 1 && ws.readyState === WebSocket.OPEN) {
                try { ws.send(new Uint8Array([0x40, 0x02, pidHi, pidLo])); } catch {}
              }
            }
            const payloadStr = textDecoder.decode(body.subarray(pos));
            try {
              this.onTopicMessage?.(topic, JSON.parse(payloadStr));
            } catch {
              // ignore malformed JSON
            }
          }
        }
      });

      ws.addEventListener('close', () => {
        clearTimeout(timeout);
        this._stopPing();
        const wasConnected = this.connected && this.ws === ws;
        if (this.ws === ws) {
          this.connected = false;
          this.ws = null;
        }
        if (!settled) {
          settled = true;
          reject(new Error(`Closed before CONNACK on ${url}`));
        } else if (wasConnected) {
          this.onDisconnect?.();
        }
      });

      ws.addEventListener('error', () => {
        if (!settled) {
          clearTimeout(timeout);
          settled = true;
          try { ws.close(); } catch {}
          reject(new Error(`WebSocket error on ${url}`));
        }
      });
    });
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(new Uint8Array([0xc0, 0x00]));
      }
    }, 18000);
  }

  _stopPing() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
  }

  subscribe(topic) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Not connected'));
    }
    const id = (this._pktId++ & 0x7fff) || 1;
    const tBytes = textEncoder.encode(topic);
    const body = concatUint8(
      new Uint8Array([(id >> 8) & 0xff, id & 0xff, (tBytes.length >> 8) & 0xff, tBytes.length & 0xff]),
      tBytes,
      new Uint8Array([0x00]) // QoS 0 avoids PUBACK burst throttling on public WSS brokers
    );
    const pkt = concatUint8(new Uint8Array([0x82, ...encodeMqttVarLen(body.length)]), body);
    return new Promise((resolve) => {
      const fallback = setTimeout(() => {
        this._subWaiters.delete(id);
        resolve();
      }, 650);
      this._subWaiters.set(id, () => {
        clearTimeout(fallback);
        resolve();
      });
      this.ws.send(pkt);
    });
  }

  publish(topic, obj, qos = 0) {
    const tBytes = textEncoder.encode(topic);
    const pBytes = textEncoder.encode(JSON.stringify(obj));
    let body;
    let hdrByte = 0x30;
    if (qos === 1) {
      hdrByte = 0x32;
      const id = (this._pktId++ & 0x7fff) || 1;
      body = concatUint8(
        new Uint8Array([(tBytes.length >> 8) & 0xff, tBytes.length & 0xff]),
        tBytes,
        new Uint8Array([(id >> 8) & 0xff, id & 0xff]),
        pBytes
      );
    } else {
      body = concatUint8(
        new Uint8Array([(tBytes.length >> 8) & 0xff, tBytes.length & 0xff]),
        tBytes,
        pBytes
      );
    }
    const pkt = concatUint8(new Uint8Array([hdrByte, ...encodeMqttVarLen(body.length)]), body);
    if (!this._txQueue) this._txQueue = [];
    this._txQueue.push(pkt);
    this._drainTxQueue();
  }

  _drainTxQueue() {
    if (this._txTimer) return;
    if (!this._txQueue || this._txQueue.length === 0) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const now = Date.now();
    if (!this._sentTimestamps) this._sentTimestamps = [];
    while (this._sentTimestamps.length > 0 && now - this._sentTimestamps[0] >= 1050) {
      this._sentTimestamps.shift();
    }

    // Stay safely below public WSS broker 10 msg/sec burst limits (<= 8 msgs per 1.05s window)
    if (this._sentTimestamps.length >= 8) {
      const waitMs = Math.max(25, 1050 - (now - this._sentTimestamps[0]) + 15);
      this._txTimer = setTimeout(() => {
        this._txTimer = null;
        this._drainTxQueue();
      }, waitMs);
      return;
    }

    const minGap =
      this._lastHugeSendAt && now - this._lastHugeSendAt < 160
        ? 140
        : this._lastLargeSendAt && now - this._lastLargeSendAt < 120
          ? 100
          : 25;
    const elapsed = now - (this._lastSendAt || 0);
    if (elapsed < minGap) {
      this._txTimer = setTimeout(() => {
        this._txTimer = null;
        this._drainTxQueue();
      }, minGap - elapsed);
      return;
    }

    const pkt = this._txQueue.shift();
    this._lastSendAt = now;
    this._sentTimestamps.push(now);
    if (pkt.length > 32768) this._lastHugeSendAt = now;
    if (pkt.length > 4096) this._lastLargeSendAt = now;
    try {
      this.ws.send(pkt);
    } catch {
      // ignore closed socket race
    }
    if (this._txQueue.length > 0) {
      this._txTimer = setTimeout(() => {
        this._txTimer = null;
        this._drainTxQueue();
      }, pkt.length > 32768 ? 140 : pkt.length > 4096 ? 100 : 25);
    }
  }

  close() {
    this._stopPing();
    if (this._txTimer) {
      clearTimeout(this._txTimer);
      this._txTimer = null;
    }
    this._txQueue = [];
    this._subWaiters.clear();
    if (this.ws) {
      const w = this.ws;
      this.ws = null;
      this.connected = false;
      try { w.close(); } catch {}
    }
  }
}

// ============================================================================
// 3. Real-Time Phone/Desktop Party Multiplayer Client (Local WS + 24/7 Cloud!)
// ============================================================================

export class MultiplayerClient {
  constructor(options = {}) {
    this.wsUrl = options.wsUrl || null;
    this.forceCloud = Boolean(options.forceCloud);
    this.cloudBrokers = options.cloudBrokers || CLOUD_MQTT_BROKERS;
    this.isStaticCloud = false;

    this.ws = null;
    this.mqtt = null;
    this.connected = false;
    this.playerId = 'p_' + Math.random().toString(36).slice(2, 10);
    this.roomCode = null;
    this.isHost = false;
    this.roomState = null;
    this.networkInfo = null;

    this.remoteSnapshots = new Map(); // playerId -> { history: [...], latest }
    this.listeners = new Map();
    this._sendQueue = [];
    this._shouldReconnect = false;
    this._reconnectAttempts = 0;
    this._reconnectTimer = null;
    this._lastStateSentAt = 0;
    this._lastProfile = null;

    // Cloud Host-Coordinator state (used when playing on 24/7 static HTTPS page!)
    this._cloudHostRoom = null;
    this._cloudAvatarBook = new Map(); // playerId -> avatarDataUrl
    this._joinTimeout = null;
    this._joinRetry = null;
    this._joinTimers = [];
    this._joinAttemptGen = 0;
    this._pendingJoinCode = null;
    this._pendingJoinProfile = null;
    this._pendingJoinAvatar = null;
    this._hostBrokerUrl = null;
    this._watchdogTimer = null;
    this._lifecycleBound = false;
    this._onLifecycleWake = null;
    this._reconnectingCloud = false;

    for (const [key, val] of Object.entries(options)) {
      if (key.startsWith('on') && typeof val === 'function') {
        const evtName = key.slice(2, 3).toLowerCase() + key.slice(3);
        this.on(evtName, val);
      }
    }
  }

  on(event, handler) {
    if (typeof handler !== 'function') return () => {};
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    this.listeners.get(event)?.delete(handler);
  }

  _emit(event, payload) {
    const set = this.listeners.get(event);
    if (set) {
      for (const fn of set) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[MultiplayerClient] listener error on ${event}:`, err);
        }
      }
    }
  }

  getRoomCodeFromUrl() {
    if (typeof window === 'undefined' || !window.location?.search) return null;
    const params = new URLSearchParams(window.location.search);
    const code = (params.get('room') || '').trim().toUpperCase();
    return /^[A-Z0-9]{4}$/.test(code) ? code : null;
  }

  getBrokerHintFromUrl() {
    if (typeof window === 'undefined' || !window.location?.search) return null;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('b');
    if (raw === null || raw === '') return null;
    const idx = Number(raw);
    if (Number.isInteger(idx) && idx >= 0 && idx < this.cloudBrokers.length) {
      return this.cloudBrokers[idx];
    }
    return null;
  }

  _getStaticBaseUrl() {
    if (typeof window === 'undefined' || !window.location?.origin) {
      return 'http://localhost:4567';
    }
    const cleanPath = (window.location.pathname || '')
      .replace(/\/index\.html$/i, '')
      .replace(/\/+$/, '');
    return `${window.location.origin}${cleanPath}`;
  }

  async fetchNetworkInfo(baseHttpUrl = '') {
    if (this.forceCloud) {
      this.isStaticCloud = true;
      const shareBaseUrl = this._getStaticBaseUrl();
      this.networkInfo = { port: 443, hostname: 'cloud', lanIps: [], shareBaseUrl, urls: [shareBaseUrl] };
      return this.networkInfo;
    }

    try {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 1400) : null;
      const res = await fetch(`${baseHttpUrl}/api/network-info`, {
        cache: 'no-store',
        signal: ctrl?.signal,
      });
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || !json.shareBaseUrl) throw new Error('Invalid network-info');
      this.isStaticCloud = false;
      this.networkInfo = json;
      this._emit('network_info', this.networkInfo);
      return this.networkInfo;
    } catch {
      // Running on static 24/7 HTTPS page (e.g. GitHub Pages) -> enable anywhere internet party relay!
      this.isStaticCloud = true;
      const shareBaseUrl = this._getStaticBaseUrl();
      this.networkInfo = {
        port: 443,
        hostname: 'cloud',
        lanIps: [],
        shareBaseUrl,
        urls: [shareBaseUrl],
      };
      return this.networkInfo;
    }
  }

  getShareUrl(roomCode = this.roomCode) {
    const base = this.networkInfo?.shareBaseUrl || this._getStaticBaseUrl();
    const cleanBase = base.replace(/\/+$/, '');
    if (!roomCode) return `${cleanBase}/`;
    if (this._useCloudMode() && this.mqtt?.brokerUrl) {
      const bIdx = this.cloudBrokers.indexOf(this.mqtt.brokerUrl);
      if (bIdx >= 0) {
        return `${cleanBase}/?room=${encodeURIComponent(roomCode)}&b=${bIdx}`;
      }
    }
    return `${cleanBase}/?room=${encodeURIComponent(roomCode)}`;
  }

  getQrCodeSvg(roomCode = this.roomCode, options = {}) {
    return renderQrCodeSvg(this.getShareUrl(roomCode), options);
  }

  _useCloudMode() {
    if (this.forceCloud) return true;
    if (this.wsUrl) return false;
    if (this.isStaticCloud) return true;
    if (typeof window !== 'undefined' && /\.github\.io$|\.pages\.dev$|\.netlify\.app$|\.vercel\.app$/i.test(window.location.hostname)) {
      return true;
    }
    return false;
  }

  _roomTopic(code) {
    return `smashykart/v2/room/${String(code || '').toUpperCase()}`;
  }

  _resolveWsUrl(explicitUrl) {
    if (explicitUrl) return explicitUrl;
    if (this.wsUrl) return this.wsUrl;
    if (typeof window !== 'undefined' && window.location?.host) {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${window.location.host}/ws`;
    }
    return 'ws://127.0.0.1:4567/ws';
  }

  _orderedBrokers(preferredUrl = null) {
    const out = [];
    const push = (u) => {
      if (u && typeof u === 'string' && !out.includes(u)) out.push(u);
    };
    push(preferredUrl);
    push(this.getBrokerHintFromUrl());
    push(this._hostBrokerUrl);
    push(this.mqtt?.brokerUrl);
    for (const u of this.cloudBrokers || CLOUD_MQTT_BROKERS) push(u);
    return out;
  }

  _installLifecycleHeal() {
    if (this._lifecycleBound || typeof window === 'undefined' || typeof document === 'undefined') return;
    this._lifecycleBound = true;
    this._onLifecycleWake = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (this._useCloudMode() && this.roomCode) {
        this._ensureCloudConnected();
      }
    };
    document.addEventListener('visibilitychange', this._onLifecycleWake);
    window.addEventListener('focus', this._onLifecycleWake);
    window.addEventListener('online', this._onLifecycleWake);
    if (!this._watchdogTimer) {
      this._watchdogTimer = setInterval(() => {
        if (this._useCloudMode() && this.roomCode) {
          this._ensureCloudConnected();
        }
      }, 10000);
    }
  }

  _teardownLifecycleHeal() {
    if (this._watchdogTimer) {
      clearInterval(this._watchdogTimer);
      this._watchdogTimer = null;
    }
    if (this._lifecycleBound && this._onLifecycleWake && typeof window !== 'undefined' && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onLifecycleWake);
      window.removeEventListener('focus', this._onLifecycleWake);
      window.removeEventListener('online', this._onLifecycleWake);
    }
    this._lifecycleBound = false;
    this._onLifecycleWake = null;
  }

  async _ensureCloudConnected() {
    if (!this._useCloudMode() || !this.roomCode || !this._shouldReconnect) return;
    const isAlive = Boolean(this.mqtt?.connected && this.mqtt?.ws?.readyState === WebSocket.OPEN);
    if (isAlive) return;
    if (this._reconnectingCloud) return;
    this._reconnectingCloud = true;
    this._emit('connection_status', { state: 'reconnecting', cloud: true, brokerUrl: this._hostBrokerUrl || null });
    try {
      const brokers = this._orderedBrokers(this._hostBrokerUrl);
      if (this.mqtt) {
        try { this.mqtt.close(); } catch {}
      }
      await this.connect(undefined, brokers);
      if (this.mqtt?.connected && this.roomCode) {
        await this.mqtt.subscribe(this._roomTopic(this.roomCode));
        this.mqtt._drainTxQueue?.();
        this._emit('connection_status', { state: 'online', cloud: true, brokerUrl: this.mqtt.brokerUrl });
        if (this.isHost && this._cloudHostRoom) {
          this._hostBrokerUrl = this.mqtt.brokerUrl;
          this._publishCloud(this.roomCode, {
            env: 'h2c',
            from: this.playerId,
            msg: { type: 'host_ready', code: this.roomCode },
          });
          this._broadcastCloudFromHost(this._cloudHostRoom, this._serializeCloudRoom(this._cloudHostRoom));
        }
      }
    } catch {
      // Next watchdog tick or visibility wake will retry cleanly
    } finally {
      this._reconnectingCloud = false;
    }
  }

  async connect(explicitUrl, brokerOverride = null) {
    if (this._useCloudMode() && !explicitUrl) {
      this._shouldReconnect = true;
      const desiredBrokers = brokerOverride || this._orderedBrokers();
      const alreadyOnDesired =
        this.mqtt &&
        this.mqtt.connected &&
        this.mqtt.ws?.readyState === WebSocket.OPEN &&
        (!brokerOverride || brokerOverride.includes(this.mqtt.brokerUrl));
      if (alreadyOnDesired) {
        this.connected = true;
        return this;
      }
      if (!this.mqtt) {
        this.mqtt = new MqttWssClient(
          (topic, packet) => this._handleCloudPacket(topic, packet),
          () => {
            this.connected = false;
            this._emit('disconnected', {});
            if (this._shouldReconnect && this.roomCode) {
              this._emit('connection_status', { state: 'reconnecting', cloud: true, brokerUrl: this._hostBrokerUrl || null });
              if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
              this._reconnectTimer = setTimeout(() => {
                this._reconnectTimer = null;
                this._ensureCloudConnected();
              }, 750);
            }
          }
        );
      } else if (brokerOverride && this.mqtt.connected && !brokerOverride.includes(this.mqtt.brokerUrl)) {
        try { this.mqtt.close(); } catch {}
      }
      await this.mqtt.connect(desiredBrokers);
      this.connected = true;
      this.mqtt._drainTxQueue?.();
      this._emit('connected', { url: this.mqtt.brokerUrl, cloud: true });
      this._emit('connection_status', { state: 'online', cloud: true, brokerUrl: this.mqtt.brokerUrl });
      this._emit('welcome', { type: 'welcome', playerId: this.playerId });
      return this;
    }

    const targetUrl = this._resolveWsUrl(explicitUrl);
    this.wsUrl = targetUrl;
    this._shouldReconnect = true;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return Promise.resolve(this);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(targetUrl);
      this.ws = ws;

      ws.addEventListener('open', () => {
        this.connected = true;
        this._reconnectAttempts = 0;
        this._emit('connected', { url: targetUrl });

        while (this._sendQueue.length > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(this._sendQueue.shift());
        }

        if (this.roomCode && this._lastProfile && !settled) {
          this._sendRaw({ type: 'join_room', code: this.roomCode, profile: this._lastProfile });
        }

        if (!settled) {
          settled = true;
          resolve(this);
        }
      });

      ws.addEventListener('message', (ev) => {
        let msg;
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data));
        } catch {
          return;
        }
        this._handleServerMessage(msg);
      });

      ws.addEventListener('close', () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.ws = null;
        if (wasConnected) this._emit('disconnected', {});

        if (this._shouldReconnect) {
          const delay = Math.min(4000, 450 * Math.pow(1.6, this._reconnectAttempts++));
          this._reconnectTimer = setTimeout(() => {
            if (this._shouldReconnect) {
              this.connect(this.wsUrl).catch(() => {});
            }
          }, delay);
        }
      });

      ws.addEventListener('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  }

  disconnect() {
    this._shouldReconnect = false;
    this._joinAttemptGen++;
    this._clearJoinTimers();
    this._teardownLifecycleHeal();
    this._hostBrokerUrl = null;
    this._pendingJoinCode = null;
    this._pendingJoinProfile = null;
    this._pendingJoinAvatar = null;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._cloudHostRoom?.match?.countdownTimer) {
      clearTimeout(this._cloudHostRoom.match.countdownTimer);
    }
    this._cloudHostRoom = null;
    this.remoteSnapshots.clear();
    this.roomCode = null;
    this.roomState = null;
    if (this.mqtt) {
      this.mqtt.close();
      this.mqtt = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this.connected = false;
  }

  _clearJoinTimers() {
    if (this._joinTimeout) {
      clearTimeout(this._joinTimeout);
      this._joinTimeout = null;
    }
    if (this._joinRetry) {
      clearTimeout(this._joinRetry);
      this._joinRetry = null;
    }
    if (Array.isArray(this._joinTimers)) {
      for (const t of this._joinTimers) {
        clearTimeout(t);
        clearInterval(t);
      }
      this._joinTimers = [];
    }
    if (this._joinResolve) {
      const fn = this._joinResolve;
      this._joinResolve = null;
      fn(Boolean(this.roomCode));
    }
  }

  _sendRaw(obj) {
    if (this._useCloudMode()) {
      this._sendCloudCommand(obj);
      return;
    }

    const serialized = JSON.stringify(obj);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(serialized);
    } else {
      if (this._sendQueue.length < 32) {
        this._sendQueue.push(serialized);
      }
      if (!this.ws && this._shouldReconnect) {
        this.connect().catch(() => {});
      }
    }
  }

  // ==========================================================================
  // Cloud Internet Party Room Coordinator (Host-in-Browser over WSS Pub/Sub)
  // ==========================================================================

  _generateRoomCode() {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
    return code;
  }

  _publishCloud(code, packet) {
    if (!this.mqtt || !code) return;
    const isHighFreqState = packet?.env === 'peer' && packet?.msg?.type === 'player_state';
    if (isHighFreqState && !this.mqtt.connected) return;
    this.mqtt.publish(this._roomTopic(code), packet, 0);
  }

  _serializeCloudRoom(room, includeAvatars = false) {
    const rules = room.settings?.lobbyRules || {};
    const allowPhoto = rules.allowCustomPhotos !== false;
    const players = [];
    let idx = 0;
    for (const [id, member] of room.members.entries()) {
      if (member.profile.avatarDataUrl) {
        this._cloudAvatarBook.set(id, member.profile.avatarDataUrl);
      }
      const isHost = id === room.hostId;
      const effectiveRole =
        rules.allowPlayerCops === false && !isHost
          ? 'runner'
          : member.profile.playerRole === 'cop'
            ? 'cop'
            : 'runner';
      const effectiveCopVeh = VALID_CLOUD_COP_IDS.has(member.profile.copVehicleId)
        ? member.profile.copVehicleId
        : 'cop_heli';
      const effectiveMode =
        effectiveRole === 'cop'
          ? 'car_driver'
          : rules.allowModeChoice === false
            ? rules.universalCharacterMode || 'car_driver'
            : member.profile.characterMode;
      const effectiveVeh =
        rules.allowCarChoice === false
          ? rules.universalVehicleId || 'sedan'
          : member.profile.vehicleId;
      players.push({
        id,
        name: member.profile.name,
        isHost,
        spawnIndex: idx++,
        playerRole: effectiveRole,
        copVehicleId: effectiveCopVeh,
        characterMode: effectiveMode,
        vehicleId: effectiveVeh,
        primaryColor: member.profile.primaryColor,
        accentColor: member.profile.accentColor,
        avatarId: allowPhoto ? member.profile.avatarId || `net_${id}` : 'default_hero',
        avatarDataUrl: allowPhoto && includeAvatars ? member.profile.avatarDataUrl || null : null,
        ready: Boolean(member.profile.ready),
      });
    }
    return {
      type: 'room_state',
      code: room.code,
      roomCode: room.code,
      hostId: room.hostId,
      state: room.state,
      settings: room.settings,
      players,
    };
  }

  _hydrateCloudAvatars(players = [], settings = {}) {
    const allowPhoto = settings?.lobbyRules?.allowCustomPhotos !== false;
    return players.map((p) => {
      if (p.avatarDataUrl) this._cloudAvatarBook.set(p.id, p.avatarDataUrl);
      return {
        ...p,
        avatarDataUrl: allowPhoto ? p.avatarDataUrl || this._cloudAvatarBook.get(p.id) || null : null,
      };
    });
  }

  _computeCloudStandings(room, preferredWinnerTeam = null) {
    if (!room?.match) return [];
    const elapsedSec = Math.max(0, (Date.now() - room.match.liveStartAt) / 1000);
    const list = Array.from(room.match.participants.values()).map((p) => ({
      ...p,
      survivalTime: Number((p.alive ? Math.max(p.survivalTime || 0, elapsedSec) : p.survivalTime || 0).toFixed(2)),
    }));
    list.sort((a, b) => {
      if (preferredWinnerTeam) {
        const aWin = (a.playerRole === 'cop' ? 'cop' : 'runner') === preferredWinnerTeam;
        const bWin = (b.playerRole === 'cop' ? 'cop' : 'runner') === preferredWinnerTeam;
        if (aWin !== bWin) return aWin ? -1 : 1;
      }
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (preferredWinnerTeam === 'cop' && (b.copsWrecked || 0) !== (a.copsWrecked || 0)) {
        return (b.copsWrecked || 0) - (a.copsWrecked || 0);
      }
      if (Math.abs(b.survivalTime - a.survivalTime) > 0.001) return b.survivalTime - a.survivalTime;
      return (b.score || 0) - (a.score || 0);
    });
    return list.map((p, idx) => ({
      rank: idx + 1,
      winner: idx === 0,
      crowned: idx === 0,
      id: p.id,
      playerId: p.id,
      name: p.name,
      playerRole: p.playerRole || 'runner',
      copVehicleId: p.copVehicleId || 'cop_heli',
      alive: p.alive,
      survivalTime: p.survivalTime,
      score: Math.round(p.score || 0),
      copsWrecked: p.copsWrecked || 0,
      eliminatedReason: p.eliminatedReason,
      killerName: p.killerName,
      killerId: p.killerId || null,
    }));
  }

  _evaluateCloudMatchEnd(room) {
    if (!room?.match || room.match.finished) return;
    const participants = Array.from(room.match.participants.values());
    const total = participants.length;
    if (total === 0) return;
    const alive = participants.filter((p) => p.alive);
    const isTeamVsMatch = Boolean(room.match.isTeamVsMatch);

    let shouldFinish = false;
    let winnerTeam = null;
    if (isTeamVsMatch) {
      const aliveRunners = alive.filter((p) => p.playerRole !== 'cop');
      const aliveCops = alive.filter((p) => p.playerRole === 'cop');
      if (aliveRunners.length === 0 || aliveCops.length === 0) {
        shouldFinish = true;
        winnerTeam = aliveRunners.length === 0 && aliveCops.length > 0 ? 'cop' : 'runner';
      }
    } else {
      shouldFinish = (total >= 2 && alive.length <= 1) || alive.length === 0;
    }
    if (!shouldFinish) return;

    const maxElim = participants
      .filter((p) => !p.alive)
      .reduce((mx, p) => Math.max(mx, p.survivalTime || 0), 0);
    const elapsed = Math.max(0, (Date.now() - room.match.liveStartAt) / 1000);
    for (const survivor of alive) {
      survivor.survivalTime = Math.max(survivor.survivalTime || 0, elapsed, maxElim + 0.05);
    }

    room.match.finished = true;
    room.state = 'results';
    const standings = this._computeCloudStandings(room, winnerTeam);
    const winner = standings[0] || null;
    const msg = {
      type: 'match_results',
      code: room.code,
      roomCode: room.code,
      winnerId: winner ? winner.id : null,
      winnerName: winner ? winner.name : null,
      winnerTeam,
      standings,
      leaderboard: standings,
    };
    this._publishCloud(room.code, { env: 'h2c', from: room.hostId, msg });
    this._handleServerMessage(msg);
  }

  _broadcastCloudFromHost(room, msg, targetId = null) {
    this._publishCloud(room.code, { env: 'h2c', from: room.hostId, targetId, msg });
    if (!targetId || targetId === this.playerId) {
      this._handleServerMessage(msg);
    }
  }

  async _sendCloudCommand(obj) {
    if (!obj || typeof obj !== 'object') return;
    switch (obj.type) {
      case 'leave_room': {
        const oldCode = this._lastCloudCode;
        this._clearJoinTimers();
        if (oldCode && this.mqtt?.connected) {
          this._publishCloud(oldCode, { env: 'c2h', from: this.playerId, cmd: { type: 'leave_room' } });
        }
        if (this._cloudHostRoom?.match?.countdownTimer) {
          clearTimeout(this._cloudHostRoom.match.countdownTimer);
        }
        this._cloudHostRoom = null;
        this._lastCloudCode = null;
        break;
      }

      case 'update_profile': {
        if (!this.roomCode) return;
        if (this.isHost && this._cloudHostRoom) {
          const me = this._cloudHostRoom.members.get(this.playerId);
          if (me) {
            const prevAv = me.profile.avatarDataUrl;
            me.profile = sanitizeCloudProfile({ ...me.profile, ...(obj.profile || {}) }, me.profile.name);
            me.profile.avatarId = `net_${this.playerId}`;
            if (me.profile.avatarDataUrl && me.profile.avatarDataUrl !== prevAv) {
              this._cloudAvatarBook.set(this.playerId, me.profile.avatarDataUrl);
              this._broadcastCloudFromHost(this._cloudHostRoom, {
                type: 'avatar_sync',
                playerId: this.playerId,
                avatarId: me.profile.avatarId,
                avatarDataUrl: me.profile.avatarDataUrl,
              });
            }
            const st = this._serializeCloudRoom(this._cloudHostRoom);
            this._broadcastCloudFromHost(this._cloudHostRoom, st);
          }
        } else {
          this._publishCloud(this.roomCode, {
            env: 'c2h',
            from: this.playerId,
            cmd: { type: 'update_profile', profile: obj.profile },
          });
        }
        break;
      }

      case 'kick_player': {
        if (!this.isHost || !this._cloudHostRoom) return;
        const targetId = String(obj.targetId || '');
        if (!targetId || targetId === this.playerId) return;
        if (this._cloudHostRoom.members.has(targetId)) {
          this._cloudHostRoom.members.delete(targetId);
          this._broadcastCloudFromHost(
            this._cloudHostRoom,
            { type: 'kicked', message: 'Removed from lobby by Lobby Manager.' },
            targetId
          );
          this._broadcastCloudFromHost(this._cloudHostRoom, this._serializeCloudRoom(this._cloudHostRoom));
        }
        break;
      }

      case 'update_room_settings': {
        if (this.isHost && this._cloudHostRoom) {
          this._cloudHostRoom.settings = sanitizeCloudRoomSettings(
            this._cloudHostRoom.settings,
            obj.settings || obj
          );
          this._broadcastCloudFromHost(this._cloudHostRoom, {
            type: 'room_settings_updated',
            code: this._cloudHostRoom.code,
            roomCode: this._cloudHostRoom.code,
            settings: this._cloudHostRoom.settings,
          });
          this._broadcastCloudFromHost(this._cloudHostRoom, this._serializeCloudRoom(this._cloudHostRoom));
        }
        break;
      }

      case 'start_match': {
        if (!this.isHost || !this._cloudHostRoom) return;
        const room = this._cloudHostRoom;
        if (room.match?.countdownTimer) clearTimeout(room.match.countdownTimer);
        const seed = Number.isFinite(Number(obj.seed))
          ? Math.floor(Math.abs(Number(obj.seed)))
          : Math.floor(100000 + Math.random() * 899999);
        room.settings = sanitizeCloudRoomSettings(room.settings, { worldSeed: seed });
        room.state = 'countdown';

        const participants = new Map();
        const serialized = this._serializeCloudRoom(room);
        let initialRunners = 0;
        let initialCops = 0;
        for (const p of serialized.players) {
          if (p.playerRole === 'cop') initialCops++;
          else initialRunners++;
          participants.set(p.id, {
            id: p.id,
            name: p.name,
            spawnIndex: p.spawnIndex,
            playerRole: p.playerRole || 'runner',
            copVehicleId: p.copVehicleId || 'cop_heli',
            alive: true,
            survivalTime: 0,
            score: 0,
            copsWrecked: 0,
            eliminatedReason: null,
            killerName: null,
            killerId: null,
          });
        }

        const now = Date.now();
        room.match = {
          seed,
          liveStartAt: now + 3000,
          finished: false,
          isTeamVsMatch: initialRunners >= 1 && initialCops >= 1,
          participants,
          countdownTimer: setTimeout(() => {
            if (room.state === 'countdown' && room.match && !room.match.finished) {
              room.state = 'playing';
              room.match.liveStartAt = Date.now();
              this._broadcastCloudFromHost(room, {
                type: 'match_start',
                code: room.code,
                roomCode: room.code,
                seed,
                settings: room.settings,
                players: serialized.players,
              });
            }
          }, 3000),
        };

        this._broadcastCloudFromHost(room, {
          type: 'match_countdown',
          code: room.code,
          roomCode: room.code,
          seed,
          countdownSec: 3,
          settings: room.settings,
          players: serialized.players,
        });
        break;
      }

      case 'player_state': {
        if (!this.roomCode) return;
        if (this.isHost && this._cloudHostRoom?.match && !this._cloudHostRoom.match.finished) {
          const part = this._cloudHostRoom.match.participants.get(this.playerId);
          if (part && part.alive) {
            part.survivalTime = Math.max(part.survivalTime, Number(obj.state?.survivalTime) || 0);
            part.score = Number(obj.state?.score) || part.score;
            part.copsWrecked = Number(obj.state?.copsWrecked) || part.copsWrecked;
          }
        }
        this._publishCloud(this.roomCode, {
          env: 'peer',
          from: this.playerId,
          msg: { type: 'player_state', playerId: this.playerId, state: { ...obj.state, id: this.playerId } },
        });
        break;
      }

      case 'ability_event': {
        if (!this.roomCode) return;
        this._publishCloud(this.roomCode, {
          env: 'peer',
          from: this.playerId,
          msg: { type: 'ability_event', event: obj.event },
        });
        break;
      }

      case 'pvp_bump': {
        if (!this.roomCode) return;
        this._publishCloud(this.roomCode, {
          env: 'peer',
          from: this.playerId,
          msg: obj,
        });
        break;
      }

      case 'sound_sync': {
        if (!this.roomCode || !this.isHost || !this._cloudHostRoom) return;
        const room = this._cloudHostRoom;
        const slot = typeof obj.slot === 'string' ? obj.slot : '';
        if (!VALID_CLOUD_SOUND_SLOTS.has(slot)) return;
        const rawDataUrl = obj.dataUrl;
        let cleanDataUrl = null;
        if (rawDataUrl !== null && rawDataUrl !== undefined && rawDataUrl !== '') {
          if (
            typeof rawDataUrl !== 'string' ||
            rawDataUrl.length > MAX_SOUND_DATA_URL_LEN ||
            !SAFE_AUDIO_DATA_URL_RE.test(rawDataUrl)
          ) {
            return;
          }
          cleanDataUrl = rawDataUrl;
        }
        const cleanLabel =
          typeof obj.label === 'string' && obj.label.trim()
            ? obj.label.trim().slice(0, 32)
            : 'Host Sound';
        if (!room.hostSounds) room.hostSounds = new Map();
        if (cleanDataUrl) {
          room.hostSounds.set(slot, { slot, dataUrl: cleanDataUrl, label: cleanLabel });
        } else {
          room.hostSounds.delete(slot);
        }
        const hostName =
          room.members.get(this.playerId)?.profile?.name || this._lastProfile?.name || 'Host';
        this._broadcastCloudFromHost(room, {
          type: 'sound_sync',
          slot,
          dataUrl: cleanDataUrl,
          label: cleanLabel,
          hostName,
        });
        break;
      }

      case 'sound_sync_clear': {
        if (!this.roomCode || !this.isHost || !this._cloudHostRoom) return;
        const room = this._cloudHostRoom;
        if (room.hostSounds) room.hostSounds.clear();
        this._broadcastCloudFromHost(room, {
          type: 'sound_sync_clear',
          code: room.code,
          roomCode: room.code,
        });
        break;
      }

      case 'horn_event': {
        if (!this.roomCode) return;
        const rosterMe = this.roomState?.players?.find((p) => p.id === this.playerId);
        const playerName =
          this._cloudHostRoom?.members?.get(this.playerId)?.profile?.name ||
          rosterMe?.name ||
          this._lastProfile?.name ||
          'Player';
        this._publishCloud(this.roomCode, {
          env: 'peer',
          from: this.playerId,
          msg: {
            type: 'horn_event',
            playerId: this.playerId,
            playerName,
            x: Number.isFinite(Number(obj.x)) ? Number(obj.x) : 0,
            z: Number.isFinite(Number(obj.z)) ? Number(obj.z) : 0,
          },
        });
        break;
      }

      case 'player_eliminated': {
        if (!this.roomCode) return;
        if (this.isHost && this._cloudHostRoom) {
          this._handleCloudEliminationOnHost(this._cloudHostRoom, this.playerId, obj);
        } else {
          this._publishCloud(this.roomCode, { env: 'c2h', from: this.playerId, cmd: obj });
        }
        break;
      }

      case 'return_to_lobby': {
        if (!this.roomCode) return;
        if (this.isHost && this._cloudHostRoom) {
          this._handleCloudReturnLobbyOnHost(this._cloudHostRoom, this.playerId);
        } else {
          this._publishCloud(this.roomCode, { env: 'c2h', from: this.playerId, cmd: obj });
        }
        break;
      }

      default:
        break;
    }
  }

  _handleCloudEliminationOnHost(room, pid, cmd) {
    if (!room?.match || room.match.finished) return;
    const part = room.match.participants.get(pid);
    if (!part || !part.alive) return;
    part.alive = false;
    part.survivalTime = Number((Number(cmd.survivalTime) || 0).toFixed(2));
    part.score = Math.round(Number(cmd.score) || part.score || 0);
    part.copsWrecked = Number(cmd.copsWrecked) || part.copsWrecked || 0;
    part.eliminatedReason = cmd.isNuke ? 'nuked' : cmd.reason || 'busted';
    part.killerName = cmd.killerName || null;
    part.killerId =
      typeof cmd.killerId === 'string' && cmd.killerId.trim()
        ? cmd.killerId.trim().slice(0, 48)
        : null;

    const announcement =
      part.eliminatedReason === 'nuked'
        ? part.killerName
          ? `☢️ ${part.killerName} NUKED ${part.name}!`
          : `☢️ ${part.name} was NUKED!`
        : part.killerName
          ? part.eliminatedReason === 'drowned'
            ? `${part.killerName} slammed ${part.name} into the river!`
            : part.eliminatedReason === 'busted'
              ? `${part.killerName} boxed ${part.name} into the cops — BUSTED!`
              : `${part.killerName} wrecked ${part.name}!`
          : part.eliminatedReason === 'drowned'
            ? `${part.name} drowned in the river!`
            : part.eliminatedReason === 'busted'
              ? `${part.name} got BUSTED by the police!`
              : `${part.name} WRECKED out!`;

    this._broadcastCloudFromHost(room, {
      type: 'player_eliminated',
      playerId: pid,
      playerName: part.name,
      reason: part.eliminatedReason,
      killerName: part.killerName,
      killerId: part.killerId,
      announcement,
      survivalTime: part.survivalTime,
      standings: this._computeCloudStandings(room),
    });
    this._evaluateCloudMatchEnd(room);
  }

  _handleCloudReturnLobbyOnHost(room, requesterId) {
    if (room.state !== 'results' && requesterId !== room.hostId) return;
    if (room.match?.countdownTimer) clearTimeout(room.match.countdownTimer);
    room.match = null;
    room.state = 'lobby';
    this._broadcastCloudFromHost(room, { type: 'return_to_lobby', code: room.code, roomCode: room.code });
    this._broadcastCloudFromHost(room, this._serializeCloudRoom(room));
  }

  _handleCloudPacket(topic, packet) {
    if (!packet || typeof packet !== 'object') return;

    // 1. Direct 1-hop peer packets (20Hz position, Mario Kart abilities, PvP slams, Horns)
    if (packet.env === 'peer') {
      if (!packet.from || packet.from === this.playerId) return;
      if (packet.msg?.type === 'sound_sync' || packet.msg?.type === 'sound_sync_clear') return;
      if (this.isHost && this._cloudHostRoom?.match && packet.msg?.type === 'player_state') {
        const part = this._cloudHostRoom.match.participants.get(packet.from);
        if (part && part.alive) {
          part.survivalTime = Math.max(part.survivalTime, Number(packet.msg.state?.survivalTime) || 0);
          part.score = Number(packet.msg.state?.score) || part.score;
          part.copsWrecked = Number(packet.msg.state?.copsWrecked) || part.copsWrecked;
        }
      }
      this._handleServerMessage(packet.msg);
      return;
    }

    // 2. Host-to-Client room broadcasts
    if (packet.env === 'h2c') {
      if (this.isHost) return; // Host already applied locally
      if (packet.msg?.type === 'host_ready') {
        if (!this.roomCode && this._pendingJoinCode && this._pendingJoinProfile) {
          this._publishCloud(this._pendingJoinCode, {
            env: 'c2h',
            from: this.playerId,
            cmd: { type: 'join_room', code: this._pendingJoinCode, profile: this._pendingJoinProfile },
          });
        }
        return;
      }
      if (packet.targetId && packet.targetId !== this.playerId) return;
      if (packet.from && this.roomState?.hostId && packet.from !== this.roomState.hostId) return;
      if (
        (packet.msg?.type === 'sound_sync' || packet.msg?.type === 'sound_sync_clear') &&
        !(this.roomState?.hostId && packet.from === this.roomState.hostId)
      ) {
        return;
      }
      if (packet.msg?.type === 'room_joined') {
        this._joinAttemptGen++;
        this._clearJoinTimers();
        this._pendingJoinCode = null;
        this._pendingJoinProfile = null;
        this._hostBrokerUrl = this.mqtt?.brokerUrl || null;
        this._installLifecycleHeal();
      }
      this._handleServerMessage(packet.msg);
      if (packet.msg?.type === 'room_joined' && this._pendingJoinAvatar) {
        const av = this._pendingJoinAvatar;
        this._pendingJoinAvatar = null;
        this.updateProfile({ avatarDataUrl: av });
      }
      return;
    }

    // 3. Client-to-Host requests (processed ONLY by the Host's phone/browser!)
    if (packet.env === 'c2h' && this.isHost && this._cloudHostRoom) {
      const room = this._cloudHostRoom;
      const fromId = packet.from;
      const cmd = packet.cmd;
      if (!fromId || !cmd) return;

      if (cmd.type === 'join_room') {
        if (room.members.size >= 16 && !room.members.has(fromId)) {
          this._broadcastCloudFromHost(
            room,
            { type: 'error', code: 'ROOM_FULL', message: 'Party room is full (max 16 players).' },
            fromId
          );
          return;
        }
        const prof = sanitizeCloudProfile(cmd.profile || {}, `Player ${room.members.size + 1}`);
        prof.avatarId = `net_${fromId}`;
        if (prof.avatarDataUrl) {
          this._cloudAvatarBook.set(fromId, prof.avatarDataUrl);
          this._broadcastCloudFromHost(room, {
            type: 'avatar_sync',
            playerId: fromId,
            avatarId: prof.avatarId,
            avatarDataUrl: prof.avatarDataUrl,
          });
        }
        room.members.set(fromId, { id: fromId, profile: prof });
        // Send each existing member's avatar individually (<30KB per packet) to the new joiner
        for (const [eid, em] of room.members.entries()) {
          if (eid !== fromId && em.profile.avatarDataUrl) {
            this._broadcastCloudFromHost(
              room,
              {
                type: 'avatar_sync',
                playerId: eid,
                avatarId: em.profile.avatarId || `net_${eid}`,
                avatarDataUrl: em.profile.avatarDataUrl,
              },
              fromId
            );
          }
        }
        const serialized = this._serializeCloudRoom(room);
        this._broadcastCloudFromHost(
          room,
          {
            type: 'room_joined',
            code: room.code,
            roomCode: room.code,
            playerId: fromId,
            isHost: false,
            room: serialized,
          },
          fromId
        );
        this._broadcastCloudFromHost(room, serialized);
        if (
          room.settings?.lobbyRules?.shareHostSounds !== false &&
          room.hostSounds &&
          room.hostSounds.size > 0
        ) {
          const hostName = room.members.get(room.hostId)?.profile?.name || 'Host';
          for (const entry of room.hostSounds.values()) {
            this._broadcastCloudFromHost(
              room,
              {
                type: 'sound_sync',
                slot: entry.slot,
                dataUrl: entry.dataUrl,
                label: entry.label,
                hostName,
              },
              fromId
            );
          }
        }
      } else if (cmd.type === 'update_profile') {
        const m = room.members.get(fromId);
        if (m) {
          const prevAv = m.profile.avatarDataUrl;
          m.profile = sanitizeCloudProfile({ ...m.profile, ...(cmd.profile || {}) }, m.profile.name);
          m.profile.avatarId = `net_${fromId}`;
          if (m.profile.avatarDataUrl && m.profile.avatarDataUrl !== prevAv) {
            this._cloudAvatarBook.set(fromId, m.profile.avatarDataUrl);
            this._broadcastCloudFromHost(room, {
              type: 'avatar_sync',
              playerId: fromId,
              avatarId: m.profile.avatarId,
              avatarDataUrl: m.profile.avatarDataUrl,
            });
          }
          this._broadcastCloudFromHost(room, this._serializeCloudRoom(room));
        }
      } else if (cmd.type === 'leave_room') {
        room.members.delete(fromId);
        if (room.match && !room.match.finished) {
          this._handleCloudEliminationOnHost(room, fromId, { reason: 'disconnected', survivalTime: 0 });
        }
        this._broadcastCloudFromHost(room, this._serializeCloudRoom(room));
      } else if (cmd.type === 'player_eliminated') {
        this._handleCloudEliminationOnHost(room, fromId, cmd);
      } else if (cmd.type === 'return_to_lobby') {
        this._handleCloudReturnLobbyOnHost(room, fromId);
      }
    }
  }

  _handleServerMessage(msg) {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'welcome': {
        this.playerId = msg.playerId || this.playerId;
        this._emit('welcome', msg);
        break;
      }

      case 'avatar_sync': {
        if (msg.playerId && msg.avatarDataUrl && SAFE_AVATAR_RE.test(msg.avatarDataUrl)) {
          this._cloudAvatarBook.set(msg.playerId, msg.avatarDataUrl);
          if (this.roomState?.players) {
            this.roomState.players = this._hydrateCloudAvatars(this.roomState.players, this.roomState.settings);
            this._emit('room_state', this.roomState);
          }
        }
        break;
      }

      case 'kicked': {
        this.roomCode = null;
        this.roomState = null;
        this.isHost = false;
        this.remoteSnapshots.clear();
        this._emit('kicked', msg);
        break;
      }

      case 'room_joined': {
        this.roomCode = msg.code || msg.roomCode;
        this._lastCloudCode = this.roomCode;
        this.playerId = msg.playerId || this.playerId;
        this.isHost = Boolean(msg.isHost);
        if (msg.room) {
          if (msg.room.players) {
            msg.room.players = this._hydrateCloudAvatars(msg.room.players, msg.room.settings);
          }
          this.roomState = msg.room;
        }
        this._emit('room_joined', msg);
        break;
      }

      case 'room_state': {
        this.roomCode = msg.code || msg.roomCode || this.roomCode;
        if (msg.players) {
          msg.players = this._hydrateCloudAvatars(msg.players, msg.settings);
        }
        this.roomState = msg;
        this.isHost = Boolean(this.playerId && msg.hostId === this.playerId);

        const activeIds = new Set((msg.players || []).map((p) => p.id));
        for (const id of this.remoteSnapshots.keys()) {
          if (!activeIds.has(id)) this.remoteSnapshots.delete(id);
        }

        this._emit('room_state', msg);
        break;
      }

      case 'match_countdown': {
        this.remoteSnapshots.clear();
        if (msg.players) {
          msg.players = this._hydrateCloudAvatars(msg.players, msg.settings);
        }
        this._emit('match_countdown', msg);
        break;
      }

      case 'host_promoted': {
        this.isHost = Boolean(this.playerId && msg.hostId === this.playerId);
        this._emit('host_promoted', msg);
        break;
      }

      case 'room_settings_updated': {
        if (this.roomState) this.roomState.settings = msg.settings;
        this._emit('room_settings_updated', msg);
        break;
      }

      case 'match_start': {
        this._emit('match_start', msg);
        break;
      }

      case 'player_state': {
        const st = msg.state;
        const pid = msg.playerId || st?.id;
        if (!st || !pid || pid === this.playerId) break;
        this._recordRemoteSnapshot(pid, st);
        this._emit('player_state', st);
        break;
      }

      case 'ability_event': {
        this._emit('ability_event', msg.event || msg);
        break;
      }

      case 'pvp_bump': {
        this._emit('pvp_bump', msg);
        break;
      }

      case 'sound_sync': {
        if (!VALID_CLOUD_SOUND_SLOTS.has(msg.slot)) break;
        const rawUrl = msg.dataUrl;
        const cleanUrl =
          rawUrl === null || rawUrl === undefined || rawUrl === ''
            ? null
            : typeof rawUrl === 'string' &&
                rawUrl.length <= MAX_SOUND_DATA_URL_LEN &&
                SAFE_AUDIO_DATA_URL_RE.test(rawUrl)
              ? rawUrl
              : undefined;
        if (cleanUrl === undefined) break;
        this._emit('sound_sync', {
          slot: msg.slot,
          dataUrl: cleanUrl,
          label: typeof msg.label === 'string' ? msg.label.slice(0, 32) : 'Host Sound',
          hostName: typeof msg.hostName === 'string' ? msg.hostName.slice(0, 24) : '',
        });
        break;
      }

      case 'sound_sync_clear': {
        this._emit('sound_sync_clear', msg);
        break;
      }

      case 'horn_event': {
        if (msg.playerId && msg.playerId === this.playerId) break;
        this._emit('horn_event', {
          playerId: msg.playerId || null,
          playerName: typeof msg.playerName === 'string' ? msg.playerName.slice(0, 24) : 'Player',
          x: Number.isFinite(Number(msg.x)) ? Number(msg.x) : 0,
          z: Number.isFinite(Number(msg.z)) ? Number(msg.z) : 0,
        });
        break;
      }

      case 'player_eliminated': {
        const entry = this.remoteSnapshots.get(msg.playerId);
        if (entry?.latest) entry.latest.alive = false;
        this._emit('player_eliminated', msg);
        break;
      }

      case 'match_results': {
        this._emit('match_results', msg);
        break;
      }

      case 'return_to_lobby': {
        this.remoteSnapshots.clear();
        this._emit('return_to_lobby', msg);
        break;
      }

      case 'error': {
        this._emit('error', msg);
        break;
      }

      default:
        this._emit(msg.type, msg);
        break;
    }
  }

  _recordRemoteSnapshot(playerId, state) {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const rosterEntry = this.roomState?.players?.find((p) => p.id === playerId) || null;
    let bucket = this.remoteSnapshots.get(playerId);
    const enriched = {
      ...state,
      id: playerId,
      name: state.name || bucket?.latest?.name || rosterEntry?.name || 'Player',
      playerRole: state.playerRole || bucket?.latest?.playerRole || rosterEntry?.playerRole || 'runner',
      copVehicleId: state.copVehicleId || bucket?.latest?.copVehicleId || rosterEntry?.copVehicleId || 'cop_heli',
      avatarId: state.avatarId || bucket?.latest?.avatarId || rosterEntry?.avatarId || `net_${playerId}`,
      primaryColor: state.primaryColor || bucket?.latest?.primaryColor || rosterEntry?.primaryColor,
      accentColor: state.accentColor || bucket?.latest?.accentColor || rosterEntry?.accentColor,
      vehicleId: state.vehicleId || bucket?.latest?.vehicleId || rosterEntry?.vehicleId,
      characterMode: state.characterMode || bucket?.latest?.characterMode || rosterEntry?.characterMode,
    };
    if (!bucket) {
      bucket = { history: [], latest: enriched };
      this.remoteSnapshots.set(playerId, bucket);
    }
    bucket.latest = enriched;
    bucket.history.push({ t: now, state: enriched });
    if (bucket.history.length > 14) {
      bucket.history.shift();
    }
  }

  getInterpolatedRemotePlayers(nowMs) {
    const now = nowMs ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const renderTime = now - 115; // 115ms jitter buffer eliminates cellular/Wi-Fi spectator stutter!
    const results = [];

    for (const [id, bucket] of this.remoteSnapshots.entries()) {
      if (id === this.playerId) continue;
      const hist = bucket.history;
      if (hist.length === 0) continue;

      if (hist.length === 1 || renderTime >= hist[hist.length - 1].t) {
        const last = hist[hist.length - 1];
        const extrapSec = Math.min(0.3, Math.max(0, (renderTime - last.t) / 1000));
        const damp = Math.pow(0.94, extrapSec * 10);
        const lvx = (last.state.vx || 0) * damp;
        const lvz = (last.state.vz || 0) * damp;
        results.push({
          ...last.state,
          vx: lvx,
          vz: lvz,
          x: last.state.x + lvx * extrapSec,
          z: last.state.z + lvz * extrapSec,
        });
        continue;
      }

      let a = hist[0];
      let b = hist[hist.length - 1];
      for (let i = 0; i < hist.length - 1; i++) {
        if (hist[i].t <= renderTime && renderTime <= hist[i + 1].t) {
          a = hist[i];
          b = hist[i + 1];
          break;
        }
      }

      const span = Math.max(1, b.t - a.t);
      const t = Math.max(0, Math.min(1, (renderTime - a.t) / span));
      let dAngle = (b.state.angle || 0) - (a.state.angle || 0);
      while (dAngle > Math.PI) dAngle -= Math.PI * 2;
      while (dAngle < -Math.PI) dAngle += Math.PI * 2;

      const ivx = (a.state.vx || 0) + ((b.state.vx || 0) - (a.state.vx || 0)) * t;
      const ivy = (a.state.vy || 0) + ((b.state.vy || 0) - (a.state.vy || 0)) * t;
      const ivz = (a.state.vz || 0) + ((b.state.vz || 0) - (a.state.vz || 0)) * t;

      results.push({
        ...b.state,
        vx: ivx,
        vy: ivy,
        vz: ivz,
        speed: Math.hypot(ivx, ivz),
        x: a.state.x + (b.state.x - a.state.x) * t,
        y: (a.state.y || 0) + ((b.state.y || 0) - (a.state.y || 0)) * t,
        z: a.state.z + (b.state.z - a.state.z) * t,
        angle: (a.state.angle || 0) + dAngle * t,
      });
    }

    return results;
  }

  async createRoom(profile = {}, settings = {}) {
    this._lastProfile = { ...profile };
    await this.connect();

    if (this._useCloudMode()) {
      this._joinAttemptGen++;
      this._clearJoinTimers();
      const code = this._generateRoomCode();
      await this.mqtt.subscribe(this._roomTopic(code));
      const cleanProfile = sanitizeCloudProfile(profile, 'Host');
      cleanProfile.avatarId = `net_${this.playerId}`;

      this._cloudHostRoom = {
        code,
        hostId: this.playerId,
        state: 'lobby',
        settings: sanitizeCloudRoomSettings(defaultCloudRoomSettings(), settings),
        members: new Map([[this.playerId, { id: this.playerId, profile: cleanProfile }]]),
        hostSounds: new Map(), // slot -> { slot, dataUrl, label }
        match: null,
      };
      this.isHost = true;
      this.roomCode = code;
      this._lastCloudCode = code;
      this._hostBrokerUrl = this.mqtt.brokerUrl;
      this._installLifecycleHeal();

      // Announce host presence so any friend already waiting on this code joins immediately
      this._publishCloud(code, {
        env: 'h2c',
        from: this.playerId,
        msg: { type: 'host_ready', code },
      });

      const serialized = this._serializeCloudRoom(this._cloudHostRoom);
      this._handleServerMessage({
        type: 'room_joined',
        code,
        roomCode: code,
        playerId: this.playerId,
        isHost: true,
        room: serialized,
      });
      this._handleServerMessage(serialized);
      return;
    }

    this._sendRaw({ type: 'create_room', profile, settings });
  }

  async joinRoom(code, profile = {}) {
    const cleanCode = String(code || '').trim().toUpperCase();
    this._lastProfile = { ...profile };

    if (this._useCloudMode()) {
      const gen = ++this._joinAttemptGen;
      this._clearJoinTimers();
      this._cloudHostRoom = null;
      this.isHost = false;
      this.roomCode = null;
      this._lastCloudCode = cleanCode;

      // Keep the initial join handshake tiny (<400B) so public WSS relays NEVER drop it;
      // the custom avatar syncs immediately after room_joined succeeds!
      const lightProfile = { ...profile, avatarDataUrl: null };
      this._pendingJoinCode = cleanCode;
      this._pendingJoinProfile = lightProfile;
      this._pendingJoinAvatar = profile?.avatarDataUrl || null;

      const brokers = this._orderedBrokers();
      let anyConnected = false;

      for (let i = 0; i < brokers.length; i++) {
        if (gen !== this._joinAttemptGen || this.roomCode) return;
        const brokerUrl = brokers[i];
        try {
          await this.connect(undefined, [brokerUrl]);
          anyConnected = true;
        } catch {
          continue;
        }
        if (gen !== this._joinAttemptGen || this.roomCode) return;

        try {
          await this.mqtt.subscribe(this._roomTopic(cleanCode));
        } catch {
          continue;
        }
        if (gen !== this._joinAttemptGen || this.roomCode) return;

        const sendJoinReq = () => {
          if (gen !== this._joinAttemptGen || this.roomCode) return;
          this._publishCloud(cleanCode, {
            env: 'c2h',
            from: this.playerId,
            cmd: { type: 'join_room', code: cleanCode, profile: lightProfile },
          });
        };

        sendJoinReq();
        const r1 = setTimeout(sendJoinReq, 800);
        const r2 = setTimeout(sendJoinReq, 1650);
        this._joinTimers.push(r1, r2);

        const waitMs = i === 0 ? 2900 : 2400;
        const joined = await new Promise((resolve) => {
          const finish = (ok) => {
            if (this._joinResolve === finish) this._joinResolve = null;
            clearInterval(poll);
            resolve(ok);
          };
          this._joinResolve = finish;
          const startedAt = Date.now();
          const poll = setInterval(() => {
            if (gen !== this._joinAttemptGen || this.roomCode) {
              finish(Boolean(this.roomCode));
            } else if (Date.now() - startedAt >= waitMs) {
              finish(false);
            }
          }, 80);
          this._joinTimers.push(poll);
        });
        clearTimeout(r1);
        clearTimeout(r2);
        if (joined || gen !== this._joinAttemptGen || this.roomCode) return;
      }

      if (gen === this._joinAttemptGen && !this.roomCode) {
        this._pendingJoinCode = null;
        this._pendingJoinProfile = null;
        this._pendingJoinAvatar = null;
        this._emit('error', {
          type: 'error',
          code: anyConnected ? 'ROOM_NOT_FOUND' : 'RELAY_UNREACHABLE',
          message: anyConnected
            ? `Room "${cleanCode}" not found — make sure the host's lobby screen is open on the same web link (refresh both phones if needed)!`
            : 'Could not reach the internet party relay — check your signal and try again!',
        });
      }
      return;
    }

    await this.connect();
    this._sendRaw({ type: 'join_room', code: cleanCode, profile });
  }

  leaveRoom() {
    this._joinAttemptGen++;
    this._clearJoinTimers();
    this._teardownLifecycleHeal();
    this._hostBrokerUrl = null;
    this._pendingJoinCode = null;
    this._pendingJoinProfile = null;
    this._pendingJoinAvatar = null;
    this.roomCode = null;
    this.roomState = null;
    this.remoteSnapshots.clear();
    this._sendRaw({ type: 'leave_room' });
  }

  updateProfile(profile = {}) {
    this._lastProfile = { ...(this._lastProfile || {}), ...profile };
    this._sendRaw({ type: 'update_profile', profile: this._lastProfile });
  }

  setReady(ready = true) {
    this.updateProfile({ ready: Boolean(ready) });
  }

  updateRoomSettings(settings = {}) {
    this._sendRaw({ type: 'update_room_settings', settings });
  }

  startMatch(seed) {
    this._sendRaw({ type: 'start_match', seed });
  }

  kickPlayer(targetId) {
    if (!this.roomCode || !targetId) return;
    this._sendRaw({ type: 'kick_player', targetId });
  }

  sendPlayerState(player, force = false) {
    if (!player || !this.roomCode || !this.connected) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const playerCount = this.roomState?.players?.length || 2;
    const minIntervalMs = this._useCloudMode()
      ? (playerCount >= 10 ? 185 : 145)
      : (playerCount >= 12 ? 85 : playerCount >= 7 ? 68 : 50);
    if (!force && now - this._lastStateSentAt < minIntervalMs) return;
    this._lastStateSentAt = now;

    this._sendRaw({
      type: 'player_state',
      state: {
        name: String(player.name || this._lastProfile?.name || 'Player').slice(0, 16),
        x: Number(player.x.toFixed(2)),
        y: Number((player.y || 0).toFixed(2)),
        z: Number(player.z.toFixed(2)),
        vx: Number((player.vx || 0).toFixed(2)),
        vy: Number((player.vy || 0).toFixed(2)),
        vz: Number((player.vz || 0).toFixed(2)),
        angle: Number((player.angle || 0).toFixed(3)),
        speed: Number((player.speed || 0).toFixed(2)),
        drifting: Boolean(player.drifting),
        scale: Number((player.scale || 1).toFixed(2)),
        hp: Math.round(player.hp ?? 100),
        maxHp: Math.round(player.maxHp ?? 100),
        alive: player.alive !== false,
        survivalTime: Number((player.survivalTime || 0).toFixed(2)),
        stars: player.stars || 1,
        score: Math.round(player.score || 0),
        copsWrecked: player.copsWrecked || 0,
        playerRole: player.playerRole || this._lastProfile?.playerRole || 'runner',
        copVehicleId: player.copVehicleId || this._lastProfile?.copVehicleId || 'cop_heli',
        flying: Boolean(player.flying),
        groundY: Number((player.groundY || 0).toFixed(2)),
        turretAngle: Number((player.turretAngle || player.angle || 0).toFixed(3)),
        copMissileCooldown: Number((player.copMissileCooldown || 0).toFixed(2)),
        characterMode: player.characterMode,
        vehicleId: player.vehicleId,
        primaryColor: player.primaryColor,
        accentColor: player.accentColor,
        avatarId: player.avatarId,
        activeBuffs: player.activeBuffs || null,
      },
    });
  }

  sendAbilityEvent(abilityEvent) {
    if (!this.roomCode || !abilityEvent) return;
    this._sendRaw({ type: 'ability_event', event: abilityEvent });
  }

  sendPvpBump(bump) {
    if (!this.roomCode || !bump) return;
    this._sendRaw({ type: 'pvp_bump', ...bump });
  }

  syncHostSound(slot, dataUrl, label = '') {
    if (!this.roomCode || !this.isHost) return;
    if (!VALID_CLOUD_SOUND_SLOTS.has(slot)) return;
    this._sendRaw({
      type: 'sound_sync',
      slot,
      dataUrl: dataUrl || null,
      label: typeof label === 'string' ? label.slice(0, 32) : '',
    });
  }

  clearAllHostSounds() {
    if (!this.roomCode || !this.isHost) return;
    this._sendRaw({ type: 'sound_sync_clear' });
  }

  sendHornEvent(payload = {}) {
    if (!this.roomCode) return;
    this._sendRaw({
      type: 'horn_event',
      x: Number.isFinite(Number(payload?.x)) ? Number(payload.x) : 0,
      z: Number.isFinite(Number(payload?.z)) ? Number(payload.z) : 0,
    });
  }

  sendPlayerEliminated(reason, killerName = null, survivalTime = 0, score = 0, copsWrecked = 0, killerId = null) {
    if (!this.roomCode) return;
    this._sendRaw({
      type: 'player_eliminated',
      reason,
      killerName,
      killerId,
      survivalTime,
      score,
      copsWrecked,
    });
  }

  returnToLobby() {
    if (!this.roomCode) return;
    this._sendRaw({ type: 'return_to_lobby' });
  }
}
