// Master Game Controller — Menus, Garage, Photo Studio, Custom Audio, Touch/Keyboard HUD & Party Multiplayer
import {
  VEHICLES,
  ABILITIES,
  BIOMES,
  CHARACTER_MODES,
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
    return {
      ...defaults,
      ...parsed,
      enabledItems: { ...defaults.enabledItems, ...(parsed.enabledItems || {}) },
      lobbyRules: { ...defaults.lobbyRules, ...(parsed.lobbyRules || {}) },
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
    this.world = new World(this.settings.worldSeed, this.settings.biome, {
      itemBoxDensity: this.settings.itemBoxDensity,
    });
    this.abilities = new AbilitySystem(this.settings);
    this.sim = new Simulation(this.world, this.abilities, this.settings);
    this.sound = new SoundManager(this.settings.soundVolume);
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

    // Input state
    this.keys = new Set();
    this.touchSteerLeft = false;
    this.touchSteerRight = false;
    this.touchBrake = false;
    this.touchUseItemQueued = false;
    this.touchHornQueued = false;
    this.joystickTouchId = null;
    this.joystickOrigin = { x: 0, y: 0 };
    this.joystickAxis = 0;
    this.leftZoneTouches = new Set();
    this.rightZoneTouches = new Set();

    // Photo editor state
    this.editingImage = null;
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
  }

  async init() {
    this._handleResize();
    window.addEventListener('resize', () => this._handleResize());

    await Promise.all([
      this.photos.init().catch(() => {}),
      this.sound.init().catch(() => {}),
      this.net.fetchNetworkInfo().catch(() => {}),
    ]);

    this._syncAllPhotoTextures();
    this._bindGlobalAudioUnlock();
    this._bindKeyboardInput();
    this._bindTouchControls();
    this._bindHomeAndModals();
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
    return {
      name: (this.settings.playerName || 'Player').trim().slice(0, 16) || 'Player',
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

  _bindKeyboardInput() {
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'Enter') {
        if (this.mode === 'playing_solo' || this.mode === 'playing_party') {
          e.preventDefault();
          this.touchUseItemQueued = true;
        }
      } else if (e.code === 'KeyH' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (this.mode === 'playing_solo' || this.mode === 'playing_party') {
          this.touchHornQueued = true;
        }
      } else if (e.code === 'Escape') {
        if (this.mode === 'playing_solo' || this.mode === 'playing_party' || this.mode === 'spectating') {
          this._exitToMainMenu();
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
    this.touchSteerLeft = false;
    this.touchSteerRight = false;
    this.touchBrake = false;
    this.joystickTouchId = null;
    this.joystickAxis = 0;
    document.getElementById('steer-left-zone')?.classList.remove('pressed');
    document.getElementById('steer-right-zone')?.classList.remove('pressed');
    const stick = document.getElementById('joystick-stick');
    if (stick) stick.style.transform = 'translate(-50%, -50%)';
  }

  _bindTouchControls() {
    const leftZone = document.getElementById('steer-left-zone');
    const rightZone = document.getElementById('steer-right-zone');
    const syncSplitVisuals = () => {
      this.touchSteerLeft = this.leftZoneTouches.size > 0;
      this.touchSteerRight = this.rightZoneTouches.size > 0;
      leftZone.classList.toggle('pressed', this.touchSteerLeft);
      rightZone.classList.toggle('pressed', this.touchSteerRight);
    };

    const bindZone = (el, set) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture?.(e.pointerId);
        set.add(e.pointerId);
        syncSplitVisuals();
      });
      const release = (e) => {
        set.delete(e.pointerId);
        syncSplitVisuals();
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('lostpointercapture', release);
    };

    bindZone(leftZone, this.leftZoneTouches);
    bindZone(rightZone, this.rightZoneTouches);

    // Optional Thumbstick steering
    const joyZone = document.getElementById('joystick-zone');
    const joyStick = document.getElementById('joystick-stick');
    const maxRadius = 42;

    joyZone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      joyZone.setPointerCapture?.(e.pointerId);
      this.joystickTouchId = e.pointerId;
      const rect = joyZone.getBoundingClientRect();
      this.joystickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      this._updateJoystick(e.clientX, e.clientY, joyStick, maxRadius);
    });

    joyZone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.joystickTouchId) return;
      this._updateJoystick(e.clientX, e.clientY, joyStick, maxRadius);
    });

    const endJoy = (e) => {
      if (e.pointerId !== this.joystickTouchId) return;
      this.joystickTouchId = null;
      this.joystickAxis = 0;
      joyStick.style.transform = 'translate(-50%, -50%)';
    };
    joyZone.addEventListener('pointerup', endJoy);
    joyZone.addEventListener('pointercancel', endJoy);

    // Use Item buttons (both bottom-right thumb button AND top-center roulette slot)
    const fireItem = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.touchUseItemQueued = true;
    };
    document.getElementById('btn-use-item').addEventListener('pointerdown', fireItem);
    document.getElementById('hud-item-slot').addEventListener('pointerdown', fireItem);

    // Brake & Horn buttons
    const brakeBtn = document.getElementById('btn-brake');
    brakeBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      brakeBtn.setPointerCapture?.(e.pointerId);
      this.touchBrake = true;
    });
    const endBrake = () => { this.touchBrake = false; };
    brakeBtn.addEventListener('pointerup', endBrake);
    brakeBtn.addEventListener('pointercancel', endBrake);
    brakeBtn.addEventListener('lostpointercapture', endBrake);

    document.getElementById('btn-horn').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.touchHornQueued = true;
    });

    document.getElementById('btn-pause').addEventListener('click', () => {
      this._exitToMainMenu();
    });

    document.getElementById('btn-next-spectate').addEventListener('click', () => {
      this.spectateIndex += 1;
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
    this.touchBrake = oy > maxR * 0.68;
  }

  _gatherGameplayInput() {
    const keyLeft = this.keys.has('ArrowLeft') || this.keys.has('KeyA');
    const keyRight = this.keys.has('ArrowRight') || this.keys.has('KeyD');
    const keyBrake = this.keys.has('ArrowDown') || this.keys.has('KeyS');

    const left = keyLeft || this.touchSteerLeft;
    const right = keyRight || this.touchSteerRight;
    const brake = keyBrake || this.touchBrake || (left && right);

    const useItem = this.touchUseItemQueued;
    const horn = this.touchHornQueued;
    this.touchUseItemQueued = false;
    this.touchHornQueued = false;

    const steerAxis =
      this.settings.touchStyle === 'joystick' && Math.abs(this.joystickAxis) > 0.05
        ? this.joystickAxis
        : null;

    return { left, right, brake, useItem, horn, steerAxis };
  }

  _bindHomeAndModals() {
    const nameInput = document.getElementById('home-player-name');
    nameInput.value = this.settings.playerName || 'Tanner';
    nameInput.addEventListener('input', () => {
      this.settings.playerName = nameInput.value.trim().slice(0, 16) || 'Player';
      saveSettings(this.settings);
      if (this.net.roomCode) this.net.updateProfile(this._buildLocalNetProfile());
    });

    // Character Mode switchers across Home, Lobby, and Garage
    const setCharacterMode = (mode) => {
      if (!CHARACTER_MODES.some((m) => m.id === mode)) return;
      if (this.net.roomCode && !this.net.isHost && this.settings.lobbyRules?.allowModeChoice === false) {
        this._showChaosToast('🔒 Runner style is locked by the Lobby Manager!');
        return;
      }
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
      container.addEventListener('click', (e) => {
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
      });
    });

    document.getElementById('btn-quick-photo').addEventListener('click', () => {
      document.getElementById('people-modal').classList.remove('hidden');
      document.getElementById('photo-file-input').click();
    });

    // Close modals
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.getElementById(btn.dataset.closeModal)?.classList.add('hidden');
      });
    });

    // Play Solo & Open Party Lobby
    document.getElementById('btn-play-solo').addEventListener('click', () => {
      this.sound.unlock();
      this._startSoloMatch();
    });

    document.getElementById('btn-open-lobby').addEventListener('click', () => {
      this.sound.unlock();
      this._openLobbyModal();
    });

    document.querySelector('[data-close-lobby]')?.addEventListener('click', () => {
      document.getElementById('lobby-modal').classList.add('hidden');
    });

    // Game over buttons
    document.getElementById('btn-play-again').addEventListener('click', () => {
      document.getElementById('gameover-modal').classList.add('hidden');
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

    document.getElementById('btn-back-lobby').addEventListener('click', () => {
      document.getElementById('gameover-modal').classList.add('hidden');
      if (this.net.roomCode) {
        this.net.returnToLobby();
        this._openLobbyModal();
      } else {
        this._exitToMainMenu();
      }
    });

    document.getElementById('btn-back-home').addEventListener('click', () => {
      if (this.net.roomCode) this.net.leaveRoom();
      this._exitToMainMenu();
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

    let latestProcessedDataUrl = null;
    const refreshCutoutPreview = async () => {
      if (!this.editingImage) return;
      document.getElementById('val-photo-zoom').textContent = `${Number(zoomRng.value).toFixed(2)}x`;
      document.getElementById('val-photo-tol').textContent = tolRng.value;
      document.getElementById('tolerance-row').classList.toggle(
        'hidden',
        this.photoEditOpts.shape !== 'cutout'
      );

      const dataUrl = await this.photos.processImageToCutout(this.editingImage, {
        zoom: Number(zoomRng.value),
        offsetX: Number(xRng.value) / 100,
        offsetY: Number(yRng.value) / 100,
        magicCutout: this.photoEditOpts.shape === 'cutout',
        tolerance: Number(tolRng.value),
        shape: this.photoEditOpts.shape,
      });
      latestProcessedDataUrl = dataUrl;

      const ctx = cropCanvas.getContext('2d');
      const previewImg = new Image();
      previewImg.onload = () => {
        ctx.clearRect(0, 0, 256, 256);
        ctx.drawImage(previewImg, 0, 0, 256, 256);
      };
      previewImg.src = dataUrl;
    };

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          this.editingImage = img;
          zoomRng.value = '1.1';
          xRng.value = '0';
          yRng.value = '0';
          tolRng.value = '38';
          const baseName = file.name.replace(/\.[^.]+$/, '').slice(0, 14);
          nameInp.value = baseName && !/^img_|^image|^photo/i.test(baseName) ? baseName : 'Me';
          editorBox.classList.remove('hidden');
          refreshCutoutPreview();
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
      fileInput.value = '';
    });

    document.getElementById('cutout-shape-btns').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-shape]');
      if (!btn) return;
      this.photoEditOpts.shape = btn.dataset.shape;
      document.querySelectorAll('#cutout-shape-btns .seg-btn').forEach((b) =>
        b.classList.toggle('active', b.dataset.shape === this.photoEditOpts.shape)
      );
      refreshCutoutPreview();
    });

    for (const rng of [zoomRng, xRng, yRng, tolRng]) {
      rng.addEventListener('input', () => refreshCutoutPreview());
    }

    document.getElementById('btn-cancel-photo').addEventListener('click', () => {
      this.editingImage = null;
      editorBox.classList.add('hidden');
    });

    document.getElementById('btn-save-photo').addEventListener('click', async () => {
      if (!latestProcessedDataUrl) return;
      const saved = await this.photos.savePerson({
        name: nameInp.value.trim() || 'Custom Hero',
        dataUrl: latestProcessedDataUrl,
        useAsCop: copChk.checked,
      });
      this.settings.avatarId = saved.id;
      saveSettings(this.settings);
      this.editingImage = null;
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
          <button type="button" class="tiny-pill ${person.useAsCop ? 'cop-on' : ''}" data-toggle-cop="${person.id}">
            ${person.useAsCop ? '🚔 Cop ON' : 'Cop OFF'}
          </button>
          ${person.builtIn ? '' : `<button type="button" class="tiny-pill" data-del-person="${person.id}">✕</button>`}
        </div>
      `;

      card.addEventListener('click', async (e) => {
        const copBtn = e.target.closest('[data-toggle-cop]');
        const delBtn = e.target.closest('[data-del-person]');
        if (copBtn) {
          e.stopPropagation();
          await this.photos.savePerson({ ...person, useAsCop: !person.useAsCop });
          this._syncAllPhotoTextures();
          this._renderPeopleGrid();
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
    const bindSlider = (id, key, fmt) => {
      const el = document.getElementById(id);
      el.addEventListener('input', () => {
        if (this.net.roomCode && !this.net.isHost && key in universalRuleKeyMap && this.settings.lobbyRules?.lockStats !== false) {
          this._refreshAllUiFromSettings();
          this._showChaosToast('🔒 Car stats are locked by the Lobby Manager!');
          return;
        }
        const v = Number(el.value);
        this.settings[key] = v;
        if ((!this.net.roomCode || this.net.isHost) && universalRuleKeyMap[key]) {
          this.settings.lobbyRules[universalRuleKeyMap[key]] = v;
        }
        saveSettings(this.settings);
        this._refreshAllUiFromSettings();
        if (this.mode === 'attract') this._respawnAttractHero();
        if (this.net.roomCode && this.net.isHost) {
          this.net.updateRoomSettings(this.settings);
        }
      });
      return fmt;
    };

    bindSlider('rng-speed-mult', 'speedMult');
    bindSlider('rng-drift-mult', 'driftMult');
    bindSlider('rng-mass-mult', 'massMult');
    bindSlider('rng-scale-mult', 'scaleMult');

    document.getElementById('btn-reset-garage').addEventListener('click', () => {
      this.settings.speedMult = 1.0;
      this.settings.driftMult = 1.0;
      this.settings.massMult = 1.0;
      this.settings.scaleMult = 1.0;
      saveSettings(this.settings);
      this._refreshAllUiFromSettings();
      if (this.mode === 'attract') this._respawnAttractHero();
    });

    // World & Map controls
    document.getElementById('biome-btns').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-biome]');
      if (!btn) return;
      this.settings.biome = btn.dataset.biome;
      saveSettings(this.settings);
      this.world.reset(this.settings.worldSeed, this.settings.biome, {
        itemBoxDensity: this.settings.itemBoxDensity,
      });
      this._refreshAllUiFromSettings();
      if (this.mode === 'attract') this._respawnAttractHero();
      if (this.net.roomCode && this.net.isHost) this.net.updateRoomSettings(this.settings);
    });

    bindSlider('rng-cop-intensity', 'copIntensity');
    bindSlider('rng-start-stars', 'startStars');
    bindSlider('rng-gravity', 'gravityMult');

    document.getElementById('rng-box-density').addEventListener('input', (e) => {
      this.settings.itemBoxDensity = Number(e.target.value);
      saveSettings(this.settings);
      this.world.reset(this.settings.worldSeed, this.settings.biome, {
        itemBoxDensity: this.settings.itemBoxDensity,
      });
      this._refreshAllUiFromSettings();
      if (this.net.roomCode && this.net.isHost) this.net.updateRoomSettings(this.settings);
    });

    document.getElementById('camera-mode-btns').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cam]');
      if (!btn) return;
      this.settings.cameraMode = btn.dataset.cam;
      saveSettings(this.settings);
      this._refreshAllUiFromSettings();
    });

    document.getElementById('touch-style-btns').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-touch]');
      if (!btn) return;
      this.settings.touchStyle = btn.dataset.touch;
      saveSettings(this.settings);
      this._refreshAllUiFromSettings();
    });
  }

  _renderVehicleGrid() {
    const grid = document.getElementById('vehicle-grid');
    grid.innerHTML = '';
    for (const veh of VEHICLES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `vehicle-card${veh.id === this.settings.vehicleId ? ' selected' : ''}`;
      card.innerHTML = `
        <div class="veh-swatch" style="background: linear-gradient(90deg, ${veh.color} 72%, ${veh.accent} 72%)"></div>
        <div class="veh-name">${veh.name}</div>
        <div class="veh-stats">SPD ${veh.speed} · HP ${veh.maxHp}</div>
      `;
      card.addEventListener('click', () => {
        if (this.net.roomCode && !this.net.isHost && this.settings.lobbyRules?.allowCarChoice === false) {
          this._showChaosToast('🔒 Car choice is locked to Same Car by the Lobby Manager!');
          return;
        }
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

  _renderAbilityMixer() {
    const grid = document.getElementById('ability-mixer-grid');
    grid.innerHTML = '';
    for (const ab of ABILITIES) {
      const enabled = this.settings.enabledItems[ab.id] !== false;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `ability-toggle-card${enabled ? '' : ' off'}`;
      btn.innerHTML = `
        <span class="ab-icon">${ab.icon}</span>
        <div>
          <span class="ab-name">${ab.name}</span>
          <span class="ab-desc">${enabled ? 'ACTIVE IN ? BOXES' : 'TURNED OFF'}</span>
        </div>
      `;
      btn.addEventListener('click', () => {
        const activeCount = ABILITIES.filter((a) => this.settings.enabledItems[a.id] !== false).length;
        if (enabled && activeCount <= 1) {
          this._showChaosToast('Keep at least 1 Mario Kart ability turned on!');
          return;
        }
        this.settings.enabledItems[ab.id] = !enabled;
        saveSettings(this.settings);
        this.abilities.updateSettings(this.settings);
        this._refreshAllUiFromSettings();
        if (this.net.roomCode && this.net.isHost) this.net.updateRoomSettings(this.settings);
      });
      grid.appendChild(btn);
    }
  }

  _bindSoundStudio() {
    const volRng = document.getElementById('rng-volume');
    volRng.value = String(this.settings.soundVolume ?? 0.85);
    volRng.addEventListener('input', () => {
      const v = Number(volRng.value);
      this.settings.soundVolume = v;
      this.sound.setVolume(v);
      document.getElementById('val-volume').textContent = `${Math.round(v * 100)}%`;
      saveSettings(this.settings);
    });
    this._renderSoundSlots();
  }

  _renderSoundSlots() {
    const list = document.getElementById('sound-slots-list');
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
          await this.sound.stopMicRecording(slot).catch(() => {});
          this._renderSoundSlots();
          this.sound.previewSlot(slot);
        } else {
          try {
            this.recordingSlot = slot;
            this._renderSoundSlots();
            await this.sound.startMicRecording(async () => {
              this.recordingSlot = null;
              await this.sound.stopMicRecording(slot).catch(() => {});
              this._renderSoundSlots();
              this.sound.previewSlot(slot);
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
      });

      list.appendChild(row);
    }
  }

  _refreshAllUiFromSettings() {
    const s = this.settings;
    const person = this._getSelectedPerson();
    const homeImg = document.getElementById('home-avatar-img');
    if (person?.dataUrl) homeImg.src = person.dataUrl;

    document.querySelectorAll('[data-mode]').forEach((el) => {
      el.classList.toggle('active', el.dataset.mode === s.characterMode);
    });

    const veh = VEHICLES.find((v) => v.id === s.vehicleId) || VEHICLES[0];
    const biome = BIOMES[s.biome] || BIOMES.city;
    const enabledCount = ABILITIES.filter((a) => s.enabledItems[a.id] !== false).length;
    const modeObj = CHARACTER_MODES.find((m) => m.id === s.characterMode) || CHARACTER_MODES[0];
    document.getElementById('home-loadout-summary').textContent =
      `${modeObj.name} · ${veh.name} · ${biome.name} · ${enabledCount} Items`;

    document.getElementById('best-time-label').textContent = `${this.best.bestTime.toFixed(1)}s`;
    document.getElementById('best-score-label').textContent = String(Math.round(this.best.bestScore));

    document.getElementById('inp-primary-color').value = s.primaryColor;
    document.getElementById('inp-accent-color').value = s.accentColor;

    const guestStatsLocked = Boolean(this.net.roomCode && !this.net.isHost && s.lobbyRules?.lockStats !== false);
    const dispSpeed = guestStatsLocked ? s.lobbyRules?.universalSpeedMult ?? 1.0 : s.speedMult;
    const dispDrift = guestStatsLocked ? s.lobbyRules?.universalDriftMult ?? 1.0 : s.driftMult;
    const dispMass = guestStatsLocked ? s.lobbyRules?.universalMassMult ?? 1.0 : s.massMult;
    const dispScale = guestStatsLocked ? s.lobbyRules?.universalScaleMult ?? 1.0 : s.scaleMult;
    const lockSuffix = guestStatsLocked ? ' 🔒' : '';

    document.getElementById('rng-speed-mult').value = String(dispSpeed);
    document.getElementById('rng-speed-mult').disabled = guestStatsLocked;
    document.getElementById('val-speed-mult').textContent = `${Math.round(dispSpeed * 100)}%${lockSuffix}`;
    document.getElementById('rng-drift-mult').value = String(dispDrift);
    document.getElementById('rng-drift-mult').disabled = guestStatsLocked;
    document.getElementById('val-drift-mult').textContent = `${Math.round(dispDrift * 100)}%${lockSuffix}`;
    document.getElementById('rng-mass-mult').value = String(dispMass);
    document.getElementById('rng-mass-mult').disabled = guestStatsLocked;
    document.getElementById('val-mass-mult').textContent = `${Math.round(dispMass * 100)}%${lockSuffix}`;
    document.getElementById('rng-scale-mult').value = String(dispScale);
    document.getElementById('rng-scale-mult').disabled = guestStatsLocked;
    document.getElementById('val-scale-mult').textContent = `${Math.round(dispScale * 100)}%${lockSuffix}`;

    document.querySelectorAll('#biome-btns .seg-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.biome === s.biome)
    );
    document.getElementById('rng-cop-intensity').value = String(s.copIntensity);
    document.getElementById('val-cop-intensity').textContent = `${Math.round(s.copIntensity * 100)}%`;
    document.getElementById('rng-start-stars').value = String(s.startStars);
    document.getElementById('val-start-stars').textContent = `${s.startStars} ★`;
    document.getElementById('rng-box-density').value = String(s.itemBoxDensity);
    document.getElementById('val-box-density').textContent = `${Math.round(s.itemBoxDensity * 100)}%`;
    document.getElementById('rng-gravity').value = String(s.gravityMult);
    document.getElementById('val-gravity').textContent =
      s.gravityMult < 0.85 ? 'Moon Jumps' : s.gravityMult > 1.1 ? 'Heavy' : 'Normal';

    document.querySelectorAll('#camera-mode-btns .seg-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.cam === s.cameraMode)
    );
    document.querySelectorAll('#touch-style-btns .seg-btn').forEach((b) =>
      b.classList.toggle('active', b.dataset.touch === s.touchStyle)
    );

    // Toggle mobile touch steering layout
    document.getElementById('split-steer').classList.toggle('hidden', s.touchStyle === 'joystick');
    document.getElementById('joystick-zone').classList.toggle('hidden', s.touchStyle !== 'joystick');

    this._renderPeopleGrid();
    this._renderVehicleGrid();
    this._renderAbilityMixer();
    this.sim.updateSettings(s);
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
          universalSpeedMult: this.settings.speedMult || 1.0,
          universalDriftMult: this.settings.driftMult || 1.0,
          universalMassMult: this.settings.massMult || 1.0,
          universalScaleMult: this.settings.scaleMult || 1.0,
          universalVehicleId: this.settings.vehicleId || 'sedan',
          universalCharacterMode: this.settings.characterMode || 'car_driver',
        };
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
      window.history.replaceState({}, '', window.location.pathname);
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
      window.history.replaceState({}, '', window.location.pathname);
      this._openLobbyModal();
      this._showLobbyError(msg?.message || 'Removed from lobby by Lobby Manager.');
    });

    this.net.on('room_joined', (msg) => {
      // Ensure our avatar ID uses our network player ID so everyone maps our custom cutout cleanly
      this.net.updateProfile(this._buildLocalNetProfile());
      if (!this.net.isHost && msg.room?.settings) {
        this._applyHostSettings(msg.room.settings);
      }
      const basePath = window.location.pathname || '/';
      window.history.replaceState({}, '', `${basePath}?room=${encodeURIComponent(msg.code)}`);
      document.getElementById('lobby-entry').classList.add('hidden');
      document.getElementById('lobby-room').classList.remove('hidden');
      if (msg.room) this._renderLobbyRoom(msg.room);
    });

    this.net.on('room_state', (room) => {
      this._ingestRoomAvatars(room.players || []);
      if (!this.net.isHost && room.settings) {
        this._applyHostSettings(room.settings);
      }
      if (!document.getElementById('lobby-modal').classList.contains('hidden')) {
        this._renderLobbyRoom(room);
      }
    });

    this.net.on('room_settings_updated', (msg) => {
      if (!this.net.isHost && msg.settings) {
        this._applyHostSettings(msg.settings);
      }
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
        rules.universalSpeedMult = 1.0;
        rules.universalDriftMult = 1.0;
        rules.universalMassMult = 1.0;
        rules.universalScaleMult = 1.0;
        this.settings.speedMult = 1.0;
        this.settings.copIntensity = 1.0;
        this.settings.startStars = 1;
        this.settings.itemBoxDensity = 1.2;
        for (const ab of ABILITIES) this.settings.enabledItems[ab.id] = true;
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
        this.settings.itemBoxDensity = 2.0;
        this.settings.copIntensity = 1.4;
        this.settings.startStars = 3;
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

    bindPerm('perm-lock-stats', 'lockStats');
    bindPerm('perm-allow-car', 'allowCarChoice');
    bindPerm('perm-allow-mode', 'allowModeChoice');
    bindPerm('perm-allow-photos', 'allowCustomPhotos');
  }

  _applyHostSettings(rs) {
    if (!rs) return;
    if (rs.biome) this.settings.biome = rs.biome;
    if (rs.copIntensity !== undefined) this.settings.copIntensity = rs.copIntensity;
    if (rs.startStars !== undefined) this.settings.startStars = rs.startStars;
    if (rs.trafficDensity !== undefined) this.settings.trafficDensity = rs.trafficDensity;
    if (rs.itemBoxDensity !== undefined) this.settings.itemBoxDensity = rs.itemBoxDensity;
    if (rs.gravityMult !== undefined) this.settings.gravityMult = rs.gravityMult;
    if (rs.enabledItems) this.settings.enabledItems = { ...this.settings.enabledItems, ...rs.enabledItems };
    if (rs.lobbyRules) {
      this.settings.lobbyRules = { ...this.settings.lobbyRules, ...rs.lobbyRules };
      if (this.settings.lobbyRules.allowModeChoice === false && this.settings.lobbyRules.universalCharacterMode) {
        this.settings.characterMode = this.settings.lobbyRules.universalCharacterMode;
      }
      if (this.settings.lobbyRules.allowCarChoice === false && this.settings.lobbyRules.universalVehicleId) {
        this.settings.vehicleId = this.settings.lobbyRules.universalVehicleId;
      }
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
      const spdPct = Math.round((rules.universalSpeedMult || 1.0) * 100);
      const biomeObj = BIOMES[room.settings?.biome || 'city'] || BIOMES.city;
      const parts = [
        rules.lockStats !== false ? `🔒 Equal ${spdPct}% Speed & Stats` : '🔓 Custom Car Tuning Allowed',
        biomeObj.name,
        rules.allowCarChoice === false ? '🔒 Same Car Forced' : 'Any Car',
        rules.allowModeChoice === false ? '🔒 Mode Locked' : 'Any Mode',
      ];
      guestBanner.textContent = `👑 Lobby Manager Rules: ${parts.join(' · ')}`;
    }

    // Lock/unlock Guest buttons right inside Lobby & Garage
    document.getElementById('lobby-mode-pills')?.classList.toggle(
      'locked-ctrl',
      !isHost && rules.allowModeChoice === false
    );
    document.getElementById('btn-lobby-car')?.classList.toggle(
      'locked-ctrl',
      !isHost && rules.allowCarChoice === false && rules.lockStats !== false
    );
    document.getElementById('btn-lobby-photo')?.classList.toggle(
      'locked-ctrl',
      !isHost && rules.allowCustomPhotos === false
    );

    const players = room.players || [];
    document.getElementById('lobby-player-count').textContent = String(players.length);

    const rosterEl = document.getElementById('lobby-roster');
    rosterEl.innerHTML = '';
    for (const p of players) {
      const card = document.createElement('div');
      card.className = `roster-card${p.ready ? ' ready' : ''}`;
      const veh = VEHICLES.find((v) => v.id === p.vehicleId) || VEHICLES[0];
      const modeLabel =
        p.characterMode === 'runner'
          ? 'On Foot'
          : p.characterMode === 'photo_car'
          ? 'Photo-Car'
          : veh.name;
      const fallbackImg = this._safeImgSrc(this._getSelectedPerson()?.dataUrl);
      const safeAvatar = this._safeImgSrc(p.avatarDataUrl) || fallbackImg;
      const canKick = isHost && p.id !== room.hostId;
      card.innerHTML = `
        <img src="${safeAvatar}" alt="${this._escapeHtml(p.name)}" />
        <div class="roster-meta">
          <div class="roster-name">${this._escapeHtml(p.name)} ${p.id === room.hostId ? '👑' : ''}</div>
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

  // ======================== MATCH START / GAME LOOP ========================

  _startAttractDemo() {
    this.mode = 'attract';
    this._clearTouchState();
    document.getElementById('hud').classList.add('hidden');
    document.getElementById('gameover-modal').classList.add('hidden');
    document.getElementById('danger-vignette').classList.add('hidden');
    document.getElementById('world-labels').innerHTML = '';
    this.sound.updateLoopSounds(0, false, 1, false, true);
    this._respawnAttractHero();
  }

  _respawnAttractHero() {
    this.world.reset(this.settings.worldSeed, this.settings.biome, {
      itemBoxDensity: this.settings.itemBoxDensity,
    });
    this.sim.resetRun(this.settings.worldSeed, {
      ...this.settings,
      playerId: 'local',
      spawnIndex: 0,
    });
  }

  _startSoloMatch() {
    if (this.net.roomCode) {
      this.net.leaveRoom();
      window.history.replaceState({}, '', window.location.pathname);
    }
    const freshSeed = Math.floor(100000 + Math.random() * 899999);
    this.settings.worldSeed = freshSeed;
    this.eliminatedSent = false;
    this.partyStandings = [];
    this._clearTouchState();

    this.world.reset(freshSeed, this.settings.biome, {
      itemBoxDensity: this.settings.itemBoxDensity,
    });
    this._syncAllPhotoTextures();
    this.sim.resetRun(freshSeed, {
      ...this.settings,
      playerId: 'local',
      spawnIndex: 0,
    });

    document.getElementById('home-screen').classList.add('hidden');
    document.getElementById('lobby-modal').classList.add('hidden');
    document.getElementById('gameover-modal').classList.add('hidden');
    document.getElementById('spectator-bar').classList.add('hidden');
    document.getElementById('survivor-strip').classList.add('hidden');
    document.getElementById('touch-controls').classList.remove('hidden');
    document.getElementById('hud').classList.remove('hidden');

    this.mode = 'playing_solo';
    this._showChaosToast('🚓 OUTRUN THE COPS & GRAB ? BOXES!');
  }

  _beginPartyCountdown(msg) {
    const roomSettings = msg.settings || {};
    const rules = roomSettings.lobbyRules || this.settings.lobbyRules || {};
    const lockStats = rules.lockStats !== false;
    const allowCar = rules.allowCarChoice !== false;
    const allowMode = rules.allowModeChoice !== false;
    const allowPhotos = rules.allowCustomPhotos !== false;

    const mergedSettings = {
      ...this.settings,
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
      itemBoxDensity: roomSettings.itemBoxDensity ?? this.settings.itemBoxDensity,
      gravityMult: roomSettings.gravityMult ?? this.settings.gravityMult,
      enabledItems: roomSettings.enabledItems || this.settings.enabledItems,
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

    const players = (msg.players || []).map((p, idx) => ({
      ...p,
      avatarId: p.avatarId || `net_${p.id}`,
      spawnIndex: Number.isFinite(p.spawnIndex) ? p.spawnIndex : idx,
    }));
    const meInRoster = players.find((p) => p.id === this.net.playerId);
    if (meInRoster) mergedSettings.spawnIndex = meInRoster.spawnIndex;

    this.world.reset(msg.seed, mergedSettings.biome, {
      itemBoxDensity: mergedSettings.itemBoxDensity,
    });
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

    document.getElementById('home-screen').classList.add('hidden');
    document.getElementById('lobby-modal').classList.add('hidden');
    document.getElementById('gameover-modal').classList.add('hidden');
    document.getElementById('spectator-bar').classList.add('hidden');
    document.getElementById('touch-controls').classList.remove('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('survivor-strip').classList.remove('hidden');

    this.countdownLeft = msg.countdownSec || 3.0;
    this.mode = 'countdown';
    this._updateSurvivorStrip();
  }

  _exitToMainMenu() {
    if (this.net.roomCode) {
      this.net.leaveRoom();
      window.history.replaceState({}, '', window.location.pathname);
    }
    this._startAttractDemo();
    document.getElementById('home-screen').classList.remove('hidden');
    document.getElementById('lobby-modal').classList.add('hidden');
    document.getElementById('gameover-modal').classList.add('hidden');
    this._refreshAllUiFromSettings();
  }

  _frame(nowMs) {
    const rawDt = (nowMs - this._lastFrameMs) / 1000;
    this._lastFrameMs = nowMs;
    const dt = Math.min(0.05, Math.max(0.001, rawDt));
    this._elapsedTime += dt;

    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) {
        document.getElementById('chaos-toast').classList.add('hidden');
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
      // Autonomous AI driver weaving through downtown behind menus!
      this._attractSteerPhase += dt;
      const lp = this.sim.localPlayer;
      if (!lp || !lp.alive) {
        this._respawnAttractHero();
      } else {
        const wave = Math.sin(this._attractSteerPhase * 0.9) + Math.cos(this._attractSteerPhase * 2.1) * 0.5;
        const autoUse = Boolean(lp.items?.heldItem && Math.random() < dt * 0.8);
        const events = this.sim.update(
          dt,
          {
            left: wave > 0.45,
            right: wave < -0.45,
            brake: false,
            useItem: autoUse,
            horn: false,
            steerAxis: null,
          },
          this._elapsedTime
        );
        this._processVisualEventsOnly(events);
      }
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
        this.sim.syncRemotePlayers(snaps, this.net.playerId);
      }

      const input =
        this.mode === 'spectating'
          ? { left: false, right: false, brake: false, useItem: false, horn: false, steerAxis: null }
          : this._gatherGameplayInput();

      const events = this.sim.update(dt, input, this._elapsedTime);
      for (const ev of events) {
        this._handleSimEvent(ev);
      }

      const lp = this.sim.localPlayer;
      if (lp) {
        // Tire skid ribbons & damage smoke
        if (lp.alive && lp.drifting && lp.grounded && lp.characterMode !== 'runner') {
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
        this.sound.updateLoopSounds(
          lp.alive ? speedRatio : 0,
          Boolean(lp.alive && lp.drifting),
          this.sim.wantedStars,
          Boolean(lp.alive && lp.starActive),
          false
        );

        if (this.net.roomCode && this.mode === 'playing_party') {
          this.net.sendPlayerState(lp);
        }
      }

      this._updateHud();
      if (this.net.roomCode) this._updateSurvivorStrip();
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
        this.sound.playEvent((ev.intensity || 0.5) > 0.9 ? 'crash' : 'smash', ev.intensity || 0.7);
        break;
      }
      case 'explosion': {
        this.renderer.spawnExplosionVisual(ev.x, ev.y || 0.8, ev.z, ev.radius || 9);
        this.cameraShake = Math.max(this.cameraShake, 1.0);
        this.sound.playEvent('explosion', ev.intensity || 1.1);
        break;
      }
      case 'pickup_box': {
        this.renderer.spawnDebris(ev.x, (ev.y || 1) + 0.8, ev.z, '#38bdf8', 10, 12, 0.34);
        this.sound.playEvent('pickup_box', 1.0);
        break;
      }
      case 'roulette_tick': {
        this.sound.playEvent('roulette_tick', 0.6);
        break;
      }
      case 'roulette_lock': {
        this.sound.playEvent('roulette_lock', 1.0);
        const ab = ABILITIES.find((a) => a.id === ev.abilityId);
        if (ab) this._showChaosToast(`${ab.icon} GOT ${ab.name.toUpperCase()}!`);
        break;
      }
      case 'item_used': {
        const id = ev.abilityId;
        if (id === 'triple_boost' || id === 'star_power' || id === 'mega_giant') {
          this.sound.playEvent('boost', 1.0);
        } else {
          this.sound.playEvent('item', 1.0);
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
        break;
      }
      case 'pvp_slam': {
        this.renderer.spawnDebris(ev.x, ev.y || 0.8, ev.z, '#facc15', 10, 16, 0.42);
        this.cameraShake = Math.max(this.cameraShake, 0.65);
        this.sound.playEvent('crash', 0.85);
        if (this.net.roomCode && Array.isArray(ev.impulses)) {
          for (const imp of ev.impulses) {
            this.net.sendPvpBump(imp);
          }
        }
        break;
      }
      case 'star_up': {
        this._showChaosToast(`⭐ ${ev.stars}-STAR WANTED: ${(ev.label || 'BACKUP INBOUND').toUpperCase()}!`);
        break;
      }
      case 'horn': {
        this.sound.playEvent(ev.superHorn ? 'super_horn' : 'horn', ev.intensity || 1.0);
        break;
      }
      case 'water_splash': {
        this.renderer.spawnDebris(ev.x, 0.2, ev.z, '#38bdf8', 18, 16, 0.48);
        this.sound.playEvent('water_splash', 1.0);
        if (ev.eliminated) this._onLocalPlayerEliminated('drowned', ev.killerName);
        break;
      }
      case 'busted': {
        this.sound.playEvent('busted', 1.0);
        this._onLocalPlayerEliminated('busted', ev.killerName);
        break;
      }
      case 'wrecked': {
        this.sound.playEvent('busted', 1.0);
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
      if (aliveRemotes.length >= 2) {
        // Enter live Spectator Cam while remaining friends battle to see who lasts longest!
        this.mode = 'spectating';
        document.getElementById('spectator-bar').classList.remove('hidden');
        document.getElementById('spectator-status').textContent = lp?.eliminatedText || 'YOU ARE OUT!';
      } else {
        this.mode = 'spectating';
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

  _showGameOverModal({ isParty, winnerId, winnerName, standings, reason }) {
    this.mode = 'gameover';
    this.sound.updateLoopSounds(0, false, 1, false, true);
    document.getElementById('spectator-bar').classList.add('hidden');
    document.getElementById('danger-vignette').classList.add('hidden');

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
      badge.textContent = iWon ? '👑 CHAMPION!' : 'PARTY MATCH OVER';
      title.textContent = winnerName ? `${winnerName} WINS!` : 'FINISH!';
      reasonEl.textContent = iWon
        ? 'You outlasted everyone in the lobby!'
        : `${winnerName || 'Winner'} lasted the longest!`;

      standingsWrap.classList.remove('hidden');
      standingsList.innerHTML = '';
      for (const row of standings) {
        const div = document.createElement('div');
        div.className = 'standing-row';
        div.innerHTML = `
          <span>${row.rank === 1 ? '👑' : `#${row.rank}`} ${this._escapeHtml(row.name)}</span>
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

    // Wanted stars
    const stars = document.querySelectorAll('#wanted-stars .star');
    stars.forEach((el, idx) => el.classList.toggle('active', idx < this.sim.wantedStars));

    // Health bar
    const hpPct = Math.max(0, Math.min(100, (lp.hp / Math.max(1, lp.maxHp)) * 100));
    const hpFill = document.getElementById('hp-fill');
    hpFill.style.width = `${hpPct}%`;
    hpFill.style.backgroundColor = hpPct > 50 ? '#22c55e' : hpPct > 25 ? '#f59e0b' : '#ef4444';

    // Busted arrest progress alert
    const bustedProg = lp.bustedProgress || 0;
    const bustedAlert = document.getElementById('busted-alert');
    const vignette = document.getElementById('danger-vignette');
    if (lp.alive && bustedProg > 0.08) {
      bustedAlert.classList.remove('hidden');
      vignette.classList.remove('hidden');
      document.getElementById('busted-fill').style.width = `${Math.round(bustedProg * 100)}%`;
    } else {
      bustedAlert.classList.add('hidden');
      vignette.classList.add('hidden');
    }

    // Mario Kart Roulette & Held Ability UI
    const items = lp.items || {};
    const slotBtn = document.getElementById('hud-item-slot');
    const slotIcon = document.getElementById('item-slot-icon');
    const slotName = document.getElementById('item-slot-name');
    const slotCharges = document.getElementById('item-slot-charges');
    const useBtn = document.getElementById('btn-use-item');
    const useIcon = document.getElementById('btn-use-item-icon');

    if (items.rouletteTimer > 0) {
      const disp = ABILITIES.find((a) => a.id === items.rouletteDisplayId) || ABILITIES[0];
      slotBtn.className = 'item-slot spinning';
      slotIcon.textContent = disp.icon;
      slotName.textContent = 'SPINNING...';
      slotCharges.classList.add('hidden');
      useBtn.classList.add('disabled');
      useIcon.textContent = disp.icon;
    } else if (items.heldItem) {
      const held = ABILITIES.find((a) => a.id === items.heldItem) || ABILITIES[0];
      slotBtn.className = 'item-slot';
      slotIcon.textContent = held.icon;
      slotName.textContent = held.shortName;
      if (items.charges > 1) {
        slotCharges.textContent = `x${items.charges}`;
        slotCharges.classList.remove('hidden');
      } else {
        slotCharges.classList.add('hidden');
      }
      useBtn.classList.remove('disabled');
      useIcon.textContent = held.icon;
    } else {
      slotBtn.className = 'item-slot empty';
      slotIcon.textContent = '?';
      slotName.textContent = 'GET A ? BOX';
      slotCharges.classList.add('hidden');
      useBtn.classList.add('disabled');
      useIcon.textContent = '?';
    }

    // Active buffs chips
    const buffsEl = document.getElementById('active-buffs');
    const chips = [];
    if (items.starTimer > 0) chips.push(`⭐ ${items.starTimer.toFixed(1)}s`);
    if (items.megaTimer > 0) chips.push(`🦖 ${items.megaTimer.toFixed(1)}s`);
    if (items.boostTimer > 0) chips.push(`🍄 BOOST`);
    if (items.shrunkTimer > 0) chips.push(`⚡ TINY`);
    buffsEl.innerHTML = chips.map((c) => `<span class="buff-chip">${c}</span>`).join('');

    // Clock & Score
    document.getElementById('hud-timer').textContent = formatClock(lp.survivalTime || 0);
    document.getElementById('hud-score').textContent = String(Math.round(lp.score || 0));
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
        alive: lp.alive !== false,
        survivalTime: lp.survivalTime || 0,
        avatarDataUrl: this._getSelectedPerson()?.dataUrl || '',
      });
    }
    for (const rp of this.sim.remotePlayers) {
      combined.push({
        id: rp.id,
        name: rp.name || 'Friend',
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
          return `
      <div class="survivor-pill ${p.alive ? '' : 'out'}">
        ${safeUrl ? `<img src="${safeUrl}" alt="" />` : ''}
        <span>${this._escapeHtml(p.name)} · ${p.survivalTime.toFixed(0)}s</span>
      </div>`;
        })
        .join('');
  }

  _showChaosToast(text) {
    const el = document.getElementById('chaos-toast');
    el.textContent = text;
    el.classList.remove('hidden');
    this.toastTimer = 2.6;
  }

  _renderFrame(dt) {
    let focusEntity = this.sim.localPlayer;
    if (this.mode === 'spectating') {
      const aliveRemotes = this.sim.remotePlayers.filter((rp) => rp.alive !== false);
      if (aliveRemotes.length > 0) {
        const target = aliveRemotes[this.spectateIndex % aliveRemotes.length];
        focusEntity = target;
        document.getElementById('spectator-watching').textContent = `Watching ${target.name || 'Survivor'}`;
      }
    }

    this.renderer.setCamera(
      focusEntity,
      this.mode === 'attract' ? 'smashy' : this.settings.cameraMode,
      this.cameraShake,
      dt
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

    this._renderFloatingNametags();
  }

  _renderFloatingNametags() {
    const container = document.getElementById('world-labels');
    if (this.mode === 'attract' || this.sim.remotePlayers.length === 0) {
      if (container.innerHTML !== '') container.innerHTML = '';
      return;
    }

    const vw = window.innerWidth || 390;
    const vh = window.innerHeight || 844;
    const pad = {
      left: 62,
      right: 68,
      top: 108,
      bottom: 106,
    };

    const refX = this.sim.localPlayer?.x ?? 0;
    const refZ = this.sim.localPlayer?.z ?? 0;
    const placedOffscreen = [];
    let html = '';

    for (const rp of this.sim.remotePlayers) {
      if (rp.alive === false) continue;
      const wp = this.renderer.projectWaypoint(
        rp.x,
        (rp.y || 0) + 4.1 * (rp.scale || 1),
        rp.z,
        pad
      );
      const imgUrl = this._safeImgSrc(this.remoteAvatarCache.get(rp.avatarId || `net_${rp.id}`));
      const borderCol = /^#[0-9a-fA-F]{3,8}$/.test(rp.primaryColor || '')
        ? rp.primaryColor
        : '#facc15';
      const distMeters = Math.round(Math.hypot(rp.x - refX, rp.z - refZ));

      if (wp.onScreen) {
        html += `
          <div class="player-tag" style="left:${wp.x.toFixed(1)}px;top:${wp.y.toFixed(1)}px;border-color:${borderCol}">
            ${imgUrl ? `<img src="${imgUrl}" alt="" />` : ''}
            <span>${this._escapeHtml(rp.name || 'Friend')}</span>
          </div>
        `;
      } else {
        // Off-screen directional corner/edge tracker — nudge gently if multiple friends share the same corner!
        let tx = wp.x;
        let ty = wp.y;
        for (let pass = 0; pass < placedOffscreen.length; pass++) {
          const prev = placedOffscreen[pass];
          if (Math.abs(tx - prev.x) < 78 && Math.abs(ty - prev.y) < 32) {
            if (ty + 34 <= vh - pad.bottom) {
              ty += 34;
            } else if (ty - 34 >= pad.top) {
              ty -= 34;
            } else {
              tx = Math.max(pad.left, Math.min(vw - pad.right, tx + (tx < vw * 0.5 ? 82 : -82)));
            }
          }
        }
        placedOffscreen.push({ x: tx, y: ty });
        const deg = Math.round((wp.angleRad * 180) / Math.PI);
        html += `
          <div class="player-tag offscreen" style="left:${tx.toFixed(1)}px;top:${ty.toFixed(1)}px;border-color:${borderCol}">
            <span class="tag-arrow" style="transform:rotate(${deg}deg)">➤</span>
            ${imgUrl ? `<img src="${imgUrl}" alt="" />` : ''}
            <span>${this._escapeHtml(rp.name || 'Friend')}</span>
            <span class="tag-dist">${distMeters}m</span>
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
