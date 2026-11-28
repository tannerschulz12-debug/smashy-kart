// Smashy Road Arcade Physics, Locked Character Modes, Playable Police Team, 5-Star Police AI, Traffic & Multiplayer PvP
import { WORLD_CONFIG, VEHICLES, COP_VEHICLES, WANTED_LEVELS, createDefaultSettings } from './config.js';

const COP_SPECS = {
  cruiser: { speed: 47, accel: 36, handling: 3.5, radius: 2.0, mass: 1.05, maxHp: 45 },
  suv:     { speed: 49, accel: 38, handling: 3.3, radius: 2.2, mass: 1.4,  maxHp: 65 },
  swat:    { speed: 45, accel: 32, handling: 2.9, radius: 2.45, mass: 1.9, maxHp: 95 },
  heli:    { speed: 55, accel: 42, handling: 3.8, radius: 2.8, mass: 2.0,  maxHp: 999 },
  army:    { speed: 48, accel: 35, handling: 3.0, radius: 2.55, mass: 2.2, maxHp: 115 },
  tank:    { speed: 35, accel: 26, handling: 2.2, radius: 2.95, mass: 3.5, maxHp: 210 },
};

const TRAFFIC_TYPES = [
  { type: 'sedan',   speed: 22, radius: 1.95, mass: 0.95, color: '#38bdf8', accentColor: '#f8fafc' },
  { type: 'compact', speed: 24, radius: 1.75, mass: 0.85, color: '#fbbf24', accentColor: '#1e293b' },
  { type: 'van',     speed: 20, radius: 2.25, mass: 1.35, color: '#f472b6', accentColor: '#ffffff' },
  { type: 'truck',   speed: 18, radius: 2.45, mass: 1.75, color: '#34d399', accentColor: '#064e3b' },
  { type: 'bus',     speed: 17, radius: 2.65, mass: 2.1,  color: '#fb923c', accentColor: '#fef3c7' },
];

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

function makeRng(seed) {
  let s = (Number(seed) || 777123) >>> 0;
  if (s === 0) s = 777123;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1000000) / 1000000;
  };
}

export class Simulation {
  constructor(world, abilitySystem, settings = {}) {
    this.world = world;
    this.abilitySystem = abilitySystem;
    this.settings = { ...createDefaultSettings(), ...(settings || {}) };
    this.seed = this.settings.worldSeed || 777123;
    this._rng = makeRng(this.seed);

    this.localPlayer = null;
    this._remoteById = new Map();
    this.remotePlayers = [];
    this.cops = [];
    this.traffic = [];
    this.hazards = [];
    this.copAvatarPool = Array.isArray(this.settings.copAvatarPool)
      ? this.settings.copAvatarPool.slice()
      : [];

    this.nextEntityId = 1;
    this._nextCopId = 1;
    this._nextTrafficId = 1;
    this.isPartyMode = Boolean(this.settings.isParty);
    this.runTime = 0;
    const initAiCopsOn = this.settings.aiCopsEnabled !== false;
    this.wantedStars = initAiCopsOn ? this.settings.startStars || 1 : 0;
    this.wantedLabel = initAiCopsOn ? WANTED_LEVELS[0].label : 'AI Cops Off';
    this.comboCount = 0;
    this.comboTimer = 0;
    this.events = [];

    this._copSpawnCooldown = 0.6;
    this._trafficSpawnCooldown = 0.4;
    this._prevUseItem = false;
    this._prevHorn = false;
  }

  get player() {
    return this.localPlayer;
  }

  updateSettings(settings = {}) {
    this.settings = { ...this.settings, ...(settings || {}) };
    if (settings?.isParty !== undefined) {
      this.isPartyMode = Boolean(settings.isParty);
    }
    if (Array.isArray(settings.copAvatarPool)) {
      this.setCopAvatarPool(settings.copAvatarPool);
    }
    if (this.settings.aiCopsEnabled === false) {
      this.cops.length = 0;
      this.wantedStars = 0;
      this.wantedLabel = 'AI Cops Off';
      if (this.localPlayer) {
        this.localPlayer.bustedProgress = 0;
        this.localPlayer.stars = 0;
      }
    }
    this.abilitySystem?.updateSettings?.(this.settings);
  }

  setCopAvatarPool(pool = []) {
    this.copAvatarPool = (pool || [])
      .map((entry) => (typeof entry === 'string' ? entry : entry?.id))
      .filter(Boolean);
  }

  getProjectiles() {
    return this.abilitySystem ? this.abilitySystem.getProjectiles() : [];
  }

  resetRun(seed, settings = {}, rosterPlayers = []) {
    this.settings = { ...this.settings, ...(settings || {}) };
    if (Array.isArray(settings.copAvatarPool)) {
      this.setCopAvatarPool(settings.copAvatarPool);
    }
    this.seed = seed ?? this.settings.worldSeed ?? 777123;
    this._rng = makeRng(this.seed);

    this.abilitySystem?.updateSettings?.(this.settings);
    this.abilitySystem?.reset?.();

    this.cops.length = 0;
    this.traffic.length = 0;
    this.hazards.length = 0;
    this._remoteById.clear();
    this.remotePlayers.length = 0;
    this.events = [];

    this.runTime = 0;
    this._nextCopId = 1;
    this._nextTrafficId = 1;
    this.isPartyMode =
      settings?.isParty !== undefined
        ? Boolean(settings.isParty)
        : Array.isArray(rosterPlayers) && rosterPlayers.length > 0;
    if (settings?.isParty !== undefined) {
      this.settings.isParty = Boolean(settings.isParty);
    } else {
      delete this.settings.isParty;
    }
    this.comboCount = 0;
    this.comboTimer = 0;
    this._copSpawnCooldown = 0.85;
    this._trafficSpawnCooldown = 0.25;
    this._prevUseItem = false;
    this._prevHorn = false;

    const aiCopsOn = this.settings.aiCopsEnabled !== false;
    const startStars = aiCopsOn ? Math.max(1, Math.min(5, Math.round(this.settings.startStars || 1))) : 0;
    this.wantedStars = startStars;
    this.wantedLabel = aiCopsOn ? (WANTED_LEVELS[startStars - 1] || WANTED_LEVELS[0]).label : 'AI Cops Off';

    const localId = this.settings.playerId || 'local';
    let localSpawnIndex = Number(this.settings.spawnIndex) || 0;
    if (Array.isArray(rosterPlayers) && rosterPlayers.length > 0) {
      const me = rosterPlayers.find((p) => p.id === localId || p.isLocal);
      if (me && Number.isFinite(me.spawnIndex)) {
        localSpawnIndex = me.spawnIndex;
      }
    }

    const spawn = this.world?.findSpawnPoint
      ? this.world.findSpawnPoint(localSpawnIndex)
      : { x: 0, z: 0, angle: 0 };
    this.localPlayer = this.createLocalPlayer(spawn, this.settings);
    this.localPlayer.stars = this.localPlayer.playerRole === 'cop' ? 0 : startStars;

    // Seed initial remote players on starting grid if multiplayer match
    if (Array.isArray(rosterPlayers) && rosterPlayers.length > 0) {
      const initialSnaps = [];
      for (let i = 0; i < rosterPlayers.length; i++) {
        const rp = rosterPlayers[i];
        if (!rp || rp.id === this.localPlayer.id) continue;
        const rSpawn = this.world?.findSpawnPoint
          ? this.world.findSpawnPoint(Number.isFinite(rp.spawnIndex) ? rp.spawnIndex : i)
          : { x: (i + 1) * 4, z: 0, angle: 0 };
        initialSnaps.push({
          ...rp,
          x: rp.x ?? rSpawn.x,
          y: rp.y ?? 0,
          z: rp.z ?? rSpawn.z,
          angle: rp.angle ?? rSpawn.angle,
          alive: rp.alive !== false,
        });
      }
      if (initialSnaps.length > 0) {
        this.syncRemotePlayers(initialSnaps, this.localPlayer.id);
      }
    }

    // Warm up world chunks around spawn & seed initial ambient traffic / street racers + optional AI patrol cops
    this.world?.update?.(0.016, this.localPlayer.x, this.localPlayer.z);
    const soloCopMode = this.localPlayer.playerRole === 'cop' && this.remotePlayers.length === 0;
    const baseTraffic = soloCopMode
      ? Math.max(7, Math.round(8 * Math.max(0.8, this.settings.trafficDensity ?? 1.0)))
      : Math.round(6 * (this.settings.trafficDensity ?? 1.0));
    for (let i = 0; i < baseTraffic; i++) {
      this._spawnTrafficCar(this.localPlayer);
    }

    const hasRunnerTarget =
      this.localPlayer.playerRole !== 'cop' ||
      this.remotePlayers.some((rp) => rp && rp.playerRole !== 'cop');
    if (this.settings.aiCopsEnabled !== false && hasRunnerTarget) {
      const initialCops = Math.min(3, Math.max(1, Math.round(2 * (this.settings.copIntensity ?? 1.0))));
      for (let i = 0; i < initialCops; i++) {
        this._spawnCop(this.localPlayer);
      }
    }

    return this.localPlayer;
  }

  createLocalPlayer(spawn = { x: 0, z: 0, angle: 0 }, settings = this.settings) {
    const playerRole = settings.playerRole === 'cop' ? 'cop' : 'runner';
    const copVeh =
      COP_VEHICLES.find((v) => v.id === settings.copVehicleId) ||
      COP_VEHICLES.find((v) => v.id === 'cop_heli') ||
      COP_VEHICLES[0];
    const mode =
      settings.characterMode === 'photo_car' || settings.characterMode === 'runner'
        ? settings.characterMode
        : 'car_driver';
    const veh = VEHICLES.find((v) => v.id === settings.vehicleId) || VEHICLES[0];

    const speedMult = Number(settings.speedMult) || 1.0;
    const driftMult = Number(settings.driftMult) || 1.0;
    const accelMult = Number(settings.accelMult) || 1.0;
    const massMult = Number(settings.massMult) || 1.0;
    const scaleMult = Number(settings.scaleMult) || 1.0;

    let baseSpeed;
    let accel;
    let handling;
    let drift;
    let mass;
    let maxHp;
    let radius;

    if (playerRole === 'cop') {
      baseSpeed = copVeh.speed * speedMult;
      accel = copVeh.accel * accelMult;
      handling = copVeh.handling;
      drift = Math.max(0.55, Math.min(0.96, copVeh.drift * driftMult));
      mass = copVeh.mass * massMult;
      maxHp = Math.round(copVeh.maxHp * Math.max(0.85, massMult));
      radius = copVeh.radius * scaleMult;
    } else if (mode === 'runner') {
      // "Just Myself" — ultra-nimble sprinting on foot!
      baseSpeed = 42 * speedMult;
      accel = 78 * accelMult;
      handling = 5.4;
      drift = Math.max(0.18, Math.min(0.65, 0.34 * driftMult));
      mass = 0.65 * massMult;
      maxHp = Math.round(92 * Math.max(0.8, massMult));
      radius = 1.25 * scaleMult;
    } else if (mode === 'photo_car') {
      // "Look Like a Car" — punchy bouncy custom photo chassis
      baseSpeed = veh.speed * 1.03 * speedMult;
      accel = veh.accel * 1.08 * accelMult;
      handling = veh.handling * 1.05;
      drift = Math.max(0.55, Math.min(0.96, veh.drift * driftMult));
      mass = veh.mass * massMult;
      maxHp = Math.round(veh.maxHp * Math.max(0.75, massMult));
      radius = veh.radius * scaleMult;
    } else {
      // 'car_driver' — classic vehicle + roof cutout driver
      baseSpeed = veh.speed * speedMult;
      accel = veh.accel * accelMult;
      handling = veh.handling;
      drift = Math.max(0.55, Math.min(0.96, veh.drift * driftMult));
      mass = veh.mass * massMult;
      maxHp = Math.round(veh.maxHp * Math.max(0.75, massMult));
      radius = veh.radius * scaleMult;
    }

    const sx = Number(spawn.x) || 0;
    const sz = Number(spawn.z) || 0;
    const g = this.world?.getGroundHeight ? this.world.getGroundHeight(sx, sz) : { y: 0, surface: 'road' };
    const groundY = g.surface === 'water' ? WORLD_CONFIG.WATER_Y : g.y || 0;
    const isFlying = playerRole === 'cop' && Boolean(copVeh.flying);
    const hoverY = isFlying ? copVeh.hoverY || 11.5 : 0;
    const startY = isFlying ? Math.max(Math.max(0, groundY) + 10.5, hoverY) : Math.max(0, g.y || 0);
    const startAngle = Number(spawn.angle) || 0;
    const items = this.abilitySystem
      ? this.abilitySystem.createPlayerItemState()
      : {
          heldItem: null,
          charges: 0,
          rouletteTimer: 0,
          rouletteDisplayId: null,
          forcedResultId: null,
          starTimer: 0,
          megaTimer: 0,
          boostTimer: 0,
          sugarTimer: 0,
          shrunkTimer: 0,
          shockwaveVisualTimer: 0,
          copMissileCooldown: 0,
          nukeSafeTimer: 0,
        };

    return {
      id: settings.playerId || 'local',
      name: settings.playerName || 'Player 1',
      isLocal: true,
      playerRole,
      copVehicleId: copVeh.id,
      flying: isFlying,
      hoverY,
      groundY,
      hasCopMissile: playerRole === 'cop' && Boolean(copVeh.hasMissile),
      copMissileCooldown: 0,
      rotorAngle: 0,
      sirenPhase: 0,
      turretAngle: startAngle,
      characterMode: playerRole === 'cop' ? 'car_driver' : mode,
      vehicleId: veh.id,
      primaryColor: settings.primaryColor || (playerRole === 'cop' ? copVeh.color : veh.color),
      accentColor: settings.accentColor || (playerRole === 'cop' ? copVeh.accent : veh.accent),
      avatarId: settings.avatarId || 'default_hero',
      x: sx,
      y: startY,
      z: sz,
      prevX: sx,
      prevZ: sz,
      vx: 0,
      vy: 0,
      vz: 0,
      speed: 0,
      angle: startAngle,
      steerInput: 0,
      pitch: 0,
      roll: 0,
      wheelSpin: 0,
      stridePhase: 0,
      bounceOffset: 0,
      ragdollTimer: 0,
      drifting: false,
      driftAngle: 0,
      driftCharge: 0,
      driftSparkTier: 0,
      airborne: false,
      grounded: true,
      airTime: 0,
      spinOutTimer: 0,
      scaleMult,
      baseScale: scaleMult,
      scale: scaleMult,
      radius,
      baseSpeed,
      maxSpeed: baseSpeed,
      accel,
      handling,
      drift,
      mass,
      hp: maxHp,
      maxHp,
      smoking: false,
      onFire: false,
      alive: true,
      eliminatedReason: null,
      eliminatedText: null,
      killerName: null,
      killerId: null,
      nukedBy: null,
      bustedProgress: 0,
      score: 0,
      survivalTime: 0,
      copsWrecked: 0,
      playerKills: 0,
      propsSmashed: 0,
      stars: Math.max(1, Math.min(5, Math.round(settings.startStars || 1))),
      items,
      heldItemId: null,
      starTimer: 0,
      megaTimer: 0,
      boostTimer: 0,
      sugarTimer: 0,
      shrunkTimer: 0,
      starActive: false,
      megaActive: false,
      boostActive: false,
      sugarActive: false,
      shrunkActive: false,
      activeBuffs: { star: false, mega: false, boost: false, sugar: false, shrunk: false, shockwave: false },
      lastBumpedBy: null,
      _dmgCooldown: 0,
      _pvpCooldown: 0,
    };
  }

  syncRemotePlayers(remoteSnapshots, localId = this.localPlayer?.id, activeRosterIds = null) {
    if (!remoteSnapshots) return this.remotePlayers;
    const list = Array.isArray(remoteSnapshots)
      ? remoteSnapshots
      : remoteSnapshots instanceof Map
        ? Array.from(remoteSnapshots.values())
        : Object.values(remoteSnapshots);

    for (let i = 0; i < list.length; i++) {
      const snap = list[i];
      if (!snap) continue;
      const id = snap.id || snap.playerId;
      if (!id || id === localId) continue;

      let rp = this._remoteById.get(id);
      const role = snap.playerRole === 'cop' ? 'cop' : snap.playerRole === 'runner' ? 'runner' : rp?.playerRole || 'runner';
      const copVehId = snap.copVehicleId || rp?.copVehicleId || 'cop_heli';
      const copSpec = COP_VEHICLES.find((c) => c.id === copVehId) || COP_VEHICLES[0];
      const veh = VEHICLES.find((v) => v.id === snap.vehicleId) || VEHICLES[0];
      const mode = role === 'cop' ? 'car_driver' : snap.characterMode || 'car_driver';
      const defaultRadius = role === 'cop' ? copSpec.radius : mode === 'runner' ? 1.25 : veh.radius;
      const defaultMass = role === 'cop' ? copSpec.mass : mode === 'runner' ? 0.65 : veh.mass;
      const defaultMaxHp = role === 'cop' ? copSpec.maxHp : veh.maxHp;
      const isFlying = role === 'cop' && Boolean(snap.flying ?? copSpec.flying);
      const snapX = Number(snap.x) || 0;
      const snapZ = Number(snap.z) || 0;
      const gSnap = this.world?.getGroundHeight ? this.world.getGroundHeight(snapX, snapZ) : { y: 0, surface: 'road' };
      const snapGroundY = Number.isFinite(snap.groundY)
        ? snap.groundY
        : gSnap.surface === 'water'
          ? WORLD_CONFIG.WATER_Y
          : gSnap.y || 0;
      const defaultY = isFlying ? Math.max(Math.max(0, snapGroundY) + 10.5, copSpec.hoverY || 11.5) : Number(snap.y) || 0;

      if (!rp) {
        const sugarOn = Boolean(snap.activeBuffs?.sugar || snap.sugarActive || (snap.sugarTimer || 0) > 0);
        const rpItems = this.abilitySystem ? this.abilitySystem.createPlayerItemState() : {};
        if (sugarOn) rpItems.sugarTimer = Math.max(Number(snap.sugarTimer) || 0, 0.25);
        if (snap.heldItemId || snap.heldItem) rpItems.heldItem = snap.heldItemId || snap.heldItem;
        rp = {
          id,
          name: snap.name || 'Player',
          isLocal: false,
          isRemote: true,
          playerRole: role,
          copVehicleId: copSpec.id,
          flying: isFlying,
          groundY: snapGroundY,
          hasCopMissile: role === 'cop' && Boolean(copSpec.hasMissile),
          copMissileCooldown: Number(snap.copMissileCooldown) || 0,
          rotorAngle: 0,
          sirenPhase: 0,
          turretAngle: Number.isFinite(snap.turretAngle) ? snap.turretAngle : Number(snap.angle) || 0,
          characterMode: mode,
          vehicleId: veh.id,
          primaryColor: snap.primaryColor || (role === 'cop' ? copSpec.color : veh.color),
          accentColor: snap.accentColor || (role === 'cop' ? copSpec.accent : veh.accent),
          avatarId: snap.avatarId || id,
          x: snapX,
          y: Number.isFinite(snap.y) && (snap.y !== 0 || !isFlying) ? snap.y : defaultY,
          z: snapZ,
          targetX: snapX,
          targetY: Number.isFinite(snap.y) && (snap.y !== 0 || !isFlying) ? snap.y : defaultY,
          targetZ: snapZ,
          vx: Number(snap.vx) || 0,
          vy: Number(snap.vy) || 0,
          vz: Number(snap.vz) || 0,
          speed: Number(snap.speed) || Math.hypot(Number(snap.vx) || 0, Number(snap.vz) || 0),
          angle: Number(snap.angle) || 0,
          targetAngle: Number(snap.angle) || 0,
          pitch: 0,
          roll: 0,
          wheelSpin: 0,
          stridePhase: 0,
          drifting: Boolean(snap.drifting),
          driftSparkTier: Number(snap.driftSparkTier) || 0,
          heldItemId: snap.heldItemId || snap.heldItem || null,
          radius: defaultRadius,
          mass: defaultMass,
          scaleMult: 1.0,
          scale: Number(snap.scale) || 1.0,
          hp: Number.isFinite(snap.hp) ? snap.hp : defaultMaxHp,
          maxHp: Number.isFinite(snap.maxHp) ? snap.maxHp : defaultMaxHp,
          alive: snap.alive !== false,
          survivalTime: Number(snap.survivalTime) || 0,
          stars: Number(snap.stars) || 1,
          score: Number(snap.score) || 0,
          activeBuffs: {
            star: Boolean(snap.activeBuffs?.star || snap.starActive),
            mega: Boolean(snap.activeBuffs?.mega || snap.megaActive),
            boost: Boolean(snap.activeBuffs?.boost || snap.boostActive),
            sugar: sugarOn,
            shrunk: Boolean(snap.activeBuffs?.shrunk || snap.shrunkActive),
          },
          starActive: Boolean(snap.activeBuffs?.star || snap.starActive),
          megaActive: Boolean(snap.activeBuffs?.mega || snap.megaActive),
          boostActive: Boolean(snap.activeBuffs?.boost || snap.boostActive),
          sugarActive: sugarOn,
          sugarTimer: sugarOn ? Math.max(Number(snap.sugarTimer) || 0, 0.25) : 0,
          shrunkActive: Boolean(snap.activeBuffs?.shrunk || snap.shrunkActive),
          items: rpItems,
        };
        this._remoteById.set(id, rp);
      } else {
        if (snap.name) rp.name = snap.name;
        rp.playerRole = role;
        rp.copVehicleId = copSpec.id;
        rp.flying = isFlying;
        rp.hasCopMissile = role === 'cop' && Boolean(copSpec.hasMissile);
        rp.radius = defaultRadius;
        rp.mass = defaultMass;
        if (Number.isFinite(snap.groundY)) rp.groundY = snap.groundY;
        if (Number.isFinite(snap.copMissileCooldown)) rp.copMissileCooldown = snap.copMissileCooldown;
        if (Number.isFinite(snap.turretAngle)) rp.turretAngle = snap.turretAngle;
        if (snap.characterMode && role !== 'cop') rp.characterMode = snap.characterMode;
        if (snap.vehicleId) rp.vehicleId = snap.vehicleId;
        if (snap.primaryColor) rp.primaryColor = snap.primaryColor;
        if (snap.accentColor) rp.accentColor = snap.accentColor;
        if (snap.avatarId) rp.avatarId = snap.avatarId;
        if (Number.isFinite(snap.x)) rp.targetX = snap.x;
        if (Number.isFinite(snap.y)) {
          rp.targetY = isFlying && snap.y <= 0.1 ? defaultY : snap.y;
        } else if (isFlying) {
          rp.targetY = defaultY;
        }
        if (Number.isFinite(snap.z)) rp.targetZ = snap.z;
        if (Number.isFinite(snap.vx)) rp.vx = snap.vx;
        if (Number.isFinite(snap.vy)) rp.vy = snap.vy;
        if (Number.isFinite(snap.vz)) rp.vz = snap.vz;
        rp.speed = Number.isFinite(snap.speed) ? snap.speed : Math.hypot(rp.vx, rp.vz);
        if (Number.isFinite(snap.angle)) rp.targetAngle = snap.angle;
        if (snap.drifting !== undefined) rp.drifting = Boolean(snap.drifting);
        if (snap.driftSparkTier !== undefined) rp.driftSparkTier = Number(snap.driftSparkTier) || 0;
        if (snap.heldItemId !== undefined || snap.heldItem !== undefined) {
          rp.heldItemId = snap.heldItemId ?? snap.heldItem ?? null;
        }
        if (Number.isFinite(snap.hp)) rp.hp = snap.hp;
        if (Number.isFinite(snap.maxHp)) rp.maxHp = snap.maxHp;
        if (snap.alive !== undefined) rp.alive = Boolean(snap.alive);
        if (Number.isFinite(snap.survivalTime)) rp.survivalTime = snap.survivalTime;
        if (Number.isFinite(snap.stars)) rp.stars = snap.stars;
        if (Number.isFinite(snap.score)) rp.score = snap.score;
        if (snap.activeBuffs) {
          rp.activeBuffs = { ...rp.activeBuffs, ...snap.activeBuffs };
          rp.starActive = Boolean(snap.activeBuffs.star);
          rp.megaActive = Boolean(snap.activeBuffs.mega);
          rp.boostActive = Boolean(snap.activeBuffs.boost);
          rp.sugarActive = Boolean(snap.activeBuffs.sugar ?? snap.sugarActive);
          rp.shrunkActive = Boolean(snap.activeBuffs.shrunk);
        } else if (snap.sugarActive !== undefined) {
          rp.sugarActive = Boolean(snap.sugarActive);
          if (rp.activeBuffs) rp.activeBuffs.sugar = rp.sugarActive;
        }
        if (Number.isFinite(snap.sugarTimer)) {
          rp.sugarTimer = snap.sugarTimer;
          if (snap.sugarTimer > 0) {
            rp.sugarActive = true;
            if (rp.activeBuffs) rp.activeBuffs.sugar = true;
          }
        } else {
          rp.sugarTimer = rp.sugarActive ? Math.max(rp.sugarTimer || 0, 0.25) : 0;
        }
        rp.scale = rp.megaActive ? 2.3 : rp.shrunkActive && !rp.sugarActive ? 0.55 : Number(snap.scale) || 1.0;
        if (rp.items) {
          rp.items.starTimer = rp.starActive ? Math.max(rp.items.starTimer || 0, 0.25) : 0;
          rp.items.megaTimer = rp.megaActive ? Math.max(rp.items.megaTimer || 0, 0.25) : 0;
          rp.items.boostTimer = rp.boostActive ? Math.max(rp.items.boostTimer || 0, 0.25) : 0;
          rp.items.sugarTimer = rp.sugarActive
            ? Math.max(rp.items.sugarTimer || 0, Number(snap.sugarTimer) || 0.25)
            : 0;
          rp.items.shrunkTimer = rp.shrunkActive && !rp.sugarActive ? Math.max(rp.items.shrunkTimer || 0, 0.25) : 0;
          if (rp.heldItemId !== undefined) rp.items.heldItem = rp.heldItemId;
        }
      }
    }

    if (activeRosterIds instanceof Set) {
      for (const id of this._remoteById.keys()) {
        if (!activeRosterIds.has(id)) this._remoteById.delete(id);
      }
    }

    this.remotePlayers = Array.from(this._remoteById.values());
    if (this.remotePlayers.length > 0 && this.settings?.isParty !== false) {
      this.isPartyMode = true;
    }
    return this.remotePlayers;
  }

  _interpolateRemotePlayers(dt) {
    const posBlend = 1.0 - Math.exp(-Math.max(0.001, dt) * 18.0);
    const angBlend = 1.0 - Math.exp(-Math.max(0.001, dt) * 16.0);
    for (let i = 0; i < this.remotePlayers.length; i++) {
      const rp = this.remotePlayers[i];
      const jumpDist = Math.hypot(rp.targetX - rp.x, rp.targetZ - rp.z);
      if (jumpDist > 55) {
        rp.x = rp.targetX;
        rp.y = rp.targetY;
        rp.z = rp.targetZ;
        rp.angle = rp.targetAngle;
      } else {
        // Smooth velocity feed-forward + exponential error convergence (zero packet-boundary stutter!)
        rp.x += rp.vx * dt * 0.22;
        rp.z += rp.vz * dt * 0.22;
        rp.x += (rp.targetX - rp.x) * posBlend;
        rp.y += (rp.targetY - rp.y) * posBlend;
        rp.z += (rp.targetZ - rp.z) * posBlend;
        rp.angle = lerpAngle(rp.angle, rp.targetAngle, angBlend);
      }
      rp.wheelSpin = (rp.wheelSpin || 0) + rp.speed * dt * 0.6;
      rp.stridePhase = (rp.stridePhase || 0) + rp.speed * dt * 0.55;
      rp.sirenPhase = (rp.sirenPhase || 0) + dt * 11;
      rp.turretAngle = lerpAngle(rp.turretAngle ?? rp.angle, rp.targetAngle, angBlend);
      if (rp.flying) {
        rp.rotorAngle = (rp.rotorAngle || 0) + dt * 28;
        if (this.world?.getGroundHeight) {
          const gRp = this.world.getGroundHeight(rp.x, rp.z);
          rp.groundY = gRp.surface === 'water' ? WORLD_CONFIG.WATER_Y : gRp.y || 0;
        }
      }
      rp.smoking = rp.hp < rp.maxHp * 0.5;
      rp.onFire = rp.hp < rp.maxHp * 0.25;
    }
  }

  applyPvPCollision(localPlayer = this.localPlayer, remotePlayers = this.remotePlayers) {
    const impulses = [];
    if (!localPlayer || !localPlayer.alive) return impulses;
    const list = Array.isArray(remotePlayers)
      ? remotePlayers
      : Array.from(remotePlayers?.values?.() || []);

    const lRadius = (localPlayer.radius || 2.1) * (localPlayer.scale || 1.0);
    const localPower = Boolean(localPlayer.starActive || localPlayer.megaActive || localPlayer.sugarActive);

    for (let i = 0; i < list.length; i++) {
      const rp = list[i];
      if (!rp || rp.alive === false || rp.id === localPlayer.id) continue;
      if (Math.abs((localPlayer.y || 0) - (rp.y || 0)) > 4.2) continue;
      const rRadius = (rp.radius || 2.1) * (rp.scale || 1.0);
      const minDist = lRadius + rRadius;
      const dx = localPlayer.x - rp.x;
      const dz = localPlayer.z - rp.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= minDist) continue;

      const nx = dist > 0.001 ? dx / dist : Math.sin(localPlayer.angle || 0);
      const nz = dist > 0.001 ? dz / dist : Math.cos(localPlayer.angle || 0);
      const overlap = minDist - dist;

      // Push apart so players never get stuck overlapping
      localPlayer.x += nx * overlap * 0.55;
      localPlayer.z += nz * overlap * 0.55;
      rp.x -= nx * overlap * 0.45;
      rp.z -= nz * overlap * 0.45;

      if (localPlayer._pvpCooldown > 0) continue;
      localPlayer._pvpCooldown = 0.22;

      const remotePower = Boolean(rp.starActive || rp.megaActive || rp.sugarActive);
      const relVx = localPlayer.vx - (rp.vx || 0);
      const relVz = localPlayer.vz - (rp.vz || 0);
      const closing = -(relVx * nx + relVz * nz);

      if (remotePower && !localPower) {
        // Rival with Star/Mega launches local player flying!
        localPlayer.vx = nx * 42;
        localPlayer.vz = nz * 42;
        localPlayer.vy = Math.max(localPlayer.vy || 0, 16);
        localPlayer.spinOutTimer = 1.1;
        localPlayer.lastBumpedBy = { id: rp.id, name: rp.name || 'Friend', time: this.runTime };
      } else if (localPower && !remotePower) {
        // Local player with Star/Mega blasts rival sky-high!
        localPlayer.score += 120;
        impulses.push({
          targetId: rp.id,
          targetName: rp.name,
          fromId: localPlayer.id,
          fromName: localPlayer.name,
          vx: -nx * 44,
          vy: 17,
          vz: -nz * 44,
          spinOut: 1.1,
          power: true,
        });
      } else {
        // Bouncy Smashy bumper-car collision!
        const lMass = (localPlayer.mass || 1.0) * (localPlayer.boostActive ? 1.4 : 1.0);
        const rMass = rp.mass || 1.0;
        const totalMass = lMass + rMass;
        const bounceStrength = Math.max(18, closing * 1.45 + 12);

        const lShare = rMass / totalMass;
        const rShare = lMass / totalMass;

        localPlayer.vx += nx * bounceStrength * lShare;
        localPlayer.vz += nz * bounceStrength * lShare;
        localPlayer.lastBumpedBy = { id: rp.id, name: rp.name || 'Friend', time: this.runTime };

        if (localPlayer.characterMode === 'runner' && bounceStrength * lShare > 20) {
          localPlayer.vy = Math.max(localPlayer.vy || 0, 9);
          localPlayer.ragdollTimer = 0.55;
        }

        impulses.push({
          targetId: rp.id,
          targetName: rp.name,
          fromId: localPlayer.id,
          fromName: localPlayer.name,
          vx: -nx * bounceStrength * rShare,
          vy: rp.characterMode === 'runner' ? 8 : 3,
          vz: -nz * bounceStrength * rShare,
          spinOut: localPlayer.boostActive ? 0.6 : 0,
          power: false,
        });
      }

      this._emit({
        type: 'pvp_slam',
        targetId: rp.id,
        targetName: rp.name,
        attackerId: localPlayer.id,
        attackerName: localPlayer.name,
        x: (localPlayer.x + rp.x) * 0.5,
        y: (localPlayer.y || 0) + 0.8,
        z: (localPlayer.z + rp.z) * 0.5,
        impulses,
      });
    }

    return impulses;
  }

  applyIncomingPvpBump(bump) {
    const lp = this.localPlayer;
    if (!lp || !lp.alive || !bump) return;
    if (bump.targetId && bump.targetId !== lp.id) return;
    const protectedBuff = lp.starActive || lp.megaActive || lp.sugarActive;
    if (protectedBuff && !bump.power) return;

    lp.vx += Number(bump.vx) || 0;
    lp.vz += Number(bump.vz) || 0;
    if (Number(bump.vy) > 0) {
      lp.vy = Math.max(lp.vy || 0, Number(bump.vy));
    }
    if (Number(bump.spinOut) > 0 && !protectedBuff) {
      lp.spinOutTimer = Math.max(lp.spinOutTimer || 0, Number(bump.spinOut));
    }
    if (lp.characterMode === 'runner' && Math.hypot(Number(bump.vx) || 0, Number(bump.vz) || 0) > 22) {
      lp.ragdollTimer = 0.6;
    }
    lp.lastBumpedBy = {
      id: bump.fromId || 'remote',
      name: bump.fromName || 'Friend',
      time: this.runTime,
    };
    this._emit({
      type: 'pvp_slam',
      attackerId: bump.fromId,
      attackerName: bump.fromName,
      x: lp.x,
      y: lp.y || 0,
      z: lp.z,
    });
  }

  _getRecentKillerInfo(player) {
    if (!player?.lastBumpedBy) return { killerId: null, killerName: null, reason: null };
    if (this.runTime - player.lastBumpedBy.time <= 6.5) {
      return {
        killerId: player.lastBumpedBy.id || null,
        killerName: player.lastBumpedBy.name || null,
        reason: player.lastBumpedBy.reason || null,
      };
    }
    return { killerId: null, killerName: null, reason: null };
  }

  _getRecentKillerName(player) {
    return this._getRecentKillerInfo(player).killerName;
  }

  _eliminateLocalPlayer(reason) {
    const lp = this.localPlayer;
    if (!lp || !lp.alive) return;
    lp.alive = false;
    const recent = this._getRecentKillerInfo(lp);
    const isNuke = Boolean(lp.nukedBy || recent.reason === 'nuked');
    const killerName = recent.killerName || lp.nukedBy || (isNuke ? lp.lastBumpedBy?.name || 'Rival' : null);
    const killerId = recent.killerId || (isNuke ? lp.lastBumpedBy?.id || null : null);
    lp.eliminatedReason = isNuke && reason === 'wrecked' ? 'nuked' : reason;
    lp.killerName = killerName;
    lp.killerId = killerId;

    if (reason === 'drowned') {
      lp.eliminatedText = killerName
        ? `${killerName} SLAMMED YOU INTO THE RIVER!`
        : 'DROWNED IN THE RIVER!';
      this._emit({
        type: 'water_splash',
        x: lp.x,
        y: WORLD_CONFIG.WATER_Y,
        z: lp.z,
        eliminated: true,
        reason: 'drowned',
        isNuke,
        killerId,
        killerName,
        survivalTime: lp.survivalTime,
        score: Math.round(lp.score),
      });
    } else if (reason === 'busted') {
      lp.eliminatedText = killerName
        ? `BOXED IN BY ${killerName} — BUSTED!`
        : 'BUSTED!';
      this._emit({
        type: 'busted',
        x: lp.x,
        y: lp.y,
        z: lp.z,
        eliminated: true,
        reason: 'busted',
        isNuke,
        killerId,
        killerName,
        survivalTime: lp.survivalTime,
        score: Math.round(lp.score),
      });
    } else {
      lp.eliminatedText = isNuke
        ? `☢️ NUKED BY ${killerName || 'Rival'}!`
        : killerName
          ? `WRECKED BY ${killerName}!`
          : 'WRECKED!';
      this._emit({
        type: 'explosion',
        x: lp.x,
        y: lp.y + 0.8,
        z: lp.z,
        radius: 9,
        intensity: 1.35,
      });
      this._emit({
        type: 'wrecked',
        x: lp.x,
        y: lp.y,
        z: lp.z,
        eliminated: true,
        reason: isNuke ? 'nuked' : 'wrecked',
        isNuke,
        nuked: isNuke,
        killerId,
        killerName,
        survivalTime: lp.survivalTime,
        score: Math.round(lp.score),
      });
    }
  }

  _isPartyActive() {
    if (this.settings?.isParty === false) return false;
    return Boolean(this.isPartyMode || this.remotePlayers.length > 0);
  }

  _buildAbilityContext(time = 0, extra = null) {
    const base = {
      world: this.world,
      cops: this.cops,
      traffic: this.traffic,
      localPlayer: this.localPlayer,
      remotePlayers: this.remotePlayers,
      isParty: this._isPartyActive(),
      time: this.runTime || time || 0,
      onEvent: (ev) => this._emit(ev),
    };
    return extra ? { ...base, ...extra } : base;
  }

  fireTargetedNuke(targetId, targetKind = null) {
    const lp = this.localPlayer;
    if (!lp || !lp.alive || !this.abilitySystem) {
      return { used: false, reason: 'unavailable', events: [] };
    }
    if (lp.items?.heldItem !== 'tactical_nuke') {
      return { used: false, reason: 'not_holding_nuke', events: [] };
    }
    const captured = [];
    const ctx = this._buildAbilityContext(this.runTime, {
      targetId: targetId || null,
      targetKind: targetKind || null,
      isParty: this._isPartyActive(),
      onEvent: (ev) => {
        captured.push(ev);
        this._emit(ev);
      },
    });
    const res = this.abilitySystem.useHeldItem(lp, ctx) || { used: false };
    return {
      used: Boolean(res.used),
      reason: res.reason || null,
      abilityId: res.abilityId || 'tactical_nuke',
      chargesLeft: res.chargesLeft ?? lp.items?.charges ?? 0,
      netEvent: res.netEvent || null,
      events: captured,
    };
  }

  spawnNetworkAbilityEvent(event) {
    if (!this.abilitySystem) return;
    this.abilitySystem.spawnNetworkAbilityEvent(event, this._buildAbilityContext(this.runTime));
  }

  _emit(ev) {
    this.events.push(ev);
    if (typeof this.onEvent === 'function') this.onEvent(ev);
    if (typeof this.settings?.onEvent === 'function') this.settings.onEvent(ev);
  }

  _computeRankBias(player) {
    let bias = 0;
    if (player.hp < player.maxHp * 0.5) bias += 0.35;
    if (this.wantedStars >= 4) bias += 0.35;
    if (this.remotePlayers.length > 0) {
      const aheadCount = this.remotePlayers.filter((rp) => rp.alive && (rp.score || 0) > player.score).length;
      if (aheadCount > 0) bias += 0.25;
    }
    return Math.min(1, bias);
  }

  update(dt, input = {}, time = 0, spectateTarget = null) {
    const safeDt = Math.max(0.0001, Math.min(0.05, Number(dt) || 0.016));
    this.events = [];

    if (!this.localPlayer) {
      this.resetRun(this.seed, this.settings);
    }
    const lp = this.localPlayer;
    this.runTime += safeDt;

    if (this.comboTimer > 0) {
      this.comboTimer = Math.max(0, this.comboTimer - safeDt);
      if (this.comboTimer === 0) this.comboCount = 0;
    }

    const context = this._buildAbilityContext(time);

    // 1. Update Ability timers & contact knockouts
    if (this.abilitySystem) {
      this.abilitySystem.updatePlayerItemState(lp, safeDt, context);
    }

    // 2. Handle discrete item activation & horn input (edge-triggered so 1 tap = 1 charge)
    const useItemNow = Boolean(input?.useItem);
    if (lp.alive && useItemNow && !this._prevUseItem && this.abilitySystem) {
      this.abilitySystem.useHeldItem(lp, context);
    }
    this._prevUseItem = useItemNow;

    const hornNow = Boolean(input?.horn);
    if (lp.alive && hornNow && !this._prevHorn) {
      this._emit({ type: 'horn', x: lp.x, y: lp.y, z: lp.z, playerId: lp.id, intensity: 1.0 });
      for (let i = 0; i < this.traffic.length; i++) {
        const car = this.traffic[i];
        if (Math.hypot(car.x - lp.x, car.z - lp.z) < 22) car.panic = true;
      }
    }
    this._prevHorn = hornNow;

    // 3. Update local player movement, world collisions, water, item boxes
    if (lp.alive) {
      this._updateLocalPlayerPhysics(lp, safeDt, input, context);
    } else {
      // Decelerate wrecked/busted body gently
      lp.vx *= Math.pow(0.15, safeDt);
      lp.vz *= Math.pow(0.15, safeDt);
      lp.x += lp.vx * safeDt;
      lp.z += lp.vz * safeDt;
      lp.drifting = false;
    }

    // 4. Interpolate remote players & apply PvP collisions
    this._interpolateRemotePlayers(safeDt);
    this.applyPvPCollision(lp, this.remotePlayers);

    // 5. Stream world, traffic & police around active focus (spectated survivor when eliminated!)
    const focusAnchor = !lp.alive && spectateTarget ? spectateTarget : lp;
    this.world?.update?.(safeDt, focusAnchor.x, focusAnchor.z);

    // 6. Update Wanted level, Police AI, Civilian Traffic, Projectiles & Hazards
    this._updateWantedStars();
    this._updateTraffic(safeDt, focusAnchor, context);
    this._updateCops(safeDt, focusAnchor, context);
    this._updateHazards(safeDt);
    this.abilitySystem?.updateProjectiles?.(safeDt, context);

    // 7. Evaluate BUSTED & WRECKED conditions
    if (lp.alive) {
      this._updateBustedAndHealth(lp, safeDt);
    }

    return this.events;
  }

  _updateLocalPlayerPhysics(lp, dt, input, context) {
    lp.survivalTime += dt;
    lp.score += dt * (8 + this.wantedStars * 3);
    if (lp._dmgCooldown > 0) lp._dmgCooldown = Math.max(0, lp._dmgCooldown - dt);
    if (lp._pvpCooldown > 0) lp._pvpCooldown = Math.max(0, lp._pvpCooldown - dt);
    if (lp.ragdollTimer > 0) lp.ragdollTimer = Math.max(0, lp.ragdollTimer - dt);

    lp.prevX = lp.x;
    lp.prevZ = lp.z;

    // Parse Smashy left/right/both/joystick steering + deadzone + invertSteer + auto/manual gas!
    const bothButtons = Boolean(input?.left && input?.right);
    const braking = Boolean(input?.brake || bothButtons);
    const autoGas = this.settings.autoAccelerate !== false;
    const gasHeld = autoGas ? !braking : Boolean(input?.gas);
    const deadzone = Math.max(0, Math.min(0.3, Number(this.settings.steerDeadzone ?? 0.05)));
    let steerCmd = 0; // +1 = left (CCW: angle +=), -1 = right (CW: angle -=)
    if (typeof input?.steerAxis === 'number' && Math.abs(input.steerAxis) > deadzone) {
      const sign = input.steerAxis > 0 ? 1 : -1;
      const norm = (Math.abs(input.steerAxis) - deadzone) / Math.max(0.01, 1 - deadzone);
      steerCmd = -sign * Math.min(1, norm);
    } else if (!bothButtons) {
      if (input?.left) steerCmd += 1;
      if (input?.right) steerCmd -= 1;
    }
    if (this.settings.invertSteer) {
      steerCmd = -steerCmd;
    }
    lp.steerInput = steerCmd;
    lp.braking = braking;

    const gBefore = this.world?.getGroundHeight
      ? this.world.getGroundHeight(lp.x, lp.z)
      : { y: 0, surface: 'road', speedFactor: 1.0, rampSlopeX: 0, rampSlopeZ: 0 };

    // Calculate buffed top speed (3x Sugar Rush = 2.35x = +135%, exact 3x the +45% mushroom boost!)
    const sugarOn = Boolean(lp.sugarActive || (lp.items?.sugarTimer || 0) > 0);
    lp.sugarActive = sugarOn;
    let topSpeed = lp.baseSpeed;
    if (sugarOn) {
      topSpeed *= 2.35;
    } else if (lp.boostActive) {
      topSpeed *= 1.45;
    }
    if (lp.starActive) topSpeed *= sugarOn ? 1.08 : 1.32;
    if (lp.megaActive) topSpeed *= sugarOn ? 1.05 : 1.14;
    if (lp.shrunkActive && !sugarOn) topSpeed *= 0.52;

    const ignoreOffroadSlow =
      sugarOn ||
      lp.starActive ||
      lp.boostActive ||
      lp.megaActive ||
      lp.flying ||
      (lp.playerRole === 'cop' && lp.copVehicleId === 'cop_tank') ||
      lp.characterMode === 'runner';
    const surfaceFactor = ignoreOffroadSlow ? 1.0 : gBefore.speedFactor ?? 1.0;
    lp.maxSpeed = topSpeed * surfaceFactor;
    lp.sirenPhase = (lp.sirenPhase || 0) + dt * 11;
    if (lp.flying) {
      lp.rotorAngle = (lp.rotorAngle || 0) + dt * 28;
      lp.spinOutTimer = 0;
    } else if (lp.playerRole === 'cop' && lp.copVehicleId === 'cop_tank') {
      lp.spinOutTimer = 0;
    }

    // Spin-out override (from banana peel or homing shell)
    if (lp.spinOutTimer > 0 && !sugarOn) {
      lp.spinOutTimer = Math.max(0, lp.spinOutTimer - dt);
      lp.angle = wrapAngle(lp.angle + 13.5 * dt);
      lp.vx *= Math.pow(0.32, dt);
      lp.vz *= Math.pow(0.32, dt);
      lp.drifting = lp.grounded && lp.characterMode !== 'runner';
      lp.driftCharge = 0;
      lp.driftSparkTier = 0;
    } else {
      if (sugarOn) lp.spinOutTimer = 0;
      // Steering rotation (with personal steerSensitivity preference, never overwritten by lobbyRules)
      const preSpeed = Math.hypot(lp.vx, lp.vz);
      const fwdPre = lp.vx * Math.sin(lp.angle) + lp.vz * Math.cos(lp.angle);
      const reverseSign = lp.flying ? 1 : fwdPre < -2.0 ? -1 : 1;
      const steerMobility =
        lp.flying || lp.characterMode === 'runner'
          ? 1.0
          : 0.42 + 0.58 * Math.min(1, preSpeed / 13);
      const airControl = lp.flying ? 1.0 : lp.airborne ? 0.45 : 1.0;
      const steerSens = Math.max(0.65, Math.min(1.5, Number(this.settings.steerSensitivity) || 1.0));
      const turnRate = lp.handling * steerMobility * airControl * steerSens;
      lp.angle = wrapAngle(lp.angle + steerCmd * reverseSign * turnRate * dt);
      lp.turretAngle = lp.angle;

      const fx = Math.sin(lp.angle);
      const fz = Math.cos(lp.angle);
      const lx = Math.cos(lp.angle);
      const lz = -Math.sin(lp.angle);

      let vFwd = lp.vx * fx + lp.vz * fz;
      let vLat = lp.vx * lx + lp.vz * lz;

      if (lp.flying) {
        if (!braking && (gasHeld || sugarOn || lp.boostActive || lp.starActive)) {
          const accelBoost = sugarOn ? 3.2 : lp.boostActive ? 2.0 : lp.starActive ? 1.45 : 1.0;
          const driveAccel = lp.accel * accelBoost;
          if (vFwd < lp.maxSpeed) {
            vFwd = Math.min(lp.maxSpeed, vFwd + driveAccel * dt);
          } else {
            vFwd += (lp.maxSpeed - vFwd) * Math.min(1, dt * 4.5);
          }
        } else if (braking) {
          // Helicopter air-brake: hover smoothly in place to pivot-aim missiles!
          vFwd *= Math.exp(-5.5 * dt);
          if (Math.abs(vFwd) < 0.35) vFwd = 0;
        } else {
          vFwd *= Math.exp(-1.5 * dt);
          if (Math.abs(vFwd) < 0.25) vFwd = 0;
        }
        vLat *= Math.exp(-5.8 * dt);
        lp.vx = fx * vFwd + lx * vLat;
        lp.vz = fz * vFwd + lz * vLat;
      } else if (lp.grounded || !lp.airborne) {
        if (!braking && (gasHeld || sugarOn || lp.boostActive || lp.starActive)) {
          // Smashy Road auto-acceleration (or Manual Gas pedal when autoAccelerate === false)!
          const accelBoost = sugarOn ? 3.6 : lp.boostActive ? 2.25 : lp.starActive ? 1.55 : 1.0;
          const driveAccel = lp.accel * accelBoost;
          if (vFwd < lp.maxSpeed) {
            vFwd = Math.min(lp.maxSpeed, vFwd + driveAccel * dt);
          } else {
            vFwd += (lp.maxSpeed - vFwd) * Math.min(1, dt * 4.5);
          }
        } else if (braking) {
          // Handbrake drift kick when tapping Brake while turning at speed, plus smooth brake & reverse!
          if (vFwd > 15 && Math.abs(steerCmd) > 0.2 && lp.characterMode !== 'runner') {
            vLat += -steerCmd * lp.accel * 0.42 * dt;
            lp.drifting = true;
          }
          if (vFwd > 1.5) {
            vFwd = Math.max(0, vFwd - lp.accel * 2.15 * dt);
          } else {
            const maxRev = -lp.maxSpeed * 0.46;
            vFwd = Math.max(maxRev, vFwd - lp.accel * 1.05 * dt);
          }
        } else {
          // Coasting when Manual Gas is enabled and neither Gas nor Brake is pressed
          vFwd *= Math.exp(-1.35 * dt);
          if (Math.abs(vFwd) < 0.25) vFwd = 0;
        }

        // Arcade tail-kick drift blending!
        if (lp.characterMode === 'runner') {
          vLat *= Math.exp(-15 * dt);
        } else {
          // Higher drift factor (0.83..0.96) lets the rear swing out cleanly during hard turns
          const grip = 1.9 + (1.0 - lp.drift) * 16.0;
          vLat *= Math.exp(-grip * dt);
          // Mario Kart cornering momentum preservation so continuous drifts stay fast (>18) & thrilling!
          if (!braking && Math.abs(steerCmd) > 0.2 && vFwd > 10) {
            const cornerCarry = Math.abs(vLat) * turnRate * 0.56 + lp.accel * 0.24;
            vFwd = Math.min(lp.maxSpeed, vFwd + cornerCarry * dt);
          }
        }

        lp.vx = fx * vFwd + lx * vLat;
        lp.vz = fz * vFwd + lz * vLat;

        // Soft cap unboosted cornering speed so lateral+forward slip never exceeds maxSpeed
        const newHorizSpd = Math.hypot(lp.vx, lp.vz);
        if (!sugarOn && !lp.boostActive && newHorizSpd > lp.maxSpeed && newHorizSpd > 0.001) {
          const capScale = lp.maxSpeed / newHorizSpd;
          lp.vx *= capScale;
          lp.vz *= capScale;
        }
      }

      lp.driftAngle = Math.atan2(vLat, Math.abs(vFwd) + 0.1);
      lp.drifting =
        !lp.flying &&
        lp.grounded &&
        lp.characterMode !== 'runner' &&
        (Math.abs(vLat) > 5.2 || (braking && vFwd > 10)) &&
        Math.hypot(lp.vx, lp.vz) > 15;

      const targetRoll = lp.flying
        ? Math.max(-0.28, Math.min(0.28, -steerCmd * 0.24))
        : lp.characterMode === 'runner'
          ? -steerCmd * 0.14
          : Math.max(-0.24, Math.min(0.24, -vLat * 0.014));
      lp.roll += (targetRoll - lp.roll) * Math.min(1, dt * 12);
    }

    // Integrate horizontal motion & clamp to world bounds
    lp.x += lp.vx * dt;
    lp.z += lp.vz * dt;
    const bound = WORLD_CONFIG.HALF_WORLD - 10;
    if (lp.x > bound) { lp.x = bound; lp.vx = -Math.abs(lp.vx) * 0.5; }
    if (lp.x < -bound) { lp.x = -bound; lp.vx = Math.abs(lp.vx) * 0.5; }
    if (lp.z > bound) { lp.z = bound; lp.vz = -Math.abs(lp.vz) * 0.5; }
    if (lp.z < -bound) { lp.z = -bound; lp.vz = Math.abs(lp.vz) * 0.5; }

    lp.speed = Math.hypot(lp.vx, lp.vz);
    const fwdSigned = lp.vx * Math.sin(lp.angle) + lp.vz * Math.cos(lp.angle);
    lp.wheelSpin += fwdSigned * dt * 0.62;
    if (lp.characterMode === 'runner') {
      lp.stridePhase += lp.speed * dt * 0.58;
    } else if (lp.characterMode === 'photo_car' && lp.grounded) {
      lp.bounceOffset = Math.abs(Math.sin(this.runTime * 11)) * Math.min(0.16, lp.speed * 0.003);
    }

    // Vertical ramp, helicopter flight & gravity physics
    const gAfter = this.world?.getGroundHeight
      ? this.world.getGroundHeight(lp.x, lp.z)
      : { y: 0, surface: 'road', speedFactor: 1.0, rampSlopeX: 0, rampSlopeZ: 0 };
    lp.groundY = gAfter.surface === 'water' ? WORLD_CONFIG.WATER_Y : gAfter.y || 0;
    const gravity = 38 * (this.settings.gravityMult ?? 1.0);

    if (lp.flying) {
      const surfaceFloorY = gAfter.surface === 'water' ? 0 : Math.max(0, gAfter.y || 0);
      const targetAlt = Math.max(surfaceFloorY + 10.5, lp.hoverY || 11.5);
      lp.y += (targetAlt - lp.y) * Math.min(1, dt * 6.0);
      lp.vy = 0;
      lp.airborne = true;
      lp.grounded = false;
      lp.airTime = 0;
      const targetHeliPitch = Math.max(-0.22, Math.min(0.14, -fwdSigned * 0.004));
      lp.pitch += (targetHeliPitch - lp.pitch) * Math.min(1, dt * 8.0);
    } else if (gAfter.surface === 'ramp' && lp.y <= gAfter.y + 0.35) {
      const climbVel = (gAfter.y - lp.y) / Math.max(0.008, dt);
      lp.y = gAfter.y;
      if (climbVel > 1.5) {
        lp.vy = Math.max(lp.vy, Math.min(30, climbVel * 0.92 + (lp.characterMode === 'runner' ? 5.5 : 2.0)));
      }
      lp.grounded = true;
      lp.airborne = false;
      lp.pitch = Math.min(0.45, Math.max(0, lp.vy * 0.02));
    } else if (gBefore.surface === 'ramp' && gAfter.surface !== 'ramp' && lp.vy > 2.0) {
      // Launching off ramp lip!
      if (lp.characterMode === 'runner') lp.vy += 4.5;
      lp.airborne = true;
      lp.grounded = false;
      lp.airTime = Math.max(lp.airTime, 0.05);
      lp.vy -= gravity * dt;
      lp.y += lp.vy * dt;
    } else if (lp.y > gAfter.y + 0.06 || lp.vy > 0.25) {
      lp.airborne = true;
      lp.grounded = false;
      lp.airTime += dt;
      lp.vy -= gravity * dt;
      lp.y += lp.vy * dt;
      lp.pitch = Math.max(-0.55, Math.min(0.6, lp.vy * 0.026));

      if (lp.y <= gAfter.y && gAfter.surface !== 'water') {
        lp.y = gAfter.y;
        if (lp.airTime >= 0.45) {
          const stuntPts = Math.round(lp.airTime * 190);
          lp.score += stuntPts;
          this._emit({
            type: 'stunt_land',
            x: lp.x,
            y: lp.y,
            z: lp.z,
            airTime: lp.airTime,
            points: stuntPts,
          });
          this._emit({
            type: 'smash',
            x: lp.x,
            y: lp.y + 0.3,
            z: lp.z,
            color: '#facc15',
            intensity: 0.65,
          });
        }
        lp.vy = 0;
        lp.airborne = false;
        lp.grounded = true;
        lp.airTime = 0;
        lp.pitch = 0;
      }
    } else {
      lp.y = gAfter.y;
      lp.vy = 0;
      lp.airborne = false;
      lp.grounded = gAfter.surface !== 'water';
      lp.airTime = 0;
      lp.pitch *= Math.exp(-12 * dt);
    }

    // Water hazard check (flying Police Attack Helicopter flies cleanly over rivers!)
    if (!lp.flying && gAfter.surface === 'water' && lp.y <= -1.1) {
      lp.y = WORLD_CONFIG.WATER_Y;
      this._eliminateLocalPlayer('drowned');
      return;
    }

    // Solid building collisions (+ 3x Sugar Rush Wall-Ricochet Cushion! Flying helicopter sails cleanly over buildings!)
    if (!lp.flying && this.world?.resolveBuildingCollision) {
      const preHitX = lp.x;
      const preHitZ = lp.z;
      const preHitVx = lp.vx;
      const preHitVz = lp.vz;
      const preHitSpeed = Math.hypot(preHitVx, preHitVz);
      const hitRes = this.world.resolveBuildingCollision(lp);
      if (hitRes?.hit) {
        if (lp.sugarActive) {
          // Sugar Wall-Ricochet: bounce cleanly along wall/tangent at 0.82 speed retention with ZERO HP damage!
          let wnx = 0;
          let wnz = 0;
          if (Number.isFinite(hitRes.nx) && Number.isFinite(hitRes.nz) && Math.hypot(hitRes.nx, hitRes.nz) > 0.001) {
            const nl = Math.hypot(hitRes.nx, hitRes.nz);
            wnx = hitRes.nx / nl;
            wnz = hitRes.nz / nl;
          } else if (Math.hypot(lp.x - preHitX, lp.z - preHitZ) > 0.0001) {
            const dxP = lp.x - preHitX;
            const dzP = lp.z - preHitZ;
            const nl = Math.hypot(dxP, dzP);
            wnx = dxP / nl;
            wnz = dzP / nl;
          } else if (Math.hypot(lp.vx - preHitVx, lp.vz - preHitVz) > 0.001) {
            const dvx = lp.vx - preHitVx;
            const dvz = lp.vz - preHitVz;
            const nl = Math.hypot(dvx, dvz);
            wnx = dvx / nl;
            wnz = dvz / nl;
          } else {
            wnx = -Math.sin(lp.angle);
            wnz = -Math.cos(lp.angle);
          }

          const vDotN = preHitVx * wnx + preHitVz * wnz;
          const tanVx = preHitVx - vDotN * wnx;
          const tanVz = preHitVz - vDotN * wnz;
          const tanLen = Math.hypot(tanVx, tanVz);

          let dirX;
          let dirZ;
          if (tanLen > preHitSpeed * 0.22 && tanLen > 0.01) {
            dirX = tanVx / tanLen + wnx * 0.36;
            dirZ = tanVz / tanLen + wnz * 0.36;
          } else {
            // Head-on wall hit: deflect cleanly off normal + tangent so player never stalls into flat wall
            dirX = -wnz * 0.62 + wnx * 0.78;
            dirZ = wnx * 0.62 + wnz * 0.78;
          }
          const dirLen = Math.hypot(dirX, dirZ) || 1;
          const retainedSpeed = Math.max(preHitSpeed * 0.82, (lp.baseSpeed || 44) * 1.15);
          lp.vx = (dirX / dirLen) * (preHitSpeed > 1 ? preHitSpeed * 0.82 : retainedSpeed);
          lp.vz = (dirZ / dirLen) * (preHitSpeed > 1 ? preHitSpeed * 0.82 : retainedSpeed);
          lp.angle = lerpAngle(lp.angle, Math.atan2(lp.vx, lp.vz), 0.65);
          lp.speed = Math.hypot(lp.vx, lp.vz);

          this._emit({
            type: 'smash',
            x: lp.x,
            y: lp.y + 0.8,
            z: lp.z,
            color: '#f472b6',
            intensity: 0.9,
          });
        } else {
          const imp = hitRes.impactSpeed || 0;
          if (imp > 9) {
            this._emit({
              type: 'smash',
              x: lp.x,
              y: lp.y + 0.8,
              z: lp.z,
              color: lp.primaryColor,
              intensity: Math.min(1.2, imp / 38),
            });
          }
          if (imp > 25 && !lp.starActive && !lp.megaActive && lp._dmgCooldown <= 0) {
            const dmg = Math.max(1, Math.round(((imp - 25) * 0.38) / Math.sqrt(Math.max(0.6, lp.mass))));
            lp.hp = Math.max(0, lp.hp - dmg);
            lp._dmgCooldown = 0.38;
            if (lp.characterMode === 'runner' && imp > 30) {
              lp.ragdollTimer = 0.6;
              lp.vy = Math.max(lp.vy, 7.5);
            }
          }
          lp.speed = Math.hypot(lp.vx, lp.vz);
        }
      }
    }

    // Mario Kart Drift Sparks & Mini-Turbo state machine
    if (lp.spinOutTimer <= 0) {
      const chargingDrift =
        lp.drifting &&
        lp.grounded &&
        lp.characterMode !== 'runner' &&
        Math.abs(lp.steerInput) > 0.2 &&
        lp.speed > 18;

      if (chargingDrift) {
        lp.driftCharge = (lp.driftCharge || 0) + dt;
        lp.driftSparkTier = lp.driftCharge >= 1.55 ? 2 : lp.driftCharge >= 0.75 ? 1 : 0;
      } else if ((lp.driftSparkTier || 0) >= 1 && (!lp.drifting || Math.abs(lp.steerInput) <= 0.2)) {
        const tier = lp.driftSparkTier;
        const burstDur = tier === 2 ? 0.95 : 0.55;
        if (!lp.items) {
          lp.items = this.abilitySystem ? this.abilitySystem.createPlayerItemState() : { boostTimer: 0 };
        }
        lp.items.boostTimer = Math.max(lp.items.boostTimer || 0, burstDur);
        lp.boostTimer = lp.items.boostTimer;
        lp.boostActive = true;
        lp.score += tier * 35;

        if (!lp.sugarActive) {
          const fxB = Math.sin(lp.angle);
          const fzB = Math.cos(lp.angle);
          const curFwdB = lp.vx * fxB + lp.vz * fzB;
          const burstSpd = Math.max(curFwdB + (tier === 2 ? 16 : 10), lp.baseSpeed * (tier === 2 ? 1.38 : 1.24));
          lp.vx = fxB * burstSpd;
          lp.vz = fzB * burstSpd;
          lp.speed = Math.hypot(lp.vx, lp.vz);
        }

        this._emit({
          type: 'mini_turbo',
          tier,
          x: lp.x,
          y: lp.y,
          z: lp.z,
        });
        lp.driftCharge = 0;
        lp.driftSparkTier = 0;
      } else if (!lp.drifting || Math.abs(lp.steerInput) <= 0.2) {
        lp.driftCharge = 0;
        lp.driftSparkTier = 0;
      }
    }

    // Destructible props & gas station chain-reaction explosions! (Skipped while flying high overhead)
    if (!lp.flying && this.world?.collideProps) {
      this.world.collideProps(lp, (prop) => {
        this.comboCount = Math.min(25, this.comboCount + 1);
        this.comboTimer = 2.8;
        lp.propsSmashed += 1;
        const pts = 20 + this.comboCount * 5;
        lp.score += pts;

        this._emit({
          type: 'smash',
          propType: prop?.type || 'prop',
          x: prop?.x ?? lp.x,
          y: (prop?.y ?? 0) + 0.8,
          z: prop?.z ?? lp.z,
          color: prop?.color || '#cbd5e1',
          intensity: prop?.type === 'gas_pump' ? 1.4 : 0.65,
        });

        if (prop?.type === 'gas_pump') {
          lp.score += 300;
          if (this.abilitySystem) {
            this.abilitySystem.detonateExplosion(
              prop.x,
              (prop.y || 0) + 1.0,
              prop.z,
              15.0,
              lp.id,
              lp.name,
              lp,
              context,
              { hurtOwner: true, maxPlayerDamage: 12, instantTankKill: true }
            );
          } else {
            this._emit({
              type: 'explosion',
              x: prop.x,
              y: (prop.y || 0) + 1.0,
              z: prop.z,
              radius: 15.0,
              intensity: 1.5,
            });
          }
        }
      });
    }

    // Mario Kart '?' Item Box & Dedicated Sugar Mystery Box pickups (ground units only)
    if (!lp.flying && this.world?.collectSugarBoxes) {
      const pickedSugar = this.world.collectSugarBoxes(lp);
      if (pickedSugar > 0) {
        lp.score += 75 * pickedSugar;
        this._emit({
          type: 'pickup_box',
          sugar: true,
          playerId: lp.id,
          x: lp.x,
          y: lp.y,
          z: lp.z,
        });
        this.abilitySystem?.triggerSugarBox?.(lp, context);
      }
    }

    if (!lp.flying && !(lp.playerRole === 'cop' && lp.copVehicleId === 'cop_tank') && this.world?.collectItemBoxes) {
      const picked = this.world.collectItemBoxes(lp);
      if (picked > 0) {
        lp.score += 50 * picked;
        this._emit({
          type: 'pickup_box',
          playerId: lp.id,
          x: lp.x,
          y: lp.y + 1.0,
          z: lp.z,
        });
        this.abilitySystem?.triggerItemBox?.(lp, this._computeRankBias(lp));
      }
    }

    // Sync activeBuffs & convenience mirrors after physics / pickups / mini-turbo
    lp.heldItemId = lp.items?.heldItem || null;
    lp.sugarTimer = lp.items?.sugarTimer || 0;
    lp.sugarActive = lp.sugarTimer > 0;
    lp.boostTimer = lp.items?.boostTimer || 0;
    lp.boostActive = lp.boostTimer > 0;
    if (!lp.activeBuffs) lp.activeBuffs = {};
    lp.activeBuffs.star = Boolean(lp.starActive);
    lp.activeBuffs.mega = Boolean(lp.megaActive);
    lp.activeBuffs.boost = Boolean(lp.boostActive);
    lp.activeBuffs.sugar = Boolean(lp.sugarActive);
    lp.activeBuffs.shrunk = Boolean(lp.shrunkActive);
    lp.activeBuffs.shockwave = Boolean((lp.items?.shockwaveVisualTimer || 0) > 0);
  }

  _updateWantedStars() {
    if (this.settings.aiCopsEnabled === false) {
      this.wantedStars = 0;
      this.wantedLabel = 'AI Cops Off';
      if (this.localPlayer) {
        this.localPlayer.stars = 0;
      }
      return;
    }
    const intensity = Math.max(0.4, Number(this.settings.copIntensity) || 1.0);
    const heatTime = this.runTime * Math.sqrt(intensity) + (this.localPlayer?.copsWrecked || 0) * 3.5;
    const minStars = Math.max(1, Math.min(5, Math.round(this.settings.startStars || 1)));
    let computed = minStars;
    for (let i = 0; i < WANTED_LEVELS.length; i++) {
      if (heatTime >= WANTED_LEVELS[i].timeSec) {
        computed = Math.max(computed, WANTED_LEVELS[i].stars);
      }
    }
    if (computed > this.wantedStars) {
      this.wantedStars = computed;
      const lvl = WANTED_LEVELS[computed - 1] || WANTED_LEVELS[0];
      this.wantedLabel = lvl.label;
      if (this.localPlayer?.playerRole !== 'cop') {
        this._emit({
          type: 'star_up',
          stars: this.wantedStars,
          label: this.wantedLabel,
        });
      }
    }
    if (this.localPlayer) {
      this.localPlayer.stars = this.localPlayer.playerRole === 'cop' ? 0 : this.wantedStars;
    }
  }

  _pickNearestTargetPlayer(x, z) {
    let best =
      this.localPlayer && this.localPlayer.alive && this.localPlayer.playerRole !== 'cop'
        ? this.localPlayer
        : null;
    let bestDist = best ? Math.hypot(best.x - x, best.z - z) : Infinity;
    for (let i = 0; i < this.remotePlayers.length; i++) {
      const rp = this.remotePlayers[i];
      if (!rp || rp.alive === false || rp.playerRole === 'cop') continue;
      const d = Math.hypot(rp.x - x, rp.z - z);
      if (d < bestDist) {
        bestDist = d;
        best = rp;
      }
    }
    return best;
  }

  _findSpawnAround(focus, minDist = 55, maxDist = 92, biasAhead = false) {
    const fx = Math.sin(focus.angle || 0);
    const fz = Math.cos(focus.angle || 0);
    const centerX = biasAhead ? focus.x + fx * 28 : focus.x;
    const centerZ = biasAhead ? focus.z + fz * 28 : focus.z;
    if (this.world?.findRoadSpawnNear) {
      return this.world.findRoadSpawnNear(centerX, centerZ, minDist, maxDist);
    }
    const theta = this._rng() * Math.PI * 2;
    const r = minDist + this._rng() * (maxDist - minDist);
    return {
      x: centerX + Math.sin(theta) * r,
      z: centerZ + Math.cos(theta) * r,
      angle: theta + Math.PI,
    };
  }

  _spawnCop(focusPlayer) {
    const lvl = WANTED_LEVELS[this.wantedStars - 1] || WANTED_LEVELS[0];
    const heliCount = this.cops.filter((c) => c.type === 'heli' && !c.wrecked).length;
    const tankCount = this.cops.filter((c) => c.type === 'tank' && !c.wrecked).length;

    const candidates = lvl.types.filter((t) => {
      if (t === 'heli' && heliCount >= 2) return false;
      if (t === 'tank' && tankCount >= 2) return false;
      return true;
    });
    const type = candidates.length
      ? candidates[Math.floor(this._rng() * candidates.length)]
      : 'cruiser';
    const spec = COP_SPECS[type] || COP_SPECS.cruiser;

    const biasAhead = type !== 'heli' && this._rng() < 0.48;
    const spawn = this._findSpawnAround(focusPlayer, 56, 94, biasAhead);
    const g = this.world?.getGroundHeight ? this.world.getGroundHeight(spawn.x, spawn.z) : { y: 0, surface: 'road' };
    if (type !== 'heli' && g.surface === 'water') return null;

    let avatarId = null;
    if (this.settings.customCopsEnabled && this.copAvatarPool.length > 0 && type !== 'heli') {
      avatarId = this.copAvatarPool[Math.floor(this._rng() * this.copAvatarPool.length)];
    }

    const flankOptions = [-1, 0, 1];
    const cop = {
      id: `cop_${this._nextCopId++}`,
      type,
      avatarId,
      x: spawn.x,
      y: type === 'heli' ? 18.0 : Math.max(0, g.y || 0),
      z: spawn.z,
      vx: 0,
      vy: 0,
      vz: 0,
      speed: 0,
      angle: Math.atan2(focusPlayer.x - spawn.x, focusPlayer.z - spawn.z),
      turretAngle: 0,
      rotorAngle: 0,
      wheelSpin: 0,
      sirenPhase: this._rng() * Math.PI * 2,
      spotlightX: spawn.x,
      spotlightZ: spawn.z,
      radius: spec.radius,
      mass: spec.mass,
      hp: spec.maxHp,
      maxHp: spec.maxHp,
      baseSpeed: spec.speed * lvl.speedMult,
      accel: spec.accel,
      handling: spec.handling,
      flankSide: flankOptions[Math.floor(this._rng() * flankOptions.length)],
      leadFactor: 0.22 + this._rng() * 0.45,
      attackCooldown: 2.2 + this._rng() * 2.0,
      zapTimer: 0,
      stunTimer: 0,
      speedMultZap: 1.0,
      spinTimer: 0,
      spinVel: 0,
      wrecked: false,
      alive: true,
      wreckTimer: 0,
      scale: 1.0,
    };

    this.cops.push(cop);
    return cop;
  }

  _updateCops(dt, lp, context) {
    if (this.settings.aiCopsEnabled === false) {
      if (this.cops.length > 0) this.cops.length = 0;
      if (lp) lp.bustedProgress = 0;
      return;
    }

    const anyRunnerAlive = Boolean(this._pickNearestTargetPlayer(lp?.x || 0, lp?.z || 0));
    const lvl = WANTED_LEVELS[this.wantedStars - 1] || WANTED_LEVELS[0];
    const intensity = Math.max(0.4, Number(this.settings.copIntensity) || 1.0);
    const maxCops = anyRunnerAlive ? Math.min(22, Math.max(1, Math.round(lvl.maxCops * intensity))) : 0;
    const activeCount = this.cops.filter((c) => !c.wrecked).length;

    this._copSpawnCooldown -= dt;
    if (anyRunnerAlive && activeCount < maxCops && this._copSpawnCooldown <= 0 && lp) {
      this._spawnCop(lp);
      this._copSpawnCooldown = Math.max(0.35, 1.35 / intensity);
    }

    const gravity = 38 * (this.settings.gravityMult ?? 1.0);

    for (let i = this.cops.length - 1; i >= 0; i--) {
      const cop = this.cops[i];
      cop.sirenPhase += dt * 11;

      if (cop.wrecked) {
        cop.wreckTimer -= dt;
        cop.vy -= gravity * dt;
        cop.x += cop.vx * dt;
        cop.y += cop.vy * dt;
        cop.z += cop.vz * dt;
        cop.angle += (cop.spinVel || 10) * dt;
        const g = this.world?.getGroundHeight ? this.world.getGroundHeight(cop.x, cop.z) : { y: 0 };
        if (cop.y < (g.y || 0)) {
          cop.y = g.y || 0;
          cop.vy = Math.abs(cop.vy) * 0.32;
          cop.vx *= 0.72;
          cop.vz *= 0.72;
        }
        if (cop.wreckTimer <= 0) {
          this.cops.splice(i, 1);
        }
        continue;
      }

      const target = this._pickNearestTargetPlayer(cop.x, cop.z);
      if (!target) {
        this.cops.splice(i, 1);
        continue;
      }
      const distToFocus = lp ? Math.hypot(cop.x - lp.x, cop.z - lp.z) : 0;
      if (distToFocus > 148) {
        this.cops.splice(i, 1);
        continue;
      }

      if (cop.zapTimer > 0) {
        cop.zapTimer = Math.max(0, cop.zapTimer - dt);
        cop.shrunkTimer = cop.zapTimer;
        cop.scale = 0.55;
      } else {
        cop.shrunkTimer = 0;
        cop.speedMultZap = 1.0;
        cop.scale = 1.0;
      }
      cop.spinoutTimer = cop.spinTimer || 0;

      // Helicopter pursuit & barrel bomb drops
      if (cop.type === 'heli') {
        cop.rotorAngle += dt * 28;
        const tx = target.x + (target.vx || 0) * 0.45 - cop.x;
        const tz = target.z + (target.vz || 0) * 0.45 - cop.z;
        const d = Math.hypot(tx, tz) || 1;
        const desiredSpeed = Math.min(cop.baseSpeed * (cop.zapTimer > 0 ? 0.5 : 1.0), d * 2.2);
        const desiredVx = (tx / d) * desiredSpeed;
        const desiredVz = (tz / d) * desiredSpeed;
        cop.vx += (desiredVx - cop.vx) * Math.min(1, dt * 3.5);
        cop.vz += (desiredVz - cop.vz) * Math.min(1, dt * 3.5);
        cop.x += cop.vx * dt;
        cop.z += cop.vz * dt;
        cop.y = 18.0 + Math.sin(this.runTime * 2.5 + i) * 0.6;
        cop.angle = lerpAngle(cop.angle, Math.atan2(tx, tz), Math.min(1, dt * 4));
        cop.spotlightX = cop.x + Math.sin(cop.angle) * 5;
        cop.spotlightZ = cop.z + Math.cos(cop.angle) * 5;

        cop.attackCooldown -= dt;
        if (cop.attackCooldown <= 0 && d < 32 && target.alive !== false && cop.zapTimer <= 0) {
          cop.attackCooldown = 4.4 + this._rng() * 1.4;
          const dropX = target.x + (target.vx || 0) * 0.65;
          const dropZ = target.z + (target.vz || 0) * 0.65;
          this.hazards.push({
            id: `haz_${this.nextEntityId++}`,
            type: 'target_ring',
            x: dropX,
            y: 0.12,
            z: dropZ,
            radius: 7.5,
            ttl: 1.2,
            maxTtl: 1.2,
            color: '#ef4444',
          });
          this.abilitySystem?.spawnHazardProjectile?.({
            type: 'heli_bomb',
            kind: 'heli_bomb',
            x: cop.x,
            y: cop.y - 1.2,
            z: cop.z,
            vx: (dropX - cop.x) / 1.15,
            vy: 0,
            vz: (dropZ - cop.z) / 1.15,
            targetX: dropX,
            targetZ: dropZ,
            gravity: 27,
            blastRadius: 8.0,
            ttl: 2.2,
            color: '#f97316',
          });
        }
        continue;
      }

      // Ground cop spin-out handling
      if (cop.spinTimer > 0) {
        cop.spinTimer = Math.max(0, cop.spinTimer - dt);
        cop.angle = wrapAngle(cop.angle + 13 * dt);
        cop.vx *= Math.pow(0.28, dt);
        cop.vz *= Math.pow(0.28, dt);
      } else {
        // Intercept + flank box-in steering!
        const toTargetDist = Math.hypot(target.x - cop.x, target.z - cop.z);
        const leadSec = toTargetDist > 16 ? Math.min(0.85, (toTargetDist / 52) * cop.leadFactor) : 0.08;
        const flankOffset = toTargetDist > 12 ? cop.flankSide * 4.5 : 0;
        const tAngle = target.angle || 0;
        const aimX = target.x + (target.vx || 0) * leadSec + Math.cos(tAngle) * flankOffset;
        const aimZ = target.z + (target.vz || 0) * leadSec - Math.sin(tAngle) * flankOffset;

        const desiredAngle = Math.atan2(aimX - cop.x, aimZ - cop.z);
        const diff = wrapAngle(desiredAngle - cop.angle);
        const maxStep = cop.handling * (cop.zapTimer > 0 ? 0.55 : 1.0) * dt;
        cop.angle = wrapAngle(cop.angle + Math.max(-maxStep, Math.min(maxStep, diff)));

        const fx = Math.sin(cop.angle);
        const fz = Math.cos(cop.angle);
        const lx = Math.cos(cop.angle);
        const lz = -Math.sin(cop.angle);

        const maxSpd = cop.baseSpeed * (cop.zapTimer > 0 ? 0.5 : 1.0);
        let vFwd = cop.vx * fx + cop.vz * fz;
        let vLat = cop.vx * lx + cop.vz * lz;
        vFwd = Math.min(maxSpd, vFwd + cop.accel * dt);
        vLat *= Math.exp(-6.5 * dt);
        cop.vx = fx * vFwd + lx * vLat;
        cop.vz = fz * vFwd + lz * vLat;
      }

      // Tank turret aim & aimed tank_shell firing
      if (cop.type === 'tank') {
        const aimAng = Math.atan2(target.x - cop.x, target.z - cop.z);
        cop.turretAngle = lerpAngle(cop.turretAngle || cop.angle, aimAng, Math.min(1, dt * 4.5));
        cop.attackCooldown -= dt;
        const d = Math.hypot(target.x - cop.x, target.z - cop.z);
        if (cop.attackCooldown <= 0 && d > 14 && d < 68 && target.alive !== false && cop.zapTimer <= 0 && cop.spinTimer <= 0) {
          cop.attackCooldown = 3.8 + this._rng() * 1.2;
          const flightT = Math.max(0.55, d / 56);
          const tx = target.x + (target.vx || 0) * flightT * 0.65;
          const tz = target.z + (target.vz || 0) * flightT * 0.65;
          const grav = 24;
          const vy0 = 0.5 * grav * flightT;
          this.hazards.push({
            id: `haz_${this.nextEntityId++}`,
            type: 'target_ring',
            x: tx,
            y: 0.12,
            z: tz,
            radius: 8.5,
            ttl: flightT,
            maxTtl: flightT,
            color: '#ef4444',
          });
          this.abilitySystem?.spawnHazardProjectile?.({
            type: 'tank_shell',
            kind: 'tank_shell',
            x: cop.x + Math.sin(cop.turretAngle) * 3.2,
            y: (cop.y || 0) + 1.8,
            z: cop.z + Math.cos(cop.turretAngle) * 3.2,
            vx: (tx - cop.x) / flightT,
            vy: vy0,
            vz: (tz - cop.z) / flightT,
            targetX: tx,
            targetZ: tz,
            angle: cop.turretAngle,
            gravity: grav,
            blastRadius: 9.0,
            ttl: flightT + 0.6,
            color: '#ef4444',
          });
        }
      }

      cop.x += cop.vx * dt;
      cop.z += cop.vz * dt;
      cop.speed = Math.hypot(cop.vx, cop.vz);
      cop.wheelSpin += cop.speed * dt * 0.6;

      // Ground & river check for cops (juking cops into rivers wrecks them!)
      const g = this.world?.getGroundHeight ? this.world.getGroundHeight(cop.x, cop.z) : { y: 0, surface: 'road' };
      if (cop.y > (g.y || 0) + 0.08 || cop.vy > 0.2) {
        cop.vy -= gravity * dt;
        cop.y += cop.vy * dt;
        if (cop.y <= (g.y || 0) && g.surface !== 'water') {
          cop.y = g.y || 0;
          cop.vy = 0;
        }
      } else {
        cop.y = g.y || 0;
        cop.vy = 0;
      }

      if (g.surface === 'water' && cop.y <= -1.0) {
        this._emit({ type: 'water_splash', x: cop.x, y: WORLD_CONFIG.WATER_Y, z: cop.z });
        if (this.abilitySystem) {
          this.abilitySystem._wreckCop(cop, 0, 4, 0, lp, 'drowned', context);
        } else {
          cop.wrecked = true;
          cop.wreckTimer = 0.4;
        }
        continue;
      }

      if (this.world?.resolveBuildingCollision) {
        const wall = this.world.resolveBuildingCollision(cop);
        if (wall?.hit && wall.impactSpeed > 28 && cop.type !== 'tank') {
          cop.hp -= (wall.impactSpeed - 24) * 1.4;
          if (cop.hp <= 0 && this.abilitySystem) {
            this.abilitySystem._wreckCop(cop, cop.vx * 0.5, 14, cop.vz * 0.5, lp, 'wall_slam', context);
            continue;
          }
        }
      }

      if (this.world?.collideProps) {
        this.world.collideProps(cop, () => {});
      }

      // Cop vs Local Player collision (AI police never attack/damage fellow Police team players!)
      if (lp && lp.alive && lp.playerRole !== 'cop' && !lp.flying) {
        const pRadius = (lp.radius || 2.1) * (lp.scale || 1.0);
        const minDist = pRadius + cop.radius;
        const dx = lp.x - cop.x;
        const dz = lp.z - cop.z;
        const dist = Math.hypot(dx, dz);
        if (dist < minDist) {
          if (lp.starActive || lp.megaActive || lp.sugarActive) {
            const nx = dist > 0.001 ? dx / dist : 1;
            const nz = dist > 0.001 ? dz / dist : 0;
            const cause = lp.sugarActive && !lp.starActive && !lp.megaActive ? 'sugar_rush' : 'power_contact';
            this.abilitySystem?._wreckCop?.(cop, -nx * 44, 25, -nz * 44, lp, cause, context);
            continue;
          }

          const nx = dist > 0.001 ? dx / dist : Math.sin(lp.angle || 0);
          const nz = dist > 0.001 ? dz / dist : Math.cos(lp.angle || 0);
          const overlap = minDist - dist;
          lp.x += nx * overlap * 0.52;
          lp.z += nz * overlap * 0.52;
          cop.x -= nx * overlap * 0.48;
          cop.z -= nz * overlap * 0.48;

          const relVx = lp.vx - cop.vx;
          const relVz = lp.vz - cop.vz;
          const closing = -(relVx * nx + relVz * nz);

          if (closing > -2) {
            const pMass = lp.mass * (lp.boostActive ? 1.75 : 1.0);
            const cMass = cop.mass;
            const tot = pMass + cMass;
            const impulse = Math.max(10, closing * 1.35 + 8);

            lp.vx += nx * impulse * (cMass / tot);
            lp.vz += nz * impulse * (cMass / tot);
            cop.vx -= nx * impulse * (pMass / tot);
            cop.vz -= nz * impulse * (pMass / tot);

            // Boosted or heavy rig smashing light cops wrecks them!
            if ((lp.boostActive || lp.mass >= 1.75) && closing > 18 && cop.type !== 'tank') {
              cop.hp -= closing * 2.1 * (pMass / cMass);
              if (cop.hp <= 0 && this.abilitySystem) {
                this.abilitySystem._wreckCop(cop, -nx * 32, 18, -nz * 32, lp, 'ram', context);
                continue;
              }
            }

            // Fair arcade player damage on hard collisions (especially tanks/SWAT head-ons)
            const dmgThreshold = cop.type === 'tank' ? 14 : 23;
            if (closing > dmgThreshold && lp._dmgCooldown <= 0 && !lp.boostActive) {
              const typeScale = cop.type === 'tank' ? 0.65 : cop.type === 'army' || cop.type === 'swat' ? 0.36 : 0.24;
              const dmg = Math.max(1, Math.round((closing - dmgThreshold + 4) * typeScale));
              lp.hp = Math.max(0, lp.hp - dmg);
              lp._dmgCooldown = 0.38;
              if (lp.characterMode === 'runner' && closing > 24) {
                lp.ragdollTimer = 0.55;
                lp.vy = Math.max(lp.vy, 7);
              }
            }

            if (closing > 8) {
              this._emit({
                type: 'smash',
                x: (lp.x + cop.x) * 0.5,
                y: (lp.y || 0) + 0.8,
                z: (lp.z + cop.z) * 0.5,
                color: '#ef4444',
                intensity: Math.min(1.2, closing / 32),
              });
            }
          }
        }
      }
    }

    // Cop-to-cop separation so cruisers box in cleanly instead of stacking on one point
    for (let i = 0; i < this.cops.length; i++) {
      const a = this.cops[i];
      if (a.wrecked || a.type === 'heli') continue;
      for (let j = i + 1; j < this.cops.length; j++) {
        const b = this.cops[j];
        if (b.wrecked || b.type === 'heli') continue;
        const dx = a.x - b.x;
        const dz = a.z - b.z;
        const dist = Math.hypot(dx, dz);
        const minD = a.radius + b.radius;
        if (dist < minD && dist > 0.001) {
          const push = (minD - dist) * 0.5;
          const nx = dx / dist;
          const nz = dz / dist;
          a.x += nx * push;
          a.z += nz * push;
          b.x -= nx * push;
          b.z -= nz * push;
        }
      }
    }
  }

  _spawnTrafficCar(focusPlayer) {
    const soloCopOutlaw =
      this.localPlayer?.playerRole === 'cop' && this.remotePlayers.length === 0;
    const spec = TRAFFIC_TYPES[Math.floor(this._rng() * TRAFFIC_TYPES.length)];
    const spawn = this._findSpawnAround(focusPlayer, soloCopOutlaw ? 38 : 52, soloCopOutlaw ? 88 : 102, soloCopOutlaw);
    const g = this.world?.getGroundHeight ? this.world.getGroundHeight(spawn.x, spawn.z) : { y: 0, surface: 'road' };
    if (g.surface === 'water') return null;

    // Snap heading to clean cardinal road grid lane direction + right-hand lane offset
    const cardinals = [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5];
    const angle = cardinals[Math.floor(this._rng() * cardinals.length)];
    const laneX = spawn.x - Math.cos(angle) * 3.2;
    const laneZ = spawn.z + Math.sin(angle) * 3.2;
    const outlawColors = ['#ef4444', '#facc15', '#ec4899', '#a855f7'];
    const cruiseSpeed = soloCopOutlaw ? 36 + this._rng() * 8 : spec.speed;

    const car = {
      id: `npc_${this._nextTrafficId++}`,
      type: soloCopOutlaw ? 'sedan' : spec.type,
      kind: soloCopOutlaw ? 'sedan' : spec.type,
      isOutlaw: soloCopOutlaw,
      color: soloCopOutlaw ? outlawColors[Math.floor(this._rng() * outlawColors.length)] : spec.color,
      accentColor: soloCopOutlaw ? '#fef08a' : spec.accentColor,
      x: laneX,
      y: Math.max(0, g.y || 0),
      z: laneZ,
      vx: Math.sin(angle) * cruiseSpeed,
      vy: 0,
      vz: Math.cos(angle) * cruiseSpeed,
      speed: cruiseSpeed,
      cruiseSpeed,
      angle,
      wheelSpin: 0,
      radius: spec.radius,
      mass: spec.mass,
      panic: soloCopOutlaw,
      spinTimer: 0,
      wrecked: false,
      _flungCooldown: 0,
      _copTakedownAwarded: false,
    };
    this.traffic.push(car);
    return car;
  }

  _updateTraffic(dt, lp) {
    const density = Math.max(0, Number(this.settings.trafficDensity) ?? 1.0);
    const soloCopOutlaw =
      this.localPlayer?.playerRole === 'cop' && this.remotePlayers.length === 0;
    const maxTraffic = soloCopOutlaw ? Math.max(8, Math.round(10 * Math.max(0.8, density))) : Math.round(12 * density);
    this._trafficSpawnCooldown -= dt;
    if (this.traffic.length < maxTraffic && this._trafficSpawnCooldown <= 0 && lp) {
      this._spawnTrafficCar(lp);
      this._trafficSpawnCooldown = soloCopOutlaw ? 0.4 : 0.55;
    }

    const gravity = 38 * (this.settings.gravityMult ?? 1.0);
    for (let i = this.traffic.length - 1; i >= 0; i--) {
      const car = this.traffic[i];
      if (car.wrecked) {
        car.wreckTimer = (car.wreckTimer ?? 1.1) - dt;
        car.vy -= gravity * dt;
        car.x += car.vx * dt;
        car.y = Math.max(0, (car.y || 0) + car.vy * dt);
        car.z += car.vz * dt;
        car.angle = wrapAngle(car.angle + 12 * dt);
        if (car.wreckTimer <= 0) this.traffic.splice(i, 1);
        continue;
      }
      if (car._flungCooldown > 0) car._flungCooldown = Math.max(0, car._flungCooldown - dt);

      const distToFocus = lp ? Math.hypot(car.x - lp.x, car.z - lp.z) : 0;
      if (distToFocus > 140) {
        this.traffic.splice(i, 1);
        continue;
      }

      if (car.spinTimer > 0) {
        car.spinTimer = Math.max(0, car.spinTimer - dt);
        car.angle = wrapAngle(car.angle + 11 * dt);
        car.vx *= Math.pow(0.3, dt);
        car.vz *= Math.pow(0.3, dt);
      } else {
        const targetSpd = car.isOutlaw ? car.cruiseSpeed : car.panic ? car.cruiseSpeed * 1.45 : car.cruiseSpeed;
        const fx = Math.sin(car.angle);
        const fz = Math.cos(car.angle);
        car.vx += (fx * targetSpd - car.vx) * Math.min(1, dt * 4);
        car.vz += (fz * targetSpd - car.vz) * Math.min(1, dt * 4);
      }

      car.x += car.vx * dt;
      car.z += car.vz * dt;
      car.speed = Math.hypot(car.vx, car.vz);
      car.wheelSpin += car.speed * dt * 0.55;

      const g = this.world?.getGroundHeight ? this.world.getGroundHeight(car.x, car.z) : { y: 0, surface: 'road' };
      if (car.y > (g.y || 0) + 0.05 || car.vy > 0.2) {
        car.vy -= gravity * dt;
        car.y += car.vy * dt;
        if (car.y <= (g.y || 0) && g.surface !== 'water') {
          car.y = g.y || 0;
          car.vy = 0;
        }
      } else {
        car.y = g.y || 0;
      }

      if (g.surface === 'water' && car.y <= -1.0) {
        this.traffic.splice(i, 1);
        continue;
      }

      if (this.world?.resolveBuildingCollision) {
        const wall = this.world.resolveBuildingCollision(car);
        if (wall?.hit && car.spinTimer <= 0) {
          car.angle = wrapAngle(car.angle + Math.PI * 0.5);
        }
      }

      // Civilian traffic / Outlaw street racer vs Local Player collision (skipped when flying overhead!)
      if (lp && lp.alive && !lp.flying && Math.abs((lp.y || 0) - (car.y || 0)) <= 3.8 && !lp.starActive && !lp.megaActive) {
        const minD = (lp.radius || 2.1) * (lp.scale || 1.0) + car.radius;
        const dx = lp.x - car.x;
        const dz = lp.z - car.z;
        const dist = Math.hypot(dx, dz);
        if (dist < minD) {
          const nx = dist > 0.001 ? dx / dist : 1;
          const nz = dist > 0.001 ? dz / dist : 0;
          const isTank = lp.playerRole === 'cop' && lp.copVehicleId === 'cop_tank';
          if (lp.sugarActive || isTank) {
            // Sugar Cop-Bowling & Heavy Police Tank flatten/fling street cars without slowing down!
            car.vx = -nx * 44;
            car.vz = -nz * 44;
            car.vy = 18;
            car.spinTimer = 1.6;
            car.panic = true;
            car._flungCooldown = 0.8;
            if (lp.playerRole === 'cop' && !car._copTakedownAwarded) {
              car._copTakedownAwarded = true;
              if (car.isOutlaw) car.wrecked = true;
              lp.score += 150;
              lp.copsWrecked = (lp.copsWrecked || 0) + 1;
              this._emit({
                type: 'cop_wrecked',
                copType: 'outlaw',
                cause: 'tank_crush',
                ownerId: lp.id,
                x: car.x,
                y: (car.y || 0) + 0.9,
                z: car.z,
                points: 150,
              });
            } else {
              lp.score += 45;
            }
            this._emit({
              type: 'smash',
              x: car.x,
              y: (car.y || 0) + 0.8,
              z: car.z,
              color: lp.sugarActive ? '#f472b6' : '#facc15',
              intensity: 0.95,
            });
            continue;
          }
          const overlap = minD - dist;
          lp.x += nx * overlap * 0.4;
          lp.z += nz * overlap * 0.4;
          car.x -= nx * overlap * 0.6;
          car.z -= nz * overlap * 0.6;

          car.panic = true;
          car.spinTimer = 1.1;
          car.vx -= nx * (lp.boostActive || lp.playerRole === 'cop' ? 34 : 20);
          car.vz -= nz * (lp.boostActive || lp.playerRole === 'cop' ? 34 : 20);
          if (lp.playerRole === 'cop' && (car.isOutlaw || lp.boostActive || lp.speed > 20) && !car._copTakedownAwarded) {
            car._copTakedownAwarded = true;
            car.vy = 13;
            if (car.isOutlaw) car.wrecked = true;
            lp.score += 150;
            lp.copsWrecked = (lp.copsWrecked || 0) + 1;
            this._emit({
              type: 'cop_wrecked',
              copType: 'outlaw',
              cause: 'pit_maneuver',
              ownerId: lp.id,
              x: car.x,
              y: (car.y || 0) + 0.9,
              z: car.z,
              points: 150,
            });
          } else if (lp.boostActive) {
            car.vy = 11;
            lp.score += 35;
          } else {
            lp.vx *= 0.86;
            lp.vz *= 0.86;
          }
          this._emit({
            type: 'smash',
            x: car.x,
            y: (car.y || 0) + 0.7,
            z: car.z,
            color: car.color,
            intensity: 0.7,
          });
        }
      }
    }
  }

  _updateHazards(dt) {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      this.hazards[i].ttl -= dt;
      if (this.hazards[i].ttl <= 0) {
        this.hazards.splice(i, 1);
      }
    }
  }

  _updateBustedAndHealth(lp, dt) {
    lp.smoking = lp.hp < lp.maxHp * 0.5;
    lp.onFire = lp.hp < lp.maxHp * 0.25;

    if (lp.hp <= 0) {
      lp.hp = 0;
      this._eliminateLocalPlayer('wrecked');
      return;
    }

    if (this.settings.aiCopsEnabled === false || lp.playerRole === 'cop' || lp.flying) {
      lp.bustedProgress = 0;
      return;
    }

    // BUSTED check: speed < 6 while >= 1 active ground cop within 6.5 units (unless Star, Mega, or Sugar Rush)
    const immuneToArrest = lp.starActive || lp.megaActive || lp.sugarActive;
    if (lp.sugarActive) lp.bustedProgress = 0;
    let arrestingCops = 0;
    if (!immuneToArrest && lp.speed < 6.0) {
      for (let i = 0; i < this.cops.length; i++) {
        const cop = this.cops[i];
        if (!cop || cop.wrecked || cop.type === 'heli' || cop.spinTimer > 0.2) continue;
        const dist = Math.hypot(cop.x - lp.x, cop.z - lp.z);
        if (dist <= 6.5) {
          arrestingCops++;
        }
      }
    }

    if (arrestingCops > 0) {
      lp.bustedProgress = Math.min(1.0, lp.bustedProgress + dt / 2.3);
      if (lp.bustedProgress >= 1.0) {
        this._eliminateLocalPlayer('busted');
      }
    } else {
      lp.bustedProgress = Math.max(0, lp.bustedProgress - dt * 0.65);
    }
  }
}
