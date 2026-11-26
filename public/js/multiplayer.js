// ISO/IEC 18004 Standards-Compliant QR Code SVG Generator + Real-Time WebSocket Party Client

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
// 2. Real-Time Phone/Desktop Party Multiplayer Client
// ============================================================================

export class MultiplayerClient {
  constructor(options = {}) {
    this.wsUrl = options.wsUrl || null;
    this.ws = null;
    this.connected = false;
    this.playerId = null;
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

    // Optional direct callback hooks in constructor options
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

  async fetchNetworkInfo(baseHttpUrl = '') {
    try {
      const res = await fetch(`${baseHttpUrl}/api/network-info`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.networkInfo = await res.json();
      this._emit('network_info', this.networkInfo);
      return this.networkInfo;
    } catch {
      const fallbackOrigin =
        typeof window !== 'undefined' && window.location?.origin
          ? window.location.origin
          : 'http://localhost:4567';
      this.networkInfo = {
        port: 4567,
        hostname: 'localhost',
        lanIps: [],
        shareBaseUrl: fallbackOrigin,
        urls: [fallbackOrigin],
      };
      return this.networkInfo;
    }
  }

  getShareUrl(roomCode = this.roomCode) {
    const base =
      this.networkInfo?.shareBaseUrl ||
      (typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost:4567');
    const cleanBase = base.replace(/\/+$/, '');
    return roomCode ? `${cleanBase}/?room=${encodeURIComponent(roomCode)}` : `${cleanBase}/`;
  }

  getQrCodeSvg(roomCode = this.roomCode, options = {}) {
    return renderQrCodeSvg(this.getShareUrl(roomCode), options);
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

  connect(explicitUrl) {
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

        // Rejoin active room seamlessly if reconnected mid-lobby
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
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this.remoteSnapshots.clear();
    this.roomCode = null;
    this.roomState = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.connected = false;
  }

  _sendRaw(obj) {
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

  _handleServerMessage(msg) {
    if (!msg || typeof msg !== 'object') return;

    switch (msg.type) {
      case 'welcome': {
        this.playerId = msg.playerId;
        this._emit('welcome', msg);
        break;
      }

      case 'room_joined': {
        this.roomCode = msg.code || msg.roomCode;
        this.playerId = msg.playerId || this.playerId;
        this.isHost = Boolean(msg.isHost);
        if (msg.room) this.roomState = msg.room;
        this._emit('room_joined', msg);
        break;
      }

      case 'room_state': {
        this.roomCode = msg.code || msg.roomCode || this.roomCode;
        this.roomState = msg;
        this.isHost = Boolean(this.playerId && msg.hostId === this.playerId);

        const activeIds = new Set((msg.players || []).map((p) => p.id));
        for (const id of this.remoteSnapshots.keys()) {
          if (!activeIds.has(id)) this.remoteSnapshots.delete(id);
        }

        this._emit('room_state', msg);
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

      case 'match_countdown': {
        this.remoteSnapshots.clear();
        this._emit('match_countdown', msg);
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
    let bucket = this.remoteSnapshots.get(playerId);
    if (!bucket) {
      bucket = { history: [], latest: state };
      this.remoteSnapshots.set(playerId, bucket);
    }
    bucket.latest = state;
    bucket.history.push({ t: now, state });
    if (bucket.history.length > 8) {
      bucket.history.shift();
    }
  }

  getInterpolatedRemotePlayers(nowMs) {
    const now = nowMs ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const renderTime = now - 75; // 75ms buffer smooths 20Hz Wi-Fi jitter cleanly
    const results = [];

    for (const [id, bucket] of this.remoteSnapshots.entries()) {
      if (id === this.playerId) continue;
      const hist = bucket.history;
      if (hist.length === 0) continue;

      if (hist.length === 1 || renderTime >= hist[hist.length - 1].t) {
        const last = hist[hist.length - 1];
        const extrapSec = Math.min(0.12, Math.max(0, (renderTime - last.t) / 1000));
        results.push({
          ...last.state,
          x: last.state.x + (last.state.vx || 0) * extrapSec,
          z: last.state.z + (last.state.vz || 0) * extrapSec,
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

      results.push({
        ...b.state,
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
    this._sendRaw({ type: 'create_room', profile, settings });
  }

  async joinRoom(code, profile = {}) {
    const cleanCode = String(code || '').trim().toUpperCase();
    this._lastProfile = { ...profile };
    await this.connect();
    this._sendRaw({ type: 'join_room', code: cleanCode, profile });
  }

  leaveRoom() {
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

  // Publishes local player state capped to 20Hz (every 50ms) unless force=true
  sendPlayerState(player, force = false) {
    if (!player || !this.roomCode || !this.connected) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!force && now - this._lastStateSentAt < 50) return;
    this._lastStateSentAt = now;

    this._sendRaw({
      type: 'player_state',
      state: {
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

  sendPlayerEliminated(reason, killerName = null, survivalTime = 0, score = 0, copsWrecked = 0) {
    if (!this.roomCode) return;
    this._sendRaw({
      type: 'player_eliminated',
      reason,
      killerName,
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
