// Master Game Controller — Menus, Garage, Photo Studio, Custom Audio, Claw HUD Editor, Keybinds & 16-Player Party
import {
  WORLD_CONFIG,
  VEHICLES,
  COP_VEHICLES,
  ABILITIES,
  BIOMES,
  CHARACTER_MODES,
  DEFAULT_KEYBINDS,
  HUD_LAYOUT_PRESETS,
  formatKeyCodeLabel,
  cloneHudLayout,
  cloneKeybinds,
  clampDropRatePct,
  createDefaultItemWeights,
  cloneItemWeights,
  sliderToDropPct,
  dropPctToSlider,
  computeAbilityDropOdds,
  createDefaultSettings,
} from './config.js';
import { World } from './world.js';
import { Renderer3D } from './renderer3d.js';
import { AbilitySystem } from './abilities.js';
import { Simulation } from './physics_ai.js';
import { SoundManager, SOUND_SLOTS } from './audio.js';
import { PhotoStudio } from './photo_studio.js';
import { MultiplayerClient } from './multiplayer.js';

const SETTINGS_STORAGE_KEY = 'smashy_kart_settings_v1';
const BEST_STORAGE_KEY = 'smashy_kart_best_v1';

const BIOME_SHORT_LABELS = {
  city: '🏙️ City',
  desert: '🌵 Desert',
  snow: '❄️ Snow',
};

const HUD_WIDGET_LABELS = {
  steerLeft: 'Steer Left (◀)',
  steerRight: 'Steer Right (▶)',
  joystick: 'Thumb Joystick',
  brake: 'Brake / Drift Pedal',
  gas: 'Manual Gas Pedal',
  useItem: 'Mystery Item Button',
  horn: 'Horn / Taunt Button',
};

const KEYBIND_ACTIONS = [
  { id: 'steerLeft', label: 'Steer Left', hint: 'Turn car left' },
  { id: 'steerRight', label: 'Steer Right', hint: 'Turn car right' },
  { id: 'brake', label: 'Brake / Drift', hint: 'Handbrake drift & reverse' },
  { id: 'gas', label: 'Manual Gas', hint: 'Used when Auto-Accelerate is off' },
  { id: 'useItem', label: 'Use Mystery Item', hint: 'Fire RPG, Star, Boost, Bomb' },
  { id: 'horn', label: 'Horn / Shockwave', hint: 'Honk custom voice or horn' },
  { id: 'cycleCamera', label: 'Switch Camera', hint: 'Smashy / Chase / Hood POV' },
  { id: 'pause', label: 'Pause / Settings', hint: 'Toggle in-game settings menu' },
];

const HUD_KEYCAP_MAP = [
  ['keycap-brake', 'brake'],
  ['keycap-useItem', 'useItem'],
  ['keycap-horn', 'horn'],
  ['keycap-steerLeft', 'steerLeft'],
  ['keycap-steerRight', 'steerRight'],
  ['keycap-gas', 'gas'],
  ['keycap-cam', 'cycleCamera'],
];

function clampNum(val, lo, hi, fallback) {
  const n = Number(val);
  if (val === null || val === undefined || val === '' || !Number.isFinite(n)) {
    return fallback;
  }
  return Math.max(lo, Math.min(hi, n));
}

function formatDropPctNumber(val) {
  const c = clampDropRatePct(val);
  const rounded1 = Math.round(c * 10) / 10;
  return Number.isInteger(rounded1) ? String(rounded1) : rounded1.toFixed(1);
}

function formatRollOddsLabel(oddsPct, enabled) {
  if (!enabled) return 'OFF';
  const v = Math.max(0, Number(oddsPct) || 0);
  if (v >= 99.995) return '100% roll';
  if (v <= 0) return '0% roll';
  if (v < 0.005) return '<0.01% roll';
  if (v < 1 || v > 99.9) return `${v.toFixed(2)}% roll`;
  return `${v.toFixed(1)}% roll`;
}

const PAINT_SWATCHES = [
  ['#ef4444', '#fef08a'],
  ['#f97316', '#1e293b'],
  ['#eab308', '#111827'],
  ['#22c55e', '#ffffff'],
  ['#06b6d4', '#fde047'],
  ['#3b82f6', '#f8fafc'],
  ['#a855f7', '#fbcfe8'],
  ['#ec4899', '#ffffff'],
  ['#f8fafc', '#ef4444'],
  ['#111827', '#facc15'],
];

const SOUND_SLOT_LABELS = {
  boost: { title: 'Turbo Boost / Star Scream', hint: 'Plays when hitting nitro or star power' },
  crash: { title: 'Big Smash / Explosion', hint: 'Plays on big crashes & cop takedowns' },
  item: { title: 'Fire Mario Kart Ability', hint: 'Plays when throwing shells, bombs, or zaps' },
  horn: { title: 'Custom Horn / Taunt', hint: 'Plays whenever you tap the horn button' },
  busted: { title: 'Busted / Wrecked Sound', hint: 'Plays when police arrest or wreck you' },
};

function loadSavedSettings() {
  const defaults = createDefaultSettings();
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    const validCam = ['smashy', 'chase', 'pov'].includes(parsed.cameraMode)
      ? parsed.cameraMode
      : defaults.cameraMode;
    const validGfx = ['high', 'balanced', 'performance'].includes(parsed.graphicsQuality)
      ? parsed.graphicsQuality
      : defaults.graphicsQuality;
    const validUnit = ['mph', 'kmh'].includes(parsed.speedUnit)
      ? parsed.speedUnit
      : defaults.speedUnit;
    const validTouch = ['split', 'buttons', 'joystick'].includes(parsed.touchStyle)
      ? parsed.touchStyle
      : defaults.touchStyle;
    const validHudPreset = ['thumbs', 'claw', 'lefty', 'custom'].includes(parsed.hudLayoutPreset)
      ? parsed.hudLayoutPreset
      : defaults.hudLayoutPreset;

    const baseHudLayout = cloneHudLayout(
      ['thumbs', 'claw', 'lefty'].includes(validHudPreset) ? validHudPreset : 'thumbs'
    );
    const mergedHudLayout = {};
    for (const [wid, defPos] of Object.entries(baseHudLayout)) {
      const savedPos = parsed.hudLayout?.[wid];
      if (savedPos && typeof savedPos === 'object') {
        mergedHudLayout[wid] = {
          xPct: clampNum(savedPos.xPct, 6, 94, defPos.xPct),
          yPct: clampNum(savedPos.yPct, 8, 93, defPos.yPct),
          scale: clampNum(savedPos.scale, 0.7, 1.6, defPos.scale),
          opacity: clampNum(savedPos.opacity, 0.4, 1.0, defPos.opacity),
        };
      } else {
        mergedHudLayout[wid] = { ...defPos };
      }
    }

    const rawKeybinds = cloneKeybinds(parsed.keybinds);
    const mergedKeybinds = {};
    for (const [act, defCodes] of Object.entries(DEFAULT_KEYBINDS)) {
      const clean = (rawKeybinds[act] || []).filter((c) => typeof c === 'string' && c.length > 0);
      mergedKeybinds[act] = clean.length > 0 ? clean : [...defCodes];
    }

    return {
      ...defaults,
      ...parsed,
      cameraMode: validCam,
      povFov: Math.round(clampNum(parsed.povFov, 62, 96, defaults.povFov)),
      cameraShakeMult: clampNum(parsed.cameraShakeMult, 0, 1.5, defaults.cameraShakeMult),
      graphicsQuality: validGfx,
      speedUnit: validUnit,
      touchStyle: validTouch,
      autoAccelerate: typeof parsed.autoAccelerate === 'boolean' ? parsed.autoAccelerate : defaults.autoAccelerate,
      invertSteer: Boolean(parsed.invertSteer),
      steerSensitivity: clampNum(parsed.steerSensitivity, 0.7, 1.4, defaults.steerSensitivity),
      steerDeadzone: clampNum(parsed.steerDeadzone, 0, 0.22, defaults.steerDeadzone),
      showTouchControlsDesktop: parsed.showTouchControlsDesktop !== false,
      showKeyHints: parsed.showKeyHints !== false,
      showSpeedometer: parsed.showSpeedometer !== false,
      showMinimap: parsed.showMinimap !== false,
      showFps: Boolean(parsed.showFps),
      showQuickCamBtn: parsed.showQuickCamBtn !== false,
      screenEffects: parsed.screenEffects !== false,
      haptics: parsed.haptics !== false,
      soundVolume: clampNum(parsed.soundVolume, 0, 1, defaults.soundVolume),
      sfxEngineVol: clampNum(parsed.sfxEngineVol, 0, 1, defaults.sfxEngineVol),
      sfxActionVol: clampNum(parsed.sfxActionVol, 0, 1, defaults.sfxActionVol),
      hudLayoutPreset: validHudPreset,
      hudLayout: mergedHudLayout,
      keybinds: mergedKeybinds,
      aiCopsEnabled: parsed.aiCopsEnabled !== false,
      playerRole: parsed.playerRole === 'cop' ? 'cop' : 'runner',
      copVehicleId: COP_VEHICLES.some((c) => c.id === parsed.copVehicleId)
        ? parsed.copVehicleId
        : (defaults.copVehicleId || 'cop_heli'),
      itemBoxDensity: Number(clampNum(parsed.itemBoxDensity, 0.1, 5.0, defaults.itemBoxDensity ?? 1.2).toFixed(2)),
      sugarBoxRate: Number(clampNum(parsed.sugarBoxRate, 0, 5.0, defaults.sugarBoxRate ?? 1.0).toFixed(2)),
      enabledItems: { ...defaults.enabledItems, ...(parsed.enabledItems || {}) },
      itemWeights: cloneItemWeights(parsed.itemWeights),
      lobbyRules: {
        ...defaults.lobbyRules,
        ...(parsed.lobbyRules || {}),
        allowPlayerCops: parsed.lobbyRules?.allowPlayerCops !== false,
        shareHostSounds: parsed.lobbyRules?.shareHostSounds !== false,
      },
    };
  } catch {
    return defaults;
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

function loadBestStats() {
  try {
    const raw = localStorage.getItem(BEST_STORAGE_KEY);
    if (!raw) return { bestTime: 0, bestScore: 0 };
    const parsed = JSON.parse(raw);
    return {
      bestTime: Number(parsed.bestTime) || 0,
      bestScore: Number(parsed.bestScore) || 0,
    };
  } catch {
    return { bestTime: 0, bestScore: 0 };
  }
}

function saveBestStats(best) {
  try {
    localStorage.setItem(BEST_STORAGE_KEY, JSON.stringify(best));
  } catch {
    // Ignore
  }
}

function formatClock(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const mins = Math.floor(s / 60);
  const rem = s - mins * 60;
  const whole = Math.floor(rem);
  const tenths = Math.floor((rem - whole) * 10);
  return `${mins}:${String(whole).padStart(2, '0')}.${tenths}`;
}

class SmashyKartApp {
  constructor() {
    this.settings = loadSavedSettings();
    this.best = loadBestStats();

    this.canvas = document.getElementById('game-canvas');
    this.renderer = new Renderer3D(this.canvas);
    this.renderer.setGraphicsQuality?.(this.settings.graphicsQuality || 'high');
    this.world = new World(this.settings.worldSeed, this.settings.biome, {
      itemBoxDensity: this.settings.itemBoxDensity,
      sugarBoxRate: this.settings.sugarBoxRate,
    });
    this.abilities = new AbilitySystem(this.settings);
    this.sim = new Simulation(this.world, this.abilities, this.settings);
    this.sound = new SoundManager(this.settings.soundVolume);
    this.sound.setChannelVolumes?.({
      engine: this.settings.sfxEngineVol ?? 0.85,
      action: this.settings.sfxActionVol ?? 1.0,
    });
    this.photos = new PhotoStudio();
    this.net = new MultiplayerClient();

    // App mode: 'attract' | 'countdown' | 'playing_solo' | 'playing_party' | 'spectating' | 'gameover'
    this.mode = 'attract';
    this.countdownLeft = 0;
    this.cameraShake = 0;
    this.spectateIndex = 0;
    this.isReadyInLobby = false;
    this.toastTimer = 0;
    this.eliminatedSent = false;
    this.partyStandings = [];
    this.remoteAvatarCache = new Map(); // playerId -> dataUrl
    this._wasHost = false;
    this._lobbyHostName = '';

    // PWA Install, HUD Layout Editor & Keybind Remapper state
    this.deferredInstallPrompt = null;
    this.editingHudLayout = false;
    this.selectedHudWidget = 'brake';
    this._hudEditorPrevScreen = null;
    this.listeningKeybind = null; // { action, slotIndex } | null
    this.activeSettingsTab = 'camera';

    // Input state
    this.keys = new Set();
    this.touchSteerLeft = false;
    this.touchSteerRight = false;
    this.touchBrake = false;
    this.touchGas = false;
    this.joystickPullBrake = false;
    this.touchUseItemQueued = false;
    this.touchHornQueued = false;
    this.joystickTouchId = null;
    this.joystickOrigin = { x: 0, y: 0 };
    this.joystickAxis = 0;
    this.leftZoneTouches = new Set();
    this.rightZoneTouches = new Set();
    this.leftBtnPointers = new Set();
    this.rightBtnPointers = new Set();
    this.brakePointers = new Set();
    this.gasPointers = new Set();

    // Photo editor state (60fps cached session)
    this.editingImage = null;
    this.editingPersonId = null;
    this.photoCutoutSession = null;
    this._photoSessionSeq = 0;
    this.photoEditOpts = {
      zoom: 1.1,
      offsetX: 0,
      offsetY: 0,
      magicCutout: true,
      tolerance: 38,
      shape: 'cutout',
    };
    this.recordingSlot = null;

    this._lastFrameMs = performance.now();
    this._elapsedTime = 0;
    this._attractSteerPhase = 0;
    this._fpsFrames = 0;
    this._fpsAccum = 0;
    this._currentFps = 60;
  }

  async init() {
    this._handleResize();
    window.addEventListener('resize', () => this._handleResize());
    this._registerServiceWorkerAndInstallFlow();

    await Promise.all([
      this.photos.init().catch(() => {}),
      this.sound.init().catch(() => {}),
      this.net.fetchNetworkInfo().catch(() => {}),
    ]);

    this._syncAllPhotoTextures();
    this._bindGlobalAudioUnlock();
    this._bindKeyboardInput();
    this._bindTouchControls();
    this._bindHudLayoutEditor();
    this._bindHomeAndModals();
    this._bindPersonalSettings();
    this._bindPeopleStudio();
    this._bindGarageAndWorld();
    this._bindSoundStudio();
    this._bindMultiplayerEvents();

    this._refreshAllUiFromSettings();
    this._startAttractDemo();

    // If opened via friend's QR / share link (?room=XXXX), jump straight into that Party Lobby!
    const roomFromUrl = this.net.getRoomCodeFromUrl();
    if (roomFromUrl) {
      this._openLobbyModal();
      document.getElementById('join-code-input').value = roomFromUrl;
      this._joinPartyRoom(roomFromUrl);
    }

    requestAnimationFrame((now) => this._frame(now));
  }

  _handleResize() {
    const w = window.innerWidth || 390;
    const h = window.innerHeight || 844;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.resize(w, h, dpr);
  }

  _syncAllPhotoTextures() {
    const people = this.photos.getPeople();
    if (!people.some((p) => p.id === this.settings.avatarId) && people.length > 0) {
      this.settings.avatarId = people[0].id;
    }
    for (const person of people) {
      if (person.dataUrl) {
        this.renderer.registerPhotoTexture(person.id, person.dataUrl);
      }
    }
    const copPool = this.settings.customCopsEnabled ? this.photos.getCopAvatarPool() : [];
    this.sim.setCopAvatarPool(copPool);
  }

  _getSelectedPerson() {
    return this.photos.getPerson(this.settings.avatarId) || this.photos.getPeople()[0] || null;
  }

  _buildLocalNetProfile() {
    const person = this._getSelectedPerson();
    const guestCopsBlocked = Boolean(
      this.net.roomCode && !this.net.isHost && this.settings.lobbyRules?.allowPlayerCops === false
    );
    const role = guestCopsBlocked ? 'runner' : (this.settings.playerRole === 'cop' ? 'cop' : 'runner');
    return {
      name: (this.settings.playerName || 'Player').trim().slice(0, 16) || 'Player',
      playerRole: role,
      copVehicleId: this.settings.copVehicleId || 'cop_heli',
      characterMode: this.settings.characterMode,
      vehicleId: this.settings.vehicleId,
      primaryColor: this.settings.primaryColor,
      accentColor: this.settings.accentColor,
      avatarId: this.net.playerId ? `net_${this.net.playerId}` : this.settings.avatarId,
      avatarDataUrl: person?.dataUrl || null,
      ready: this.isReadyInLobby,
    };
  }

  _bindGlobalAudioUnlock() {
    const unlockOnce = () => {
      this.sound.unlock();
    };
    window.addEventListener('pointerdown', unlockOnce, { passive: true });
    window.addEventListener('touchend', unlockOnce, { passive: true });
    window.addEventListener('click', unlockOnce, { passive: true });
    window.addEventListener('keydown', unlockOnce, { passive: true });
  }

  _registerServiceWorkerAndInstallFlow() {
    if ('serviceWorker' in navigator) {
      const registerSw = () => {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      };
      if (document.readyState === 'complete') {
        registerSw();
      } else {
        window.addEventListener('load', registerSw, { once: true });
      }
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      this._syncInstallAppUi();
    });

    window.addEventListener('appinstalled', () => {
      this.deferredInstallPrompt = null;
      document.getElementById('install-modal')?.classList.add('hidden');
      this._syncInstallAppUi();
      this._showChaosToast('📲 Smashy Kart added to Home Screen!');
    });

    const mq = window.matchMedia?.('(display-mode: standalone)');
    mq?.addEventListener?.('change', () => this._syncInstallAppUi());
  }

  _isStandaloneApp() {
    return Boolean(
      window.matchMedia?.('(display-mode: standalone)')?.matches ||
      window.matchMedia?.('(display-mode: fullscreen)')?.matches ||
      window.navigator?.standalone === true
    );
  }

  _syncInstallAppUi() {
    const isInstalled = this._isStandaloneApp();
    const installBtn = document.getElementById('btn-install-app');
    if (installBtn) {
      installBtn.classList.toggle('hidden', isInstalled);
    }
    const nativeBtn = document.getElementById('btn-trigger-native-install');
    if (nativeBtn) {
      nativeBtn.classList.toggle('hidden', !this.deferredInstallPrompt);
    }
  }

  async _triggerNativeInstallPrompt() {
    if (!this.deferredInstallPrompt) return false;
    const promptEvent = this.deferredInstallPrompt;
    this.deferredInstallPrompt = null;
    this._syncInstallAppUi();
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice?.outcome === 'accepted') {
        document.getElementById('install-modal')?.classList.add('hidden');
        return true;
      }
    } catch {
      // Ignore user dismissal
    }
    return false;
  }

  _triggerHaptic(pattern = 16) {
    if (this.settings.haptics === false) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      // Ignore unsupported browsers
    }
  }

  _isActionPressed(actionName) {
    const codes = this.settings.keybinds?.[actionName] || DEFAULT_KEYBINDS[actionName] || [];
    for (let i = 0; i < codes.length; i++) {
      if (codes[i] && this.keys.has(codes[i])) return true;
    }
    return false;
  }

  _matchesActionCode(actionName, code) {
    if (!code) return false;
    const codes = this.settings.keybinds?.[actionName] || DEFAULT_KEYBINDS[actionName] || [];
    return codes.includes(code);
  }

  _bindKeyboardInput() {
    window.addEventListener('keydown', (e) => {
      // 1. Interactive MacBook / PC Keybind Remapper capture mode
      if (this.listeningKeybind) {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === 'Escape') {
          this.listeningKeybind = null;
          this._renderKeybindsList();
          return;
        }
        const { action, slotIndex } = this.listeningKeybind;
        const current = Array.isArray(this.settings.keybinds[action])
          ? [...this.settings.keybinds[action]]
          : [...(DEFAULT_KEYBINDS[action] || [])];
        while (current.length <= slotIndex) current.push('');
        current[slotIndex] = e.code;
        const deduped = [];
        for (const c of current) {
          if (c && !deduped.includes(c)) deduped.push(c);
        }
        this.settings.keybinds[action] = deduped.length > 0 ? deduped : [e.code];
        this.listeningKeybind = null;
        saveSettings(this.settings);
        this._renderKeybindsList();
        this._updateHudKeycaps();
        this._showChaosToast(`⌨️ Bound ${formatKeyCodeLabel(e.code)}!`);
        return;
      }

      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

      if (this.editingHudLayout) {
        if (e.code === 'Escape' && !e.repeat) {
          e.preventDefault();
          this._closeHudLayoutEditor();
        }
        return;
      }

      this.keys.add(e.code);

      const inMatch =
        this.mode === 'playing_solo' ||
        this.mode === 'playing_party' ||
        this.mode === 'spectating' ||
        this.mode === 'countdown';

      if (
        inMatch &&
        (e.code === 'Space' ||
          e.code === 'ArrowUp' ||
          e.code === 'ArrowDown' ||
          e.code === 'ArrowLeft' ||
          e.code === 'ArrowRight')
      ) {
        e.preventDefault();
      }

      if (this._matchesActionCode('pause', e.code) && !e.repeat) {
        const subModalIds = ['install-modal', 'sound-modal', 'people-modal', 'garage-modal', 'world-modal'];
        for (const id of subModalIds) {
          const el = document.getElementById(id);
          if (el && !el.classList.contains('hidden')) {
            el.classList.add('hidden');
            return;
          }
        }
        const settingsModal = document.getElementById('settings-modal');
        if (inMatch && settingsModal) {
          e.preventDefault();
          const willOpen = settingsModal.classList.contains('hidden');
          settingsModal.classList.toggle('hidden', !willOpen);
          if (willOpen) {
            this.keys.clear();
            this._clearTouchState();
          }
          return;
        }
        if (settingsModal && !settingsModal.classList.contains('hidden')) {
          settingsModal.classList.add('hidden');
          return;
        }
      } else if (this._matchesActionCode('cycleCamera', e.code) && !e.repeat) {
        this._cycleCameraMode();
      } else if (this._matchesActionCode('useItem', e.code) && !e.repeat) {
        if (this.mode === 'playing_solo' || this.mode === 'playing_party') {
          e.preventDefault();
          this.touchUseItemQueued = true;
        }
      } else if (this._matchesActionCode('horn', e.code) && !e.repeat) {
        if (this.mode === 'playing_solo' || this.mode === 'playing_party') {
          this.touchHornQueued = true;
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this._clearTouchState();
    });
  }

  _clearTouchState() {
    this.leftZoneTouches.clear();
    this.rightZoneTouches.clear();
    this.leftBtnPointers.clear();
    this.rightBtnPointers.clear();
    this.brakePointers.clear();
    this.gasPointers.clear();
    this.touchSteerLeft = false;
    this.touchSteerRight = false;
    this.touchBrake = false;
    this.touchGas = false;
    this.joystickPullBrake = false;
    this.joystickTouchId = null;
    this.joystickAxis = 0;
    for (const id of [
      'steer-left-zone',
      'steer-right-zone',
      'btn-steer-left',
      'btn-steer-right',
      'btn-brake',
      'btn-gas',
    ]) {
      document.getElementById(id)?.classList.remove('pressed');
    }
    const stick = document.getElementById('joystick-stick');
    if (stick) stick.style.transform = 'translate(-50%, -50%)';
  }

  _bindTouchControls() {
    const leftZone = document.getElementById('steer-left-zone');
    const rightZone = document.getElementById('steer-right-zone');
    const leftPadBtn = document.getElementById('btn-steer-left');
    const rightPadBtn = document.getElementById('btn-steer-right');
    const brakeBtn = document.getElementById('btn-brake');
    const gasBtn = document.getElementById('btn-gas');
    const useItemBtn = document.getElementById('btn-use-item');
    const hornBtn = document.getElementById('btn-horn');

    const syncSteerAndPedals = () => {
      this.touchSteerLeft = this.leftZoneTouches.size > 0 || this.leftBtnPointers.size > 0;
      this.touchSteerRight = this.rightZoneTouches.size > 0 || this.rightBtnPointers.size > 0;
      this.touchBrake = this.brakePointers.size > 0;
      this.touchGas = this.gasPointers.size > 0;

      leftZone?.classList.toggle('pressed', this.leftZoneTouches.size > 0);
      rightZone?.classList.toggle('pressed', this.rightZoneTouches.size > 0);
      leftPadBtn?.classList.toggle('pressed', this.leftBtnPointers.size > 0);
      rightPadBtn?.classList.toggle('pressed', this.rightBtnPointers.size > 0);
      brakeBtn?.classList.toggle('pressed', this.touchBrake);
      gasBtn?.classList.toggle('pressed', this.touchGas);
    };

    const bindHoldControl = (el, pointerSet, stopProp = false) => {
      if (!el) return;
      el.addEventListener('pointerdown', (e) => {
        if (this.editingHudLayout) return;
        e.preventDefault();
        if (stopProp) e.stopPropagation();
        el.setPointerCapture?.(e.pointerId);
        pointerSet.add(e.pointerId);
        syncSteerAndPedals();
      });
      const release = (e) => {
        if (!pointerSet.has(e.pointerId)) return;
        pointerSet.delete(e.pointerId);
        syncSteerAndPedals();
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
    };

    bindHoldControl(leftZone, this.leftZoneTouches, false);
    bindHoldControl(rightZone, this.rightZoneTouches, false);
    bindHoldControl(leftPadBtn, this.leftBtnPointers, true);
    bindHoldControl(rightPadBtn, this.rightBtnPointers, true);
    bindHoldControl(brakeBtn, this.brakePointers, true);
    bindHoldControl(gasBtn, this.gasPointers, true);

    // Optional Thumbstick steering
    const joyZone = document.getElementById('joystick-zone');
    const joyStick = document.getElementById('joystick-stick');
    const maxRadius = 42;

    if (joyZone && joyStick) {
      joyZone.addEventListener('pointerdown', (e) => {
        if (this.editingHudLayout) return;
        e.preventDefault();
        e.stopPropagation();
        joyZone.setPointerCapture?.(e.pointerId);
        this.joystickTouchId = e.pointerId;
        const rect = joyZone.getBoundingClientRect();
        this.joystickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        this._updateJoystick(e.clientX, e.clientY, joyStick, maxRadius);
      });

      joyZone.addEventListener('pointermove', (e) => {
        if (this.editingHudLayout || e.pointerId !== this.joystickTouchId) return;
        this._updateJoystick(e.clientX, e.clientY, joyStick, maxRadius);
      });

      const endJoy = (e) => {
        if (e.pointerId !== this.joystickTouchId) return;
        this.joystickTouchId = null;
        this.joystickAxis = 0;
        this.joystickPullBrake = false;
        joyStick.style.transform = 'translate(-50%, -50%)';
      };
      joyZone.addEventListener('pointerup', endJoy);
      joyZone.addEventListener('pointercancel', endJoy);
      joyZone.addEventListener('lostpointercapture', endJoy);
    }

    useItemBtn?.addEventListener('pointerdown', (e) => {
      if (this.editingHudLayout) return;
      e.preventDefault();
      e.stopPropagation();
      this.touchUseItemQueued = true;
    });

    hornBtn?.addEventListener('pointerdown', (e) => {
      if (this.editingHudLayout) return;
      e.preventDefault();
      e.stopPropagation();
      this.touchHornQueued = true;
    });

    const quickCamBtn = document.getElementById('btn-quick-cam');
    quickCamBtn?.addEventListener('pointerdown', (e) => e.stopPropagation());
    quickCamBtn?.addEventListener('click', () => {
      if (this.editingHudLayout) return;
      this._cycleCameraMode();
    });

    const ingameSettingsBtn = document.getElementById('btn-ingame-settings');
    ingameSettingsBtn?.addEventListener('pointerdown', (e) => e.stopPropagation());
    ingameSettingsBtn?.addEventListener('click', () => {
      if (this.editingHudLayout) return;
      this._clearTouchState();
      document.getElementById('settings-modal')?.classList.remove('hidden');
    });

    const pauseBtn = document.getElementById('btn-pause');
    pauseBtn?.addEventListener('pointerdown', (e) => e.stopPropagation());
    pauseBtn?.addEventListener('click', () => {
      if (this.editingHudLayout) {
        this._closeHudLayoutEditor();
        return;
      }
      this._exitToMainMenu();
    });

    document.getElementById('btn-next-spectate')?.addEventListener('click', () => {
      this.spectateIndex += 1;
    });

    window.matchMedia?.('(pointer: coarse)')?.addEventListener?.('change', () => {
      this._applyHudLayout();
    });
  }

  _updateJoystick(clientX, clientY, stickEl, maxR) {
    const dx = clientX - this.joystickOrigin.x;
    const dy = clientY - this.joystickOrigin.y;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, maxR);
    const angle = Math.atan2(dy, dx);
    const ox = Math.cos(angle) * clamped;
    const oy = Math.sin(angle) * clamped;
    stickEl.style.transform = `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px))`;
    this.joystickAxis = Math.max(-1, Math.min(1, ox / maxR));
    this.joystickPullBrake = oy > maxR * 0.68;
  }

  _gatherGameplayInput() {
    if (this.editingHudLayout) {
      this.touchUseItemQueued = false;
      this.touchHornQueued = false;
      return { left: false, right: false, brake: false, gas: false, useItem: false, horn: false, steerAxis: null };
    }

    const keyLeft = this._isActionPressed('steerLeft');
    const keyRight = this._isActionPressed('steerRight');
    const keyBrake = this._isActionPressed('brake');
    const keyGas = this._isActionPressed('gas');

    const left = keyLeft || this.touchSteerLeft;
    const right = keyRight || this.touchSteerRight;
    const brake = keyBrake || this.touchBrake || this.joystickPullBrake || (left && right);
    const gas = keyGas || this.touchGas;

    const useItem = this.touchUseItemQueued;
    const horn = this.touchHornQueued;
    this.touchUseItemQueued = false;
    this.touchHornQueued = false;

    const deadzone = clampNum(this.settings.steerDeadzone, 0, 0.22, 0.05);
    const steerAxis =
      this.settings.touchStyle === 'joystick' && Math.abs(this.joystickAxis) > deadzone
        ? this.joystickAxis
        : null;

    return { left, right, brake, gas, useItem, horn, steerAxis };
  }

  // ======================== CLAW & FREE-DRAG HUD LAYOUT EDITOR ========================

  _isCoarseTouchDevice() {
    return Boolean(
      window.matchMedia?.('(pointer: coarse)')?.matches ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
    );
  }

  _applyHudLayout() {
    const s = this.settings;
    if (!s.hudLayout) {
      s.hudLayout = cloneHudLayout(s.hudLayoutPreset || 'thumbs');
    }

    const touchRoot = document.getElementById('touch-controls');
    const splitSteer = document.getElementById('split-steer');
    const isGameplayHudActive =
      this.mode === 'playing_solo' || this.mode === 'playing_party' || this.mode === 'countdown';

    if (touchRoot) {
      if (this.editingHudLayout) {
        touchRoot.classList.remove('hidden');
      } else if (isGameplayHudActive) {
        const hideOnDesktop = !this._isCoarseTouchDevice() && s.showTouchControlsDesktop === false;
        touchRoot.classList.toggle('hidden', hideOnDesktop);
      } else if (this.mode === 'spectating') {
        touchRoot.classList.add('hidden');
      }
    }

    if (splitSteer) {
      splitSteer.classList.toggle('hidden', this.editingHudLayout || s.touchStyle !== 'split');
    }

    const widgets = document.querySelectorAll('[data-hud-widget]');
    widgets.forEach((el) => {
      const wid = el.dataset.hudWidget;
      const fallback = HUD_LAYOUT_PRESETS.thumbs[wid] || { xPct: 50, yPct: 80, scale: 1.0, opacity: 0.95 };
      const cfg = s.hudLayout[wid] || fallback;
      const xPct = clampNum(cfg.xPct, 6, 94, fallback.xPct);
      const yPct = clampNum(cfg.yPct, 8, 93, fallback.yPct);
      const scale = clampNum(cfg.scale, 0.7, 1.6, fallback.scale);
      const opacity = clampNum(cfg.opacity, 0.4, 1.0, fallback.opacity);

      el.style.left = `${xPct.toFixed(1)}%`;
      el.style.top = `${yPct.toFixed(1)}%`;
      el.style.transform = `translate(-50%, -50%) scale(${scale.toFixed(2)})`;
      el.style.opacity = String(opacity.toFixed(2));

      let shouldHide = false;
      if (wid === 'joystick') {
        shouldHide = s.touchStyle !== 'joystick';
      } else if (wid === 'steerLeft' || wid === 'steerRight') {
        shouldHide = s.touchStyle === 'joystick';
      } else if (wid === 'gas') {
        shouldHide = Boolean(s.autoAccelerate !== false && !this.editingHudLayout);
      }
      el.classList.toggle('hidden', shouldHide);
      el.classList.toggle('selected', this.editingHudLayout && this.selectedHudWidget === wid);
    });
  }

  _applyHudPreset(presetName, announce = false) {
    if (!HUD_LAYOUT_PRESETS[presetName]) return;
    this.settings.hudLayoutPreset = presetName;
    this.settings.hudLayout = cloneHudLayout(presetName);
    saveSettings(this.settings);
    this._applyHudLayout();
    this._syncHudEditorInspector();
    this._refreshAllUiFromSettings();
    if (announce) {
      const names = {
        thumbs: '👍 Classic Thumbs HUD applied!',
        claw: '🦅 4-Finger Claw HUD applied!',
        lefty: '🫲 Left-Handed HUD applied!',
      };
      this._showChaosToast(names[presetName] || '✓ HUD preset applied!');
    }
  }

  _syncHudEditorInspector() {
    const wid = this.selectedHudWidget || 'brake';
    const fallback = HUD_LAYOUT_PRESETS.thumbs[wid] || { xPct: 74, yPct: 86, scale: 1.0, opacity: 0.95 };
    const cfg = this.settings.hudLayout?.[wid] || fallback;

    const nameEl = document.getElementById('hud-editor-selected-name');
    if (nameEl) nameEl.textContent = HUD_WIDGET_LABELS[wid] || wid;

    const scaleVal = clampNum(cfg.scale, 0.7, 1.6, 1.0);
    const opVal = clampNum(cfg.opacity, 0.4, 1.0, 0.95);

    const scaleRng = document.getElementById('rng-widget-scale');
    const scaleLbl = document.getElementById('val-widget-scale');
    if (scaleRng) scaleRng.value = String(scaleVal);
    if (scaleLbl) scaleLbl.textContent = `${Math.round(scaleVal * 100)}%`;

    const opRng = document.getElementById('rng-widget-opacity');
    const opLbl = document.getElementById('val-widget-opacity');
    if (opRng) opRng.value = String(opVal);
    if (opLbl) opLbl.textContent = `${Math.round(opVal * 100)}%`;

    document.querySelectorAll('#hud-preset-btns [data-hpreset], #settings-hpreset-btns [data-hpreset]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.hpreset === this.settings.hudLayoutPreset);
    });
  }

  _openHudLayoutEditor() {
    const homeEl = document.getElementById('home-screen');
    const lobbyEl = document.getElementById('lobby-modal');
    const hudEl = document.getElementById('hud');
    const editorEl = document.getElementById('hud-layout-editor');
    if (!editorEl) return;

    this._hudEditorPrevScreen = {
      homeHidden: homeEl ? homeEl.classList.contains('hidden') : true,
      lobbyHidden: lobbyEl ? lobbyEl.classList.contains('hidden') : true,
      hudHidden: hudEl ? hudEl.classList.contains('hidden') : true,
    };

    if (
      this.settings.touchStyle === 'joystick' &&
      (this.selectedHudWidget === 'steerLeft' || this.selectedHudWidget === 'steerRight')
    ) {
      this.selectedHudWidget = 'joystick';
    } else if (this.settings.touchStyle !== 'joystick' && this.selectedHudWidget === 'joystick') {
      this.selectedHudWidget = 'steerLeft';
    }

    this._clearTouchState();
    this.editingHudLayout = true;
    document.body.classList.add('editing-hud-layout');

    document.getElementById('settings-modal')?.classList.add('hidden');
    homeEl?.classList.add('hidden');
    lobbyEl?.classList.add('hidden');
    hudEl?.classList.remove('hidden');
    editorEl.classList.remove('hidden');

    this._applyHudLayout();
    this._syncHudEditorInspector();
  }

  _closeHudLayoutEditor() {
    if (!this.editingHudLayout) return;
    this.editingHudLayout = false;
    document.body.classList.remove('editing-hud-layout');
    document.getElementById('hud-layout-editor')?.classList.add('hidden');
    saveSettings(this.settings);

    const prev = this._hudEditorPrevScreen;
    this._hudEditorPrevScreen = null;

    const inActiveMatch =
      this.mode === 'playing_solo' ||
      this.mode === 'playing_party' ||
      this.mode === 'countdown' ||
      this.mode === 'spectating';

    if (inActiveMatch) {
      document.getElementById('hud')?.classList.remove('hidden');
      document.getElementById('home-screen')?.classList.add('hidden');
    } else {
      document.getElementById('hud')?.classList.toggle('hidden', prev ? prev.hudHidden : true);
      if (prev && !prev.homeHidden) {
        document.getElementById('home-screen')?.classList.remove('hidden');
      }
      if (prev && !prev.lobbyHidden) {
        document.getElementById('lobby-modal')?.classList.remove('hidden');
      }
    }

    this._applyHudLayout();
    this._refreshAllUiFromSettings();
    this._showChaosToast('✓ HUD button layout saved!');
  }

  _bindHudLayoutEditor() {
    const widgets = document.querySelectorAll('[data-hud-widget]');
    let activeDrag = null; // { pointerId, wid, startX, startY, origX, origY }

    widgets.forEach((widgetEl) => {
      const wid = widgetEl.dataset.hudWidget;
      if (!wid) return;

      widgetEl.addEventListener(
        'pointerdown',
        (e) => {
          if (!this.editingHudLayout) return;
          e.preventDefault();
          e.stopPropagation();
          widgetEl.setPointerCapture?.(e.pointerId);
          this.selectedHudWidget = wid;
          if (!this.settings.hudLayout[wid]) {
            this.settings.hudLayout[wid] = { ...(HUD_LAYOUT_PRESETS.thumbs[wid] || { xPct: 50, yPct: 80, scale: 1, opacity: 0.95 }) };
          }
          activeDrag = {
            pointerId: e.pointerId,
            wid,
            startX: e.clientX,
            startY: e.clientY,
            origX: this.settings.hudLayout[wid].xPct,
            origY: this.settings.hudLayout[wid].yPct,
          };
          widgetEl.classList.add('dragging');
          this._applyHudLayout();
          this._syncHudEditorInspector();
        },
        { capture: true }
      );

      widgetEl.addEventListener(
        'pointermove',
        (e) => {
          if (!this.editingHudLayout || !activeDrag || activeDrag.pointerId !== e.pointerId || activeDrag.wid !== wid) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          const vw = Math.max(1, window.innerWidth || 390);
          const vh = Math.max(1, window.innerHeight || 844);
          const dxPct = ((e.clientX - activeDrag.startX) / vw) * 100;
          const dyPct = ((e.clientY - activeDrag.startY) / vh) * 100;
          const nx = clampNum(activeDrag.origX + dxPct, 6, 94, activeDrag.origX);
          const ny = clampNum(activeDrag.origY + dyPct, 8, 93, activeDrag.origY);
          this.settings.hudLayout[wid].xPct = Number(nx.toFixed(1));
          this.settings.hudLayout[wid].yPct = Number(ny.toFixed(1));
          if (Math.hypot(e.clientX - activeDrag.startX, e.clientY - activeDrag.startY) > 3) {
            this.settings.hudLayoutPreset = 'custom';
          }
          this._applyHudLayout();
          this._syncHudEditorInspector();
        },
        { capture: true }
      );

      const finishDrag = (e) => {
        if (!activeDrag || activeDrag.pointerId !== e.pointerId) return;
        widgetEl.classList.remove('dragging');
        activeDrag = null;
        saveSettings(this.settings);
      };
      widgetEl.addEventListener('pointerup', finishDrag, { capture: true });
      widgetEl.addEventListener('pointercancel', finishDrag, { capture: true });
      widgetEl.addEventListener('lostpointercapture', finishDrag, { capture: true });
    });

    document.getElementById('hud-preset-btns')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-hpreset]');
      if (!btn) return;
      this._applyHudPreset(btn.dataset.hpreset, true);
    });

    const scaleRng = document.getElementById('rng-widget-scale');
    scaleRng?.addEventListener('input', () => {
      const wid = this.selectedHudWidget || 'brake';
      if (!this.settings.hudLayout[wid]) return;
      const sc = clampNum(scaleRng.value, 0.7, 1.6, 1.0);
      this.settings.hudLayout[wid].scale = Number(sc.toFixed(2));
      this.settings.hudLayoutPreset = 'custom';
      saveSettings(this.settings);
      this._applyHudLayout();
      this._syncHudEditorInspector();
    });

    const opRng = document.getElementById('rng-widget-opacity');
    opRng?.addEventListener('input', () => {
      const wid = this.selectedHudWidget || 'brake';
      if (!this.settings.hudLayout[wid]) return;
      const op = clampNum(opRng.value, 0.4, 1.0, 0.95);
      this.settings.hudLayout[wid].opacity = Number(op.toFixed(2));
      this.settings.hudLayoutPreset = 'custom';
      saveSettings(this.settings);
      this._applyHudLayout();
      this._syncHudEditorInspector();
    });

    document.getElementById('btn-hud-editor-reset')?.addEventListener('click', () => {
      const targetPreset = ['thumbs', 'claw', 'lefty'].includes(this.settings.hudLayoutPreset)
        ? this.settings.hudLayoutPreset
        : 'thumbs';
      this._applyHudPreset(targetPreset, false);
      this._showChaosToast('↺ HUD layout reset!');
    });

    document.getElementById('btn-hud-editor-done')?.addEventListener('click', () => {
      this._closeHudLayoutEditor();
    });
  }

  _stepVehicleOnHome(delta) {
    if (this.settings.playerRole === 'cop') {
      const curIdx = Math.max(0, COP_VEHICLES.findIndex((c) => c.id === this.settings.copVehicleId));
      const nextIdx = (curIdx + delta + COP_VEHICLES.length) % COP_VEHICLES.length;
      const copVeh = COP_VEHICLES[nextIdx];
      this.settings.copVehicleId = copVeh.id;
      saveSettings(this.settings);
      this._refreshAllUiFromSettings();
      if (this.mode === 'attract') this._respawnAttractHero();
      if (this.net.roomCode) {
        this.net.updateProfile(this._buildLocalNetProfile());
      }
      return;
    }

    if (this.net.roomCode && !this.net.isHost && this.settings.lobbyRules?.allowCarChoice === false) {
      this._showChaosToast('🔒 Car choice is locked by the Lobby Manager!');
      return;
    }
    const curIdx = Math.max(0, VEHICLES.findIndex((v) => v.id === this.settings.vehicleId));
    const nextIdx = (curIdx + delta + VEHICLES.length) % VEHICLES.length;
    const veh = VEHICLES[nextIdx];
    this.settings.vehicleId = veh.id;
    this.settings.primaryColor = veh.color;
    this.settings.accentColor = veh.accent;
    if (!this.net.roomCode || this.net.isHost) {
      this.settings.lobbyRules.universalVehicleId = veh.id;
    }
    saveSettings(this.settings);
    this._refreshAllUiFromSettings();

    // Live-swap 3D hero car & paint right on the Home Screen without resetting the chase!
    if (this.mode === 'attract' && this.sim.localPlayer) {
      const lp = this.sim.localPlayer;
      lp.vehicleId = veh.id;
      lp.primaryColor = veh.color;
      lp.accentColor = veh.accent;
      if (lp.characterMode !== 'runner') {
        const isPhotoCar = lp.characterMode === 'photo_car';
        lp.radius = veh.radius * (this.settings.scaleMult || 1.0);
        lp.baseSpeed = veh.speed * (isPhotoCar ? 1.03 : 1.0) * (this.settings.speedMult || 1.0);
        lp.maxSpeed = lp.baseSpeed;
        lp.accel = veh.accel * (isPhotoCar ? 1.08 : 1.0) * (this.settings.accelMult || 1.0);
        lp.handling = veh.handling * (isPhotoCar ? 1.05 : 1.0);
        lp.mass = veh.mass * (this.settings.massMult || 1.0);
      }
    }

    if (this.net.roomCode) {
      this.net.updateProfile(this._buildLocalNetProfile());
      if (this.net.isHost) this.net.updateRoomSettings(this.settings);
    }
  }

  _setPlayerRole(role) {
    const nextRole = role === 'cop' ? 'cop' : 'runner';
    if (
      nextRole === 'cop' &&
      this.net.roomCode &&
      !this.net.isHost &&
      this.settings.lobbyRules?.allowPlayerCops === false
    ) {
      this._showChaosToast('🔒 Playing as Police is disabled by the Lobby Host!');
      return;
    }
    if (!COP_VEHICLES.some((c) => c.id === this.settings.copVehicleId)) {
      this.settings.copVehicleId = 'cop_heli';
    }
    this.settings.playerRole = nextRole;
    saveSettings(this.settings);
    this._refreshAllUiFromSettings();
    if (this.mode === 'attract') this._respawnAttractHero();
    if (this.net.roomCode) {
      this.net.updateProfile(this._buildLocalNetProfile());
      if (this.net.roomState && !document.getElementById('lobby-modal')?.classList.contains('hidden')) {
        this._renderLobbyRoom(this.net.roomState);
      }
    }
  }

  _bindHomeAndModals() {
    const nameInput = document.getElementById('home-player-name');
    if (nameInput) {
      nameInput.value = this.settings.playerName || 'Tanner';
      nameInput.addEventListener('input', () => {
        this.settings.playerName = nameInput.value.trim().slice(0, 16) || 'Player';
        saveSettings(this.settings);
        if (this.net.roomCode) this.net.updateProfile(this._buildLocalNetProfile());
      });
    }

    // Home Screen Live 3D Car Stepper & Biome Cycler
    document.getElementById('btn-prev-car')?.addEventListener('click', () => {
      this.sound.unlock();
      this._stepVehicleOnHome(-1);
    });
    document.getElementById('btn-next-car')?.addEventListener('click', () => {
      this.sound.unlock();
      this._stepVehicleOnHome(1);
    });

    document.getElementById('btn-cycle-biome')?.addEventListener('click', () => {
      this.sound.unlock();
      if (this.net.roomCode && !this.net.isHost) {
        this._showChaosToast('🔒 Map is controlled by the Lobby Manager!');
        return;
      }
      const order = ['city', 'desert', 'snow'];
      const curIdx = Math.max(0, order.indexOf(this.settings.biome));
      this.settings.biome = order[(curIdx + 1) % order.length];
      saveSettings(this.settings);
      this.world.reset(this.settings.worldSeed, this.settings.biome, {
        itemBoxDensity: this.settings.itemBoxDensity,
        sugarBoxRate: this.settings.sugarBoxRate,
      });
      this._refreshAllUiFromSettings();
      if (this.mode === 'attract') this._respawnAttractHero();
      if (this.net.roomCode && this.net.isHost) this.net.updateRoomSettings(this.settings);
    });

    // Native Install App button + modal
    document.getElementById('btn-install-app')?.addEventListener('click', async () => {
      this.sound.unlock();
      if (this.deferredInstallPrompt) {
        await this._triggerNativeInstallPrompt();
      } else {
        this._syncInstallAppUi();
        document.getElementById('install-modal')?.classList.remove('hidden');
      }
    });

    document.getElementById('btn-trigger-native-install')?.addEventListener('click', async () => {
      await this._triggerNativeInstallPrompt();
    });

    const installModal = document.getElementById('install-modal');
    installModal?.addEventListener('click', (e) => {
      if (e.target === installModal) installModal.classList.add('hidden');
    });

    // Team Role switchers across Home, Lobby, and Garage
    for (const roleContainerId of ['home-role-pills', 'lobby-role-pills', 'garage-role-cards']) {
      document.getElementById(roleContainerId)?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-role]');
        if (!btn) return;
        this.sound.unlock();
        this._setPlayerRole(btn.dataset.role);
      });
    }

    document.getElementById('lobby-cop-pills')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cop-veh]');
      if (!btn) return;
      if (this.net.roomCode && !this.net.isHost && this.settings.lobbyRules?.allowPlayerCops === false) {
        this._showChaosToast('🔒 Playing as Police is disabled by the Lobby Host!');
        return;
      }
      const cid = btn.dataset.copVeh;
      if (!COP_VEHICLES.some((c) => c.id === cid)) return;
      this.sound.unlock();
      this.settings.playerRole = 'cop';
      this.settings.copVehicleId = cid;
      saveSettings(this.settings);
      this._refreshAllUiFromSettings();
      if (this.mode === 'attract') this._respawnAttractHero();
      if (this.net.roomCode) {
        this.net.updateProfile(this._buildLocalNetProfile());
      }
    });

    // Character Mode switchers across Home, Lobby, and Garage
    const setCharacterMode = (mode) => {
      if (!CHARACTER_MODES.some((m) => m.id === mode)) return;
      if (this.net.roomCode && !this.net.isHost && this.settings.lobbyRules?.allowModeChoice === false) {
        this._showChaosToast('🔒 Runner style is locked by the Lobby Manager!');
        return;
      }
      this.settings.playerRole = 'runner';
      this.settings.characterMode = mode;
      if (!this.net.roomCode || this.net.isHost) {
        this.settings.lobbyRules.universalCharacterMode = mode;
      }
      saveSettings(this.settings);
      this._refreshAllUiFromSettings();
      if (this.mode === 'attract') this._respawnAttractHero();
      if (this.net.roomCode) {
        this.net.updateProfile(this._buildLocalNetProfile());
        if (this.net.isHost) this.net.updateRoomSettings(this.settings);
      }
    };

    for (const containerId of ['home-mode-pills', 'lobby-mode-pills', 'garage-mode-cards']) {
      const container = document.getElementById(containerId);
      container?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-mode]');
        if (!btn) return;
        setCharacterMode(btn.dataset.mode);
      });
    }

    // Open modals
    document.querySelectorAll('[data-open-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const modalId = btn.dataset.openModal;
        document.getElementById(modalId)?.classList.remove('hidden');
        if (modalId === 'sound-modal') {
          this._renderSoundSlots();
        }
      });
    });

    document.getElementById('btn-quick-photo')?.addEventListener('click', () => {
      document.getElementById('people-modal')?.classList.remove('hidden');
      document.getElementById('photo-file-input')?.click();
    });

    // Close modals
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.closeModal === 'settings-modal' && this.listeningKeybind) {
          this.listeningKeybind = null;
          this._renderKeybindsList();
        }
        document.getElementById(btn.dataset.closeModal)?.classList.add('hidden');
      });
    });

    // Play Solo & Open Party Lobby
    document.getElementById('btn-play-solo')?.addEventListener('click', () => {
      this.sound.unlock();
      this._startSoloMatch();
    });

    document.getElementById('btn-open-lobby')?.addEventListener('click', () => {
      this.sound.unlock();
      this._openLobbyModal();
    });

    document.querySelector('[data-close-lobby]')?.addEventListener('click', () => {
      document.getElementById('lobby-modal')?.classList.add('hidden');
    });

    // Game over buttons
    document.getElementById('btn-play-again')?.addEventListener('click', () => {
      document.getElementById('gameover-modal')?.classList.add('hidden');
      if (this.net.roomCode) {
        if (this.net.isHost) {
          this.net.startMatch();
        } else {
          this.net.returnToLobby();
          this._openLobbyModal();
        }
      } else {
        this._startSoloMatch();
      }
    });

    document.getElementById('btn-back-lobby')?.addEventListener('click', () => {
      document.getElementById('gameover-modal')?.classList.add('hidden');
      if (this.net.roomCode) {
        this.net.returnToLobby();
        this._openLobbyModal();
      } else {
        this._exitToMainMenu();
      }
    });

    document.getElementById('btn-back-home')?.addEventListener('click', () => {
      if (this.net.roomCode) this.net.leaveRoom();
      this._exitToMainMenu();
    });
  }

  _setCameraMode(cam, announce = false) {
    if (!['smashy', 'chase', 'pov'].includes(cam)) return;
    this.settings.cameraMode = cam;
    saveSettings(this.settings);
    this._refreshAllUiFromSettings();
    if (announce) {
      const camNames = {
        smashy: '🎥 Smashy Overhead Cam',
        chase: '🎥 Behind Chase Cam',
        pov: '🎥 First-Person Hood POV',
      };
      this._showChaosToast(camNames[cam] || '🎥 Camera Switched');
    }
  }

  _cycleCameraMode() {
    const order = ['smashy', 'chase', 'pov'];
    const idx = order.indexOf(this.settings.cameraMode);
    const next = order[(idx + 1) % order.length];
    this._setCameraMode(next, true);
  }

  _syncSimPersonalSettings() {
    const s = this.settings;
    const isGuestParty = Boolean(
      this.net.roomCode && !this.net.isHost && (this.mode === 'playing_party' || this.mode === 'countdown')
    );
    if (isGuestParty && this.sim.settings) {
      this.sim.updateSettings({
        ...this.sim.settings,
        cameraMode: s.cameraMode,
        povFov: s.povFov,
        cameraShakeMult: s.cameraShakeMult,
        speedUnit: s.speedUnit,
        touchStyle: s.touchStyle,
        autoAccelerate: s.autoAccelerate,
        invertSteer: s.invertSteer,
        steerSensitivity: s.steerSensitivity,
        steerDeadzone: s.steerDeadzone,
      });
    } else {
      this.sim.updateSettings(s);
    }
  }

  _setSettingsTab(tabId) {
    if (!['camera', 'controls', 'keyboard', 'audio'].includes(tabId)) return;
    this.activeSettingsTab = tabId;
    if (tabId !== 'keyboard' && this.listeningKeybind) {
      this.listeningKeybind = null;
      this._renderKeybindsList();
    }
    document.querySelectorAll('#settings-tabs [data-stab]').forEach((btn) => {
      const active = btn.dataset.stab === tabId;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-stab-pane]').forEach((pane) => {
      const active = pane.dataset.stabPane === tabId;
      pane.classList.toggle('hidden', !active);
      pane.classList.toggle('active', active);
    });
  }

  _updateHudKeycaps() {
    const show = this.settings.showKeyHints !== false;
    for (const [domId, action] of HUD_KEYCAP_MAP) {
      const el = document.getElementById(domId);
      if (!el) continue;
      const code = this.settings.keybinds?.[action]?.[0] || DEFAULT_KEYBINDS[action]?.[0] || '';
      el.textContent = formatKeyCodeLabel(code);
      el.classList.toggle('hidden', !show);
    }
  }

  _renderKeybindsList() {
    const list = document.getElementById('keybinds-list');
    if (!list) return;
    list.innerHTML = '';

    for (const act of KEYBIND_ACTIONS) {
      const codes = this.settings.keybinds?.[act.id] || DEFAULT_KEYBINDS[act.id] || [];
      const row = document.createElement('div');
      row.className = 'keybind-row';

      const slot0Listening =
        this.listeningKeybind?.action === act.id && this.listeningKeybind?.slotIndex === 0;
      const slot1Listening =
        this.listeningKeybind?.action === act.id && this.listeningKeybind?.slotIndex === 1;

      const label0 = slot0Listening ? 'Press a key...' : formatKeyCodeLabel(codes[0] || '');
      const label1 = slot1Listening ? 'Press a key...' : formatKeyCodeLabel(codes[1] || '');

      row.innerHTML = `
        <div class="keybind-meta">
          <strong class="keybind-label">${this._escapeHtml(act.label)}</strong>
          <span class="keybind-hint">${this._escapeHtml(act.hint)}</span>
        </div>
        <div class="keybind-slots">
          <button type="button" class="keybind-pill${slot0Listening ? ' listening active' : ''}" data-kaction="${act.id}" data-kslot="0">
            ${this._escapeHtml(label0)}
          </button>
          <button type="button" class="keybind-pill secondary${slot1Listening ? ' listening active' : ''}" data-kaction="${act.id}" data-kslot="1">
            ${this._escapeHtml(label1)}
          </button>
        </div>
      `;
      list.appendChild(row);
    }
  }

  _bindPersonalSettings() {
    const settingsModal = document.getElementById('settings-modal');
    settingsModal?.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        if (this.listeningKeybind) {
          this.listeningKeybind = null;
          this._renderKeybindsList();
        }
        settingsModal.classList.add('hidden');
      }
    });

    // 4-Tab Switcher
    document.getElementById('settings-tabs')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-stab]');
      if (!btn) return;
      this._setSettingsTab(btn.dataset.stab);
    });

    // Tab 1: Camera & Display
    document.getElementById('settings-cam-btns')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cam]');
      if (!btn) return;
      const inMatch = this.mode === 'playing_solo' || this.mode === 'playing_party' || this.mode === 'spectating';
      this._setCameraMode(btn.dataset.cam, inMatch);
    });

    const fovRng = document.getElementById('rng-pov-fov');
    fovRng?.addEventListener('input', () => {
      const fov = Math.round(clampNum(fovRng.value, 62, 96, 78));
      this.settings.povFov = fov;
      const lbl = document.getElementById('val-pov-fov');
      if (lbl) lbl.textContent = `${fov}°`;
      saveSettings(this.settings);
      this._syncSimPersonalSettings();
    });

    const shakeRng = document.getElementById('rng-cam-shake');
    shakeRng?.addEventListener('input', () => {
      const shake = clampNum(shakeRng.value, 0, 1.5, 1.0);
      this.settings.cameraShakeMult = Number(shake.toFixed(2));
      const lbl = document.getElementById('val-cam-shake');
      if (lbl) lbl.textContent = `${Math.round(shake * 100)}%`;
      saveSettings(this.settings);
      this._syncSimPersonalSettings();
    });

    document.getElementById('settings-gfx-btns')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-gfx]');
      if (!btn) return;
      const gfx = btn.dataset.gfx;
      if (!['high', 'balanced', 'performance'].includes(gfx)) return;
      this.settings.graphicsQuality = gfx;
      this.renderer.setGraphicsQuality?.(gfx);
      saveSettings(this.settings);
      this._refreshAllUiFromSettings();
    });

    document.getElementById('settings-unit-btns')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-unit]');
      if (!btn) return;
      const unit = btn.dataset.unit;
      if (!['mph', 'kmh'].includes(unit)) return;
      this.settings.speedUnit = unit;
      saveSettings(this.settings);
      this._refreshAllUiFromSettings();
      this._updateHud();
    });

    const bindBoolToggle = (id, key, onChange) => {
      const el = document.getElementById(id);
      el?.addEventListener('change', () => {
        this.settings[key] = el.checked;
        saveSettings(this.settings);
        if (onChange) onChange(el.checked);
      });
    };

    bindBoolToggle('chk-show-desktop-btns', 'showTouchControlsDesktop', () => this._applyHudLayout());
    bindBoolToggle('chk-show-keyhints', 'showKeyHints', () => this._updateHudKeycaps());
    bindBoolToggle('chk-show-minimap', 'showMinimap', (v) => {
      document.getElementById('hud-minimap')?.classList.toggle('hidden', !v);
    });
    bindBoolToggle('chk-show-speedo', 'showSpeedometer', (v) => {
      document.getElementById('hud-speedo')?.classList.toggle('hidden', !v);
    });
    bindBoolToggle('chk-show-fps', 'showFps', (v) => {
      document.getElementById('hud-fps')?.classList.toggle('hidden', !v);
    });
    bindBoolToggle('chk-show-quickcam', 'showQuickCamBtn', (v) => {
      document.getElementById('btn-quick-cam')?.classList.toggle('hidden', !v);
    });
    bindBoolToggle('chk-screen-fx', 'screenEffects', (v) => {
      if (!v) {
        document.getElementById('speed-lines')?.classList.add('hidden');
        document.getElementById('danger-vignette')?.classList.add('hidden');
      }
    });

    // Tab 2: Controls & Claw HUD
    document.getElementById('btn-open-hud-editor')?.addEventListener('click', () => {
      this._openHudLayoutEditor();
    });

    document.getElementById('settings-hpreset-btns')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-hpreset]');
      if (!btn) return;
      this._applyHudPreset(btn.dataset.hpreset, true);
    });

    document.getElementById('settings-touch-btns')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-touch]');
      if (!btn) return;
      if (!['split', 'buttons', 'joystick'].includes(btn.dataset.touch)) return;
      this.settings.touchStyle = btn.dataset.touch;
      this._clearTouchState();
      saveSettings(this.settings);
      this._refreshAllUiFromSettings();
    });

    bindBoolToggle('chk-auto-accel', 'autoAccelerate', () => {
      this._syncSimPersonalSettings();
      this._applyHudLayout();
    });
    bindBoolToggle('chk-invert-steer', 'invertSteer', () => this._syncSimPersonalSettings());
    bindBoolToggle('chk-haptics', 'haptics', (v) => {
      if (v) this._triggerHaptic(18);
    });

    const sensRng = document.getElementById('rng-steer-sens');
    sensRng?.addEventListener('input', () => {
      const sens = clampNum(sensRng.value, 0.7, 1.4, 1.0);
      this.settings.steerSensitivity = sens;
      const lbl = document.getElementById('val-steer-sens');
      if (lbl) lbl.textContent = `${Math.round(sens * 100)}%`;
      saveSettings(this.settings);
      this._syncSimPersonalSettings();
    });

    const dzRng = document.getElementById('rng-steer-deadzone');
    dzRng?.addEventListener('input', () => {
      const dz = clampNum(dzRng.value, 0, 0.22, 0.05);
      this.settings.steerDeadzone = Number(dz.toFixed(2));
      const lbl = document.getElementById('val-steer-deadzone');
      if (lbl) lbl.textContent = `${Math.round(dz * 100)}%`;
      saveSettings(this.settings);
      this._syncSimPersonalSettings();
    });

    // Tab 3: Mac / PC Keybinds
    document.getElementById('keybinds-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-kaction]');
      if (!btn) return;
      const action = btn.dataset.kaction;
      const slotIndex = Number(btn.dataset.kslot) || 0;
      if (
        this.listeningKeybind &&
        this.listeningKeybind.action === action &&
        this.listeningKeybind.slotIndex === slotIndex
      ) {
        this.listeningKeybind = null;
      } else {
        this.listeningKeybind = { action, slotIndex };
      }
      this._renderKeybindsList();
    });

    document.getElementById('btn-reset-keybinds')?.addEventListener('click', () => {
      this.listeningKeybind = null;
      this.settings.keybinds = cloneKeybinds();
      saveSettings(this.settings);
      this._renderKeybindsList();
      this._updateHudKeycaps();
      this._showChaosToast('⌨️ Default keyboard keys restored!');
    });

    // Tab 4: Audio & Voice
    const settingsVolRng = document.getElementById('rng-settings-vol');
    settingsVolRng?.addEventListener('input', () => {
      const v = clampNum(settingsVolRng.value, 0, 1, 0.85);
      this.settings.soundVolume = v;
      this.sound.setVolume(v);
      const pct = `${Math.round(v * 100)}%`;
      const sLbl = document.getElementById('val-settings-vol');
      if (sLbl) sLbl.textContent = pct;
      const volEl = document.getElementById('rng-volume');
      if (volEl) volEl.value = String(v);
      const vLbl = document.getElementById('val-volume');
      if (vLbl) vLbl.textContent = pct;
      saveSettings(this.settings);
    });

    const engVolRng = document.getElementById('rng-engine-vol');
    engVolRng?.addEventListener('input', () => {
      const v = clampNum(engVolRng.value, 0, 1, 0.85);
      this.settings.sfxEngineVol = v;
      this.sound.setChannelVolumes?.({ engine: v, action: this.settings.sfxActionVol ?? 1.0 });
      const lbl = document.getElementById('val-engine-vol');
      if (lbl) lbl.textContent = `${Math.round(v * 100)}%`;
      saveSettings(this.settings);
    });

    const actVolRng = document.getElementById('rng-action-vol');
    actVolRng?.addEventListener('input', () => {
      const v = clampNum(actVolRng.value, 0, 1, 1.0);
      this.settings.sfxActionVol = v;
      this.sound.setChannelVolumes?.({ engine: this.settings.sfxEngineVol ?? 0.85, action: v });
      const lbl = document.getElementById('val-action-vol');
      if (lbl) lbl.textContent = `${Math.round(v * 100)}%`;
      saveSettings(this.settings);
    });

    document.getElementById('btn-settings-voice-studio')?.addEventListener('click', () => {
      document.getElementById('sound-modal')?.classList.remove('hidden');
      this._renderSoundSlots();
    });

    document.getElementById('btn-reset-personal-settings')?.addEventListener('click', () => {
      const defs = createDefaultSettings();
      this.listeningKeybind = null;
      this.settings.cameraMode = defs.cameraMode;
      this.settings.povFov = defs.povFov;
      this.settings.cameraShakeMult = defs.cameraShakeMult;
      this.settings.graphicsQuality = defs.graphicsQuality;
      this.settings.speedUnit = defs.speedUnit;
      this.settings.touchStyle = defs.touchStyle;
      this.settings.autoAccelerate = defs.autoAccelerate;
      this.settings.invertSteer = defs.invertSteer;
      this.settings.steerSensitivity = defs.steerSensitivity;
      this.settings.steerDeadzone = defs.steerDeadzone;
      this.settings.showTouchControlsDesktop = defs.showTouchControlsDesktop;
      this.settings.showKeyHints = defs.showKeyHints;
      this.settings.showSpeedometer = defs.showSpeedometer;
      this.settings.showMinimap = defs.showMinimap;
      this.settings.showFps = defs.showFps;
      this.settings.showQuickCamBtn = defs.showQuickCamBtn;
      this.settings.screenEffects = defs.screenEffects;
      this.settings.haptics = defs.haptics;
      this.settings.soundVolume = defs.soundVolume;
      this.settings.sfxEngineVol = defs.sfxEngineVol;
      this.settings.sfxActionVol = defs.sfxActionVol;
      this.settings.hudLayoutPreset = 'thumbs';
      this.settings.hudLayout = cloneHudLayout('thumbs');
      this.settings.keybinds = cloneKeybinds();

      this.renderer.setGraphicsQuality?.(this.settings.graphicsQuality);
      this.sound.setVolume(this.settings.soundVolume);
      this.sound.setChannelVolumes?.({
        engine: this.settings.sfxEngineVol,
        action: this.settings.sfxActionVol,
      });
      this._clearTouchState();
      saveSettings(this.settings);
      this._refreshAllUiFromSettings();
      this._showChaosToast('⚙️ All personal settings reset!');
    });
  }

  _bindPeopleStudio() {
    const fileInput = document.getElementById('photo-file-input');
    const editorBox = document.getElementById('photo-editor-box');
    const cropCanvas = document.getElementById('photo-crop-canvas');
    const nameInp = document.getElementById('photo-person-name');
    const zoomRng = document.getElementById('rng-photo-zoom');
    const xRng = document.getElementById('rng-photo-x');
    const yRng = document.getElementById('rng-photo-y');
    const tolRng = document.getElementById('rng-photo-tol');
    const copChk = document.getElementById('chk-person-cop');
    const centerBtn = document.getElementById('btn-center-photo');

    const clampVal = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    // Synchronous <0.5ms 60fps canvas redraw (zero Image decode, zero LAB flood-fill!)
    const drawInstantPreview = () => {
      if (!this.photoCutoutSession) return;
      const z = clampVal(Number(this.photoEditOpts.zoom) || 1.1, 0.7, 2.6);
      const ox = clampVal(Number(this.photoEditOpts.offsetX) || 0, -1, 1);
      const oy = clampVal(Number(this.photoEditOpts.offsetY) || 0, -1, 1);

      zoomRng.value = String(z);
      xRng.value = String(Math.round(ox * 100));
      yRng.value = String(Math.round(oy * 100));
      document.getElementById('val-photo-zoom').textContent = `${z.toFixed(2)}x`;
      document.getElementById('val-photo-tol').textContent = String(this.photoEditOpts.tolerance);
      document.getElementById('tolerance-row').classList.toggle(
        'hidden',
        this.photoEditOpts.shape === 'full'
      );
      document.querySelectorAll('#cutout-shape-btns .seg-btn').forEach((b) =>
        b.classList.toggle('active', b.dataset.shape === this.photoEditOpts.shape)
      );

      this.photos.renderSessionPreview(cropCanvas, this.photoCutoutSession, {
        zoom: z,
        offsetX: ox,
        offsetY: oy,
        shape: this.photoEditOpts.shape,
        normalizedOffsets: true,
      });
    };

    const rebuildCutoutSession = async () => {
      if (!this.editingImage) return;
      const seq = ++this._photoSessionSeq;
      const magic = this.photoEditOpts.shape !== 'full';
      const tol = Number(tolRng.value) || 38;
      this.photoEditOpts.tolerance = tol;
      document.getElementById('val-photo-tol').textContent = String(tol);
      const session = await this.photos.prepareCutoutSession(this.editingImage, {
        magicCutout: magic,
        tolerance: tol,
      });
      if (seq !== this._photoSessionSeq) return;
      this.photoCutoutSession = session;
      drawInstantPreview();
    };

    this._openEditorForImage = (img, { personId = null, name = 'Me', useAsCop = true, initialZoom = 1.1 } = {}) => {
      this.editingImage = img;
      this.editingPersonId = personId;
      this.photoEditOpts.zoom = initialZoom;
      this.photoEditOpts.offsetX = 0;
      this.photoEditOpts.offsetY = 0;
      this.photoEditOpts.tolerance = 38;
      this.photoEditOpts.shape = 'cutout';
      tolRng.value = '38';
      nameInp.value = name;
      copChk.checked = Boolean(useAsCop);
      editorBox.classList.remove('hidden');
      rebuildCutoutSession();
    };

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 14);
          const cleanName = baseName && !/^img_|^image|^photo/i.test(baseName) ? baseName : 'Me';
          this._openEditorForImage(img, {
            personId: null,
            name: cleanName,
            useAsCop: true,
            initialZoom: 1.1,
          });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
      fileInput.value = '';
    });

    // Direct 60fps 1-Finger / Mouse Drag + 2-Finger Pinch-to-Zoom + Wheel Zoom on #photo-crop-canvas
    const activePointers = new Map();
    let pinchStartDist = 0;
    let pinchStartZoom = 1.1;
    let pinchLastMid = null;

    const refreshPinchBaseline = () => {
      if (activePointers.size >= 2) {
        const [pA, pB] = Array.from(activePointers.values());
        pinchStartDist = Math.max(8, Math.hypot(pB.x - pA.x, pB.y - pA.y));
        pinchStartZoom = this.photoEditOpts.zoom;
        pinchLastMid = { x: (pA.x + pB.x) * 0.5, y: (pA.y + pB.y) * 0.5 };
      } else {
        pinchStartDist = 0;
        pinchLastMid = null;
      }
    };

    cropCanvas.addEventListener('pointerdown', (e) => {
      if (!this.photoCutoutSession) return;
      e.preventDefault();
      cropCanvas.setPointerCapture?.(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      cropCanvas.classList.add('dragging');
      if (activePointers.size >= 2) {
        refreshPinchBaseline();
      }
    });

    cropCanvas.addEventListener('pointermove', (e) => {
      if (!activePointers.has(e.pointerId) || !this.photoCutoutSession) return;
      e.preventDefault();
      const prev = activePointers.get(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const rect = cropCanvas.getBoundingClientRect();
      const boxW = Math.max(48, rect.width);
      const boxH = Math.max(48, rect.height);

      if (activePointers.size === 1) {
        const dx = e.clientX - prev.x;
        const dy = e.clientY - prev.y;
        this.photoEditOpts.offsetX = clampVal(this.photoEditOpts.offsetX + (dx / boxW) * 2, -1, 1);
        this.photoEditOpts.offsetY = clampVal(this.photoEditOpts.offsetY + (dy / boxH) * 2, -1, 1);
        drawInstantPreview();
      } else if (activePointers.size >= 2) {
        const [pA, pB] = Array.from(activePointers.values());
        const dist = Math.hypot(pB.x - pA.x, pB.y - pA.y);
        const mid = { x: (pA.x + pB.x) * 0.5, y: (pA.y + pB.y) * 0.5 };
        if (pinchStartDist > 8) {
          this.photoEditOpts.zoom = clampVal(pinchStartZoom * (dist / pinchStartDist), 0.7, 2.6);
        }
        if (pinchLastMid) {
          this.photoEditOpts.offsetX = clampVal(
            this.photoEditOpts.offsetX + ((mid.x - pinchLastMid.x) / boxW) * 2,
            -1,
            1
          );
          this.photoEditOpts.offsetY = clampVal(
            this.photoEditOpts.offsetY + ((mid.y - pinchLastMid.y) / boxH) * 2,
            -1,
            1
          );
        }
        pinchLastMid = mid;
        drawInstantPreview();
      }
    });

    const releaseCropPointer = (e) => {
      if (!activePointers.has(e.pointerId)) return;
      activePointers.delete(e.pointerId);
      refreshPinchBaseline();
      if (activePointers.size === 0) {
        cropCanvas.classList.remove('dragging');
      }
    };
    cropCanvas.addEventListener('pointerup', releaseCropPointer);
    cropCanvas.addEventListener('pointercancel', releaseCropPointer);
    cropCanvas.addEventListener('lostpointercapture', releaseCropPointer);

    cropCanvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.photoCutoutSession) return;
        e.preventDefault();
        const nextZoom = clampVal(this.photoEditOpts.zoom - e.deltaY * 0.0022, 0.7, 2.6);
        this.photoEditOpts.zoom = nextZoom;
        drawInstantPreview();
      },
      { passive: false }
    );

    centerBtn.addEventListener('click', () => {
      this.photoEditOpts.zoom = this.editingPersonId ? 1.0 : 1.1;
      this.photoEditOpts.offsetX = 0;
      this.photoEditOpts.offsetY = 0;
      drawInstantPreview();
    });

    document.getElementById('cutout-shape-btns').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-shape]');
      if (!btn) return;
      const prevShape = this.photoEditOpts.shape;
      this.photoEditOpts.shape = btn.dataset.shape;
      if ((prevShape === 'full') !== (this.photoEditOpts.shape === 'full')) {
        rebuildCutoutSession();
      } else {
        drawInstantPreview();
      }
    });

    zoomRng.addEventListener('input', () => {
      this.photoEditOpts.zoom = clampVal(Number(zoomRng.value), 0.7, 2.6);
      drawInstantPreview();
    });
    xRng.addEventListener('input', () => {
      this.photoEditOpts.offsetX = clampVal(Number(xRng.value) / 100, -1, 1);
      drawInstantPreview();
    });
    yRng.addEventListener('input', () => {
      this.photoEditOpts.offsetY = clampVal(Number(yRng.value) / 100, -1, 1);
      drawInstantPreview();
    });

    let tolRaf = 0;
    tolRng.addEventListener('input', () => {
      document.getElementById('val-photo-tol').textContent = tolRng.value;
      if (tolRaf) cancelAnimationFrame(tolRaf);
      tolRaf = requestAnimationFrame(() => {
        tolRaf = 0;
        rebuildCutoutSession();
      });
    });

    document.getElementById('btn-cancel-photo').addEventListener('click', () => {
      this.editingImage = null;
      this.editingPersonId = null;
      this.photoCutoutSession = null;
      editorBox.classList.add('hidden');
    });

    document.getElementById('btn-save-photo').addEventListener('click', async () => {
      if (!this.photoCutoutSession && !this.editingImage) return;
      const exportOpts = {
        zoom: this.photoEditOpts.zoom,
        offsetX: this.photoEditOpts.offsetX,
        offsetY: this.photoEditOpts.offsetY,
        magicCutout: this.photoEditOpts.shape !== 'full',
        tolerance: this.photoEditOpts.tolerance,
        shape: this.photoEditOpts.shape,
        normalizedOffsets: true,
      };
      const finalDataUrl = this.photoCutoutSession
        ? this.photos.exportSessionDataUrl(this.photoCutoutSession, exportOpts)
        : await this.photos.processImageToCutout(this.editingImage, exportOpts);
      if (!finalDataUrl) return;

      const saved = await this.photos.savePerson({
        id: this.editingPersonId || undefined,
        name: nameInp.value.trim() || 'Custom Hero',
        dataUrl: finalDataUrl,
        useAsCop: copChk.checked,
      });
      this.settings.avatarId = saved.id;
      saveSettings(this.settings);
      this.editingImage = null;
      this.editingPersonId = null;
      this.photoCutoutSession = null;
      editorBox.classList.add('hidden');

      this._syncAllPhotoTextures();
      this._refreshAllUiFromSettings();
      if (this.mode === 'attract') this._respawnAttractHero();
      if (this.net.roomCode) this.net.updateProfile(this._buildLocalNetProfile());
    });

    const customCopsToggle = document.getElementById('toggle-custom-cops');
    customCopsToggle.checked = this.settings.customCopsEnabled !== false;
    customCopsToggle.addEventListener('change', () => {
      this.settings.customCopsEnabled = customCopsToggle.checked;
      saveSettings(this.settings);
      this._syncAllPhotoTextures();
    });
  }

  _renderPeopleGrid() {
    const grid = document.getElementById('people-grid');
    const people = this.photos.getPeople();
    grid.innerHTML = '';

    for (const person of people) {
      const card = document.createElement('div');
      card.className = `person-card${person.id === this.settings.avatarId ? ' selected' : ''}`;
      const safePersonImg = this._safeImgSrc(person.dataUrl);
      card.innerHTML = `
        <img src="${safePersonImg}" alt="${this._escapeHtml(person.name)}" />
        <div class="person-card-name">${this._escapeHtml(person.name)}</div>
        <div class="person-card-actions">
          <button type="button" class="tiny-pill ${person.useAsCop ? 'cop-on' : ''}" data-toggle-cop="${person.id}" title="Put this person's face onto AI police cars">
            ${person.useAsCop ? '🚔 Cop Face: ON' : 'Cop Face: OFF'}
          </button>
          ${
            person.builtIn
              ? ''
              : `<button type="button" class="tiny-pill edit-pill" data-edit-person="${person.id}">✏️ Edit</button>
                 <button type="button" class="tiny-pill" data-del-person="${person.id}">✕</button>`
          }
        </div>
      `;

      card.addEventListener('click', async (e) => {
        const copBtn = e.target.closest('[data-toggle-cop]');
        const editBtn = e.target.closest('[data-edit-person]');
        const delBtn = e.target.closest('[data-del-person]');
        if (copBtn) {
          e.stopPropagation();
          await this.photos.savePerson({ ...person, useAsCop: !person.useAsCop });
          this._syncAllPhotoTextures();
          this._renderPeopleGrid();
          return;
        }
        if (editBtn) {
          e.stopPropagation();
          const img = new Image();
          img.onload = () => {
            this._openEditorForImage?.(img, {
              personId: person.id,
              name: person.name || 'Custom Hero',
              useAsCop: person.useAsCop !== false,
              initialZoom: 1.0,
            });
          };
          img.src = person.dataUrl;
          return;
        }
        if (delBtn) {
          e.stopPropagation();
          await this.photos.deletePerson(person.id);
          if (this.settings.avatarId === person.id) {
            this.settings.avatarId = this.photos.getPeople()[0]?.id || 'default_hero';
            saveSettings(this.settings);
          }
          this._syncAllPhotoTextures();
          this._refreshAllUiFromSettings();
          if (this.net.roomCode) this.net.updateProfile(this._buildLocalNetProfile());
          return;
        }

        this.settings.avatarId = person.id;
        saveSettings(this.settings);
        this._refreshAllUiFromSettings();
        if (this.mode === 'attract') this._respawnAttractHero();
        if (this.net.roomCode) this.net.updateProfile(this._buildLocalNetProfile());
      });

      grid.appendChild(card);
    }
  }

  _bindGarageAndWorld() {
    // Paint swatches
    const swatchBox = document.getElementById('paint-swatches');
    swatchBox.innerHTML = '';
    for (const [prim, acc] of PAINT_SWATCHES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch-dot';
      btn.style.background = `linear-gradient(135deg, ${prim} 60%, ${acc} 60%)`;
      btn.addEventListener('click', () => {
        this.settings.primaryColor = prim;
        this.settings.accentColor = acc;
        saveSettings(this.settings);
        this._refreshAllUiFromSettings();
        if (this.mode === 'attract') this._respawnAttractHero();
        if (this.net.roomCode) this.net.updateProfile(this._buildLocalNetProfile());
      });
      swatchBox.appendChild(btn);
    }

    const pColor = document.getElementById('inp-primary-color');
    const aColor = document.getElementById('inp-accent-color');
    pColor.addEventListener('input', () => {
      this.settings.primaryColor = pColor.value;
      saveSettings(this.settings);
      if (this.mode === 'attract') this._respawnAttractHero();
      if (this.net.roomCode) this.net.updateProfile(this._buildLocalNetProfile());
    });
    aColor.addEventListener('input', () => {
      this.settings.accentColor = aColor.value;
      saveSettings(this.settings);
      if (this.mode === 'attract') this._respawnAttractHero();
      if (this.net.roomCode) this.net.updateProfile(this._buildLocalNetProfile());
    });

    // Garage stat sliders
    const universalRuleKeyMap = {
      speedMult: 'universalSpeedMult',
      driftMult: 'universalDriftMult',
      massMult: 'universalMassMult',
      scaleMult: 'universalScaleMult',
    };
    const hostWorldKeys = new Set(['copIntensity', 'startStars', 'gravityMult']);
    const bindSlider = (id, key, fmt) => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => {
        if (this.net.roomCode && !this.net.isHost) {
          if (hostWorldKeys.has(key)) {
            this._refreshAllUiFromSettings();
            this._showChaosToast('🔒 World settings are controlled by the Lobby Host!');
            return;
          }
          if (key in universalRuleKeyMap && this.settings.lobbyRules?.lockStats !== false) {
            this._refreshAllUiFromSettings();
            this._showChaosToast('🔒 Car stats are locked by the Lobby Manager!');
            return;
          }
        }
        const v = Number(el.value);
        this.settings[key] = v;
        if ((!this.net.roomCode || this.net.isHost) && universalRuleKeyMap[key]) {
          if (!this.settings.lobbyRules) this.settings.lobbyRules = {};
          this.settings.lobbyRules[universalRuleKeyMap[key]] = v;
        }
        saveSettings(this.settings);
        this._refreshAllUiFromSettings();
        if (this.mode === 'attract') this._respawnAttractHero();
        if (this.net.roomCode && this.net.isHost) {
          this.net.updateRoomSettings(this.settings);
          if (this.net.roomState && !document.getElementById('lobby-modal')?.classList.contains('hidden')) {
            this._renderLobbyRoom(this.net.roomState);
          }
        }
      });
      return fmt;
    };

    bindSlider('rng-speed-mult', 'speedMult');
    bindSlider('rng-drift-mult', 'driftMult');
    bindSlider('rng-mass-mult', 'massMult');
    bindSlider('rng-scale-mult', 'scaleMult');

    // 1-Tap Garage Tuning Presets
    const GARAGE_PRESETS = {
      balanced: { speedMult: 1.0, driftMult: 1.0, massMult: 1.0, scaleMult: 1.0, accelMult: 1.0 },
      drift:    { speedMult: 1.15, driftMult: 1.45, massMult: 0.85, scaleMult: 0.95, accelMult: 1.2 },
      speed:    { speedMult: 1.5, driftMult: 1.15, massMult: 0.9, scaleMult: 0.95, accelMult: 1.35 },
      tank:     { speedMult: 0.95, driftMult: 0.85, massMult: 1.7, scaleMult: 1.35, accelMult: 1.0 },
    };

    const applyGaragePreset = (presetKey) => {
      const vals = GARAGE_PRESETS[presetKey];
      if (!vals) return;
      if (this.net.roomCode && !this.net.isHost && this.settings.lobbyRules?.lockStats !== false) {
        this._refreshAllUiFromSettings();
        this._showChaosToast('🔒 Car stats are locked by the Lobby Manager!');
        return;
      }
      Object.assign(this.settings, vals);
      if (!this.net.roomCode || this.net.isHost) {
        if (!this.settings.lobbyRules) this.settings.lobbyRules = {};
        this.settings.lobbyRules.universalSpeedMult = vals.speedMult;
        this.settings.lobbyRules.universalDriftMult = vals.driftMult;
        this.settings.lobbyRules.universalMassMult = vals.massMult;
        this.settings.lobbyRules.universalScaleMult = vals.scaleMult;
      }
      saveSettings(this.settings);
      this._refreshAllUiFromSettings();
      if (this.mode === 'attract') this._respawnAttractHero();
      if (this.net.roomCode && this.net.isHost) {
        this.net.updateRoomSettings(this.settings);
        if (this.net.roomState && !document.getElementById('lobby-modal')?.classList.contains('hidden')) {
          this._renderLobbyRoom(this.net.roomState);
        }
      }
    };

    document.getElementById('garage-preset-btns').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-gpreset]');
      if (!btn) return;
      applyGaragePreset(btn.dataset.gpreset);
    });

    document.getElementById('btn-reset-garage').addEventListener('click', () => {
      applyGaragePreset('balanced');
    });

    // World & Map controls
    document.getElementById('biome-btns').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-biome]');
      if (!btn) return;
      if (this.net.roomCode && !this.net.isHost) {
        this._showChaosToast('🔒 Map is controlled by the Lobby Host!');
        return;
      }
      this.settings.biome = btn.dataset.biome;
      saveSettings(this.settings);
      this.world.reset(this.settings.worldSeed, this.settings.biome, {
        itemBoxDensity: this.settings.itemBoxDensity,
        sugarBoxRate: this.settings.sugarBoxRate,
      });
      this._refreshAllUiFromSettings();
      if (this.mode === 'attract') this._respawnAttractHero();
      if (this.net.roomCode && this.net.isHost) this.net.updateRoomSettings(this.settings);
    });

    document.getElementById('chk-ai-cops')?.addEventListener('change', (e) => {
      if (this.net.roomCode && !this.net.isHost) {
        this._refreshAllUiFromSettings();
        this._showChaosToast('🔒 AI Police setting is controlled by the Lobby Host!');
        return;
      }
      this.settings.aiCopsEnabled = Boolean(e.target.checked);
      saveSettings(this.settings);
      this.sim.updateSettings(this.settings);
      if (!this.settings.aiCopsEnabled) {
        this.sim.cops.length = 0;
        if (this.sim.localPlayer) this.sim.localPlayer.bustedProgress = 0;
      } else if (this.mode === 'attract') {
        this._respawnAttractHero();
      }
      this._refreshAllUiFromSettings();
      if (this.net.roomCode && this.net.isHost) this.net.updateRoomSettings(this.settings);
      this._showChaosToast(
        this.settings.aiCopsEnabled
          ? '🚔 AI Police Chase turned ON!'
          : '🚫 AI Police turned OFF — Zero computer cops!'
      );
    });

    bindSlider('rng-cop-intensity', 'copIntensity');
    bindSlider('rng-start-stars', 'startStars');
    bindSlider('rng-gravity', 'gravityMult');

    document.getElementById('rng-box-density').addEventListener('input', (e) => {
      if (this.net.roomCode && !this.net.isHost) {
        this._refreshAllUiFromSettings();
        this._showChaosToast('🔒 Drop rates & map settings are controlled by the Lobby Host!');
        return;
      }
      this.settings.itemBoxDensity = Number(clampNum(e.target.value, 0.1, 5.0, 1.2).toFixed(2));
      saveSettings(this.settings);
      this.world.reset(this.settings.worldSeed, this.settings.biome, {
        itemBoxDensity: this.settings.itemBoxDensity,
        sugarBoxRate: this.settings.sugarBoxRate,
      });
      this._refreshAllUiFromSettings();
      if (this.net.roomCode && this.net.isHost) this.net.updateRoomSettings(this.settings);
    });

    document.getElementById('rng-sugar-rate')?.addEventListener('input', (e) => {
      if (this.net.roomCode && !this.net.isHost) {
        this._refreshAllUiFromSettings();
        this._showChaosToast('🔒 Drop rates & map settings are controlled by the Lobby Host!');
        return;
      }
      this.settings.sugarBoxRate = Number(clampNum(e.target.value, 0, 5.0, 1.0).toFixed(2));
      saveSettings(this.settings);
      this.world.reset(this.settings.worldSeed, this.settings.biome, {
        itemBoxDensity: this.settings.itemBoxDensity,
        sugarBoxRate: this.settings.sugarBoxRate,
      });
      this._refreshAllUiFromSettings();
      if (this.net.roomCode && this.net.isHost) this.net.updateRoomSettings(this.settings);
    });

    document.getElementById('ability-rate-presets')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-rpreset]');
      if (!btn) return;
      if (this.net.roomCode && !this.net.isHost) {
        this._showChaosToast('🔒 Ability drop rates are controlled by the Lobby Host!');
        return;
      }
      this._applyAbilityRatePreset(btn.dataset.rpreset);
    });

    document.getElementById('camera-mode-btns').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cam]');
      if (!btn) return;
      this._setCameraMode(btn.dataset.cam, false);
    });

    document.getElementById('touch-style-btns').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-touch]');
      if (!btn) return;
      this.settings.touchStyle = btn.dataset.touch;
      this._clearTouchState();
      saveSettings(this.settings);
      this._refreshAllUiFromSettings();
    });
  }

  _renderCopVehicleGrid() {
    const grid = document.getElementById('cop-vehicle-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const guestCopsBlocked = Boolean(
      this.net.roomCode && !this.net.isHost && this.settings.lobbyRules?.allowPlayerCops === false
    );
    grid.classList.toggle('locked-ctrl', guestCopsBlocked);

    for (const cv of COP_VEHICLES) {
      const isSelected = this.settings.playerRole === 'cop' && this.settings.copVehicleId === cv.id;
      const spdPct = Math.round(Math.min(100, (cv.speed / 60) * 100));
      const hdlPct = Math.round(Math.min(100, (cv.handling / 4.6) * 100));
      const hpPct = Math.round(Math.min(100, (cv.maxHp / 225) * 100));

      const perks = [];
      if (cv.flying) {
        perks.push('<span class="cop-card-perk sky">🚁 Flies Over Buildings</span>');
      }
      if (cv.hasMissile) {
        perks.push('<span class="cop-card-perk missile">🎯 2s Soft-Homing Missiles</span>');
      } else {
        perks.push('<span class="cop-card-perk surge">🚨 2s Siren Surge + ? Items</span>');
      }

      const card = document.createElement('button');
      card.type = 'button';
      card.className = `cop-vehicle-card${isSelected ? ' selected' : ''}`;
      card.dataset.copCard = cv.id;
      card.innerHTML = `
        <div class="cop-card-top">
          <span class="cop-card-title"><span>${cv.icon}</span><span>${this._escapeHtml(cv.name)}</span></span>
          <span class="veh-stats">SPD ${cv.speed} · HP ${cv.maxHp}</span>
        </div>
        <div class="cop-card-perks">${perks.join('')}</div>
        <div class="cop-card-desc">${this._escapeHtml(cv.desc || '')}</div>
        <div class="veh-bars">
          <div class="veh-bar-row"><span class="veh-bar-lbl">SPD</span><div class="veh-bar-track"><div class="veh-bar-fill" style="width:${spdPct}%"></div></div></div>
          <div class="veh-bar-row"><span class="veh-bar-lbl">HDL</span><div class="veh-bar-track"><div class="veh-bar-fill hdl" style="width:${hdlPct}%"></div></div></div>
          <div class="veh-bar-row"><span class="veh-bar-lbl">HP</span><div class="veh-bar-track"><div class="veh-bar-fill hp" style="width:${hpPct}%"></div></div></div>
        </div>
      `;
      card.addEventListener('click', () => {
        if (guestCopsBlocked) {
          this._showChaosToast('🔒 Playing as Police is disabled by the Lobby Host!');
          return;
        }
        this.settings.playerRole = 'cop';
        this.settings.copVehicleId = cv.id;
        saveSettings(this.settings);
        this._refreshAllUiFromSettings();
        if (this.mode === 'attract') this._respawnAttractHero();
        if (this.net.roomCode) {
          this.net.updateProfile(this._buildLocalNetProfile());
        }
      });
      grid.appendChild(card);
    }
  }

  _renderVehicleGrid() {
    const grid = document.getElementById('vehicle-grid');
    grid.innerHTML = '';
    for (const veh of VEHICLES) {
      const spdPct = Math.round(Math.min(100, (veh.speed / 60) * 100));
      const hdlPct = Math.round(Math.min(100, (veh.handling / 4.6) * 100));
      const hpPct = Math.round(Math.min(100, (veh.maxHp / 190) * 100));
      const isSelected = this.settings.playerRole !== 'cop' && veh.id === this.settings.vehicleId;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `vehicle-card${isSelected ? ' selected' : ''}`;
      card.innerHTML = `
        <div class="veh-swatch" style="background: linear-gradient(90deg, ${veh.color} 72%, ${veh.accent} 72%)"></div>
        <div class="veh-name">${veh.name}</div>
        <div class="veh-stats">SPD ${veh.speed} · HP ${veh.maxHp}</div>
        <div class="veh-bars">
          <div class="veh-bar-row"><span class="veh-bar-lbl">SPD</span><div class="veh-bar-track"><div class="veh-bar-fill" style="width:${spdPct}%"></div></div></div>
          <div class="veh-bar-row"><span class="veh-bar-lbl">HDL</span><div class="veh-bar-track"><div class="veh-bar-fill hdl" style="width:${hdlPct}%"></div></div></div>
          <div class="veh-bar-row"><span class="veh-bar-lbl">HP</span><div class="veh-bar-track"><div class="veh-bar-fill hp" style="width:${hpPct}%"></div></div></div>
        </div>
      `;
      card.addEventListener('click', () => {
        if (this.net.roomCode && !this.net.isHost && this.settings.lobbyRules?.allowCarChoice === false) {
          this._showChaosToast('🔒 Car choice is locked to Same Car by the Lobby Manager!');
          return;
        }
        this.settings.playerRole = 'runner';
        this.settings.vehicleId = veh.id;
        this.settings.primaryColor = veh.color;
        this.settings.accentColor = veh.accent;
        if (!this.net.roomCode || this.net.isHost) {
          this.settings.lobbyRules.universalVehicleId = veh.id;
        }
        saveSettings(this.settings);
        this._refreshAllUiFromSettings();
        if (this.mode === 'attract') this._respawnAttractHero();
        if (this.net.roomCode) {
          this.net.updateProfile(this._buildLocalNetProfile());
          if (this.net.isHost) this.net.updateRoomSettings(this.settings);
        }
      });
      grid.appendChild(card);
    }
  }

  _ensureItemWeights() {
    this.settings.itemWeights = cloneItemWeights(this.settings.itemWeights);
    return this.settings.itemWeights;
  }

  _updateLoadoutSummaryLabel() {
    const s = this.settings;
    const summaryEl = document.getElementById('home-loadout-summary');
    if (!summaryEl) return;
    const biome = BIOMES[s.biome] || BIOMES.city;
    const enabledCount = ABILITIES.filter((a) => s.enabledItems[a.id] !== false).length;
    if (s.playerRole === 'cop') {
      const copVeh = COP_VEHICLES.find((c) => c.id === s.copVehicleId) || COP_VEHICLES[2] || COP_VEHICLES[0];
      summaryEl.textContent = `Police Team · ${copVeh.name} · ${biome.name} · ${enabledCount} Items`;
      return;
    }
    const veh = VEHICLES.find((v) => v.id === s.vehicleId) || VEHICLES[0];
    const modeObj = CHARACTER_MODES.find((m) => m.id === s.characterMode) || CHARACTER_MODES[0];
    summaryEl.textContent = `${modeObj.name} · ${veh.name} · ${biome.name} · ${enabledCount} Items`;
  }

  _applyAbilityRatePreset(presetId) {
    if (document.activeElement?.matches?.('.ab-rate-num')) {
      document.activeElement.blur();
    }
    const weights = this._ensureItemWeights();
    let toastMsg = '';

    if (presetId === 'default') {
      for (const ab of ABILITIES) {
        this.settings.enabledItems[ab.id] = true;
        weights[ab.id] = 100;
      }
      toastMsg = '↺ Reset all 9 abilities to 100% drop rate!';
    } else if (presetId === 'equal') {
      const anyEnabled = ABILITIES.some((ab) => this.settings.enabledItems[ab.id] !== false);
      if (!anyEnabled) {
        for (const ab of ABILITIES) this.settings.enabledItems[ab.id] = true;
      }
      for (const ab of ABILITIES) {
        weights[ab.id] = clampDropRatePct(100 / (ab.weight || 1));
      }
      toastMsg = '⚖️ Exact equal roll % set across active abilities!';
    } else if (presetId === 'boost500') {
      for (const ab of ABILITIES) {
        this.settings.enabledItems[ab.id] = true;
        weights[ab.id] = 500;
      }
      toastMsg = '🔥 All 9 abilities cranked to 500% drop rate!';
    } else if (presetId === 'rpg1000') {
      for (const ab of ABILITIES) {
        this.settings.enabledItems[ab.id] = true;
        weights[ab.id] = ab.id === 'homing_rocket' ? 1000 : 0.1;
      }
      toastMsg = '🚀 1000% Twin RPG / 0.1% everything else!';
    } else if (presetId === 'sugar1000') {
      this.settings.enabledItems.sugar_rush = true;
      for (const ab of ABILITIES) {
        weights[ab.id] = ab.id === 'sugar_rush' ? 1000 : 100;
      }
      toastMsg = '🍭 1000% 3x Sugar Rush drop rate!';
    } else {
      return;
    }

    saveSettings(this.settings);
    this.abilities.updateSettings(this.settings);
    this._updateAbilityOddsLabels();
    this._updateLoadoutSummaryLabel();
    if (this.net.roomCode && this.net.isHost) {
      this.net.updateRoomSettings(this.settings);
    }
    if (toastMsg) this._showChaosToast(toastMsg);
  }

  _renderAbilityMixer() {
    const grid = document.getElementById('ability-mixer-grid');
    if (!grid) return;
    this._ensureItemWeights();

    // Build persistent DOM cards once so slider drags & number typing NEVER destroy active <input> focus!
    if (grid.querySelectorAll('[data-ability-card]').length !== ABILITIES.length) {
      grid.innerHTML = '';
      for (const ab of ABILITIES) {
        const card = document.createElement('div');
        card.className = 'ability-mixer-card';
        card.dataset.abilityCard = ab.id;
        card.style.setProperty('--ab-accent', ab.color || '#facc15');
        card.innerHTML = `
          <div class="ab-card-head">
            <div class="ab-title-group">
              <span class="ab-icon" aria-hidden="true">${ab.icon}</span>
              <span class="ab-name">${this._escapeHtml(ab.name)}</span>
            </div>
            <div class="ab-head-actions">
              <span class="ab-odds-badge" data-odds-badge="${ab.id}">11.1% roll</span>
              <button
                type="button"
                class="ab-toggle-pill on"
                data-toggle-item="${ab.id}"
                aria-pressed="true"
                aria-label="Toggle ${this._escapeHtml(ab.name)}"
              >ON</button>
            </div>
          </div>
          <div class="ab-rate-controls" data-rate-row="${ab.id}">
            <div class="ab-slider-line">
              <input
                type="range"
                class="ab-rate-slider"
                data-rate-slider="${ab.id}"
                min="0"
                max="100"
                step="0.5"
                value="50"
                aria-label="${this._escapeHtml(ab.name)} drop probability slider"
              />
              <label class="ab-num-wrap">
                <input
                  type="number"
                  class="ab-rate-num"
                  data-rate-input="${ab.id}"
                  min="0.1"
                  max="1000"
                  step="0.1"
                  inputmode="decimal"
                  value="100"
                  aria-label="${this._escapeHtml(ab.name)} drop rate percent"
                />
                <span class="ab-pct-suffix">%</span>
              </label>
            </div>
            <div class="ab-quick-chips" role="group" aria-label="${this._escapeHtml(ab.name)} quick drop rates">
              <button type="button" class="ab-qchip" data-quick-ability="${ab.id}" data-quick-rate="0.1">0.1%</button>
              <button type="button" class="ab-qchip" data-quick-ability="${ab.id}" data-quick-rate="100">100%</button>
              <button type="button" class="ab-qchip" data-quick-ability="${ab.id}" data-quick-rate="500">500%</button>
              <button type="button" class="ab-qchip" data-quick-ability="${ab.id}" data-quick-rate="1000">1000%</button>
            </div>
          </div>
        `;

        const toggleBtn = card.querySelector('[data-toggle-item]');
        const sliderEl = card.querySelector('[data-rate-slider]');
        const numEl = card.querySelector('[data-rate-input]');

        toggleBtn?.addEventListener('click', () => {
          if (this.net.roomCode && !this.net.isHost) {
            this._showChaosToast('🔒 Ability drop rates are controlled by the Lobby Host!');
            return;
          }
          const curEnabled = this.settings.enabledItems[ab.id] !== false;
          const activeCount = ABILITIES.filter((a) => this.settings.enabledItems[a.id] !== false).length;
          if (curEnabled && activeCount <= 1) {
            this._showChaosToast('Keep at least 1 Mario Kart ability turned on!');
            return;
          }
          this.settings.enabledItems[ab.id] = !curEnabled;
          saveSettings(this.settings);
          this.abilities.updateSettings(this.settings);
          this._updateAbilityOddsLabels();
          this._updateLoadoutSummaryLabel();
          if (this.net.roomCode && this.net.isHost) this.net.updateRoomSettings(this.settings);
        });

        sliderEl?.addEventListener('input', () => {
          if (this.net.roomCode && !this.net.isHost) {
            this._updateAbilityOddsLabels();
            this._showChaosToast('🔒 Ability drop rates are controlled by the Lobby Host!');
            return;
          }
          if (numEl && document.activeElement === numEl) {
            numEl.blur();
          }
          const pct = clampDropRatePct(sliderToDropPct(Number(sliderEl.value)));
          this._ensureItemWeights()[ab.id] = pct;
          if (numEl) numEl.value = formatDropPctNumber(pct);
          saveSettings(this.settings);
          this.abilities.updateSettings(this.settings);
          this._updateAbilityOddsLabels({ skipSliderId: ab.id });
          if (this.net.roomCode && this.net.isHost) this.net.updateRoomSettings(this.settings);
        });

        numEl?.addEventListener('input', () => {
          if (this.net.roomCode && !this.net.isHost) {
            this._updateAbilityOddsLabels();
            return;
          }
          const raw = numEl.value.trim();
          if (raw === '' || raw === '.' || raw === '0' || raw === '0.') return;
          const parsed = Number(raw);
          if (!Number.isFinite(parsed) || parsed <= 0) return;
          const pct = clampDropRatePct(parsed);
          this._ensureItemWeights()[ab.id] = pct;
          if (sliderEl) {
            sliderEl.value = String(Number(dropPctToSlider(pct).toFixed(2)));
          }
          saveSettings(this.settings);
          this.abilities.updateSettings(this.settings);
          this._updateAbilityOddsLabels({ skipNumberId: ab.id, skipSliderId: ab.id });
          if (this.net.roomCode && this.net.isHost) this.net.updateRoomSettings(this.settings);
        });

        const commitNumberInput = () => {
          if (this.net.roomCode && !this.net.isHost) {
            this._updateAbilityOddsLabels();
            return;
          }
          const raw = numEl.value.trim();
          const fallback = this.settings.itemWeights?.[ab.id] ?? 100;
          const parsed = raw === '' ? fallback : Number(raw);
          const pct = clampDropRatePct(Number.isFinite(parsed) ? parsed : fallback);
          this._ensureItemWeights()[ab.id] = pct;
          numEl.value = formatDropPctNumber(pct);
          if (sliderEl) {
            sliderEl.value = String(Number(dropPctToSlider(pct).toFixed(2)));
          }
          saveSettings(this.settings);
          this.abilities.updateSettings(this.settings);
          this._updateAbilityOddsLabels({ skipNumberId: ab.id });
          if (this.net.roomCode && this.net.isHost) this.net.updateRoomSettings(this.settings);
        };

        numEl?.addEventListener('change', commitNumberInput);
        numEl?.addEventListener('blur', commitNumberInput);
        numEl?.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            numEl.blur();
          }
        });

        card.querySelectorAll('[data-quick-rate]').forEach((chip) => {
          chip.addEventListener('click', () => {
            if (this.net.roomCode && !this.net.isHost) {
              this._showChaosToast('🔒 Ability drop rates are controlled by the Lobby Host!');
              return;
            }
            if (this.settings.enabledItems[ab.id] === false) return;
            if (document.activeElement?.matches?.('.ab-rate-num')) {
              document.activeElement.blur();
            }
            const pct = clampDropRatePct(Number(chip.dataset.quickRate));
            this._ensureItemWeights()[ab.id] = pct;
            saveSettings(this.settings);
            this.abilities.updateSettings(this.settings);
            this._updateAbilityOddsLabels();
            if (this.net.roomCode && this.net.isHost) this.net.updateRoomSettings(this.settings);
          });
        });

        grid.appendChild(card);
      }
    }

    this._updateAbilityOddsLabels();
  }

  _updateAbilityOddsLabels(opts = {}) {
    const grid = document.getElementById('ability-mixer-grid');
    if (!grid) return;
    const weights = this._ensureItemWeights();
    const enabledItems = this.settings.enabledItems || {};
    const oddsMap = computeAbilityDropOdds(enabledItems, weights);
    const isGuestLocked = Boolean(this.net.roomCode && !this.net.isHost);

    for (const ab of ABILITIES) {
      const enabled = enabledItems[ab.id] !== false;
      const pct = clampDropRatePct(weights[ab.id] ?? 100);
      const odds = oddsMap[ab.id] ?? 0;

      const card = grid.querySelector(`[data-ability-card="${ab.id}"]`);
      if (!card) continue;
      card.classList.toggle('off', !enabled);
      card.classList.toggle('guest-locked', isGuestLocked);

      const badge = card.querySelector(`[data-odds-badge="${ab.id}"]`);
      if (badge) {
        badge.textContent = formatRollOddsLabel(odds, enabled);
        badge.classList.toggle('is-off', !enabled);
        badge.classList.toggle('is-boosted', enabled && pct > 100.05);
        badge.classList.toggle('is-low', enabled && pct < 10);
      }

      const toggleBtn = card.querySelector(`[data-toggle-item="${ab.id}"]`);
      if (toggleBtn) {
        toggleBtn.textContent = enabled ? 'ON' : 'OFF';
        toggleBtn.classList.toggle('on', enabled);
        toggleBtn.classList.toggle('off', !enabled);
        toggleBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
        toggleBtn.disabled = isGuestLocked;
      }

      const rateRow = card.querySelector(`[data-rate-row="${ab.id}"]`);
      const controlsDisabled = !enabled || isGuestLocked;
      rateRow?.classList.toggle('is-disabled', controlsDisabled);

      const sliderEl = card.querySelector(`[data-rate-slider="${ab.id}"]`);
      if (sliderEl) {
        sliderEl.disabled = controlsDisabled;
        if (opts.skipSliderId !== ab.id) {
          sliderEl.value = String(Number(dropPctToSlider(pct).toFixed(2)));
        }
      }

      const numEl = card.querySelector(`[data-rate-input="${ab.id}"]`);
      if (numEl) {
        numEl.disabled = controlsDisabled;
        if (opts.skipNumberId !== ab.id && document.activeElement !== numEl) {
          numEl.value = formatDropPctNumber(pct);
        }
      }

      card.querySelectorAll('[data-quick-rate]').forEach((chip) => {
        const chipRate = Number(chip.dataset.quickRate);
        chip.disabled = controlsDisabled;
        chip.classList.toggle('active', enabled && Math.abs(pct - chipRate) < 0.05);
      });
    }

    const allEnabled = ABILITIES.every((a) => enabledItems[a.id] !== false);
    const activeAbilities = ABILITIES.filter((a) => enabledItems[a.id] !== false);
    const presetMatches = {
      default: allEnabled && ABILITIES.every((a) => Math.abs((weights[a.id] ?? 100) - 100) < 0.05),
      equal:
        activeAbilities.length > 0 &&
        activeAbilities.every(
          (a) => Math.abs((weights[a.id] ?? 100) - clampDropRatePct(100 / (a.weight || 1))) < 0.15
        ),
      boost500: allEnabled && ABILITIES.every((a) => Math.abs((weights[a.id] ?? 100) - 500) < 0.05),
      rpg1000:
        allEnabled &&
        ABILITIES.every((a) =>
          Math.abs((weights[a.id] ?? 100) - (a.id === 'homing_rocket' ? 1000 : 0.1)) < 0.05
        ),
      sugar1000:
        enabledItems.sugar_rush !== false &&
        ABILITIES.every((a) =>
          Math.abs((weights[a.id] ?? 100) - (a.id === 'sugar_rush' ? 1000 : 100)) < 0.05
        ),
    };

    document.querySelectorAll('#ability-rate-presets [data-rpreset]').forEach((btn) => {
      const pid = btn.dataset.rpreset;
      btn.disabled = isGuestLocked;
      btn.classList.toggle('active', Boolean(presetMatches[pid]));
    });
  }

  _bindSoundStudio() {
    const volRng = document.getElementById('rng-volume');
    volRng.value = String(this.settings.soundVolume ?? 0.85);
    volRng.addEventListener('input', () => {
      const v = Number(volRng.value);
      this.settings.soundVolume = v;
      this.sound.setVolume(v);
      const pct = `${Math.round(v * 100)}%`;
      document.getElementById('val-volume').textContent = pct;
      document.getElementById('rng-settings-vol').value = String(v);
      document.getElementById('val-settings-vol').textContent = pct;
      saveSettings(this.settings);
    });
    this._renderSoundSlots();
  }

  _renderSoundSlots() {
    this._updateSoundLobbyBanner();
    const list = document.getElementById('sound-slots-list');
    if (!list) return;
    const summary = this.sound.getSavedSlotsSummary();
    const canMic = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    list.innerHTML = '';

    for (const slot of SOUND_SLOTS) {
      const info = SOUND_SLOT_LABELS[slot];
      const slotState = summary[slot] || { hasCustom: false };
      const isRec = this.recordingSlot === slot;

      const row = document.createElement('div');
      row.className = `sound-slot-row${slotState.hasCustom ? ' custom' : ''}`;
      row.innerHTML = `
        <div>
          <strong>${info.title}</strong>
          <div style="font-size:11.5px;color:#94a3b8">
            ${slotState.hasCustom ? `Custom voice clip saved (${(slotState.duration || 1).toFixed(1)}s)` : info.hint}
          </div>
        </div>
        <div class="sound-slot-actions">
          ${
            canMic
              ? `<button type="button" class="arcade-btn small ${isRec ? 'red' : 'gold'}" data-rec-slot="${slot}">
                   ${isRec ? '⏹ Stop' : '🎙️ Record'}
                 </button>`
              : ''
          }
          <label class="arcade-btn small cyan" style="cursor:pointer">
            📁 Upload Clip
            <input type="file" accept="audio/*,video/*" data-upload-slot="${slot}" hidden />
          </label>
          <button type="button" class="arcade-btn small dark" data-play-slot="${slot}">▶ Hear</button>
          ${
            slotState.hasCustom
              ? `<button type="button" class="arcade-btn small dark" data-clear-slot="${slot}">Reset</button>`
              : ''
          }
        </div>
      `;

      row.querySelector('[data-rec-slot]')?.addEventListener('click', async () => {
        this.sound.unlock();
        if (this.recordingSlot === slot) {
          this.recordingSlot = null;
          const savedRec = await this.sound.stopMicRecording(slot).catch(() => null);
          this._renderSoundSlots();
          this.sound.previewSlot(slot);
          if (savedRec) {
            this._pushHostSoundSlotToLobby(slot, false);
          }
        } else {
          try {
            this.recordingSlot = slot;
            this._renderSoundSlots();
            await this.sound.startMicRecording(async () => {
              this.recordingSlot = null;
              const savedRec = await this.sound.stopMicRecording(slot).catch(() => null);
              this._renderSoundSlots();
              this.sound.previewSlot(slot);
              if (savedRec) {
                this._pushHostSoundSlotToLobby(slot, false);
              }
            });
          } catch {
            this.recordingSlot = null;
            this._renderSoundSlots();
            alert('Microphone blocked here — tap "Upload Clip" to pick or record a phone clip!');
          }
        }
      });

      row.querySelector('[data-upload-slot]')?.addEventListener('change', async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        this.sound.unlock();
        try {
          await this.sound.uploadAudioFile(slot, file);
          this._renderSoundSlots();
          this.sound.previewSlot(slot);
          this._pushHostSoundSlotToLobby(slot, false);
        } catch {
          alert('Could not read that sound clip — try a short audio or camera clip.');
        }
      });

      row.querySelector('[data-play-slot]')?.addEventListener('click', () => {
        this.sound.unlock();
        this.sound.previewSlot(slot);
      });

      row.querySelector('[data-clear-slot]')?.addEventListener('click', async () => {
        await this.sound.clearCustomSound(slot);
        this._renderSoundSlots();
        this._pushHostSoundSlotToLobby(slot, true);
      });

      list.appendChild(row);
    }
  }

  _getLobbyHostName(room = this.net.roomState) {
    if (room?.players && room?.hostId) {
      const hostPlayer = room.players.find((p) => p.id === room.hostId);
      if (hostPlayer?.name) return hostPlayer.name;
    }
    return this._lobbyHostName || 'Host';
  }

  _updateSoundLobbyBanner() {
    const banner = document.getElementById('sound-lobby-banner');
    if (!banner) return;
    const shareOn = this.settings.lobbyRules?.shareHostSounds !== false;
    if (this.net.roomCode && this.net.isHost && shareOn) {
      banner.textContent =
        '👑 Lobby Owner: Every sound you record, upload, or clear here syncs LIVE to everyone in your lobby!';
      banner.classList.remove('hidden', 'is-guest');
      banner.classList.add('is-host');
    } else if (this.net.roomCode && !this.net.isHost && shareOn) {
      const hostName = this._getLobbyHostName();
      banner.textContent = `🔊 Playing ${hostName}'s Custom Sound Pack in this lobby (your own saved sounds come back when you leave!).`;
      banner.classList.remove('hidden', 'is-host');
      banner.classList.add('is-guest');
    } else {
      banner.textContent = '';
      banner.classList.add('hidden');
      banner.classList.remove('is-host', 'is-guest');
    }
  }

  async _pushAllHostSoundsToLobby() {
    if (!this.net.roomCode || !this.net.isHost) return;
    if (this.settings.lobbyRules?.shareHostSounds === false) return;
    if (typeof this.sound.exportAllCustomSoundsForNetwork !== 'function') return;
    try {
      const slots = await this.sound.exportAllCustomSoundsForNetwork();
      if (!this.net.roomCode || !this.net.isHost || this.settings.lobbyRules?.shareHostSounds === false) return;
      for (const s of slots || []) {
        if (s && s.slot && s.dataUrl) {
          this.net.syncHostSound?.(s.slot, s.dataUrl, s.label);
        }
      }
    } catch {
      // Ignore export error without interrupting lobby sync
    }
  }

  async _pushHostSoundSlotToLobby(slot, cleared = false) {
    if (!this.net.roomCode || !this.net.isHost) return;
    if (this.settings.lobbyRules?.shareHostSounds === false) return;
    try {
      if (cleared) {
        this.net.syncHostSound?.(slot, null);
        return;
      }
      if (typeof this.sound.exportSlotForNetwork !== 'function') return;
      const exp = await this.sound.exportSlotForNetwork(slot);
      if (!this.net.roomCode || !this.net.isHost || this.settings.lobbyRules?.shareHostSounds === false) return;
      if (exp && exp.dataUrl) {
        this.net.syncHostSound?.(slot, exp.dataUrl, exp.label);
      } else {
        this.net.syncHostSound?.(slot, null);
      }
    } catch {
      // Ignore export error
    }
  }

  _refreshAllUiFromSettings() {
    const s = this.settings;
    const person = this._getSelectedPerson();
    const homeImg = document.getElementById('home-avatar-img');
    if (homeImg && person?.dataUrl) homeImg.src = person.dataUrl;

    const isCopRole = s.playerRole === 'cop';
    const copVeh = COP_VEHICLES.find((c) => c.id === s.copVehicleId) || COP_VEHICLES[2] || COP_VEHICLES[0];

    document.querySelectorAll('[data-role]').forEach((el) => {
      el.classList.toggle('active', el.dataset.role === (isCopRole ? 'cop' : 'runner'));
    });
    document.querySelectorAll('#lobby-cop-pills [data-cop-veh]').forEach((el) => {
      el.classList.toggle('active', el.dataset.copVeh === copVeh?.id);
    });
    document.querySelectorAll('[data-mode]').forEach((el) => {
      el.classList.toggle('active', !isCopRole && el.dataset.mode === s.characterMode);
    });

    const veh = VEHICLES.find((v) => v.id === s.vehicleId) || VEHICLES[0];
    this._updateLoadoutSummaryLabel();

    const homeCarName = document.getElementById('home-car-name');
    if (homeCarName) {
      homeCarName.textContent = isCopRole ? `${copVeh.icon} ${copVeh.name}` : veh.name;
      homeCarName.classList.toggle('cop-active', isCopRole);
    }

    document.getElementById('home-mode-pills')?.classList.toggle('hidden', isCopRole);
    const homeCopPerk = document.getElementById('home-cop-perk-badge');
    if (homeCopPerk) {
      homeCopPerk.classList.toggle('hidden', !isCopRole);
      if (isCopRole) {
        homeCopPerk.textContent =
          copVeh.id === 'cop_heli'
            ? '🚁 Flies + 🎯 2s Missiles'
            : copVeh.id === 'cop_tank'
              ? '🪖 Tank Armor + 🎯 2s Missiles'
              : copVeh.id === 'cop_swat'
                ? '🛡️ SWAT Ram + 🚨 2s Surge'
                : '🚔 V8 Pursuit + 🚨 2s Surge';
      }
    }

    document.getElementById('lobby-mode-pills')?.classList.toggle('hidden', isCopRole);
    document.getElementById('lobby-cop-pills')?.classList.toggle('hidden', !isCopRole);

    const soloSubEl = document.querySelector('#btn-play-solo .btn-sub-text');
    if (soloSubEl) {
      soloSubEl.textContent = isCopRole
        ? `${copVeh.icon} Hunt Outlaws · ${copVeh.hasMissile ? '2s Missiles' : 'Siren Purge'}`
        : s.aiCopsEnabled === false
          ? 'Free-Roam Stunt & ? Box Run'
          : 'Instant 5-Star Police Chase';
    }

    const cycleBiomeBtn = document.getElementById('btn-cycle-biome');
    if (cycleBiomeBtn) cycleBiomeBtn.textContent = BIOME_SHORT_LABELS[s.biome] || '🏙️ City';

    const bestTimeEl = document.getElementById('best-time-label');
    if (bestTimeEl) bestTimeEl.textContent = `${this.best.bestTime.toFixed(1)}s`;
    const bestScoreEl = document.getElementById('best-score-label');
    if (bestScoreEl) bestScoreEl.textContent = String(Math.round(this.best.bestScore));

    const primInp = document.getElementById('inp-primary-color');
    if (primInp) primInp.value = s.primaryColor;
    const accInp = document.getElementById('inp-accent-color');
    if (accInp) accInp.value = s.accentColor;

    const guestStatsLocked = Boolean(this.net.roomCode && !this.net.isHost && s.lobbyRules?.lockStats !== false);
    const dispSpeed = guestStatsLocked ? s.lobbyRules?.universalSpeedMult ?? 1.0 : s.speedMult;
    const dispDrift = guestStatsLocked ? s.lobbyRules?.universalDriftMult ?? 1.0 : s.driftMult;
    const dispMass = guestStatsLocked ? s.lobbyRules?.universalMassMult ?? 1.0 : s.massMult;
    const dispScale = guestStatsLocked ? s.lobbyRules?.universalScaleMult ?? 1.0 : s.scaleMult;
    const lockSuffix = guestStatsLocked ? ' 🔒' : '';

    const setRangeAndVal = (rngId, valId, val, text, disabled = false) => {
      const rEl = document.getElementById(rngId);
      const vEl = document.getElementById(valId);
      if (rEl) {
        rEl.value = String(val);
        rEl.disabled = disabled;
      }
      if (vEl) vEl.textContent = text;
    };

    setRangeAndVal('rng-speed-mult', 'val-speed-mult', dispSpeed, `${Math.round(dispSpeed * 100)}%${lockSuffix}`, guestStatsLocked);
    setRangeAndVal('rng-drift-mult', 'val-drift-mult', dispDrift, `${Math.round(dispDrift * 100)}%${lockSuffix}`, guestStatsLocked);
    setRangeAndVal('rng-mass-mult', 'val-mass-mult', dispMass, `${Math.round(dispMass * 100)}%${lockSuffix}`, guestStatsLocked);
    setRangeAndVal('rng-scale-mult', 'val-scale-mult', dispScale, `${Math.round(dispScale * 100)}%${lockSuffix}`, guestStatsLocked);

    const guestWorldLocked = Boolean(this.net.roomCode && !this.net.isHost);
    const worldLockSuffix = guestWorldLocked ? ' 🔒' : '';
    const aiCopsOn = s.aiCopsEnabled !== false;
    document.getElementById('world-guest-lock-note')?.classList.toggle('hidden', !guestWorldLocked);
    document.getElementById('biome-btns')?.classList.toggle('locked-ctrl', guestWorldLocked);

    const chkAiCops = document.getElementById('chk-ai-cops');
    if (chkAiCops) {
      chkAiCops.checked = aiCopsOn;
      chkAiCops.disabled = guestWorldLocked;
    }
    const aiCopsLabelWrap = chkAiCops?.closest('.ai-cops-world-switch');
    aiCopsLabelWrap?.classList.toggle('is-off', !aiCopsOn);
    const aiCopsStateLbl = document.getElementById('lbl-ai-cops-state');
    if (aiCopsStateLbl) {
      aiCopsStateLbl.textContent = aiCopsOn
        ? `ON — 5-Star Police Pursuit${worldLockSuffix}`
        : `OFF — No AI Cops${worldLockSuffix}`;
    }
    document.getElementById('ai-cop-sliders-wrap')?.classList.toggle('is-off', !aiCopsOn);

    document.querySelectorAll('#biome-btns .seg-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.biome === s.biome)
    );
    const boxDens = clampNum(s.itemBoxDensity, 0.1, 5.0, 1.2);
    const sugarRate = clampNum(s.sugarBoxRate, 0, 5.0, 1.0);
    setRangeAndVal(
      'rng-cop-intensity',
      'val-cop-intensity',
      s.copIntensity,
      aiCopsOn ? `${Math.round(s.copIntensity * 100)}%${worldLockSuffix}` : `OFF — No AI Cops${worldLockSuffix}`,
      guestWorldLocked || !aiCopsOn
    );
    setRangeAndVal(
      'rng-start-stars',
      'val-start-stars',
      s.startStars,
      aiCopsOn ? `${s.startStars} ★${worldLockSuffix}` : `OFF${worldLockSuffix}`,
      guestWorldLocked || !aiCopsOn
    );
    setRangeAndVal(
      'rng-box-density',
      'val-box-density',
      boxDens,
      `${Math.round(boxDens * 100)}%${worldLockSuffix}`,
      guestWorldLocked
    );
    setRangeAndVal(
      'rng-sugar-rate',
      'val-sugar-rate',
      sugarRate,
      `${Math.round(sugarRate * 100)}%${worldLockSuffix}`,
      guestWorldLocked
    );
    setRangeAndVal(
      'rng-gravity',
      'val-gravity',
      s.gravityMult,
      `${s.gravityMult < 0.85 ? 'Moon Jumps' : s.gravityMult > 1.1 ? 'Heavy' : 'Normal'}${worldLockSuffix}`,
      guestWorldLocked
    );

    document.querySelectorAll('#camera-mode-btns [data-cam], #settings-cam-btns [data-cam]').forEach((b) =>
      b.classList.toggle('active', b.dataset.cam === s.cameraMode)
    );
    document.querySelectorAll('#touch-style-btns [data-touch], #settings-touch-btns [data-touch]').forEach((b) =>
      b.classList.toggle('active', b.dataset.touch === s.touchStyle)
    );
    document.querySelectorAll('#settings-gfx-btns [data-gfx]').forEach((b) =>
      b.classList.toggle('active', b.dataset.gfx === s.graphicsQuality)
    );
    document.querySelectorAll('#settings-unit-btns [data-unit]').forEach((b) =>
      b.classList.toggle('active', b.dataset.unit === s.speedUnit)
    );
    document.querySelectorAll('#hud-preset-btns [data-hpreset], #settings-hpreset-btns [data-hpreset]').forEach((b) =>
      b.classList.toggle('active', b.dataset.hpreset === s.hudLayoutPreset)
    );

    // Sync Personal Settings sliders & toggles
    const fov = Math.round(clampNum(s.povFov, 62, 96, 78));
    setRangeAndVal('rng-pov-fov', 'val-pov-fov', fov, `${fov}°`);

    const shake = clampNum(s.cameraShakeMult, 0, 1.5, 1.0);
    setRangeAndVal('rng-cam-shake', 'val-cam-shake', shake, `${Math.round(shake * 100)}%`);

    const sens = clampNum(s.steerSensitivity, 0.7, 1.4, 1.0);
    setRangeAndVal('rng-steer-sens', 'val-steer-sens', sens, `${Math.round(sens * 100)}%`);

    const dz = clampNum(s.steerDeadzone, 0, 0.22, 0.05);
    setRangeAndVal('rng-steer-deadzone', 'val-steer-deadzone', dz, `${Math.round(dz * 100)}%`);

    const vol = clampNum(s.soundVolume, 0, 1, 0.85);
    const volPct = `${Math.round(vol * 100)}%`;
    setRangeAndVal('rng-volume', 'val-volume', vol, volPct);
    setRangeAndVal('rng-settings-vol', 'val-settings-vol', vol, volPct);

    const engVol = clampNum(s.sfxEngineVol, 0, 1, 0.85);
    setRangeAndVal('rng-engine-vol', 'val-engine-vol', engVol, `${Math.round(engVol * 100)}%`);

    const actVol = clampNum(s.sfxActionVol, 0, 1, 1.0);
    setRangeAndVal('rng-action-vol', 'val-action-vol', actVol, `${Math.round(actVol * 100)}%`);

    this.renderer.setGraphicsQuality?.(s.graphicsQuality || 'high');
    this.sound.setVolume(vol);
    this.sound.setChannelVolumes?.({ engine: engVol, action: actVol });

    const setChk = (id, checked) => {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(checked);
    };
    const showSpeedo = s.showSpeedometer !== false;
    const showQuickCam = s.showQuickCamBtn !== false;
    const showMinimap = s.showMinimap !== false;
    const showFps = Boolean(s.showFps);

    setChk('chk-show-desktop-btns', s.showTouchControlsDesktop !== false);
    setChk('chk-show-keyhints', s.showKeyHints !== false);
    setChk('chk-show-minimap', showMinimap);
    setChk('chk-show-speedo', showSpeedo);
    setChk('chk-show-fps', showFps);
    setChk('chk-show-quickcam', showQuickCam);
    setChk('chk-screen-fx', s.screenEffects !== false);
    setChk('chk-auto-accel', s.autoAccelerate !== false);
    setChk('chk-invert-steer', Boolean(s.invertSteer));
    setChk('chk-haptics', s.haptics !== false);

    const speedoEl = document.getElementById('hud-speedo');
    if (speedoEl) {
      speedoEl.classList.toggle('hidden', !showSpeedo);
      const unitEl = speedoEl.querySelector('#hud-speedo-unit, .speedo-unit');
      if (unitEl) unitEl.textContent = s.speedUnit === 'kmh' ? 'KM/H' : 'MPH';
    }

    document.getElementById('hud-minimap')?.classList.toggle('hidden', !showMinimap);
    document.getElementById('hud-fps')?.classList.toggle('hidden', !showFps);

    const quickCamBtn = document.getElementById('btn-quick-cam');
    if (quickCamBtn) {
      quickCamBtn.classList.toggle('hidden', !showQuickCam);
      quickCamBtn.classList.toggle('pov-active', s.cameraMode === 'pov');
    }

    // Highlight matching 1-tap garage preset pill if active
    const presetChecks = {
      balanced: [1.0, 1.0, 1.0],
      drift: [1.15, 1.45, 0.85],
      speed: [1.5, 1.15, 0.9],
      tank: [0.95, 0.85, 1.7],
    };
    document.querySelectorAll('#garage-preset-btns .preset-pill').forEach((pill) => {
      const target = presetChecks[pill.dataset.gpreset];
      const isMatch = Boolean(
        target &&
          Math.abs(dispSpeed - target[0]) < 0.03 &&
          Math.abs(dispDrift - target[1]) < 0.03 &&
          Math.abs(dispMass - target[2]) < 0.03
      );
      pill.classList.toggle('active', isMatch);
    });

    this._setSettingsTab(this.activeSettingsTab || 'camera');
    this._updateHudKeycaps();
    this._renderKeybindsList();
    this._applyHudLayout();
    this._syncHudEditorInspector();
    this._syncInstallAppUi();
    this._renderPeopleGrid();
    this._renderCopVehicleGrid();
    this._renderVehicleGrid();
    this._renderAbilityMixer();
    this._updateSoundLobbyBanner();
    this._syncSimPersonalSettings();
  }

  // ======================== MULTIPLAYER PARTY LOBBY ========================

  _openLobbyModal() {
    document.getElementById('lobby-modal').classList.remove('hidden');
    document.getElementById('lobby-error').classList.add('hidden');
    const inRoom = Boolean(this.net.roomCode);
    document.getElementById('lobby-entry').classList.toggle('hidden', inRoom);
    document.getElementById('lobby-room').classList.toggle('hidden', !inRoom);
    if (inRoom && this.net.roomState) {
      this._renderLobbyRoom(this.net.roomState);
    }
  }

  async _joinPartyRoom(code) {
    const clean = String(code || '').trim().toUpperCase();
    if (!clean) return;
    document.getElementById('lobby-error').classList.add('hidden');
    this._requestWakeLock();
    try {
      await this.net.joinRoom(clean, this._buildLocalNetProfile());
    } catch {
      this._showLobbyError('Could not connect to party relay. Check your internet connection and try again!');
    }
  }

  _requestWakeLock() {
    if (navigator.wakeLock && typeof navigator.wakeLock.request === 'function') {
      navigator.wakeLock.request('screen').catch(() => {});
    }
  }

  _showLobbyError(msg) {
    const el = document.getElementById('lobby-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  _bindMultiplayerEvents() {
    document.getElementById('btn-create-room').addEventListener('click', async () => {
      this.sound.unlock();
      this._requestWakeLock();
      document.getElementById('lobby-error').classList.add('hidden');
      try {
        this.isReadyInLobby = true;
        this.settings.lobbyRules = {
          ...(this.settings.lobbyRules || {}),
          shareHostSounds: this.settings.lobbyRules?.shareHostSounds !== false,
          universalSpeedMult: this.settings.speedMult || 1.0,
          universalDriftMult: this.settings.driftMult || 1.0,
          universalMassMult: this.settings.massMult || 1.0,
          universalScaleMult: this.settings.scaleMult || 1.0,
          universalVehicleId: this.settings.vehicleId || 'sedan',
          universalCharacterMode: this.settings.characterMode || 'car_driver',
        };
        saveSettings(this.settings);
        await this.net.createRoom(this._buildLocalNetProfile(), this.settings);
      } catch {
        this._showLobbyError('Could not connect to party relay. Check your internet connection!');
      }
    });

    this._bindHostManagerControls();

    document.getElementById('btn-join-room').addEventListener('click', () => {
      this.sound.unlock();
      const code = document.getElementById('join-code-input').value;
      this.isReadyInLobby = true;
      this._joinPartyRoom(code);
    });

    document.getElementById('btn-leave-room').addEventListener('click', () => {
      this.net.leaveRoom();
      this._wasHost = false;
      this._lobbyHostName = '';
      this.sound.clearLobbySounds?.();
      window.history.replaceState({}, '', window.location.pathname);
      this._refreshAllUiFromSettings();
      this._openLobbyModal();
    });

    document.getElementById('btn-toggle-ready').addEventListener('click', () => {
      this.isReadyInLobby = !this.isReadyInLobby;
      this.net.setReady(this.isReadyInLobby);
    });

    document.getElementById('btn-host-start').addEventListener('click', () => {
      this.sound.unlock();
      const randomSeed = Math.floor(100000 + Math.random() * 899999);
      this.net.startMatch(randomSeed);
    });

    document.getElementById('btn-copy-link').addEventListener('click', async () => {
      const shareUrl = this.net.getShareUrl();
      try {
        await navigator.clipboard.writeText(shareUrl);
        document.getElementById('btn-copy-link').textContent = 'Copied!';
        setTimeout(() => {
          document.getElementById('btn-copy-link').textContent = 'Copy Link';
        }, 1600);
      } catch {
        document.getElementById('room-share-url').select();
      }
    });

    document.getElementById('btn-native-share').addEventListener('click', async () => {
      const shareUrl = this.net.getShareUrl();
      if (navigator.share) {
        try {
          await navigator.share({
            title: `Join my Smashy Kart chase! (Room ${this.net.roomCode})`,
            text: `Tap to jump into my Smashy Kart lobby with your own face & car!`,
            url: shareUrl,
          });
        } catch {
          // User cancelled share sheet
        }
      } else {
        document.getElementById('btn-copy-link').click();
      }
    });

    this.net.on('error', (err) => {
      this._showLobbyError(err?.message || 'Lobby error.');
    });

    this.net.on('kicked', (msg) => {
      this._wasHost = false;
      this._lobbyHostName = '';
      this.sound.clearLobbySounds?.();
      window.history.replaceState({}, '', window.location.pathname);
      this._refreshAllUiFromSettings();
      this._openLobbyModal();
      this._showLobbyError(msg?.message || 'Removed from lobby by Lobby Manager.');
    });

    this.net.on('room_joined', (msg) => {
      // Ensure our avatar ID uses our network player ID so everyone maps our custom cutout cleanly
      this._wasHost = Boolean(this.net.isHost);
      const hostName = this._getLobbyHostName(msg.room);
      if (hostName && hostName !== 'Host') this._lobbyHostName = hostName;
      this.net.updateProfile(this._buildLocalNetProfile());
      if (this.net.isHost) {
        this.sound.clearLobbySounds?.();
        this._pushAllHostSoundsToLobby();
      } else {
        if (msg.room?.settings) {
          this._applyHostSettings(msg.room.settings);
        }
        if (this.settings.lobbyRules?.shareHostSounds === false) {
          this.sound.clearLobbySounds?.();
        } else {
          this.sound.setLobbyOverride?.(true, hostName);
        }
      }
      const basePath = window.location.pathname || '/';
      window.history.replaceState({}, '', `${basePath}?room=${encodeURIComponent(msg.code)}`);
      document.getElementById('lobby-entry').classList.add('hidden');
      document.getElementById('lobby-room').classList.remove('hidden');
      if (msg.room) this._renderLobbyRoom(msg.room);
      this._updateSoundLobbyBanner();
    });

    this.net.on('room_state', (room) => {
      const wasHost = this._wasHost;
      const isNowHost = Boolean(this.net.isHost);
      this._wasHost = isNowHost;
      const hostName = this._getLobbyHostName(room);
      if (hostName && hostName !== 'Host') this._lobbyHostName = hostName;

      this._ingestRoomAvatars(room.players || []);
      if (!wasHost && isNowHost) {
        this.sound.clearLobbySounds?.();
        this.net.clearAllHostSounds?.();
        this._pushAllHostSoundsToLobby();
      } else if (!isNowHost && room.settings) {
        this._applyHostSettings(room.settings);
      }
      if (!document.getElementById('lobby-modal').classList.contains('hidden')) {
        this._renderLobbyRoom(room);
      } else if (!isNowHost) {
        this._updateGuestRulesBanner(room);
      }
      this._updateSoundLobbyBanner();
    });

    this.net.on('room_settings_updated', (msg) => {
      if (!this.net.isHost && msg.settings) {
        this._applyHostSettings(msg.settings);
        if (this.net.roomState && !document.getElementById('lobby-modal')?.classList.contains('hidden')) {
          this._renderLobbyRoom(this.net.roomState);
        } else {
          this._updateGuestRulesBanner();
        }
        this._updateSoundLobbyBanner();
      }
    });

    this.net.on('sound_sync', async (msg) => {
      if (!msg || !this.net.roomCode || this.net.isHost) return;
      if (msg.hostName) this._lobbyHostName = msg.hostName;
      const hostName = msg.hostName || this._getLobbyHostName();
      const shareOn = this.settings.lobbyRules?.shareHostSounds !== false;
      if (!shareOn) {
        this.sound.clearLobbySounds?.();
      } else {
        if (typeof this.sound.setLobbySound === 'function') {
          await this.sound.setLobbySound(msg.slot, msg.dataUrl, msg.label).catch(() => {});
        }
        if (!this.net.roomCode || this.net.isHost || this.settings.lobbyRules?.shareHostSounds === false) {
          this.sound.clearLobbySounds?.();
        } else {
          this.sound.setLobbyOverride?.(true, hostName);
        }
      }
      this._updateGuestRulesBanner();
      this._updateSoundLobbyBanner();
    });

    this.net.on('sound_sync_clear', () => {
      if (this.net.isHost) return;
      this.sound.clearLobbySounds?.();
      this._updateGuestRulesBanner();
      this._updateSoundLobbyBanner();
    });

    this.net.on('horn_event', (ev) => {
      if (!ev || (ev.playerId && ev.playerId === this.net.playerId)) return;
      this.sound.playEvent('horn', 0.85);
    });

    this.net.on('match_countdown', (msg) => {
      this._ingestRoomAvatars(msg.players || []);
      this._beginPartyCountdown(msg);
    });

    this.net.on('match_start', () => {
      if (this.mode === 'countdown') {
        this.countdownLeft = 0;
        this.mode = 'playing_party';
        const banner = document.getElementById('countdown-banner');
        banner.textContent = 'SMASH!';
        setTimeout(() => banner.classList.add('hidden'), 650);
      }
    });

    this.net.on('ability_event', (ev) => {
      if (!ev || ev.playerId === this.net.playerId) return;
      this.abilities.spawnNetworkAbilityEvent(ev, {
        world: this.world,
        cops: this.sim.cops,
        traffic: this.sim.traffic,
        localPlayer: this.sim.localPlayer,
        remotePlayers: this.sim.remotePlayers,
        onEvent: (simEv) => this._handleSimEvent(simEv),
      });
    });

    this.net.on('pvp_bump', (bump) => {
      if (!bump || bump.fromId === this.net.playerId) return;
      this.sim.applyIncomingPvpBump(bump);
      this.cameraShake = Math.max(this.cameraShake, 0.7);
      this.sound.playEvent('crash', 0.85);
      this._triggerHaptic([24, 28, 34]);
      if (bump.fromName) {
        this._showChaosToast(`💥 ${bump.fromName} SLAMMED YOU!`);
      }
    });

    this.net.on('player_eliminated', (msg) => {
      if (msg.standings) this.partyStandings = msg.standings;
      if (msg.announcement) this._showChaosToast(`🚨 ${msg.announcement}`);
      this._updateSurvivorStrip();
    });

    this.net.on('match_results', (msg) => {
      this.partyStandings = msg.standings || [];
      this._showGameOverModal({
        isParty: true,
        winnerId: msg.winnerId,
        winnerName: msg.winnerName,
        winnerTeam: msg.winnerTeam || null,
        standings: this.partyStandings,
      });
    });

    this.net.on('return_to_lobby', () => {
      document.getElementById('gameover-modal').classList.add('hidden');
      this._startAttractDemo();
      document.getElementById('home-screen').classList.remove('hidden');
      this._openLobbyModal();
    });
  }

  _bindHostManagerControls() {
    const syncHostRules = () => {
      saveSettings(this.settings);
      this._refreshAllUiFromSettings();
      if (this.net.roomCode && this.net.isHost) {
        this.net.updateRoomSettings(this.settings);
      }
      if (this.net.roomState) this._renderLobbyRoom(this.net.roomState);
    };

    // One-Tap Universal Presets
    document.getElementById('host-preset-btns')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-preset]');
      if (!btn || !this.net.isHost) return;
      const p = btn.dataset.preset;
      const rules = this.settings.lobbyRules;

      if (p === 'fair') {
        rules.lockStats = true;
        rules.allowCarChoice = true;
        rules.allowModeChoice = true;
        rules.allowCustomPhotos = true;
        rules.allowPlayerCops = true;
        rules.universalSpeedMult = 1.0;
        rules.universalDriftMult = 1.0;
        rules.universalMassMult = 1.0;
        rules.universalScaleMult = 1.0;
        this.settings.aiCopsEnabled = true;
        this.settings.speedMult = 1.0;
        this.settings.driftMult = 1.0;
        this.settings.massMult = 1.0;
        this.settings.scaleMult = 1.0;
        this.settings.copIntensity = 1.0;
        this.settings.startStars = 1;
        this.settings.itemBoxDensity = 1.2;
        this.settings.sugarBoxRate = 1.0;
        this.settings.itemWeights = createDefaultItemWeights();
        for (const ab of ABILITIES) this.settings.enabledItems[ab.id] = true;
        this.abilities.updateSettings(this.settings);
        this.world.reset(this.settings.worldSeed, this.settings.biome, {
          itemBoxDensity: this.settings.itemBoxDensity,
          sugarBoxRate: this.settings.sugarBoxRate,
        });
      } else if (p === 'same_car') {
        rules.lockStats = true;
        rules.allowCarChoice = false;
        rules.allowModeChoice = false;
        rules.universalVehicleId = this.settings.vehicleId || 'sedan';
        rules.universalCharacterMode = this.settings.characterMode || 'car_driver';
        rules.universalSpeedMult = 1.0;
        rules.universalDriftMult = 1.0;
        rules.universalMassMult = 1.0;
        rules.universalScaleMult = 1.0;
        this.settings.speedMult = 1.0;
      } else if (p === 'all_foot') {
        rules.lockStats = true;
        rules.allowModeChoice = false;
        rules.universalCharacterMode = 'runner';
        this.settings.characterMode = 'runner';
        rules.universalSpeedMult = 1.1;
        this.settings.speedMult = 1.1;
        this.settings.startStars = 3;
      } else if (p === 'turbo') {
        rules.lockStats = true;
        rules.universalSpeedMult = 1.35;
        rules.universalDriftMult = 1.15;
        this.settings.speedMult = 1.35;
        this.settings.driftMult = 1.15;
        this.settings.itemBoxDensity = 2.0;
        this.settings.copIntensity = 1.4;
        this.settings.startStars = 3;
        this.world.reset(this.settings.worldSeed, this.settings.biome, {
          itemBoxDensity: this.settings.itemBoxDensity,
          sugarBoxRate: this.settings.sugarBoxRate,
        });
      }

      document.querySelectorAll('#host-preset-btns .preset-pill').forEach((el) =>
        el.classList.toggle('active', el === btn)
      );
      syncHostRules();
    });

    // Universal Speed Quick Selector
    document.getElementById('host-univ-speed')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-uspeed]');
      if (!btn || !this.net.isHost) return;
      const spd = Number(btn.dataset.uspeed) || 1.0;
      this.settings.speedMult = spd;
      this.settings.lobbyRules.universalSpeedMult = spd;
      this.settings.lobbyRules.lockStats = true;
      syncHostRules();
    });

    // Universal Map Quick Selector
    document.getElementById('host-univ-map')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-ubiome]');
      if (!btn || !this.net.isHost) return;
      this.settings.biome = btn.dataset.ubiome;
      this.world.reset(this.settings.worldSeed, this.settings.biome, {
        itemBoxDensity: this.settings.itemBoxDensity,
        sugarBoxRate: this.settings.sugarBoxRate,
      });
      syncHostRules();
    });

    // Permission Switches
    const bindPerm = (id, key) => {
      const el = document.getElementById(id);
      el?.addEventListener('change', () => {
        if (!this.net.isHost) return;
        this.settings.lobbyRules[key] = el.checked;
        if (key === 'allowCarChoice' && !el.checked) {
          this.settings.lobbyRules.universalVehicleId = this.settings.vehicleId || 'sedan';
        }
        if (key === 'allowModeChoice' && !el.checked) {
          this.settings.lobbyRules.universalCharacterMode = this.settings.characterMode || 'car_driver';
        }
        syncHostRules();
      });
    };

    const permAiCopsEl = document.getElementById('perm-ai-cops');
    permAiCopsEl?.addEventListener('change', () => {
      if (!this.net.isHost) return;
      this.settings.aiCopsEnabled = Boolean(permAiCopsEl.checked);
      this.sim.updateSettings(this.settings);
      if (!this.settings.aiCopsEnabled) {
        this.sim.cops.length = 0;
        if (this.sim.localPlayer) this.sim.localPlayer.bustedProgress = 0;
      } else if (this.mode === 'attract') {
        this._respawnAttractHero();
      }
      syncHostRules();
      this._showChaosToast(
        this.settings.aiCopsEnabled
          ? '🚔 AI Police Chase ON for Party!'
          : '🚫 AI Police OFF — Pure Friends PvP / Human Cops!'
      );
    });

    bindPerm('perm-allow-cops', 'allowPlayerCops');
    const permShareSoundsEl = document.getElementById('perm-share-sounds');
    permShareSoundsEl?.addEventListener('change', () => {
      if (!this.net.isHost) return;
      const shareOn = Boolean(permShareSoundsEl.checked);
      if (!this.settings.lobbyRules) this.settings.lobbyRules = {};
      this.settings.lobbyRules.shareHostSounds = shareOn;
      syncHostRules();
      if (shareOn) {
        this._pushAllHostSoundsToLobby();
        this._showChaosToast('🔊 Sharing your custom voices & sounds with everyone!');
      } else {
        this.net.clearAllHostSounds?.();
        this._showChaosToast('🔇 Host custom sounds OFF — everyone uses their own sounds.');
      }
      this._updateSoundLobbyBanner();
    });
    bindPerm('perm-lock-stats', 'lockStats');
    bindPerm('perm-allow-car', 'allowCarChoice');
    bindPerm('perm-allow-mode', 'allowModeChoice');
    bindPerm('perm-allow-photos', 'allowCustomPhotos');
  }

  _applyHostSettings(rs) {
    if (!rs) return;
    const prevBiome = this.settings.biome;
    const prevBoxDensity = this.settings.itemBoxDensity;
    const prevSugarRate = this.settings.sugarBoxRate;
    const prevAiCops = this.settings.aiCopsEnabled;

    if (rs.biome) this.settings.biome = rs.biome;
    if (rs.aiCopsEnabled !== undefined) {
      this.settings.aiCopsEnabled = Boolean(rs.aiCopsEnabled);
    }
    if (rs.copIntensity !== undefined) this.settings.copIntensity = rs.copIntensity;
    if (rs.startStars !== undefined) this.settings.startStars = rs.startStars;
    if (rs.trafficDensity !== undefined) this.settings.trafficDensity = rs.trafficDensity;
    if (rs.itemBoxDensity !== undefined) {
      this.settings.itemBoxDensity = Number(
        clampNum(rs.itemBoxDensity, 0.1, 5.0, this.settings.itemBoxDensity ?? 1.2).toFixed(2)
      );
    }
    if (rs.sugarBoxRate !== undefined) {
      this.settings.sugarBoxRate = Number(
        clampNum(rs.sugarBoxRate, 0, 5.0, this.settings.sugarBoxRate ?? 1.0).toFixed(2)
      );
    }
    if (rs.gravityMult !== undefined) this.settings.gravityMult = rs.gravityMult;
    if (rs.enabledItems) this.settings.enabledItems = { ...this.settings.enabledItems, ...rs.enabledItems };
    if (rs.itemWeights) {
      this.settings.itemWeights = cloneItemWeights({
        ...(this.settings.itemWeights || {}),
        ...rs.itemWeights,
      });
    }
    if (rs.lobbyRules) {
      this.settings.lobbyRules = { ...this.settings.lobbyRules, ...rs.lobbyRules };
      if (this.settings.lobbyRules.shareHostSounds === false) {
        this.sound.clearLobbySounds?.();
      } else if (this.net.roomCode && !this.net.isHost) {
        this.sound.setLobbyOverride?.(true, this._getLobbyHostName());
      }
      if (this.settings.lobbyRules.allowModeChoice === false && this.settings.lobbyRules.universalCharacterMode) {
        this.settings.characterMode = this.settings.lobbyRules.universalCharacterMode;
      }
      if (this.settings.lobbyRules.allowCarChoice === false && this.settings.lobbyRules.universalVehicleId) {
        this.settings.vehicleId = this.settings.lobbyRules.universalVehicleId;
      }
      if (this.settings.lobbyRules.allowPlayerCops === false && this.settings.playerRole === 'cop') {
        this.settings.playerRole = 'runner';
        if (this.net.roomCode) {
          this.net.updateProfile(this._buildLocalNetProfile());
        }
      }
    }
    if (!this.settings.aiCopsEnabled) {
      this.sim.cops.length = 0;
      if (this.sim.localPlayer) this.sim.localPlayer.bustedProgress = 0;
    }
    if (
      this.mode === 'attract' &&
      (prevBiome !== this.settings.biome ||
        prevBoxDensity !== this.settings.itemBoxDensity ||
        prevSugarRate !== this.settings.sugarBoxRate ||
        prevAiCops !== this.settings.aiCopsEnabled)
    ) {
      this.world.reset(this.settings.worldSeed, this.settings.biome, {
        itemBoxDensity: this.settings.itemBoxDensity,
        sugarBoxRate: this.settings.sugarBoxRate,
      });
      if (this.settings.aiCopsEnabled) this._respawnAttractHero();
    }
    this.abilities.updateSettings(this.settings);
    this._refreshAllUiFromSettings();
  }

  _ingestRoomAvatars(players) {
    for (const p of players) {
      const avId = p.avatarId || `net_${p.id}`;
      const safeUrl = this._safeImgSrc(p.avatarDataUrl);
      if (safeUrl && this.remoteAvatarCache.get(avId) !== safeUrl) {
        this.remoteAvatarCache.set(avId, safeUrl);
        this.renderer.registerPhotoTexture(avId, safeUrl);
      }
    }
  }

  _renderLobbyRoom(room) {
    document.getElementById('room-code-display').textContent = room.code;
    const shareUrl = this.net.getShareUrl(room.code);
    document.getElementById('room-share-url').value = shareUrl;
    document.getElementById('room-qr-box').innerHTML = this.net.getQrCodeSvg(room.code, { margin: 3 });

    const rules = room.settings?.lobbyRules || this.settings.lobbyRules || {};
    const isHost = Boolean(this.net.isHost);

    // Sync Host Manager Panel vs Guest Rules Summary Banner
    const hostPanel = document.getElementById('host-manager-panel');
    const guestBanner = document.getElementById('guest-rules-banner');
    hostPanel.classList.toggle('hidden', !isHost);
    guestBanner.classList.toggle('hidden', isHost);

    if (isHost) {
      const aiCopsChk = document.getElementById('perm-ai-cops');
      if (aiCopsChk) aiCopsChk.checked = room.settings?.aiCopsEnabled !== false;
      const allowCopsChk = document.getElementById('perm-allow-cops');
      if (allowCopsChk) allowCopsChk.checked = rules.allowPlayerCops !== false;
      const shareSoundsChk = document.getElementById('perm-share-sounds');
      if (shareSoundsChk) shareSoundsChk.checked = rules.shareHostSounds !== false;
      document.getElementById('perm-lock-stats').checked = rules.lockStats !== false;
      document.getElementById('perm-allow-car').checked = rules.allowCarChoice !== false;
      document.getElementById('perm-allow-mode').checked = rules.allowModeChoice !== false;
      document.getElementById('perm-allow-photos').checked = rules.allowCustomPhotos !== false;
      const curSpd = Number(rules.universalSpeedMult || 1.0);
      document.querySelectorAll('#host-univ-speed .seg-btn').forEach((b) =>
        b.classList.toggle('active', Math.abs(Number(b.dataset.uspeed) - curSpd) < 0.04)
      );
      const curBiome = room.settings?.biome || this.settings.biome;
      document.querySelectorAll('#host-univ-map .seg-btn').forEach((b) =>
        b.classList.toggle('active', b.dataset.ubiome === curBiome)
      );
    } else {
      this._updateGuestRulesBanner(room);
    }
    this._updateSoundLobbyBanner();

    // Lock/unlock Guest buttons right inside Lobby & Garage
    document.getElementById('lobby-role-pills')?.classList.toggle(
      'locked-ctrl',
      !isHost && rules.allowPlayerCops === false
    );
    document.getElementById('lobby-mode-pills')?.classList.toggle(
      'locked-ctrl',
      !isHost && rules.allowModeChoice === false
    );
    document.getElementById('btn-lobby-car')?.classList.toggle(
      'locked-ctrl',
      !isHost && rules.allowCarChoice === false && rules.lockStats !== false && rules.allowPlayerCops === false
    );
    document.getElementById('btn-lobby-photo')?.classList.toggle(
      'locked-ctrl',
      !isHost && rules.allowCustomPhotos === false
    );

    const players = room.players || [];
    document.getElementById('lobby-player-count').textContent = String(players.length);

    const COP_BADGE_MAP = {
      cop_cruiser: '🚔 Cruiser',
      cop_swat: '🛡️ SWAT',
      cop_heli: '🚁 Heli',
      cop_tank: '🪖 Tank',
    };

    const rosterEl = document.getElementById('lobby-roster');
    rosterEl.innerHTML = '';
    for (const p of players) {
      const isCopPlayer = p.playerRole === 'cop';
      const card = document.createElement('div');
      card.className = `roster-card${p.ready ? ' ready' : ''}${isCopPlayer ? ' cop-roster-card' : ''}`;
      const veh = VEHICLES.find((v) => v.id === p.vehicleId) || VEHICLES[0];
      const copVeh = COP_VEHICLES.find((c) => c.id === p.copVehicleId) || COP_VEHICLES[2] || COP_VEHICLES[0];
      const modeLabel = isCopPlayer
        ? `${copVeh.icon} ${copVeh.name}`
        : p.characterMode === 'runner'
          ? 'On Foot'
          : p.characterMode === 'photo_car'
            ? 'Photo-Car'
            : veh.name;
      const copTagHtml = isCopPlayer
        ? `<span class="roster-cop-badge">${COP_BADGE_MAP[copVeh.id] || '🚔 COP'}</span>`
        : '';
      const fallbackImg = this._safeImgSrc(this._getSelectedPerson()?.dataUrl);
      const safeAvatar = this._safeImgSrc(p.avatarDataUrl) || fallbackImg;
      const canKick = isHost && p.id !== room.hostId;
      card.innerHTML = `
        <img src="${safeAvatar}" alt="${this._escapeHtml(p.name)}" />
        <div class="roster-meta">
          <div class="roster-name">${this._escapeHtml(p.name)} ${p.id === room.hostId ? '👑' : ''} ${copTagHtml}</div>
          <div class="roster-sub">${this._escapeHtml(modeLabel)} · ${p.ready ? 'READY' : 'Picking...'}</div>
        </div>
        ${canKick ? `<button type="button" class="tiny-pill" data-kick-id="${this._escapeHtml(p.id)}">Kick</button>` : ''}
      `;
      card.querySelector('[data-kick-id]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.net.kickPlayer(p.id);
      });
      rosterEl.appendChild(card);
    }

    const startBtn = document.getElementById('btn-host-start');
    startBtn.classList.toggle('hidden', !isHost);
    const readyBtn = document.getElementById('btn-toggle-ready');
    readyBtn.textContent = this.isReadyInLobby ? '✓ Ready!' : 'Tap When Ready';
  }

  _updateGuestRulesBanner(room = this.net.roomState) {
    const guestBanner = document.getElementById('guest-rules-banner');
    if (!guestBanner || this.net.isHost) return;
    const rs = room?.settings || this.settings || {};
    const rules = rs.lobbyRules || this.settings.lobbyRules || {};
    const spdPct = Math.round((rules.universalSpeedMult || 1.0) * 100);
    const biomeObj = BIOMES[rs.biome || 'city'] || BIOMES.city;
    const aiCopsStatus = rs.aiCopsEnabled === false ? '🚫 AI Cops OFF' : '🚔 AI Cops ON';
    const playerCopsStatus =
      rules.allowPlayerCops === false ? '🔒 Police Team Disabled' : '🚔 Police Team Open';
    const parts = [
      aiCopsStatus,
      playerCopsStatus,
      rules.lockStats !== false ? `🔒 Equal ${spdPct}% Speed & Stats` : '🔓 Custom Car Tuning Allowed',
      biomeObj.name,
      rules.allowCarChoice === false ? '🔒 Same Car Forced' : 'Any Car',
      rules.allowModeChoice === false ? '🔒 Mode Locked' : 'Any Mode',
    ];
    const lobbySoundCount =
      typeof this.sound.getLobbySoundCount === 'function' ? this.sound.getLobbySoundCount() : 0;
    if (rules.shareHostSounds !== false && lobbySoundCount > 0) {
      parts.push('🎙️ Host Sounds ON');
    }
    guestBanner.textContent = `👑 Lobby Manager Rules: ${parts.join(' · ')}`;
  }

  // ======================== MATCH START / GAME LOOP ========================

  _startAttractDemo() {
    this.mode = 'attract';
    this._clearTouchState();
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('gameover-modal').classList.add('hidden');
    document.getElementById('danger-vignette').classList.add('hidden');
    document.getElementById('speed-lines').classList.add('hidden');
    document.getElementById('world-labels').innerHTML = '';
    this.sound.updateLoopSounds(0, false, 1, false, true);
    this._respawnAttractHero();
  }

  _respawnAttractHero() {
    this.world.reset(this.settings.worldSeed, this.settings.biome, {
      itemBoxDensity: this.settings.itemBoxDensity,
      sugarBoxRate: this.settings.sugarBoxRate,
    });
    this.abilities.updateSettings(this.settings);
    const aiCopsOn = this.settings.aiCopsEnabled !== false;
    this.sim.resetRun(this.settings.worldSeed, {
      ...this.settings,
      aiCopsEnabled: aiCopsOn,
      startStars: aiCopsOn ? 2 : 1,
      autoAccelerate: true,
      playerId: 'local',
      spawnIndex: 0,
    });
    if (aiCopsOn && this.settings.playerRole !== 'cop') {
      this.sim.wantedStars = 2;
      if (this.sim.localPlayer) {
        this.sim.localPlayer.stars = 2;
      }
      let safety = 0;
      while (this.sim.cops.length < 2 && safety < 4 && typeof this.sim._spawnCop === 'function') {
        this.sim._spawnCop(this.sim.localPlayer);
        safety++;
      }
    } else if (!aiCopsOn) {
      this.sim.cops.length = 0;
    }
  }

  _startSoloMatch() {
    if (this.editingHudLayout) {
      this.editingHudLayout = false;
      document.body.classList.remove('editing-hud-layout');
      document.getElementById('hud-layout-editor')?.classList.add('hidden');
    }
    if (this.net.roomCode) {
      this.net.leaveRoom();
      window.history.replaceState({}, '', window.location.pathname);
    }
    this._wasHost = false;
    this._lobbyHostName = '';
    this.sound.clearLobbySounds?.();
    this._updateSoundLobbyBanner();
    const freshSeed = Math.floor(100000 + Math.random() * 899999);
    this.settings.worldSeed = freshSeed;
    this.eliminatedSent = false;
    this.partyStandings = [];
    this._clearTouchState();

    this.world.reset(freshSeed, this.settings.biome, {
      itemBoxDensity: this.settings.itemBoxDensity,
      sugarBoxRate: this.settings.sugarBoxRate,
    });
    this.abilities.updateSettings(this.settings);
    this._syncAllPhotoTextures();
    this.sim.resetRun(freshSeed, {
      ...this.settings,
      playerId: 'local',
      spawnIndex: 0,
    });

    document.getElementById('home-screen')?.classList.add('hidden');
    document.getElementById('lobby-modal')?.classList.add('hidden');
    document.getElementById('gameover-modal')?.classList.add('hidden');
    document.getElementById('settings-modal')?.classList.add('hidden');
    document.getElementById('spectator-bar')?.classList.add('hidden');
    document.getElementById('survivor-strip')?.classList.add('hidden');
    document.getElementById('hud')?.classList.remove('hidden');

    this.mode = 'playing_solo';
    this._applyHudLayout();
  }

  _beginPartyCountdown(msg) {
    if (this.editingHudLayout) {
      this.editingHudLayout = false;
      document.body.classList.remove('editing-hud-layout');
      document.getElementById('hud-layout-editor')?.classList.add('hidden');
    }
    const roomSettings = msg.settings || {};
    const rules = roomSettings.lobbyRules || this.settings.lobbyRules || {};
    const lockStats = rules.lockStats !== false;
    const allowCar = rules.allowCarChoice !== false;
    const allowMode = rules.allowModeChoice !== false;
    const allowPhotos = rules.allowCustomPhotos !== false;
    const allowPlayerCops = rules.allowPlayerCops !== false;
    const roomAiCops =
      roomSettings.aiCopsEnabled !== undefined
        ? Boolean(roomSettings.aiCopsEnabled)
        : this.settings.aiCopsEnabled !== false;

    const players = (msg.players || []).map((p, idx) => ({
      ...p,
      playerRole: p.playerRole === 'cop' ? 'cop' : 'runner',
      copVehicleId: p.copVehicleId || 'cop_heli',
      avatarId: p.avatarId || `net_${p.id}`,
      spawnIndex: Number.isFinite(p.spawnIndex) ? p.spawnIndex : idx,
    }));
    const meInRoster = players.find((p) => p.id === this.net.playerId);

    const localRole =
      !allowPlayerCops && !this.net.isHost
        ? 'runner'
        : meInRoster?.playerRole || (this.settings.playerRole === 'cop' ? 'cop' : 'runner');
    const localCopVehicleId = meInRoster?.copVehicleId || this.settings.copVehicleId || 'cop_heli';

    const mergedItemBoxDensity = Number(
      clampNum(roomSettings.itemBoxDensity ?? this.settings.itemBoxDensity, 0.1, 5.0, 1.2).toFixed(2)
    );
    const mergedSugarBoxRate = Number(
      clampNum(roomSettings.sugarBoxRate ?? this.settings.sugarBoxRate, 0, 5.0, 1.0).toFixed(2)
    );
    const mergedItemWeights = cloneItemWeights(
      roomSettings.itemWeights || this.settings.itemWeights
    );

    const mergedSettings = {
      ...this.settings,
      aiCopsEnabled: roomAiCops,
      playerRole: localRole,
      copVehicleId: localCopVehicleId,
      characterMode: allowMode ? this.settings.characterMode : rules.universalCharacterMode || 'car_driver',
      vehicleId: allowCar ? this.settings.vehicleId : rules.universalVehicleId || 'sedan',
      speedMult: lockStats ? rules.universalSpeedMult ?? 1.0 : this.settings.speedMult,
      accelMult: lockStats ? rules.universalSpeedMult ?? 1.0 : this.settings.accelMult,
      driftMult: lockStats ? rules.universalDriftMult ?? 1.0 : this.settings.driftMult,
      massMult: lockStats ? rules.universalMassMult ?? 1.0 : this.settings.massMult,
      scaleMult: lockStats ? rules.universalScaleMult ?? 1.0 : this.settings.scaleMult,
      biome: roomSettings.biome || this.settings.biome,
      copIntensity: roomSettings.copIntensity ?? this.settings.copIntensity,
      startStars: roomSettings.startStars ?? this.settings.startStars,
      trafficDensity: roomSettings.trafficDensity ?? this.settings.trafficDensity,
      itemBoxDensity: mergedItemBoxDensity,
      sugarBoxRate: mergedSugarBoxRate,
      gravityMult: roomSettings.gravityMult ?? this.settings.gravityMult,
      enabledItems: roomSettings.enabledItems || this.settings.enabledItems,
      itemWeights: mergedItemWeights,
      worldSeed: msg.seed,
      playerId: this.net.playerId || 'local',
      avatarId: !allowPhotos
        ? 'default_hero'
        : this.net.playerId
          ? `net_${this.net.playerId}`
          : this.settings.avatarId,
    };

    // Register our own network avatarId texture so local & remote match
    const myPerson = this._getSelectedPerson();
    if (myPerson?.dataUrl && this.net.playerId) {
      this.renderer.registerPhotoTexture(`net_${this.net.playerId}`, myPerson.dataUrl);
    }

    if (meInRoster) mergedSettings.spawnIndex = meInRoster.spawnIndex;

    this.world.reset(msg.seed, mergedSettings.biome, {
      itemBoxDensity: mergedSettings.itemBoxDensity,
      sugarBoxRate: mergedSettings.sugarBoxRate,
    });
    this.abilities.updateSettings(mergedSettings);
    this._syncAllPhotoTextures();
    this.sim.resetRun(msg.seed, mergedSettings, players);

    this.eliminatedSent = false;
    this.partyStandings = players.map((p) => ({
      id: p.id,
      name: p.name,
      avatarId: p.avatarId,
      alive: true,
      survivalTime: 0,
    }));

    document.getElementById('home-screen')?.classList.add('hidden');
    document.getElementById('lobby-modal')?.classList.add('hidden');
    document.getElementById('gameover-modal')?.classList.add('hidden');
    document.getElementById('settings-modal')?.classList.add('hidden');
    document.getElementById('spectator-bar')?.classList.add('hidden');
    document.getElementById('hud')?.classList.remove('hidden');
    document.getElementById('survivor-strip')?.classList.add('hidden');

    this.countdownLeft = msg.countdownSec || 3.0;
    this.mode = 'countdown';
    this._applyHudLayout();
  }

  _exitToMainMenu() {
    if (this.editingHudLayout) {
      this.editingHudLayout = false;
      document.body.classList.remove('editing-hud-layout');
      document.getElementById('hud-layout-editor')?.classList.add('hidden');
    }
    if (this.net.roomCode) {
      this.net.leaveRoom();
      window.history.replaceState({}, '', window.location.pathname);
    }
    this._wasHost = false;
    this._lobbyHostName = '';
    this.sound.clearLobbySounds?.();
    this._startAttractDemo();
    document.getElementById('home-screen')?.classList.remove('hidden');
    document.getElementById('lobby-modal')?.classList.add('hidden');
    document.getElementById('gameover-modal')?.classList.add('hidden');
    document.getElementById('settings-modal')?.classList.add('hidden');
    this._refreshAllUiFromSettings();
  }

  _frame(nowMs) {
    const rawDt = (nowMs - this._lastFrameMs) / 1000;
    this._lastFrameMs = nowMs;
    const dt = Math.min(0.05, Math.max(0.001, rawDt));
    this._elapsedTime += dt;

    // Rolling FPS counter readout
    if (rawDt > 0 && rawDt < 1.0) {
      this._fpsFrames += 1;
      this._fpsAccum += rawDt;
      if (this._fpsAccum >= 0.35) {
        this._currentFps = Math.min(240, Math.max(1, Math.round(this._fpsFrames / this._fpsAccum)));
        this._fpsFrames = 0;
        this._fpsAccum = 0;
        if (this.settings.showFps) {
          const fpsEl = document.getElementById('hud-fps');
          if (fpsEl) fpsEl.textContent = `${this._currentFps} FPS`;
        }
      }
    }

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) {
        document.getElementById('chaos-toast')?.classList.add('hidden');
      }
    }

    if (this.cameraShake > 0) {
      this.cameraShake = Math.max(0, this.cameraShake - dt * 2.4);
    }

    this._stepSimulation(dt, nowMs);
    this._renderFrame(dt);

    requestAnimationFrame((t) => this._frame(t));
  }

  _stepSimulation(dt, nowMs) {
    if (this.mode === 'attract') {
      // Autonomous showcase getaway chase or playable Police Heli/Tank patrol!
      this._attractSteerPhase += dt;
      const lp = this.sim.localPlayer;
      if (!lp || !lp.alive) {
        this._respawnAttractHero();
      } else {
        const aiCopsOn = this.settings.aiCopsEnabled !== false;
        if (aiCopsOn) {
          this.sim.wantedStars = Math.max(2, this.sim.wantedStars || 2);
          lp.stars = this.sim.wantedStars;
        } else {
          this.sim.cops.length = 0;
        }
        // Ensure auto-acceleration drives the showcase car even if user unchecked Auto-Accelerate for manual play!
        const prevAuto = this.sim.settings.autoAccelerate;
        this.sim.settings.autoAccelerate = true;
        const wave = Math.sin(this._attractSteerPhase * 0.9) + Math.cos(this._attractSteerPhase * 2.1) * 0.5;
        const autoUse =
          lp.playerRole === 'cop' && (lp.copVehicleId === 'cop_heli' || lp.copVehicleId === 'cop_tank')
            ? Boolean((lp.copMissileCooldown || 0) <= 0 && Math.random() < dt * 0.28)
            : Boolean(lp.items?.heldItem && Math.random() < dt * 0.8);
        const events = this.sim.update(
          dt,
          {
            left: wave > 0.45,
            right: wave < -0.45,
            brake: false,
            gas: true,
            useItem: autoUse,
            horn: false,
            steerAxis: null,
          },
          this._elapsedTime
        );
        this.sim.settings.autoAccelerate = prevAuto;
        if (aiCopsOn && lp.playerRole !== 'cop') {
          const activeCops = this.sim.cops.filter((c) => !c.wrecked).length;
          if (activeCops < 2 && typeof this.sim._spawnCop === 'function') {
            this.sim._spawnCop(lp);
          }
        }
        this._processVisualEventsOnly(events);
      }
      return;
    }

    if (this.editingHudLayout && this.mode === 'playing_solo') {
      this.sound.updateLoopSounds(0, false, 1, false, true);
      this._updateHud();
      return;
    }

    if (this.mode === 'countdown') {
      this.countdownLeft = Math.max(0, this.countdownLeft - dt);
      const banner = document.getElementById('countdown-banner');
      banner.classList.remove('hidden');
      banner.textContent = String(Math.max(1, Math.ceil(this.countdownLeft)));
      this.world.update(dt, this.sim.localPlayer?.x || 0, this.sim.localPlayer?.z || 0);
      if (this.net.roomCode) {
        const snaps = this.net.getInterpolatedRemotePlayers(nowMs);
        if (snaps.length > 0) this.sim.syncRemotePlayers(snaps, this.net.playerId);
      }
      this._updateHud();
      return;
    }

    if (this.mode === 'playing_solo' || this.mode === 'playing_party' || this.mode === 'spectating') {
      if (this.net.roomCode) {
        const snaps = this.net.getInterpolatedRemotePlayers(nowMs);
        const activeIds = this.net.roomState?.players
          ? new Set(this.net.roomState.players.map((p) => p.id))
          : null;
        this.sim.syncRemotePlayers(snaps, this.net.playerId, activeIds);
      }

      let spectateTarget = null;
      if (this.mode === 'spectating') {
        const aliveRemotes = this.sim.remotePlayers.filter((rp) => rp.alive !== false);
        if (aliveRemotes.length > 0) {
          spectateTarget = aliveRemotes[this.spectateIndex % aliveRemotes.length];
        }
      }

      const input =
        this.mode === 'spectating'
          ? { left: false, right: false, brake: false, useItem: false, horn: false, steerAxis: null }
          : this._gatherGameplayInput();

      const events = this.sim.update(dt, input, this._elapsedTime, spectateTarget);
      for (const ev of events) {
        this._handleSimEvent(ev);
      }

      const lp = this.sim.localPlayer;
      if (lp) {
        // Tire skid ribbons & damage smoke
        if (lp.alive && lp.drifting && lp.grounded && !lp.flying && lp.characterMode !== 'runner') {
          this.renderer.addSkidMark(lp.prevX, lp.prevZ, lp.x, lp.z, 0.48 * (lp.scale || 1), 0.45);
          if (Math.random() < 0.45) {
            this.renderer.spawnSmoke(lp.x, lp.y + 0.25, lp.z, '#e2e8f0', 1, 0.55);
          }
        }
        if (lp.alive && lp.hp < lp.maxHp * 0.45 && Math.random() < 0.35) {
          const fireCol = lp.hp < lp.maxHp * 0.22 ? '#f97316' : '#475569';
          this.renderer.spawnSmoke(lp.x, lp.y + 1.1, lp.z, fireCol, 1, 0.75);
        }

        const speedRatio = Math.min(1.3, (lp.speed || 0) / Math.max(20, lp.maxSpeed || 45));
        const aiCopsActive = (this.sim.settings?.aiCopsEnabled ?? this.settings.aiCopsEnabled) !== false;
        const anyHumanCopAlive =
          Boolean(lp.alive && lp.playerRole === 'cop') ||
          this.sim.remotePlayers.some((rp) => rp && rp.alive !== false && rp.playerRole === 'cop');
        const sirenStars = aiCopsActive
          ? (this.sim.wantedStars || 1)
          : anyHumanCopAlive
            ? Math.max(1, this.sim.wantedStars || 1)
            : 0;
        this.sound.updateLoopSounds(
          lp.alive ? speedRatio : 0,
          Boolean(lp.alive && lp.drifting),
          sirenStars,
          Boolean(lp.alive && lp.starActive),
          false
        );

        if (this.net.roomCode && this.mode === 'playing_party') {
          this.net.sendPlayerState(lp);
        }
      }

      this._updateHud();
    }
  }

  _processVisualEventsOnly(events) {
    for (const ev of events) {
      if (ev.type === 'smash') {
        this.renderer.spawnDebris(ev.x, ev.y || 0.8, ev.z, ev.color || '#facc15', 7, 14, 0.42);
      } else if (ev.type === 'explosion') {
        this.renderer.spawnExplosionVisual(ev.x, ev.y || 0.8, ev.z, ev.radius || 8);
      }
    }
  }

  _handleSimEvent(ev) {
    if (!ev) return;
    switch (ev.type) {
      case 'smash': {
        this.renderer.spawnDebris(ev.x, ev.y || 0.8, ev.z, ev.color || '#cbd5e1', 8, 15, 0.44);
        this.cameraShake = Math.max(this.cameraShake, Math.min(0.65, (ev.intensity || 0.5) * 0.45));
        const bigSmash = (ev.intensity || 0.5) > 0.9;
        this.sound.playEvent(bigSmash ? 'crash' : 'smash', ev.intensity || 0.7);
        if (bigSmash) this._triggerHaptic(18);
        break;
      }
      case 'explosion': {
        this.renderer.spawnExplosionVisual(ev.x, ev.y || 0.8, ev.z, ev.radius || 9);
        this.cameraShake = Math.max(this.cameraShake, 1.0);
        this.sound.playEvent('explosion', ev.intensity || 1.1);
        this._triggerHaptic([28, 30, 42]);
        break;
      }
      case 'pickup_box': {
        const boxCol = ev.sugar ? '#f472b6' : '#38bdf8';
        this.renderer.spawnDebris(ev.x, (ev.y || 1) + 0.8, ev.z, boxCol, 11, 13, 0.34);
        this.sound.playEvent('pickup_box', ev.sugar ? 1.15 : 1.0);
        if (ev.sugar) this._triggerHaptic(16);
        break;
      }
      case 'roulette_tick': {
        this.sound.playEvent('roulette_tick', 0.6);
        break;
      }
      case 'roulette_lock': {
        this.sound.playEvent('roulette_lock', 1.0);
        const useBtn = document.getElementById('btn-use-item');
        useBtn?.classList.add('locked-pop');
        setTimeout(() => useBtn?.classList.remove('locked-pop'), 440);
        break;
      }
      case 'mini_turbo': {
        const sparkCol = (ev.tier || 1) >= 2 ? '#f97316' : '#38bdf8';
        this.renderer.spawnDebris(ev.x, (ev.y || 0.4) + 0.35, ev.z, sparkCol, 8, 12, 0.3);
        this.sound.playEvent('boost', 0.65);
        this._triggerHaptic(14);
        break;
      }
      case 'item_used': {
        const id = ev.abilityId;
        if (id === 'cop_missile') {
          this.cameraShake = Math.max(this.cameraShake, ev.sourceUnit === 'tank' ? 0.55 : 0.32);
          this.sound.playEvent('item', 1.1);
          this._triggerHaptic([18, 20, 26]);
        } else if (id === 'cop_siren_surge' || id === 'cop_surge') {
          this.sound.playEvent('boost', 1.0);
          this._triggerHaptic(16);
        } else if (id === 'sugar_rush') {
          this.cameraShake = Math.max(this.cameraShake, 0.42);
          this.sound.playEvent('boost', 1.25);
          this._triggerHaptic([20, 25, 25]);
        } else if (id === 'triple_boost' || id === 'star_power' || id === 'mega_giant') {
          this.sound.playEvent('boost', 1.0);
          this._triggerHaptic(18);
        } else {
          this.sound.playEvent('item', 1.0);
          this._triggerHaptic(12);
        }
        if (this.net.roomCode && ev.netEvent && ev.playerId === (this.sim.localPlayer?.id || 'local')) {
          this.net.sendAbilityEvent(ev.netEvent);
        }
        break;
      }
      case 'cop_wrecked': {
        this.renderer.spawnExplosionVisual(ev.x, ev.y || 0.9, ev.z, 5.5);
        this.cameraShake = Math.max(this.cameraShake, 0.55);
        this.sound.playEvent('crash', 0.95);
        this._triggerHaptic([22, 24, 32]);
        break;
      }
      case 'pvp_slam': {
        this.renderer.spawnDebris(ev.x, ev.y || 0.8, ev.z, '#facc15', 10, 16, 0.42);
        this.cameraShake = Math.max(this.cameraShake, 0.65);
        this.sound.playEvent('crash', 0.85);
        this._triggerHaptic([24, 28, 34]);
        if (this.net.roomCode && Array.isArray(ev.impulses)) {
          for (const imp of ev.impulses) {
            this.net.sendPvpBump(imp);
          }
        }
        break;
      }
      case 'star_up': {
        const aiCopsActive = (this.sim.settings?.aiCopsEnabled ?? this.settings.aiCopsEnabled) !== false;
        if (!aiCopsActive || this.sim.localPlayer?.playerRole === 'cop') break;
        this._showChaosToast(`⭐ ${ev.stars}★ ${ev.label || 'Backup Inbound'}`);
        break;
      }
      case 'horn': {
        this.sound.playEvent(ev.superHorn ? 'super_horn' : 'horn', ev.intensity || 1.0);
        if (ev.superHorn) this._triggerHaptic(24);
        if (this.net.roomCode && ev.playerId === (this.sim.localPlayer?.id || 'local')) {
          this.net.sendHornEvent?.({ x: ev.x, z: ev.z });
        }
        break;
      }
      case 'water_splash': {
        this.renderer.spawnDebris(ev.x, 0.2, ev.z, '#38bdf8', 18, 16, 0.48);
        this.sound.playEvent('water_splash', 1.0);
        if (ev.eliminated) {
          this._triggerHaptic([45, 40, 75]);
          this._onLocalPlayerEliminated('drowned', ev.killerName);
        }
        break;
      }
      case 'busted': {
        this.sound.playEvent('busted', 1.0);
        this._triggerHaptic([45, 40, 75]);
        this._onLocalPlayerEliminated('busted', ev.killerName);
        break;
      }
      case 'wrecked': {
        this.sound.playEvent('busted', 1.0);
        this._triggerHaptic([55, 40, 85]);
        this._onLocalPlayerEliminated('wrecked', ev.killerName);
        break;
      }
      default:
        break;
    }
  }

  _onLocalPlayerEliminated(reason, killerName) {
    if (this.eliminatedSent) return;
    this.eliminatedSent = true;
    this.sound.updateLoopSounds(0, false, 1, false, true);

    const lp = this.sim.localPlayer;
    const survived = lp?.survivalTime || 0;
    const score = Math.round(lp?.score || 0);
    const copsWrecked = lp?.copsWrecked || 0;

    if (survived > this.best.bestTime || score > this.best.bestScore) {
      this.best.bestTime = Math.max(this.best.bestTime, survived);
      this.best.bestScore = Math.max(this.best.bestScore, score);
      saveBestStats(this.best);
    }

    if (this.net.roomCode && (this.mode === 'playing_party' || this.mode === 'spectating')) {
      this.net.sendPlayerState(lp, true);
      this.net.sendPlayerEliminated(reason, killerName, survived, score, copsWrecked);
      this._clearTouchState();
      document.getElementById('touch-controls').classList.add('hidden');

      const aliveRemotes = this.sim.remotePlayers.filter((rp) => rp.alive !== false);
      this.mode = 'spectating';
      if (aliveRemotes.length >= 1) {
        document.getElementById('spectator-bar').classList.remove('hidden');
        document.getElementById('spectator-status').textContent = lp?.eliminatedText || 'YOU ARE OUT!';
      }
      return;
    }

    // Solo Mode -> show Game Over after brief dramatic beat
    this.mode = 'gameover';
    setTimeout(() => {
      if (this.mode === 'gameover') {
        this._showGameOverModal({ isParty: false, reason, killerName });
      }
    }, 650);
  }

  _showGameOverModal({ isParty, winnerId, winnerName, winnerTeam, standings, reason }) {
    this.mode = 'gameover';
    this.sound.updateLoopSounds(0, false, 1, false, true);
    document.getElementById('spectator-bar').classList.add('hidden');
    document.getElementById('danger-vignette').classList.add('hidden');
    document.getElementById('speed-lines').classList.add('hidden');
    document.getElementById('settings-modal').classList.add('hidden');

    const lp = this.sim.localPlayer;
    const survived = lp?.survivalTime || 0;
    const score = Math.round(lp?.score || 0);
    const cops = lp?.copsWrecked || 0;

    document.getElementById('go-time').textContent = `${survived.toFixed(1)}s`;
    document.getElementById('go-score').textContent = String(score);
    document.getElementById('go-cops').textContent = String(cops);

    const badge = document.getElementById('gameover-badge');
    const title = document.getElementById('gameover-title');
    const reasonEl = document.getElementById('gameover-reason');
    const standingsWrap = document.getElementById('go-standings-wrap');
    const standingsList = document.getElementById('go-standings-list');
    const backLobbyBtn = document.getElementById('btn-back-lobby');
    const playAgainBtn = document.getElementById('btn-play-again');

    if (isParty && Array.isArray(standings) && standings.length > 0) {
      const iWon = winnerId && winnerId === this.net.playerId;
      const myRole = lp?.playerRole || this.settings.playerRole || 'runner';
      if (winnerTeam === 'cop') {
        badge.textContent = myRole === 'cop' ? '🚔 PRECINCT VICTORY!' : '🚨 BUSTED BY POLICE!';
        title.textContent = '🚔 POLICE TEAM WINS!';
        reasonEl.textContent = winnerName
          ? `Top Officer: ${winnerName} — All Getaway Runners eliminated!`
          : 'All Getaway Runners were busted by the Police Team!';
      } else if (winnerTeam === 'runner') {
        badge.textContent = iWon ? '👑 GETAWAY CHAMPION!' : '🏎️ RUNNERS ESCAPED!';
        title.textContent = winnerName ? `${winnerName} WINS!` : '🏎️ GETAWAY TEAM WINS!';
        reasonEl.textContent = iWon
          ? 'You outlasted the entire Police pursuit!'
          : `${winnerName || 'Getaway Runner'} escaped the Police pursuit!`;
      } else {
        badge.textContent = iWon ? '👑 CHAMPION!' : 'PARTY MATCH OVER';
        title.textContent = winnerName ? `${winnerName} WINS!` : 'FINISH!';
        reasonEl.textContent = iWon
          ? 'You outlasted everyone in the lobby!'
          : `${winnerName || 'Winner'} lasted the longest!`;
      }

      standingsWrap.classList.remove('hidden');
      standingsList.innerHTML = '';
      for (const row of standings) {
        const div = document.createElement('div');
        div.className = 'standing-row';
        const roleIcon = row.playerRole === 'cop' ? '🚔 ' : '';
        div.innerHTML = `
          <span>${row.rank === 1 ? '👑' : `#${row.rank}`} ${roleIcon}${this._escapeHtml(row.name)}</span>
          <span>${Number(row.survivalTime || 0).toFixed(1)}s · ${row.score || 0} pts</span>
        `;
        standingsList.appendChild(div);
      }

      backLobbyBtn.classList.remove('hidden');
      playAgainBtn.textContent = this.net.isHost ? 'START REMATCH!' : 'BACK TO LOBBY';
    } else {
      badge.textContent = reason === 'drowned' ? 'SPLASHED!' : reason === 'wrecked' ? 'WRECKED!' : 'BUSTED!';
      title.textContent = lp?.eliminatedText || 'BUSTED!';
      reasonEl.textContent = `Best Survival: ${this.best.bestTime.toFixed(1)}s · High Score: ${Math.round(this.best.bestScore)}`;
      standingsWrap.classList.add('hidden');
      backLobbyBtn.classList.add('hidden');
      playAgainBtn.textContent = 'PLAY AGAIN';
    }

    document.getElementById('gameover-modal').classList.remove('hidden');
  }

  _updateHud() {
    const lp = this.sim.localPlayer;
    if (!lp) return;

    // Wanted stars (0 stars lit when AI Police Chase is turned OFF!)
    const aiCopsActive = this.sim.settings?.aiCopsEnabled !== false;
    const shownStars = aiCopsActive || lp.playerRole === 'cop' ? this.sim.wantedStars : 0;
    const stars = document.querySelectorAll('#wanted-stars .star');
    stars.forEach((el, idx) => el.classList.toggle('active', idx < shownStars));

    // Health bar + dynamic vehicle role label (HELI, TANK, COP, or CAR)
    const hpLbl = document.getElementById('hud-hp-label') || document.querySelector('.hp-label');
    if (hpLbl) {
      if (lp.playerRole === 'cop') {
        hpLbl.textContent =
          lp.copVehicleId === 'cop_heli'
            ? 'HELI'
            : lp.copVehicleId === 'cop_tank'
              ? 'TANK'
              : 'COP';
      } else {
        hpLbl.textContent = 'CAR';
      }
    }
    const hpPct = Math.max(0, Math.min(100, (lp.hp / Math.max(1, lp.maxHp)) * 100));
    const hpFill = document.getElementById('hp-fill');
    hpFill.style.width = `${hpPct}%`;
    hpFill.style.backgroundColor = hpPct > 50 ? '#22c55e' : hpPct > 25 ? '#f59e0b' : '#ef4444';

    // Busted arrest progress alert
    const bustedProg = lp.bustedProgress || 0;
    const bustedAlert = document.getElementById('busted-alert');
    const vignette = document.getElementById('danger-vignette');
    const fxEnabled = this.settings.screenEffects !== false;
    if (lp.alive && bustedProg > 0.08) {
      bustedAlert?.classList.remove('hidden');
      vignette?.classList.toggle('hidden', !fxEnabled);
      const bFill = document.getElementById('busted-fill');
      if (bFill) bFill.style.width = `${Math.round(bustedProg * 100)}%`;
    } else {
      bustedAlert?.classList.add('hidden');
      vignette?.classList.add('hidden');
    }

    // Side-Only Mario Kart Mystery Box / Police Weapon Button
    const items = lp.items || {};
    const useBtn = document.getElementById('btn-use-item');
    const useIcon = document.getElementById('btn-use-item-icon');
    const useLabel = document.getElementById('btn-use-item-label');
    const useCharges = document.getElementById('btn-use-item-charges');
    const isCopMissileUnit =
      lp.playerRole === 'cop' && (lp.copVehicleId === 'cop_heli' || lp.copVehicleId === 'cop_tank');

    if (useBtn && useIcon && useLabel && useCharges) {
      if (isCopMissileUnit) {
        const cd = Math.max(0, Number(lp.copMissileCooldown) || 0);
        useBtn.classList.remove('spinning', 'sugar-glow');
        useCharges.classList.add('hidden');
        if (cd <= 0) {
          useBtn.classList.remove('disabled');
          useBtn.classList.add('cop-weapon-ready');
          useIcon.textContent = '🎯';
          useLabel.textContent = 'MISSILE';
        } else {
          useBtn.classList.add('disabled');
          useBtn.classList.remove('cop-weapon-ready', 'locked-pop');
          useIcon.textContent = '⏳';
          useLabel.textContent = `${cd.toFixed(1)}s`;
        }
      } else if (items.rouletteTimer > 0) {
        const disp = ABILITIES.find((a) => a.id === items.rouletteDisplayId) || ABILITIES[0];
        useBtn.classList.remove('disabled', 'sugar-glow', 'cop-weapon-ready');
        useBtn.classList.add('spinning');
        useIcon.textContent = disp.icon;
        useLabel.textContent = 'SPIN...';
        useCharges.classList.add('hidden');
      } else if (items.heldItem) {
        const held = ABILITIES.find((a) => a.id === items.heldItem) || ABILITIES[0];
        useBtn.classList.remove('disabled', 'spinning', 'cop-weapon-ready');
        useBtn.classList.toggle('sugar-glow', items.heldItem === 'sugar_rush');
        useIcon.textContent = held.icon;
        useLabel.textContent = held.shortName;
        if (items.charges > 1) {
          useCharges.textContent = `x${items.charges}`;
          useCharges.classList.remove('hidden');
        } else {
          useCharges.classList.add('hidden');
        }
      } else if (lp.playerRole === 'cop') {
        const cd = Math.max(0, Number(lp.copMissileCooldown) || 0);
        useBtn.classList.remove('spinning', 'sugar-glow');
        useCharges.classList.add('hidden');
        if (cd <= 0) {
          useBtn.classList.remove('disabled');
          useBtn.classList.add('cop-weapon-ready');
          useIcon.textContent = '🚨';
          useLabel.textContent = 'SURGE';
        } else {
          useBtn.classList.add('disabled');
          useBtn.classList.remove('cop-weapon-ready', 'locked-pop');
          useIcon.textContent = '⏳';
          useLabel.textContent = `${cd.toFixed(1)}s`;
        }
      } else {
        useBtn.classList.add('disabled');
        useBtn.classList.remove('spinning', 'sugar-glow', 'locked-pop', 'cop-weapon-ready');
        useIcon.textContent = '?';
        useLabel.textContent = 'ITEM';
        useCharges.classList.add('hidden');
      }
    }

    // Active buffs chips (under .hud-left-stack so top-center is 100% open!)
    const buffsEl = document.getElementById('active-buffs');
    const chips = [];
    if (items.sugarTimer > 0) {
      chips.push({ text: `🍭 ${items.sugarTimer.toFixed(1)}s`, cls: 'buff-chip sugar' });
    }
    if (items.starTimer > 0) {
      chips.push({ text: `⭐ ${items.starTimer.toFixed(1)}s`, cls: 'buff-chip' });
    }
    if (items.megaTimer > 0) {
      chips.push({ text: `🦖 ${items.megaTimer.toFixed(1)}s`, cls: 'buff-chip' });
    }
    if (items.boostTimer > 0) {
      chips.push({ text: '🍄 BOOST', cls: 'buff-chip' });
    }
    if (items.shrunkTimer > 0) {
      chips.push({ text: '⚡ TINY', cls: 'buff-chip' });
    }
    if (buffsEl) {
      buffsEl.innerHTML = chips.map((c) => `<span class="${c.cls}">${c.text}</span>`).join('');
    }

    // Speedometer + MPH / KM/H + Drift Spark Gauge
    const speedoEl = document.getElementById('hud-speedo');
    const showSpeedo = this.settings.showSpeedometer !== false;
    if (speedoEl) {
      speedoEl.classList.toggle('hidden', !showSpeedo);
      if (showSpeedo) {
        const isKmh = this.settings.speedUnit === 'kmh';
        const speedVal = Math.round((lp.speed || 0) * (isKmh ? 3.54 : 2.2));
        const valEl = document.getElementById('hud-speedo-val');
        if (valEl) valEl.textContent = String(speedVal);
        const unitEl = speedoEl.querySelector('#hud-speedo-unit, .speedo-unit');
        if (unitEl) unitEl.textContent = isKmh ? 'KM/H' : 'MPH';
        const sugarOn = Boolean(lp.sugarActive || items.sugarTimer > 0);
        speedoEl.classList.toggle('sugar-speed', sugarOn);

        const sparkEl = document.getElementById('hud-drift-spark');
        const sparkTier = lp.driftSparkTier || 0;
        if (sparkEl) {
          if (lp.alive && sparkTier > 0) {
            sparkEl.classList.remove('hidden');
            sparkEl.classList.toggle('tier-1', sparkTier === 1);
            sparkEl.classList.toggle('tier-2', sparkTier >= 2);
          } else {
            sparkEl.classList.add('hidden');
            sparkEl.classList.remove('tier-1', 'tier-2');
          }
        }
      }
    }

    // Minimap & FPS badge visibility
    document.getElementById('hud-minimap')?.classList.toggle('hidden', this.settings.showMinimap === false);
    document.getElementById('hud-fps')?.classList.toggle('hidden', !this.settings.showFps);

    // Screen-Edge Speed Streaks (3x Sugar Rush OR POV Turbo/Star)
    const speedLinesEl = document.getElementById('speed-lines');
    const sugarActive = Boolean(lp.sugarActive || items.sugarTimer > 0);
    const povHyper =
      this.settings.cameraMode === 'pov' &&
      Boolean(lp.boostActive || items.boostTimer > 0 || lp.starActive || items.starTimer > 0);
    const showStreaks = Boolean(
      fxEnabled && lp.alive && this.mode !== 'spectating' && (sugarActive || povHyper)
    );
    speedLinesEl?.classList.toggle('hidden', !showStreaks);
    speedLinesEl?.classList.toggle('sugar-mode', sugarActive);

    // Clock & Score
    const timerEl = document.getElementById('hud-timer');
    if (timerEl) timerEl.textContent = formatClock(lp.survivalTime || 0);
    const scoreEl = document.getElementById('hud-score');
    if (scoreEl) scoreEl.textContent = String(Math.round(lp.score || 0));
  }

  _updateSurvivorStrip() {
    const strip = document.getElementById('survivor-strip');
    if (!this.net.roomCode) {
      strip.classList.add('hidden');
      return;
    }

    const lp = this.sim.localPlayer;
    const combined = [];
    if (lp) {
      combined.push({
        id: lp.id,
        name: lp.name || 'You',
        playerRole: lp.playerRole || 'runner',
        alive: lp.alive !== false,
        survivalTime: lp.survivalTime || 0,
        avatarDataUrl: this._getSelectedPerson()?.dataUrl || '',
      });
    }
    for (const rp of this.sim.remotePlayers) {
      combined.push({
        id: rp.id,
        name: rp.name || 'Friend',
        playerRole: rp.playerRole || 'runner',
        alive: rp.alive !== false,
        survivalTime: rp.survivalTime || 0,
        avatarDataUrl: this.remoteAvatarCache.get(rp.avatarId || `net_${rp.id}`) || '',
      });
    }
    combined.sort((a, b) => (a.alive !== b.alive ? (a.alive ? -1 : 1) : b.survivalTime - a.survivalTime));

    const aliveCount = combined.filter((p) => p.alive).length;
    const visiblePills = combined.length > 6 ? combined.slice(0, 5) : combined;
    const countBadge =
      combined.length >= 6
        ? `<div class="survivor-pill" style="border-color:#facc15;color:#fde047">👥 ${aliveCount}/${combined.length} ALIVE</div>`
        : '';

    strip.innerHTML =
      countBadge +
      visiblePills
        .map((p) => {
          const safeUrl = this._safeImgSrc(p.avatarDataUrl);
          const rolePrefix = p.playerRole === 'cop' ? '🚔 ' : '';
          return `
      <div class="survivor-pill ${p.alive ? '' : 'out'}">
        ${safeUrl ? `<img src="${safeUrl}" alt="" />` : ''}
        <span>${rolePrefix}${this._escapeHtml(p.name)} · ${p.survivalTime.toFixed(0)}s</span>
      </div>`;
        })
        .join('');
  }

  _showChaosToast(text) {
    const el = document.getElementById('chaos-toast');
    el.textContent = text;
    el.classList.remove('hidden');
    this.toastTimer = 1.75;
  }

  _renderFrame(dt) {
    let focusEntity = this.sim.localPlayer;
    if (this.mode === 'spectating') {
      const aliveRemotes = this.sim.remotePlayers.filter((rp) => rp.alive !== false);
      if (aliveRemotes.length > 0) {
        const target = aliveRemotes[this.spectateIndex % aliveRemotes.length];
        focusEntity = target;
        const realName =
          target.name ||
          this.net.roomState?.players?.find((p) => p.id === target.id)?.name ||
          'Player';
        document.getElementById('spectator-watching').textContent = `Watching ${realName}`;
      }
    }

    const shakeMult = clampNum(this.settings.cameraShakeMult, 0, 1.5, 1.0);
    this.renderer.setCamera(
      focusEntity,
      this.mode === 'attract' ? 'attract' : this.settings.cameraMode,
      this.cameraShake * shakeMult,
      dt,
      { povFov: this.settings.povFov || 78 }
    );

    const activeProjectiles = this.sim.getProjectiles();
    const allVisualProjectiles =
      Array.isArray(this.sim.hazards) && this.sim.hazards.length > 0
        ? activeProjectiles.concat(this.sim.hazards)
        : activeProjectiles;

    this.renderer.render(
      {
        world: this.world,
        biomeId: this.world.biomeId || this.settings.biome,
        localPlayer: this.sim.localPlayer,
        remotePlayers: this.sim.remotePlayers,
        cops: this.sim.cops,
        traffic: this.sim.traffic,
        projectiles: allVisualProjectiles,
        focusX: focusEntity?.x ?? 0,
        focusZ: focusEntity?.z ?? 0,
      },
      dt,
      this._elapsedTime
    );

    this._renderMinimap(focusEntity);
    this._renderFloatingNametags(focusEntity);
  }

  _renderMinimap(focusEntity) {
    if (this.settings.showMinimap === false) return;
    if (this.mode === 'attract' && !this.editingHudLayout) return;
    const canvas = document.getElementById('hud-minimap');
    if (!canvas || canvas.classList.contains('hidden')) return;
    const ctx = canvas.getContext('2d');
    if (!ctx || !focusEntity) return;

    const w = canvas.width || 112;
    const h = canvas.height || 112;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const radius = Math.min(cx, cy) - 3;
    const radarRange = 175;
    const scale = radius / radarRange;

    ctx.clearRect(0, 0, w, h);

    // 1. Circular clip + dark radar surface
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = 'rgba(11, 17, 29, 0.88)';
    ctx.fillRect(0, 0, w, h);

    const fx = focusEntity.x || 0;
    const fz = focusEntity.z || 0;
    const yaw = focusEntity.angle || 0;
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);

    // 2. World-space rotated roads & rivers (ahead = UP on radar!)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(yaw);
    ctx.scale(-scale, -scale);
    ctx.translate(-fx, -fz);

    const chunkSize = WORLD_CONFIG.CHUNK_SIZE || 60;
    const minGX = Math.floor((fx - radarRange) / chunkSize);
    const maxGX = Math.ceil((fx + radarRange) / chunkSize);
    const minGZ = Math.floor((fz - radarRange) / chunkSize);
    const maxGZ = Math.ceil((fz + radarRange) / chunkSize);

    // River water tint bands
    ctx.fillStyle = 'rgba(34, 211, 238, 0.42)';
    for (let cz = minGZ - 1; cz <= maxGZ + 1; cz++) {
      if (this.world?.isRiverChunkZ?.(cz)) {
        const rz = cz * chunkSize + chunkSize * 0.5;
        ctx.fillRect(fx - radarRange * 1.4, rz - 13.5, radarRange * 2.8, 27);
      }
    }

    // NS & EW street grid
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.48)';
    for (let gx = minGX; gx <= maxGX; gx++) {
      ctx.lineWidth = this.world?.isHighwayGrid?.(gx) ? 20 : 12;
      ctx.beginPath();
      ctx.moveTo(gx * chunkSize, fz - radarRange * 1.4);
      ctx.lineTo(gx * chunkSize, fz + radarRange * 1.4);
      ctx.stroke();
    }
    for (let gz = minGZ; gz <= maxGZ; gz++) {
      ctx.lineWidth = this.world?.isHighwayGrid?.(gz) ? 20 : 12;
      ctx.beginPath();
      ctx.moveTo(fx - radarRange * 1.4, gz * chunkSize);
      ctx.lineTo(fx + radarRange * 1.4, gz * chunkSize);
      ctx.stroke();
    }
    ctx.restore();

    // Inner range ring
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.55, 0, Math.PI * 2);
    ctx.stroke();

    const projectDot = (wx, wz, clampToRim = false) => {
      const dx = wx - fx;
      const dz = wz - fz;
      const fwd = dx * sinY + dz * cosY;
      const right = -dx * cosY + dz * sinY;
      let px = right * scale;
      let py = -fwd * scale;
      const d = Math.hypot(px, py);
      const maxR = radius - 4.5;
      if (d > maxR) {
        if (!clampToRim) return null;
        px = (px / d) * maxR;
        py = (py / d) * maxR;
      }
      return { x: cx + px, y: cy + py };
    };

    // 3. Nearby Mystery Boxes & Pink Sugar Rush Boxes
    const nearbyChunks = this.world?._getNearbyChunks?.(fx, fz, 2) || [];
    for (let c = 0; c < nearbyChunks.length; c++) {
      const boxes = nearbyChunks[c].itemBoxes || [];
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        if (box.collected) continue;
        const pt = projectDot(box.x, box.z, false);
        if (!pt) continue;
        const isSugar = box.boxType === 'sugar';
        ctx.fillStyle = isSugar ? '#f472b6' : 'rgba(56, 189, 248, 0.72)';
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, isSugar ? 2.5 : 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 4. Pulsing Red/Blue Police Dots
    const sirenPhase = Math.floor(this._elapsedTime * 9);
    for (let i = 0; i < this.sim.cops.length; i++) {
      const cop = this.sim.cops[i];
      if (!cop || cop.wrecked) continue;
      if (Math.hypot(cop.x - fx, cop.z - fz) > 250) continue;
      const pt = projectDot(cop.x, cop.z, true);
      if (!pt) continue;
      const isRed = (sirenPhase + i) % 2 === 0;
      ctx.fillStyle = isRed ? '#ef4444' : '#3b82f6';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, cop.type === 'tank' || cop.type === 'heli' ? 3.5 : 2.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // 5. Party Friends Dots (always shown on radar rim even far across the 4800x4800 map!)
    for (let i = 0; i < this.sim.remotePlayers.length; i++) {
      const rp = this.sim.remotePlayers[i];
      if (!rp || rp.alive === false) continue;
      const pt = projectDot(rp.x, rp.z, true);
      if (!pt) continue;
      const isRemoteCop = rp.playerRole === 'cop';
      const isRedStrobe = (sirenPhase + i) % 2 === 0;
      ctx.fillStyle = isRemoteCop
        ? (isRedStrobe ? '#ef4444' : '#38bdf8')
        : (/^#[0-9a-fA-F]{3,8}$/.test(rp.primaryColor || '') ? rp.primaryColor : '#facc15');
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = isRemoteCop ? 1.5 : 1.2;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, isRemoteCop ? 3.9 : 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 6. Player Center Heading Chevron (pointing UP = straight ahead)
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.8, 5);
    ctx.lineTo(0, 2.6);
    ctx.lineTo(-4.8, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();

    // Crisp outer bezel
    ctx.strokeStyle = 'rgba(250, 204, 21, 0.72)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  _renderFloatingNametags(focusEntity) {
    const container = document.getElementById('world-labels');
    if (this.mode === 'attract' || this.sim.remotePlayers.length === 0) {
      if (container.innerHTML !== '') container.innerHTML = '';
      return;
    }

    const vw = window.innerWidth || 390;
    const vh = window.innerHeight || 844;
    const pad = {
      left: 8,
      right: 8,
      top: 74,
      bottom: 10,
    };

    const placedOffscreen = [];
    let html = '';

    for (const rp of this.sim.remotePlayers) {
      if (rp.alive === false) continue;
      if (this.mode === 'spectating' && focusEntity && rp.id === focusEntity.id) {
        // Still label the car you're spectating right above their roof
      }
      const wp = this.renderer.projectWaypoint(
        rp.x,
        (rp.y || 0) + 4.1 * (rp.scale || 1),
        rp.z,
        pad
      );
      const rosterPlayer = this.net.roomState?.players?.find((p) => p.id === rp.id);
      const isRemoteCop = (rp.playerRole || rosterPlayer?.playerRole) === 'cop';
      const rawName = rp.name && rp.name !== 'Friend' ? rp.name : rosterPlayer?.name || rp.name || 'Player';
      const displayLabel = isRemoteCop ? `🚔 ${this._escapeHtml(rawName)}` : this._escapeHtml(rawName);
      const borderCol = isRemoteCop
        ? '#38bdf8'
        : /^#[0-9a-fA-F]{3,8}$/.test(rp.primaryColor || '')
          ? rp.primaryColor
          : '#facc15';

      if (wp.onScreen) {
        html += `
          <div class="player-tag" style="left:${wp.x.toFixed(1)}px;top:${wp.y.toFixed(1)}px;border-color:${borderCol}">
            <span>${displayLabel}</span>
          </div>
        `;
      } else {
        // Flush outer-edge directional username tag (anchored inward from whichever screen edge it touches!)
        let tx = wp.x;
        let ty = wp.y;
        for (let pass = 0; pass < placedOffscreen.length; pass++) {
          const prev = placedOffscreen[pass];
          if (Math.abs(tx - prev.x) < 70 && Math.abs(ty - prev.y) < 28) {
            if (ty + 28 <= vh - pad.bottom) {
              ty += 28;
            } else if (ty - 28 >= pad.top) {
              ty -= 28;
            } else {
              tx = Math.max(pad.left, Math.min(vw - pad.right, tx + (tx < vw * 0.5 ? 74 : -74)));
            }
          }
        }
        placedOffscreen.push({ x: tx, y: ty });
        const rxPct = Math.round(((tx - pad.left) / Math.max(1, vw - pad.left - pad.right)) * 100);
        const ryPct = Math.round(((ty - pad.top) / Math.max(1, vh - pad.top - pad.bottom)) * 100);
        const deg = Math.round((wp.angleRad * 180) / Math.PI);
        html += `
          <div class="player-tag offscreen" style="left:${tx.toFixed(1)}px;top:${ty.toFixed(1)}px;transform:translate(-${rxPct}%, -${ryPct}%);border-color:${borderCol}">
            <span class="tag-arrow" style="transform:rotate(${deg}deg)">➤</span>
            <span>${displayLabel}</span>
          </div>
        `;
      }
    }
    container.innerHTML = html;
  }

  _safeImgSrc(url) {
    if (typeof url !== 'string' || !url) return '';
    if (/^data:image\/(?:png|webp|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/.test(url)) {
      return url;
    }
    return '';
  }

  _escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new SmashyKartApp();
  window.__SMASHY_KART__ = app;
  app.init();
});
