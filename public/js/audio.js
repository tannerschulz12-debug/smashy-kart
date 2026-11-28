// Zero-Asset Web Audio Arcade Synthesizer + IndexedDB Custom Voice/Sound Studio
export const SOUND_SLOTS = ['boost', 'crash', 'item', 'horn', 'busted'];

const DB_NAME = 'smashy_kart_sounds_v1';
const STORE_NAME = 'sounds';
const MAX_CUSTOM_SECONDS = 5.0;
const SAFE_AUDIO_DATA_URL_RE = /^data:audio\/(?:wav|mpeg|mp3|ogg|webm|mp4);base64,[A-Za-z0-9+/=]+$/;
const MAX_LOBBY_AUDIO_DATA_URL_CHARS = 190000;
const MAX_NETWORK_AUDIO_BYTES = 138 * 1024;

function arrayBufferToBase64(ab) {
  const bytes = new Uint8Array(ab);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

function dataUrlToArrayBuffer(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return null;
  const b64 = dataUrl.slice(commaIdx + 1);
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function tryDecodeMonoPcm16WavBuffer(ab) {
  if (!ab || ab.byteLength <= 44) return null;
  const view = new DataView(ab);
  // RIFF....WAVE, PCM=1, mono=1, 16-bit
  if (
    view.getUint32(0, false) !== 0x52494646 ||
    view.getUint32(8, false) !== 0x57415645 ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint16(34, true) !== 16
  ) {
    return null;
  }
  const srcRate = view.getUint32(24, true);
  if (!srcRate || srcRate < 4000 || srcRate > 192000) return null;
  const dataBytes = Math.min(view.getUint32(40, true), ab.byteLength - 44);
  const numSamples = Math.floor(dataBytes / 2);
  if (numSamples <= 0) return null;
  const floatSamples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const s = view.getInt16(44 + i * 2, true);
    floatSamples[i] = s < 0 ? s / 0x8000 : s / 0x7fff;
  }
  return {
    sampleRate: srcRate,
    numberOfChannels: 1,
    length: numSamples,
    duration: numSamples / srcRate,
    getChannelData: () => floatSamples,
  };
}

const STAR_MELODY_HZ = [
  523.25, 659.25, 783.99, 880.0, 1046.5, 880.0, 783.99, 659.25,
  587.33, 739.99, 880.0, 987.77, 1174.66, 987.77, 880.0, 739.99,
];

function encodeMonoWavBlob(samples, sampleRate) {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function downsampleAndNormalize(audioBuffer, targetRate = 22050, maxDuration = MAX_CUSTOM_SECONDS) {
  const srcRate = audioBuffer.sampleRate || 44100;
  const channels = audioBuffer.numberOfChannels || 1;
  const maxSrcSamples = Math.min(audioBuffer.length, Math.floor(srcRate * maxDuration));
  const mono = new Float32Array(maxSrcSamples);

  for (let ch = 0; ch < channels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    for (let i = 0; i < maxSrcSamples; i++) {
      mono[i] += data[i] / channels;
    }
  }

  // Trim quiet leading/trailing dead air lightly while keeping at least 0.18s
  let start = 0;
  let end = maxSrcSamples - 1;
  const threshold = 0.012;
  while (start < maxSrcSamples - 1 && Math.abs(mono[start]) < threshold) start++;
  while (end > start && Math.abs(mono[end]) < threshold) end--;
  start = Math.max(0, start - Math.floor(srcRate * 0.03));
  end = Math.min(maxSrcSamples - 1, end + Math.floor(srcRate * 0.05));
  if (end - start < Math.floor(srcRate * 0.15)) {
    start = 0;
    end = maxSrcSamples - 1;
  }

  const trimmedLen = Math.max(1, end - start + 1);
  const ratio = srcRate / targetRate;
  const outLen = Math.max(1, Math.floor(trimmedLen / ratio));
  const out = new Float32Array(outLen);

  let peak = 0.001;
  for (let i = 0; i < outLen; i++) {
    const srcIdx = start + Math.min(trimmedLen - 1, Math.floor(i * ratio));
    const v = mono[srcIdx];
    out[i] = v;
    const abs = Math.abs(v);
    if (abs > peak) peak = abs;
  }

  // Normalize so quiet voice clips cut cleanly through gameplay
  const gain = Math.min(4.0, 0.92 / peak);
  const fadeSamples = Math.min(Math.floor(targetRate * 0.015), Math.floor(outLen * 0.1));
  for (let i = 0; i < outLen; i++) {
    let env = 1.0;
    if (i < fadeSamples) env = i / Math.max(1, fadeSamples);
    else if (i > outLen - fadeSamples) env = (outLen - i) / Math.max(1, fadeSamples);
    out[i] = Math.max(-0.98, Math.min(0.98, out[i] * gain * env));
  }

  return { samples: out, sampleRate: targetRate, duration: outLen / targetRate };
}

export class SoundManager {
  constructor(initialVolume = 0.85) {
    const initVol = Number(initialVolume);
    this.volume = Number.isFinite(initVol) ? Math.max(0, Math.min(1, initVol)) : 0.85;
    this.engineVolume = 0.85;
    this.actionVolume = 1.0;
    this.ctx = null;
    this.masterGain = null;
    this.engineBus = null;
    this.actionBus = null;
    this.noiseBuffer = null;
    this.loops = null;

    this.customRecords = new Map(); // slot -> { slot, blob, buffer, duration, label, updatedAt }
    this.lobbyRecords = new Map();  // slot -> { slot, dataUrl, buffer, label }
    this.lobbyOverrideEnabled = false;
    this.lobbyHostName = '';
    this._dbPromise = null;
    this._rouletteStep = 0;
    this._starStep = 0;
    this._starAccum = 0;
    this._lastCustomCrashAt = 0;
    this._lastSmashAt = 0;

    // Mic recording state
    this._mediaStream = null;
    this._mediaRecorder = null;
    this._recordedChunks = [];
    this._recordingPromise = null;
    this._autoStopTimer = null;

    // Kick off non-blocking IndexedDB load if running in browser
    if (typeof indexedDB !== 'undefined') {
      this._loadAllFromDb().catch(() => {});
    }
  }

  async init() {
    if (typeof indexedDB !== 'undefined') {
      await this._loadAllFromDb().catch(() => {});
    }
    return this.getSavedSlotsSummary();
  }

  _openDb() {
    if (typeof indexedDB === 'undefined') return Promise.resolve(null);
    if (this._dbPromise) return this._dbPromise;
    this._dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'slot' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this._dbPromise;
  }

  async _loadAllFromDb() {
    const db = await this._openDb();
    if (!db) return;
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    for (const rec of records) {
      if (!rec || !SOUND_SLOTS.includes(rec.slot) || !rec.blob) continue;
      this.customRecords.set(rec.slot, {
        slot: rec.slot,
        blob: rec.blob,
        buffer: null,
        duration: rec.duration || 1.0,
        label: rec.label || 'Custom Sound',
        updatedAt: rec.updatedAt || Date.now(),
      });
    }
    if (this.ctx) {
      await this._decodePendingRecords();
    }
  }

  async _decodePendingRecords() {
    if (!this.ctx) return;
    for (const rec of this.customRecords.values()) {
      if (!rec.buffer && rec.blob) {
        try {
          const ab = await rec.blob.arrayBuffer();
          rec.buffer = await this.ctx.decodeAudioData(ab.slice(0));
        } catch {
          // Ignore corrupt custom audio entry without breaking synth
        }
      }
    }
    for (const rec of this.lobbyRecords.values()) {
      if (!rec.buffer && rec.dataUrl) {
        try {
          const ab = dataUrlToArrayBuffer(rec.dataUrl);
          if (ab) {
            const decoded = await this.ctx.decodeAudioData(ab.slice(0));
            if (this.lobbyRecords.get(rec.slot) === rec) {
              rec.buffer = decoded;
            }
          }
        } catch {
          // Ignore corrupt lobby audio entry without breaking synth
        }
      }
    }
  }

  _ensureContext() {
    if (this.ctx) return this.ctx;
    const AudioCtx =
      typeof globalThis !== 'undefined'
        ? globalThis.AudioContext || globalThis.webkitAudioContext
        : null;
    if (!AudioCtx) return null;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.volume;
    this.masterGain.connect(ctx.destination);

    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = this.engineVolume;
    this.engineBus.connect(this.masterGain);

    this.actionBus = ctx.createGain();
    this.actionBus.gain.value = this.actionVolume;
    this.actionBus.connect(this.masterGain);

    // Build shared 1.5s white noise buffer for screeches, crashes, explosions & splashes
    const noiseLen = Math.floor(ctx.sampleRate * 1.5);
    const nb = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const data = nb.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = nb;

    this._initLoops(ctx);
    this._decodePendingRecords().catch(() => {});
    return ctx;
  }

  _initLoops(ctx) {
    // 1. Warm dual-oscillator engine rumble
    const engOsc1 = ctx.createOscillator();
    const engOsc2 = ctx.createOscillator();
    engOsc1.type = 'sawtooth';
    engOsc2.type = 'triangle';
    engOsc1.frequency.value = 54;
    engOsc2.frequency.value = 108;

    const engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 260;
    engFilter.Q.value = 2.2;

    const engGain = ctx.createGain();
    engGain.gain.value = 0.0;

    engOsc1.connect(engFilter);
    engOsc2.connect(engFilter);
    engFilter.connect(engGain);
    engGain.connect(this.engineBus || this.masterGain);
    engOsc1.start();
    engOsc2.start();

    // 2. Drift tire screech (bandpass-filtered noise)
    const screechSrc = ctx.createBufferSource();
    screechSrc.buffer = this.noiseBuffer;
    screechSrc.loop = true;

    const screechFilter = ctx.createBiquadFilter();
    screechFilter.type = 'bandpass';
    screechFilter.frequency.value = 1420;
    screechFilter.Q.value = 6.5;

    const screechGain = ctx.createGain();
    screechGain.gain.value = 0.0;

    screechSrc.connect(screechFilter);
    screechFilter.connect(screechGain);
    screechGain.connect(this.engineBus || this.masterGain);
    screechSrc.start();

    // 3. Dual-tone police siren wail
    const sirenOsc = ctx.createOscillator();
    sirenOsc.type = 'triangle';
    sirenOsc.frequency.value = 720;

    const sirenLfo = ctx.createOscillator();
    sirenLfo.type = 'sine';
    sirenLfo.frequency.value = 1.6;
    const sirenLfoDepth = ctx.createGain();
    sirenLfoDepth.gain.value = 165;
    sirenLfo.connect(sirenLfoDepth);
    sirenLfoDepth.connect(sirenOsc.frequency);

    const sirenGain = ctx.createGain();
    sirenGain.gain.value = 0.0;
    sirenOsc.connect(sirenGain);
    sirenGain.connect(this.actionBus || this.masterGain);
    sirenOsc.start();
    sirenLfo.start();

    this.loops = {
      engOsc1,
      engOsc2,
      engFilter,
      engGain,
      screechFilter,
      screechGain,
      sirenOsc,
      sirenLfo,
      sirenGain,
    };
  }

  unlock() {
    const ctx = this._ensureContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    this._decodePendingRecords().catch(() => {});
    return true;
  }

  setVolume(v) {
    const n = Number(v);
    this.volume = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.85;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.03);
    }
  }

  setChannelVolumes({ engine = 0.85, action = 1.0 } = {}) {
    const engNum = Number(engine);
    const actNum = Number(action);
    this.engineVolume = Number.isFinite(engNum) ? Math.max(0, Math.min(1.5, engNum)) : 0.85;
    this.actionVolume = Number.isFinite(actNum) ? Math.max(0, Math.min(1.5, actNum)) : 1.0;
    if (this.ctx) {
      const now = this.ctx.currentTime;
      if (this.engineBus) {
        this.engineBus.gain.setTargetAtTime(this.engineVolume, now, 0.03);
      }
      if (this.actionBus) {
        this.actionBus.gain.setTargetAtTime(this.actionVolume, now, 0.03);
      }
    }
  }

  updateLoopSounds(speedRatio = 0, drifting = false, wantedStars = 1, starActive = false, paused = false) {
    const ctx = this.ctx;
    if (!ctx || !this.loops || ctx.state !== 'running') return;
    const now = ctx.currentTime;

    if (paused) {
      this.loops.engGain.gain.setTargetAtTime(0, now, 0.04);
      this.loops.screechGain.gain.setTargetAtTime(0, now, 0.04);
      this.loops.sirenGain.gain.setTargetAtTime(0, now, 0.04);
      return;
    }

    const clampedSpeed = Math.max(0, Math.min(1.6, Number(speedRatio) || 0));
    const baseHz = 50 + clampedSpeed * 98;
    this.loops.engOsc1.frequency.setTargetAtTime(baseHz, now, 0.05);
    this.loops.engOsc2.frequency.setTargetAtTime(baseHz * 1.98, now, 0.05);
    this.loops.engFilter.frequency.setTargetAtTime(220 + clampedSpeed * 540, now, 0.06);
    this.loops.engGain.gain.setTargetAtTime(0.055 + Math.min(0.085, clampedSpeed * 0.065), now, 0.06);

    const targetScreech = drifting ? 0.075 : 0.0;
    this.loops.screechFilter.frequency.setTargetAtTime(1280 + Math.sin(now * 23) * 140, now, 0.03);
    this.loops.screechGain.gain.setTargetAtTime(targetScreech, now, 0.04);

    const stars = Math.max(0, Math.min(5, Number(wantedStars) || 0));
    const targetSiren = stars >= 1 && !starActive ? 0.022 + stars * 0.008 : 0.0;
    this.loops.sirenLfo.frequency.setTargetAtTime(1.3 + stars * 0.38, now, 0.08);
    this.loops.sirenGain.gain.setTargetAtTime(targetSiren, now, 0.08);

    // Upbeat Star Power arpeggiated melody
    if (starActive) {
      this._starAccum += 0.016;
      if (this._starAccum >= 0.095) {
        this._starAccum = 0;
        const freq = STAR_MELODY_HZ[this._starStep % STAR_MELODY_HZ.length];
        this._starStep++;
        this._playTone(freq, 0.085, 'square', 0.09, freq * 1.005);
      }
    } else {
      this._starAccum = 0;
    }
  }

  _playCustomSlotBuffer(slot, gainScale = 1.0, bypassActionBus = false) {
    const rec = this.lobbyOverrideEnabled
      ? this.lobbyRecords.get(slot)
      : this.customRecords.get(slot);
    if (!rec || !rec.buffer) return false;
    const ctx = this._ensureContext();
    if (!ctx) return false;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const src = ctx.createBufferSource();
    src.buffer = rec.buffer;
    const g = ctx.createGain();
    g.gain.value = Math.min(1.35, 0.95 * gainScale);
    src.connect(g);
    g.connect(bypassActionBus ? this.masterGain : (this.actionBus || this.masterGain));
    src.start();
    return true;
  }

  _playTone(startHz, duration, type = 'triangle', peakGain = 0.16, endHz = null, delay = 0) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startHz, t0);
    if (endHz !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, endHz), t0 + duration);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peakGain, t0 + Math.min(0.015, duration * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(g);
    g.connect(this.actionBus || this.masterGain);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  _playNoiseBurst(duration, filterType = 'lowpass', freq = 800, q = 1.2, peakGain = 0.24, endFreq = null) {
    const ctx = this._ensureContext();
    if (!ctx || !this.noiseBuffer) return;
    const t0 = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, t0);
    filter.Q.value = q;
    if (endFreq !== null) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFreq), t0 + duration);
    }

    const g = ctx.createGain();
    g.gain.setValueAtTime(peakGain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    src.connect(filter);
    filter.connect(g);
    g.connect(this.actionBus || this.masterGain);
    src.start(t0);
    src.stop(t0 + duration + 0.02);
  }

  playEvent(eventName, intensity = 1.0) {
    const ctx = this._ensureContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    const scale = Math.max(0.25, Math.min(1.5, Number(intensity) || 1.0));
    const nowMs = Date.now();

    switch (eventName) {
      case 'boost':
      case 'triple_boost': {
        if (this._playCustomSlotBuffer('boost', scale)) return;
        this._playNoiseBurst(0.36, 'bandpass', 420, 1.8, 0.22 * scale, 1850);
        this._playTone(220, 0.34, 'sawtooth', 0.16 * scale, 680);
        this._playTone(330, 0.28, 'triangle', 0.12 * scale, 990, 0.04);
        break;
      }

      case 'crash':
      case 'cop_wrecked':
      case 'wrecked':
      case 'pvp_slam':
      case 'smash': {
        if (eventName === 'smash' && nowMs - this._lastSmashAt < 45) return;
        this._lastSmashAt = nowMs;

        const isBigCrash =
          eventName === 'crash' ||
          eventName === 'cop_wrecked' ||
          eventName === 'wrecked' ||
          eventName === 'pvp_slam' ||
          scale >= 0.72;

        const hasActiveCrash = this.lobbyOverrideEnabled
          ? this.lobbyRecords.has('crash')
          : this.customRecords.has('crash');

        if (isBigCrash && hasActiveCrash && nowMs - this._lastCustomCrashAt > 220) {
          this._lastCustomCrashAt = nowMs;
          if (this._playCustomSlotBuffer('crash', scale)) {
            if (eventName === 'wrecked') {
              this._playNoiseBurst(0.55, 'lowpass', 520, 1.4, 0.24, 90);
            }
            return;
          }
        }

        this._playNoiseBurst(0.22 * scale, 'lowpass', 1100, 1.6, 0.25 * scale, 180);
        this._playTone(145, 0.16, 'sawtooth', 0.18 * scale, 52);
        if (eventName === 'cop_wrecked') {
          this._playTone(523.25, 0.09, 'square', 0.11, 783.99, 0.05);
        }
        break;
      }

      case 'explosion': {
        this._playNoiseBurst(0.68, 'lowpass', 680, 1.2, 0.36 * scale, 65);
        this._playTone(110, 0.48, 'sine', 0.32 * scale, 28);
        this._playTone(82, 0.38, 'sawtooth', 0.18 * scale, 32);
        break;
      }

      case 'pickup_box': {
        this._playTone(587.33, 0.08, 'triangle', 0.14, null, 0);
        this._playTone(783.99, 0.08, 'triangle', 0.14, null, 0.055);
        this._playTone(1174.66, 0.14, 'triangle', 0.16, null, 0.11);
        break;
      }

      case 'roulette_tick': {
        const notes = [659.25, 783.99, 880.0, 987.77];
        const hz = notes[this._rouletteStep++ % notes.length];
        this._playTone(hz, 0.045, 'square', 0.085);
        break;
      }

      case 'roulette_lock': {
        const chord = [523.25, 659.25, 783.99, 1046.5];
        for (let i = 0; i < chord.length; i++) {
          this._playTone(chord[i], 0.24, 'triangle', 0.12, null, i * 0.035);
        }
        break;
      }

      case 'item':
      case 'item_used': {
        if (this._playCustomSlotBuffer('item', scale)) return;
        this._playTone(440, 0.1, 'square', 0.12 * scale, 660, 0);
        this._playTone(660, 0.18, 'square', 0.14 * scale, 1046.5, 0.07);
        break;
      }

      case 'horn':
      case 'super_horn': {
        const isSuper = eventName === 'super_horn' || scale > 1.15;
        if (this._playCustomSlotBuffer('horn', scale)) {
          if (isSuper) {
            this._playTone(140, 0.38, 'sawtooth', 0.24, 42);
          }
          return;
        }
        if (isSuper) {
          this._playNoiseBurst(0.42, 'bandpass', 620, 2.0, 0.28, 140);
          this._playTone(349.23, 0.36, 'sawtooth', 0.2, 174.61);
          this._playTone(440.0, 0.36, 'sawtooth', 0.2, 220.0);
        } else {
          this._playTone(349.23, 0.24, 'sawtooth', 0.14 * scale);
          this._playTone(440.0, 0.24, 'sawtooth', 0.14 * scale);
        }
        break;
      }

      case 'busted': {
        if (this._playCustomSlotBuffer('busted', scale)) return;
        // Classic police chirp + descending wah-wah-waaaah busted brass
        this._playTone(880, 0.09, 'sawtooth', 0.16, 1320, 0);
        this._playTone(392.0, 0.22, 'sawtooth', 0.18, 370.0, 0.12);
        this._playTone(369.99, 0.22, 'sawtooth', 0.18, 349.23, 0.36);
        this._playTone(349.23, 0.52, 'sawtooth', 0.2, 246.94, 0.6);
        break;
      }

      case 'water_splash': {
        this._playNoiseBurst(0.52, 'bandpass', 720, 2.4, 0.28, 220);
        this._playTone(280, 0.22, 'sine', 0.16, 95);
        this._playTone(420, 0.16, 'sine', 0.12, 620, 0.12);
        break;
      }

      case 'star_up': {
        this._playTone(783.99, 0.1, 'square', 0.12, null, 0);
        this._playTone(1046.5, 0.18, 'square', 0.14, null, 0.11);
        break;
      }

      case 'stunt_land': {
        this._playTone(523.25, 0.08, 'triangle', 0.13, null, 0);
        this._playTone(659.25, 0.08, 'triangle', 0.13, null, 0.06);
        this._playTone(783.99, 0.08, 'triangle', 0.13, null, 0.12);
        this._playTone(1046.5, 0.18, 'triangle', 0.15, null, 0.18);
        break;
      }

      default:
        break;
    }
  }

  async startMicRecording(onAutoStop) {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        'Live mic requires HTTPS or localhost. On phone Wi-Fi, tap "Upload Voice / Camera Clip" to record with your phone camera/mic!'
      );
    }
    this.unlock();
    this._cleanupActiveRecorder();

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    this._mediaStream = stream;
    this._recordedChunks = [];

    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    let mimeType = '';
    if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
      mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m)) || '';
    }

    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    this._mediaRecorder = recorder;

    this._recordingPromise = new Promise((resolve, reject) => {
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) this._recordedChunks.push(ev.data);
      };
      recorder.onerror = (ev) => reject(ev.error || new Error('Microphone recording failed'));
      recorder.onstop = () => {
        const blobType = recorder.mimeType || mimeType || 'audio/webm';
        const rawBlob = new Blob(this._recordedChunks, { type: blobType });
        this._stopStreamTracks();
        resolve(rawBlob);
      };
    });

    recorder.start(100);
    this._autoStopTimer = setTimeout(() => {
      if (this._mediaRecorder && this._mediaRecorder.state === 'recording') {
        if (typeof onAutoStop === 'function') {
          onAutoStop();
        } else {
          this._mediaRecorder.stop();
        }
      }
    }, MAX_CUSTOM_SECONDS * 1000);

    return true;
  }

  _stopStreamTracks() {
    if (this._mediaStream) {
      for (const track of this._mediaStream.getTracks()) {
        track.stop();
      }
      this._mediaStream = null;
    }
  }

  _cleanupActiveRecorder() {
    if (this._autoStopTimer) {
      clearTimeout(this._autoStopTimer);
      this._autoStopTimer = null;
    }
    if (this._mediaRecorder && this._mediaRecorder.state === 'recording') {
      try {
        this._mediaRecorder.stop();
      } catch {
        // ignore
      }
    }
    this._stopStreamTracks();
  }

  async stopMicRecording(slot) {
    if (!SOUND_SLOTS.includes(slot)) {
      throw new Error(`Invalid sound slot: ${slot}`);
    }
    if (!this._recordingPromise) {
      throw new Error('No active microphone recording');
    }
    if (this._autoStopTimer) {
      clearTimeout(this._autoStopTimer);
      this._autoStopTimer = null;
    }
    if (this._mediaRecorder && this._mediaRecorder.state === 'recording') {
      this._mediaRecorder.stop();
    }
    const rawBlob = await this._recordingPromise;
    this._recordingPromise = null;
    this._mediaRecorder = null;

    return this._processAndStoreAudioBlob(slot, rawBlob, 'Mic Voice Clip');
  }

  async uploadAudioFile(slot, file) {
    if (!SOUND_SLOTS.includes(slot)) {
      throw new Error(`Invalid sound slot: ${slot}`);
    }
    if (!file) {
      throw new Error('No audio or video file provided');
    }
    const label = (file.name || 'Uploaded Clip').slice(0, 32);
    return this._processAndStoreAudioBlob(slot, file, label);
  }

  async _processAndStoreAudioBlob(slot, blobOrFile, label) {
    const ctx = this._ensureContext();
    if (!ctx) {
      throw new Error('Web Audio API is unavailable in this browser');
    }
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    const arrayBuffer = await blobOrFile.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    const { samples, sampleRate, duration } = downsampleAndNormalize(decoded, 22050, MAX_CUSTOM_SECONDS);
    const wavBlob = encodeMonoWavBlob(samples, sampleRate);

    const compactBuffer = ctx.createBuffer(1, samples.length, sampleRate);
    compactBuffer.getChannelData(0).set(samples);

    const record = {
      slot,
      blob: wavBlob,
      buffer: compactBuffer,
      duration: Number(duration.toFixed(2)),
      label,
      updatedAt: Date.now(),
    };
    this.customRecords.set(slot, record);

    const db = await this._openDb();
    if (db) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({
          slot: record.slot,
          blob: record.blob,
          duration: record.duration,
          label: record.label,
          updatedAt: record.updatedAt,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }

    return {
      slot,
      hasCustom: true,
      duration: record.duration,
      label: record.label,
      updatedAt: record.updatedAt,
    };
  }

  hasCustomSound(slot) {
    return this.customRecords.has(slot);
  }

  async exportSlotForNetwork(slot, { maxDuration = 3.2, sampleRate = 11025 } = {}) {
    if (!SOUND_SLOTS.includes(slot)) return null;
    const rec = this.customRecords.get(slot);
    if (!rec) return null;

    let targetBlob = rec.blob || null;
    let outDuration = rec.duration || rec.buffer?.duration || 1.0;

    if (
      rec.buffer &&
      (rec.buffer.sampleRate > sampleRate ||
        rec.buffer.duration > maxDuration ||
        !targetBlob ||
        targetBlob.size > MAX_NETWORK_AUDIO_BYTES)
    ) {
      const ds = downsampleAndNormalize(rec.buffer, sampleRate, maxDuration);
      targetBlob = encodeMonoWavBlob(ds.samples, ds.sampleRate);
      outDuration = Number(ds.duration.toFixed(2));
    }

    if (!targetBlob) return null;
    let ab = await targetBlob.arrayBuffer();

    // If blob came from IndexedDB before AudioContext unlocked and exceeds network cap, downsample PCM WAV directly
    if (ab.byteLength > MAX_NETWORK_AUDIO_BYTES) {
      const parsed = tryDecodeMonoPcm16WavBuffer(ab);
      if (parsed) {
        const ds = downsampleAndNormalize(parsed, sampleRate, maxDuration);
        targetBlob = encodeMonoWavBlob(ds.samples, ds.sampleRate);
        outDuration = Number(ds.duration.toFixed(2));
        ab = await targetBlob.arrayBuffer();
      }
    }

    // Final safety downstep if still slightly over 140 KB
    if (ab.byteLength > MAX_NETWORK_AUDIO_BYTES) {
      const srcBuf = rec.buffer || tryDecodeMonoPcm16WavBuffer(ab);
      if (srcBuf) {
        const ds = downsampleAndNormalize(srcBuf, Math.min(sampleRate, 8000), Math.min(maxDuration, 2.8));
        targetBlob = encodeMonoWavBlob(ds.samples, ds.sampleRate);
        outDuration = Number(ds.duration.toFixed(2));
        ab = await targetBlob.arrayBuffer();
      }
    }

    if (ab.byteLength > MAX_NETWORK_AUDIO_BYTES) return null;

    const rawMime = typeof targetBlob.type === 'string' ? targetBlob.type.split(';')[0].trim().toLowerCase() : '';
    const mime = /^audio\/(?:wav|mpeg|mp3|ogg|webm|mp4)$/.test(rawMime) ? rawMime : 'audio/wav';
    const dataUrl = `data:${mime};base64,${arrayBufferToBase64(ab)}`;
    if (dataUrl.length > MAX_LOBBY_AUDIO_DATA_URL_CHARS || !SAFE_AUDIO_DATA_URL_RE.test(dataUrl)) {
      return null;
    }

    return {
      slot,
      dataUrl,
      duration: Number(outDuration) || 1.0,
      label: String(rec.label || 'Host Sound').slice(0, 32),
    };
  }

  async exportAllCustomSoundsForNetwork() {
    const exported = [];
    for (const slot of SOUND_SLOTS) {
      const item = await this.exportSlotForNetwork(slot);
      if (item) exported.push(item);
    }
    return exported;
  }

  async setLobbySound(slot, dataUrl, label = 'Host Sound') {
    if (!SOUND_SLOTS.includes(slot)) return false;
    if (!dataUrl) {
      this.lobbyRecords.delete(slot);
      return true;
    }
    if (
      typeof dataUrl !== 'string' ||
      dataUrl.length > MAX_LOBBY_AUDIO_DATA_URL_CHARS ||
      !SAFE_AUDIO_DATA_URL_RE.test(dataUrl)
    ) {
      return false;
    }
    const cleanLabel = String(label || 'Host Sound').trim().slice(0, 32) || 'Host Sound';
    const record = {
      slot,
      dataUrl,
      buffer: null,
      label: cleanLabel,
    };
    this.lobbyRecords.set(slot, record);

    if (this.ctx) {
      try {
        const ab = dataUrlToArrayBuffer(dataUrl);
        if (ab) {
          const decoded = await this.ctx.decodeAudioData(ab.slice(0));
          if (this.lobbyRecords.get(slot) === record) {
            record.buffer = decoded;
          }
        }
      } catch {
        // Ignore corrupt lobby audio entry without breaking synth
      }
    }
    return true;
  }

  setLobbyOverride(enabled, hostName = '') {
    this.lobbyOverrideEnabled = Boolean(enabled);
    this.lobbyHostName = String(hostName || '').trim().slice(0, 24);
  }

  clearLobbySounds() {
    this.lobbyRecords.clear();
    this.lobbyOverrideEnabled = false;
    this.lobbyHostName = '';
  }

  getLobbySoundCount() {
    return this.lobbyRecords.size;
  }

  previewSlot(slot) {
    this.unlock();
    if (!SOUND_SLOTS.includes(slot)) return;
    if (this._playCustomSlotBuffer(slot, 1.0, this.actionVolume <= 0.02)) return;
    const prevAction = this.actionVolume;
    if (prevAction <= 0.02) {
      this.setChannelVolumes({ engine: this.engineVolume, action: 0.85 });
      this.playEvent(slot, 1.0);
      setTimeout(() => this.setChannelVolumes({ engine: this.engineVolume, action: prevAction }), 400);
      return;
    }
    this.playEvent(slot, 1.0);
  }

  async clearCustomSound(slot) {
    this.customRecords.delete(slot);
    const db = await this._openDb();
    if (db) {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(slot);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
    return true;
  }

  getSavedSlotsSummary() {
    const summary = {};
    for (const slot of SOUND_SLOTS) {
      const rec = this.customRecords.get(slot);
      summary[slot] = rec
        ? {
            slot,
            hasCustom: true,
            saved: true,
            duration: rec.duration,
            label: rec.label,
            updatedAt: rec.updatedAt,
          }
        : {
            slot,
            hasCustom: false,
            saved: false,
            duration: 0,
            label: 'Built-in Arcade Synth',
            updatedAt: null,
          };
    }
    return summary;
  }
}
