// Shared game configuration, vehicles, Mario Kart abilities, biomes, and tuning defaults

export const WORLD_CONFIG = {
  WORLD_SIZE: 4800,
  HALF_WORLD: 2400,
  CHUNK_SIZE: 60,        // 80 x 80 chunks = 6,400 city/biome blocks (2x width & length!)
  ROAD_WIDTH: 14,
  HIGHWAY_WIDTH: 22,
  VIEW_CHUNK_RADIUS: 5,  // 11x11 chunks active around camera (~660x660 visible area + deep POV horizon)
  WATER_Y: -1.6,
  BRIDGE_Y: 1.8,
};

export const BIOMES = {
  city: {
    id: 'city',
    name: 'Sunny Metro City',
    skyTop: [0.34, 0.68, 0.98],
    skyBottom: [0.76, 0.91, 1.0],
    fogColor: [0.72, 0.88, 0.99],
    grassA: '#58c948',
    grassB: '#4db83d',
    road: '#3b4049',
    sidewalk: '#cfd5dd',
    water: '#28b6ea',
    sunColor: [1.0, 0.97, 0.88],
    ambientColor: [0.46, 0.54, 0.68],
  },
  desert: {
    id: 'desert',
    name: 'Canyon Desert Highway',
    skyTop: [0.96, 0.56, 0.26],
    skyBottom: [1.0, 0.86, 0.62],
    fogColor: [0.98, 0.82, 0.60],
    grassA: '#e7b46a',
    grassB: '#dba357',
    road: '#4a413b',
    sidewalk: '#d8c3a5',
    water: '#2dc4d6',
    sunColor: [1.0, 0.90, 0.74],
    ambientColor: [0.58, 0.48, 0.42],
  },
  snow: {
    id: 'snow',
    name: 'Alpine Snow Town',
    skyTop: [0.46, 0.70, 0.94],
    skyBottom: [0.88, 0.95, 1.0],
    fogColor: [0.86, 0.93, 0.99],
    grassA: '#eef5fb',
    grassB: '#ddeaf6',
    road: '#46505e',
    sidewalk: '#bcc9d8',
    water: '#4ec9f5',
    sunColor: [0.98, 0.99, 1.0],
    ambientColor: [0.56, 0.64, 0.78],
  },
};

export const CHARACTER_MODES = [
  {
    id: 'car_driver',
    name: 'People on Car',
    tagline: 'Your custom photo pops out of the roof while you drift',
  },
  {
    id: 'photo_car',
    name: 'Look Like a Car',
    tagline: 'You ARE the car — your photo becomes a rolling 3D car on wheels',
  },
  {
    id: 'runner',
    name: 'Just Myself (On Foot)',
    tagline: 'Sprint away from the cops on your own two feet at turbo speed',
  },
];

export const VEHICLES = [
  {
    id: 'sedan',
    name: 'Getaway Coupe',
    color: '#ef4444',
    accent: '#fef08a',
    speed: 44,
    accel: 34,
    handling: 3.3,
    drift: 0.88,
    mass: 1.0,
    maxHp: 100,
    radius: 2.1,
  },
  {
    id: 'muscle',
    name: 'V8 Muscle Beast',
    color: '#f97316',
    accent: '#1e293b',
    speed: 50,
    accel: 38,
    handling: 2.95,
    drift: 0.92,
    mass: 1.25,
    maxHp: 115,
    radius: 2.25,
  },
  {
    id: 'kart',
    name: 'Pipe Frame Kart',
    color: '#22c55e',
    accent: '#ffffff',
    speed: 47,
    accel: 44,
    handling: 4.1,
    drift: 0.85,
    mass: 0.82,
    maxHp: 85,
    radius: 1.85,
  },
  {
    id: 'supercar',
    name: 'Apex Hypercar',
    color: '#eab308',
    accent: '#111827',
    speed: 56,
    accel: 42,
    handling: 3.55,
    drift: 0.89,
    mass: 1.05,
    maxHp: 95,
    radius: 2.15,
  },
  {
    id: 'monster',
    name: 'Crusher 4x4',
    color: '#3b82f6',
    accent: '#fde047',
    speed: 43,
    accel: 31,
    handling: 2.8,
    drift: 0.86,
    mass: 1.85,
    maxHp: 155,
    radius: 2.65,
  },
  {
    id: 'convertible',
    name: 'Miami Drop-Top',
    color: '#ec4899',
    accent: '#ffffff',
    speed: 49,
    accel: 36,
    handling: 3.5,
    drift: 0.90,
    mass: 1.0,
    maxHp: 95,
    radius: 2.1,
  },
  {
    id: 'van',
    name: 'Party Ice-Cream Van',
    color: '#a855f7',
    accent: '#fbcfe8',
    speed: 40,
    accel: 28,
    handling: 2.7,
    drift: 0.87,
    mass: 1.65,
    maxHp: 145,
    radius: 2.45,
  },
  {
    id: 'pickup',
    name: 'Baja Trophy Truck',
    color: '#14b8a6',
    accent: '#fef9c3',
    speed: 48,
    accel: 35,
    handling: 3.15,
    drift: 0.90,
    mass: 1.45,
    maxHp: 130,
    radius: 2.35,
  },
  {
    id: 'f1',
    name: 'Turbo Open-Wheel',
    color: '#dc2626',
    accent: '#f8fafc',
    speed: 58,
    accel: 47,
    handling: 4.25,
    drift: 0.84,
    mass: 0.88,
    maxHp: 82,
    radius: 2.05,
  },
  {
    id: 'mini',
    name: 'Pocket Buggy',
    color: '#06b6d4',
    accent: '#fde047',
    speed: 45,
    accel: 43,
    handling: 4.4,
    drift: 0.86,
    mass: 0.76,
    maxHp: 80,
    radius: 1.7,
  },
  {
    id: 'dozer',
    name: 'Wrecking Rig',
    color: '#f59e0b',
    accent: '#1f2937',
    speed: 39,
    accel: 29,
    handling: 2.55,
    drift: 0.83,
    mass: 2.3,
    maxHp: 185,
    radius: 2.8,
  },
  {
    id: 'gold',
    name: '24K Legend Cruiser',
    color: '#fbbf24',
    accent: '#fef3c7',
    speed: 54,
    accel: 43,
    handling: 3.8,
    drift: 0.90,
    mass: 1.35,
    maxHp: 135,
    radius: 2.2,
  },
];

export const COP_VEHICLES = [
  {
    id: 'cop_cruiser',
    copType: 'cruiser',
    name: 'Police Interceptor',
    icon: '🚔',
    color: '#1e293b',
    accent: '#f8fafc',
    speed: 51,
    accel: 41,
    handling: 3.6,
    drift: 0.89,
    mass: 1.35,
    maxHp: 125,
    radius: 2.15,
    flying: false,
    hasMissile: false,
    missileCooldown: 2.0,
    desc: 'Fast V8 pursuit cruiser with siren surge & PIT slam',
  },
  {
    id: 'cop_swat',
    copType: 'swat',
    name: 'Armored SWAT Truck',
    icon: '🛡️',
    color: '#1e3a8a',
    accent: '#93c5fd',
    speed: 45,
    accel: 34,
    handling: 2.95,
    drift: 0.86,
    mass: 2.0,
    maxHp: 175,
    radius: 2.5,
    flying: false,
    hasMissile: false,
    missileCooldown: 2.0,
    desc: 'Heavy battering-ram truck that boxes in & wrecks runners',
  },
  {
    id: 'cop_heli',
    copType: 'heli',
    name: 'Police Attack Heli',
    icon: '🚁',
    color: '#0f172a',
    accent: '#38bdf8',
    speed: 55,
    accel: 46,
    handling: 3.9,
    drift: 0.92,
    mass: 1.4,
    maxHp: 135,
    radius: 2.2,
    flying: true,
    hoverY: 11.5,
    hasMissile: true,
    missileCooldown: 2.0,
    desc: 'Flies over buildings & rivers! Fires air-to-ground missiles (2s cooldown)',
  },
  {
    id: 'cop_tank',
    copType: 'tank',
    name: 'Heavy Police Tank',
    icon: '🪖',
    color: '#365314',
    accent: '#a3e635',
    speed: 40,
    accel: 31,
    handling: 2.85,
    drift: 0.82,
    mass: 2.6,
    maxHp: 220,
    radius: 2.75,
    flying: false,
    hasMissile: true,
    missileCooldown: 2.0,
    desc: 'Unstoppable armored tank! Fires cannon missiles (2s cooldown)',
  },
];

export const ABILITIES = [
  {
    id: 'homing_rocket',
    name: 'Twin-Rocket RPG',
    shortName: 'TWIN RPG',
    icon: '🚀',
    color: '#ef4444',
    desc: 'Fires TWO homing RPG warheads side-by-side that lock onto cops and rivals',
    weight: 1.35,
  },
  {
    id: 'sugar_rush',
    name: '3x Sugar Rush',
    shortName: 'SUGAR 3X',
    icon: '🍭',
    color: '#f472b6',
    desc: 'Insane 3x mushroom hyper-speed burst with candy wall-ricochet and cop bowling',
    weight: 1.15,
  },
  {
    id: 'triple_boost',
    name: 'Triple Turbo Shrooms',
    shortName: '3X TURBO',
    icon: '🍄',
    color: '#f97316',
    charges: 3,
    desc: 'Three blazing speed bursts that smash straight through fences and traffic',
    weight: 1.35,
  },
  {
    id: 'star_power',
    name: 'Rainbow Star Power',
    shortName: 'STAR POWER',
    icon: '⭐',
    color: '#facc15',
    desc: '8 seconds of rainbow invincibility, super speed, and instant cop knockouts',
    weight: 0.85,
  },
  {
    id: 'mega_giant',
    name: 'Mega Giant Growth',
    shortName: 'MEGA GIANT',
    icon: '🦖',
    color: '#ec4899',
    desc: 'Grow huge for 9 seconds and flatten police cars, SWAT vans, and obstacles',
    weight: 0.9,
  },
  {
    id: 'banana_bunch',
    name: 'Triple Banana Trap',
    shortName: '3X BANANAS',
    icon: '🍌',
    color: '#eab308',
    charges: 3,
    desc: 'Drop three giant bananas behind you that send cops and friends spinning out',
    weight: 1.3,
  },
  {
    id: 'bomb_toss',
    name: 'Bob-omb Lob',
    shortName: 'BOB-OMB',
    icon: '💣',
    color: '#3b82f6',
    desc: 'Lob a bouncing bomb ahead that erupts in a massive shockwave fireball',
    weight: 1.15,
  },
  {
    id: 'lightning_zap',
    name: 'Thunder Shrinking Bolt',
    shortName: 'LIGHTNING',
    icon: '⚡',
    color: '#38bdf8',
    desc: 'Zaps and shrinks all nearby police and rivals, cutting their speed in half',
    weight: 0.75,
  },
  {
    id: 'super_horn',
    name: 'Super Shockwave Horn',
    shortName: 'SHOCKWAVE',
    icon: '📢',
    color: '#a855f7',
    desc: 'Unleashes a huge 360-degree sonic boom that flings away every cop around you',
    weight: 1.1,
  },
];

export const WANTED_LEVELS = [
  { stars: 1, timeSec: 0,   maxCops: 4,  types: ['cruiser'], speedMult: 0.94, label: 'Patrol Chase' },
  { stars: 2, timeSec: 22,  maxCops: 7,  types: ['cruiser', 'suv'], speedMult: 1.0, label: 'County Backup' },
  { stars: 3, timeSec: 50,  maxCops: 10, types: ['cruiser', 'suv', 'swat'], speedMult: 1.06, label: 'SWAT Response' },
  { stars: 4, timeSec: 85,  maxCops: 13, types: ['suv', 'swat', 'heli', 'army'], speedMult: 1.12, label: 'Air & Military' },
  { stars: 5, timeSec: 125, maxCops: 16, types: ['swat', 'heli', 'army', 'tank'], speedMult: 1.18, label: 'Maximum Lockdown' },
];

export const DEFAULT_KEYBINDS = {
  steerLeft: ['KeyA', 'ArrowLeft'],
  steerRight: ['KeyD', 'ArrowRight'],
  brake: ['KeyS', 'ArrowDown', 'ShiftLeft'],
  gas: ['KeyW', 'ArrowUp'],
  useItem: ['Space', 'KeyE'],
  horn: ['KeyH', 'KeyQ'],
  cycleCamera: ['KeyC', 'KeyV'],
  pause: ['Escape'],
};

export function formatKeyCodeLabel(code) {
  if (!code || typeof code !== 'string') return '—';
  if (code.startsWith('Key')) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit')) return code.slice(5);
  const map = {
    Space: 'SPACE',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ShiftLeft: 'SHIFT',
    ShiftRight: 'R-SHIFT',
    ControlLeft: 'CTRL',
    ControlRight: 'R-CTRL',
    AltLeft: 'OPT',
    AltRight: 'R-OPT',
    MetaLeft: 'CMD',
    MetaRight: 'R-CMD',
    Enter: 'ENTER',
    Tab: 'TAB',
    Backspace: 'BACK',
    Escape: 'ESC',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Semicolon: ';',
    Quote: "'",
  };
  return map[code] || code.toUpperCase();
}

export const HUD_LAYOUT_PRESETS = {
  thumbs: {
    steerLeft:  { xPct: 10, yPct: 84, scale: 1.0, opacity: 0.92 },
    steerRight: { xPct: 24, yPct: 84, scale: 1.0, opacity: 0.92 },
    joystick:   { xPct: 15, yPct: 80, scale: 1.0, opacity: 0.92 },
    brake:      { xPct: 74, yPct: 86, scale: 1.05, opacity: 0.96 },
    gas:        { xPct: 89, yPct: 86, scale: 1.0, opacity: 0.95 },
    useItem:    { xPct: 88, yPct: 65, scale: 1.0, opacity: 0.98 },
    horn:       { xPct: 62, yPct: 88, scale: 0.95, opacity: 0.9 },
  },
  claw: {
    // 4-Finger Claw Setup: Brake on top-left index finger, Item on top-right index finger, thumbs steer below!
    steerLeft:  { xPct: 12, yPct: 83, scale: 1.08, opacity: 0.92 },
    steerRight: { xPct: 88, yPct: 83, scale: 1.08, opacity: 0.92 },
    joystick:   { xPct: 16, yPct: 80, scale: 1.05, opacity: 0.92 },
    brake:      { xPct: 14, yPct: 24, scale: 1.15, opacity: 0.96 },
    gas:        { xPct: 74, yPct: 84, scale: 1.0, opacity: 0.95 },
    useItem:    { xPct: 86, yPct: 26, scale: 1.08, opacity: 0.98 },
    horn:       { xPct: 28, yPct: 24, scale: 0.95, opacity: 0.88 },
  },
  lefty: {
    // Left-handed action cluster, right-handed steering!
    steerLeft:  { xPct: 74, yPct: 84, scale: 1.0, opacity: 0.92 },
    steerRight: { xPct: 89, yPct: 84, scale: 1.0, opacity: 0.92 },
    joystick:   { xPct: 84, yPct: 80, scale: 1.0, opacity: 0.92 },
    brake:      { xPct: 26, yPct: 86, scale: 1.05, opacity: 0.96 },
    gas:        { xPct: 11, yPct: 86, scale: 1.0, opacity: 0.95 },
    useItem:    { xPct: 12, yPct: 65, scale: 1.0, opacity: 0.98 },
    horn:       { xPct: 38, yPct: 88, scale: 0.95, opacity: 0.9 },
  },
};

export function cloneHudLayout(presetName = 'thumbs') {
  const src = HUD_LAYOUT_PRESETS[presetName] || HUD_LAYOUT_PRESETS.thumbs;
  const out = {};
  for (const [k, v] of Object.entries(src)) {
    out[k] = { ...v };
  }
  return out;
}

export function cloneKeybinds(src = DEFAULT_KEYBINDS) {
  const out = {};
  for (const [k, v] of Object.entries(DEFAULT_KEYBINDS)) {
    out[k] = Array.isArray(src?.[k]) && src[k].length > 0 ? [...src[k]] : [...v];
  }
  return out;
}

const DROP_SLIDER_ANCHORS = [
  [0, 0.1],
  [20, 5],
  [50, 100],
  [80, 500],
  [100, 1000],
];

export function clampDropRatePct(val) {
  if (val === null || val === undefined || val === '') return 100;
  const num = Number(val);
  if (!Number.isFinite(num)) return 100;
  const clamped = Math.max(0.1, Math.min(1000, num));
  return Math.round(clamped * 10) / 10;
}

export function createDefaultItemWeights() {
  const out = {};
  for (const ab of ABILITIES) {
    out[ab.id] = 100;
  }
  return out;
}

export function cloneItemWeights(src) {
  const out = {};
  for (const ab of ABILITIES) {
    out[ab.id] = clampDropRatePct(src?.[ab.id] ?? 100);
  }
  return out;
}

export function sliderToDropPct(t) {
  const num = Number(t);
  const clampedT = Number.isFinite(num) ? Math.max(0, Math.min(100, num)) : 50;
  for (let i = 0; i < DROP_SLIDER_ANCHORS.length - 1; i++) {
    const [t0, p0] = DROP_SLIDER_ANCHORS[i];
    const [t1, p1] = DROP_SLIDER_ANCHORS[i + 1];
    if (clampedT <= t1 || i === DROP_SLIDER_ANCHORS.length - 2) {
      const u = (clampedT - t0) / (t1 - t0);
      const raw = p0 + u * (p1 - p0);
      const clean = raw < 10 ? Math.round(raw * 10) / 10 : Math.round(raw);
      return clampDropRatePct(clean);
    }
  }
  return 100;
}

export function dropPctToSlider(pct) {
  const p = clampDropRatePct(pct);
  for (let i = 0; i < DROP_SLIDER_ANCHORS.length - 1; i++) {
    const [t0, p0] = DROP_SLIDER_ANCHORS[i];
    const [t1, p1] = DROP_SLIDER_ANCHORS[i + 1];
    if (p <= p1 || i === DROP_SLIDER_ANCHORS.length - 2) {
      const u = (p - p0) / (p1 - p0);
      const rawT = t0 + u * (t1 - t0);
      return Math.round(Math.max(0, Math.min(100, rawT)) * 100) / 100;
    }
  }
  return 50;
}

export function computeAbilityDropOdds(enabledItems = {}, itemWeights = {}) {
  const en = enabledItems || {};
  const iw = itemWeights || {};
  const rawWeights = {};
  let total = 0;
  for (const ab of ABILITIES) {
    if (en[ab.id] !== false) {
      const w = (ab.weight || 1) * (clampDropRatePct(iw[ab.id] ?? 100) / 100);
      rawWeights[ab.id] = w;
      total += w;
    } else {
      rawWeights[ab.id] = 0;
    }
  }
  const odds = {};
  for (const ab of ABILITIES) {
    odds[ab.id] = total > 0 && rawWeights[ab.id] > 0 ? (rawWeights[ab.id] / total) * 100 : 0;
  }
  return odds;
}

export function createDefaultSettings() {
  const enabledItems = {};
  for (const ab of ABILITIES) enabledItems[ab.id] = true;
  return {
    playerName: 'Tanner',
    playerRole: 'runner',        // 'runner' (Getaway) | 'cop' (Playable Police Officer)
    copVehicleId: 'cop_heli',    // 'cop_cruiser' | 'cop_swat' | 'cop_heli' | 'cop_tank'
    characterMode: 'car_driver', // 'car_driver' | 'photo_car' | 'runner'
    vehicleId: 'sedan',
    primaryColor: '#ef4444',
    accentColor: '#fef08a',
    avatarId: 'default_hero',
    customCopsEnabled: true,
    aiCopsEnabled: true,         // true = AI police spawn & chase; false = 0 AI cops!
    // Garage stat multipliers (0.6 .. 1.6)
    speedMult: 1.0,
    driftMult: 1.0,
    accelMult: 1.0,
    massMult: 1.0,
    scaleMult: 1.0,
    // World settings
    biome: 'city',               // 'city' | 'desert' | 'snow'
    copIntensity: 1.0,           // 0.6 (chill) | 1.0 (normal) | 1.45 (insane)
    startStars: 1,               // 1..5
    trafficDensity: 1.0,         // 0 .. 1.8
    itemBoxDensity: 1.2,         // 0.1 .. 5.0 (10% .. 500%)
    sugarBoxRate: 1.0,           // 0.0 .. 5.0 (0% .. 500%)
    gravityMult: 1.0,            // 0.6 (moon jumps) .. 1.3
    // Personal Camera, Display, Controls, HUD Layout & Audio Settings (never overwritten by Host Lobby!)
    cameraMode: 'smashy',        // 'smashy' (angled overhead) | 'chase' (behind car) | 'pov' (first-person hood view)
    povFov: 78,                  // 62 .. 96 degrees in POV camera
    cameraShakeMult: 1.0,        // 0.0 (off) .. 1.5
    graphicsQuality: 'high',     // 'high' | 'balanced' | 'performance'
    speedUnit: 'mph',            // 'mph' | 'kmh'
    touchStyle: 'split',         // 'split' (Buttons + Split Tap) | 'buttons' (Buttons Only) | 'joystick' (Thumbstick + Buttons)
    autoAccelerate: true,        // true = Smashy auto-gas; false = Manual Gas pedal [W / Up / GAS button]
    invertSteer: false,
    steerSensitivity: 1.0,       // 0.7 .. 1.4 personal steering feel
    steerDeadzone: 0.05,         // 0.0 .. 0.22 joystick deadzone
    showTouchControlsDesktop: true, // Show clickable Brake / Item / Steer buttons on Mac/Desktop too
    showKeyHints: true,          // Show [S], [SPACE], [A]/[D], [C] keycap badges on HUD buttons
    showSpeedometer: true,       // Personal MPH/KMH & drift spark gauge
    showMinimap: true,           // Circular live GPS cop/box/friend radar
    showFps: false,              // Live FPS counter badge
    showQuickCamBtn: true,       // In-game 1-tap camera angle cycle button
    screenEffects: true,         // Speed streaks & danger siren edge flash
    haptics: true,               // Mobile vibration feedback on crash/boost
    soundVolume: 0.85,
    sfxEngineVol: 0.85,
    sfxActionVol: 1.0,
    hudLayoutPreset: 'thumbs',   // 'thumbs' | 'claw' | 'lefty' | 'custom'
    hudLayout: cloneHudLayout('thumbs'),
    keybinds: cloneKeybinds(),
    worldSeed: 777123,
    enabledItems,
    itemWeights: createDefaultItemWeights(), // 0.1 .. 1000 (% weight multiplier per ability)
    lobbyRules: {
      lockStats: true,
      allowCarChoice: true,
      allowModeChoice: true,
      allowCustomPhotos: true,
      allowPlayerCops: true,
      universalSpeedMult: 1.0,
      universalDriftMult: 1.0,
      universalMassMult: 1.0,
      universalScaleMult: 1.0,
      universalVehicleId: 'sedan',
      universalCharacterMode: 'car_driver',
    },
  };
}
