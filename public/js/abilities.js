// Mario Kart Item Box Roulette, 8 Signature Abilities, Projectiles & Multiplayer Ability Sync
import { ABILITIES } from './config.js';

const ROULETTE_DURATION = 1.15;
const ABILITY_MAP = new Map(ABILITIES.map((ab) => [ab.id, ab]));

export class AbilitySystem {
  constructor(settings = {}) {
    this.settings = { ...(settings || {}) };
    this.projectiles = [];
    this.nextProjectileId = 1;
  }

  updateSettings(settings = {}) {
    this.settings = { ...this.settings, ...(settings || {}) };
  }

  reset() {
    this.projectiles.length = 0;
  }

  getAbilityDef(abilityId) {
    return ABILITY_MAP.get(abilityId) || null;
  }

  getEnabledAbilities() {
    const enabledMap = this.settings?.enabledItems;
    if (!enabledMap) return ABILITIES.slice();
    return ABILITIES.filter((ab) => enabledMap[ab.id] !== false);
  }

  createPlayerItemState() {
    return {
      heldItem: null,
      charges: 0,
      rouletteTimer: 0,
      rouletteDisplayId: null,
      starTimer: 0,
      megaTimer: 0,
      boostTimer: 0,
      shrunkTimer: 0,
      shockwaveVisualTimer: 0,
    };
  }

  _resolveItemState(playerOrState) {
    if (!playerOrState) return null;
    if (playerOrState.items && typeof playerOrState.items === 'object') {
      return playerOrState.items;
    }
    return playerOrState;
  }

  _pickWeightedAbility(enabled, rankBias = 0) {
    if (!enabled.length) return null;
    const bias = Math.max(0, Math.min(1, Number(rankBias) || 0));
    const weights = enabled.map((ab) => {
      let w = ab.weight || 1.0;
      if (bias > 0) {
        if (ab.id === 'star_power' || ab.id === 'mega_giant' || ab.id === 'lightning_zap') {
          w *= 1 + bias * 0.95;
        } else if (ab.id === 'triple_boost' || ab.id === 'super_horn') {
          w *= 1 + bias * 0.4;
        }
      }
      return Math.max(0.05, w);
    });
    const total = weights.reduce((acc, v) => acc + v, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < enabled.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return enabled[i];
    }
    return enabled[enabled.length - 1];
  }

  triggerItemBox(playerState, rankBias = 0) {
    const items = this._resolveItemState(playerState);
    if (!items) return false;
    if (items.heldItem || items.rouletteTimer > 0) return false;

    const enabled = this.getEnabledAbilities();
    if (enabled.length === 0) return false;

    const target = this._pickWeightedAbility(enabled, rankBias);
    if (!target) return false;

    const startIdx = Math.floor(Math.random() * enabled.length);
    items.rouletteTimer = ROULETTE_DURATION;
    items.rouletteDisplayId = enabled[startIdx].id;
    Object.defineProperties(items, {
      _rouletteTargetId: { value: target.id, writable: true, configurable: true, enumerable: false },
      _rouletteTickAccum: { value: 0, writable: true, configurable: true, enumerable: false },
      _rouletteIndex: { value: startIdx, writable: true, configurable: true, enumerable: false },
    });
    return true;
  }

  updatePlayerItemState(player, dt, context = {}) {
    if (!player) return;
    if (!player.items) {
      player.items = this.createPlayerItemState();
    }
    const items = player.items;
    const enabled = this.getEnabledAbilities();

    // 1. Advance Mario Kart '?' Item Box roulette
    if (items.rouletteTimer > 0) {
      items.rouletteTimer = Math.max(0, items.rouletteTimer - dt);
      const progress = 1 - items.rouletteTimer / ROULETTE_DURATION;
      const tickInterval = 0.055 + progress * progress * 0.095;
      items._rouletteTickAccum = (items._rouletteTickAccum || 0) + dt;

      if (items.rouletteTimer > 0 && enabled.length > 0 && items._rouletteTickAccum >= tickInterval) {
        items._rouletteTickAccum = 0;
        items._rouletteIndex = ((items._rouletteIndex || 0) + 1) % enabled.length;
        items.rouletteDisplayId = enabled[items._rouletteIndex].id;
        context.onEvent?.({
          type: 'roulette_tick',
          playerId: player.id,
          abilityId: items.rouletteDisplayId,
        });
      }

      if (items.rouletteTimer <= 0) {
        const fallbackId = enabled[0]?.id || null;
        const lockedId =
          items._rouletteTargetId && enabled.some((a) => a.id === items._rouletteTargetId)
            ? items._rouletteTargetId
            : fallbackId;
        if (lockedId) {
          const def = this.getAbilityDef(lockedId);
          items.heldItem = lockedId;
          items.charges = def?.charges || 1;
          items.rouletteDisplayId = lockedId;
          context.onEvent?.({
            type: 'roulette_lock',
            playerId: player.id,
            abilityId: lockedId,
            charges: items.charges,
          });
        } else {
          items.rouletteDisplayId = null;
        }
        items._rouletteTargetId = null;
      }
    }

    // 2. Tick active timed buffs
    if (items.starTimer > 0) items.starTimer = Math.max(0, items.starTimer - dt);
    if (items.megaTimer > 0) items.megaTimer = Math.max(0, items.megaTimer - dt);
    if (items.boostTimer > 0) items.boostTimer = Math.max(0, items.boostTimer - dt);
    if (items.shrunkTimer > 0) items.shrunkTimer = Math.max(0, items.shrunkTimer - dt);
    if (items.shockwaveVisualTimer > 0) {
      items.shockwaveVisualTimer = Math.max(0, items.shockwaveVisualTimer - dt);
    }

    // Sync player-level convenience flags & visual scale
    const baseScale = player.baseScale || 1.0;
    let targetScale = baseScale;
    if (items.megaTimer > 0) {
      targetScale = baseScale * 2.3;
    } else if (items.shrunkTimer > 0) {
      targetScale = baseScale * 0.55;
    }
    const prevScale = player.scale || baseScale;
    const blend = Math.min(1, dt * 14);
    player.scale = prevScale + (targetScale - prevScale) * blend;

    player.starTimer = items.starTimer;
    player.megaTimer = items.megaTimer;
    player.boostTimer = items.boostTimer;
    player.shrunkTimer = items.shrunkTimer;
    player.starActive = items.starTimer > 0;
    player.megaActive = items.megaTimer > 0;
    player.boostActive = items.boostTimer > 0;
    player.shrunkActive = items.shrunkTimer > 0;
    player.activeBuffs = {
      star: items.starTimer > 0,
      mega: items.megaTimer > 0,
      boost: items.boostTimer > 0,
      shrunk: items.shrunkTimer > 0,
      shockwave: items.shockwaveVisualTimer > 0,
    };

    // 3. Star Power & Mega Giant contact knockouts
    if (player.alive !== false && (items.starTimer > 0 || items.megaTimer > 0)) {
      const playerRadius = (player.radius || 2.1) * (player.scale || 1.0);
      const cops = context.cops || [];
      for (let i = 0; i < cops.length; i++) {
        const cop = cops[i];
        if (!cop || cop.wrecked || cop.alive === false || cop.type === 'heli') continue;
        const dx = cop.x - player.x;
        const dz = cop.z - player.z;
        const dist = Math.hypot(dx, dz);
        const hitDist = playerRadius + (cop.radius || 2.1) + 0.65;
        if (dist <= hitDist) {
          const inv = dist > 0.001 ? 1 / dist : 1;
          const nx = dist > 0.001 ? dx * inv : Math.sin(player.angle || 0);
          const nz = dist > 0.001 ? dz * inv : Math.cos(player.angle || 0);
          this._wreckCop(cop, nx * 42, 24, nz * 42, player, items.megaTimer > 0 ? 'mega_giant' : 'star_power', context);
        }
      }

      const traffic = context.traffic || [];
      for (let i = 0; i < traffic.length; i++) {
        const car = traffic[i];
        if (!car || car.wrecked || car._flungCooldown > 0) continue;
        const dx = car.x - player.x;
        const dz = car.z - player.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= playerRadius + (car.radius || 2.0) + 0.5) {
          const inv = dist > 0.001 ? 1 / dist : 1;
          const nx = dist > 0.001 ? dx * inv : Math.sin(player.angle || 0);
          const nz = dist > 0.001 ? dz * inv : Math.cos(player.angle || 0);
          car.vx = nx * 36;
          car.vz = nz * 36;
          car.vy = 15;
          car.spinTimer = 1.6;
          car.panic = true;
          car._flungCooldown = 0.8;
          player.score = (player.score || 0) + 45;
          context.onEvent?.({
            type: 'smash',
            x: car.x,
            y: (car.y || 0) + 0.8,
            z: car.z,
            color: car.color || '#f59e0b',
            intensity: 0.85,
          });
        }
      }
    }
  }

  _wreckCop(cop, vx, vy, vz, ownerPlayer, cause, context) {
    if (!cop || cop.wrecked) return;
    cop.hp = 0;
    cop.wrecked = true;
    cop.alive = false;
    cop.vx = vx;
    cop.vy = vy;
    cop.vz = vz;
    cop.spinVel = (Math.random() < 0.5 ? -1 : 1) * 15;
    cop.wreckTimer = 1.65;

    const bonus = cop.type === 'tank' ? 350 : cop.type === 'swat' || cop.type === 'army' ? 200 : 140;
    if (ownerPlayer) {
      ownerPlayer.copsWrecked = (ownerPlayer.copsWrecked || 0) + 1;
      ownerPlayer.score = (ownerPlayer.score || 0) + bonus;
    }
    context.onEvent?.({
      type: 'cop_wrecked',
      cop,
      copType: cop.type,
      cause,
      ownerId: ownerPlayer?.id || null,
      x: cop.x,
      y: (cop.y || 0) + 0.9,
      z: cop.z,
      points: bonus,
    });
    context.onEvent?.({
      type: 'smash',
      x: cop.x,
      y: (cop.y || 0) + 0.9,
      z: cop.z,
      color: '#ef4444',
      intensity: cop.type === 'tank' ? 1.3 : 1.0,
    });
  }

  useHeldItem(player, context = {}) {
    if (!player || player.alive === false || !player.items) {
      return { used: false, abilityId: null };
    }
    const items = player.items;
    const abilityId = items.heldItem;
    if (!abilityId || items.charges <= 0) {
      return { used: false, abilityId: null };
    }

    items.charges -= 1;
    if (items.charges <= 0) {
      items.heldItem = null;
      items.charges = 0;
      items.rouletteDisplayId = null;
    }

    const angle = player.angle || 0;
    const fx = Math.sin(angle);
    const fz = Math.cos(angle);
    const pr = (player.radius || 2.1) * (player.scale || 1.0);
    const px = player.x || 0;
    const py = player.y || 0;
    const pz = player.z || 0;

    const netEvent = {
      abilityId,
      playerId: player.id || 'local',
      ownerName: player.name || 'Player',
      x: px,
      y: py,
      z: pz,
      angle,
      vx: player.vx || 0,
      vz: player.vz || 0,
    };

    switch (abilityId) {
      case 'homing_rocket': {
        const spawnX = px + fx * (pr + 2.1);
        const spawnZ = pz + fz * (pr + 2.1);
        const speed = 78;
        netEvent.x = spawnX;
        netEvent.z = spawnZ;
        this._spawnHomingShell({
          ownerId: player.id || 'local',
          ownerName: player.name || 'Player',
          ownerRef: player,
          x: spawnX,
          y: Math.max(0.65, py + 0.65),
          z: spawnZ,
          angle,
          speed,
        });
        break;
      }

      case 'triple_boost': {
        items.boostTimer = 1.65;
        player.boostTimer = 1.65;
        player.boostActive = true;
        const boostTargetSpeed = Math.max((player.maxSpeed || player.baseSpeed || 46) * 1.46, 62);
        const curFwd = (player.vx || 0) * fx + (player.vz || 0) * fz;
        const nextFwd = Math.max(curFwd + 22, boostTargetSpeed);
        player.vx = fx * nextFwd;
        player.vz = fz * nextFwd;
        player.spinOutTimer = 0;
        break;
      }

      case 'star_power': {
        items.starTimer = 8.0;
        items.shrunkTimer = 0;
        player.starTimer = 8.0;
        player.starActive = true;
        player.spinOutTimer = 0;
        player.bustedProgress = 0;
        break;
      }

      case 'mega_giant': {
        items.megaTimer = 9.0;
        items.shrunkTimer = 0;
        player.megaTimer = 9.0;
        player.megaActive = true;
        player.spinOutTimer = 0;
        player.bustedProgress = 0;
        player.scale = (player.baseScale || 1.0) * 2.3;
        break;
      }

      case 'banana_bunch': {
        const bx = px - fx * (pr + 2.3);
        const bz = pz - fz * (pr + 2.3);
        netEvent.x = bx;
        netEvent.z = bz;
        this._spawnBanana({
          ownerId: player.id || 'local',
          ownerName: player.name || 'Player',
          x: bx,
          y: Math.max(0.4, py + 0.55),
          z: bz,
          vx: -fx * 3.5,
          vy: 4.5,
          vz: -fz * 3.5,
          angle,
        });
        break;
      }

      case 'bomb_toss': {
        // Lob parabolic bouncing Bob-omb ~24 units forward, detonating on impact or after 1.4s
        const fwdSpeed = Math.max(0, (player.vx || 0) * fx + (player.vz || 0) * fz);
        const lobHoriz = 27.5 + fwdSpeed * 0.42;
        const bvx = fx * lobHoriz;
        const bvy = 16.5;
        const bvz = fz * lobHoriz;
        const sx = px + fx * (pr + 1.4);
        const sy = Math.max(1.1, py + 1.4);
        const sz = pz + fz * (pr + 1.4);
        netEvent.x = sx;
        netEvent.y = sy;
        netEvent.z = sz;
        netEvent.vx = bvx;
        netEvent.vy = bvy;
        netEvent.vz = bvz;
        this._spawnBobomb({
          ownerId: player.id || 'local',
          ownerName: player.name || 'Player',
          ownerRef: player,
          x: sx,
          y: sy,
          z: sz,
          vx: bvx,
          vy: bvy,
          vz: bvz,
          angle,
        });
        break;
      }

      case 'lightning_zap': {
        this._triggerLightning({
          ownerId: player.id || 'local',
          ownerName: player.name || 'Player',
          ownerRef: player,
          x: px,
          y: py,
          z: pz,
          context,
          isRemote: false,
        });
        break;
      }

      case 'super_horn': {
        items.shockwaveVisualTimer = 0.55;
        this._triggerSuperHorn({
          ownerId: player.id || 'local',
          ownerName: player.name || 'Player',
          ownerRef: player,
          x: px,
          y: py,
          z: pz,
          context,
          isRemote: false,
        });
        break;
      }

      default:
        break;
    }

    context.onEvent?.({
      type: 'item_used',
      abilityId,
      playerId: player.id || 'local',
      chargesLeft: items.charges,
      x: px,
      y: py,
      z: pz,
      netEvent,
    });

    return { used: true, abilityId, chargesLeft: items.charges, netEvent };
  }

  spawnNetworkAbilityEvent(event, context = {}) {
    if (!event) return;
    const payload = event.event && typeof event.event === 'object' ? event.event : event;
    const abilityId = payload.abilityId || payload.kind || payload.type;
    if (!abilityId) return;

    const ownerId = payload.playerId || event.playerId || payload.ownerId || 'remote';
    const ownerName = payload.ownerName || event.playerName || 'Rival';
    if (context.localPlayer && ownerId === context.localPlayer.id) return;

    const x = Number(payload.x) || 0;
    const y = Number(payload.y) || 0;
    const z = Number(payload.z) || 0;
    const angle = Number(payload.angle) || 0;
    const fx = Math.sin(angle);
    const fz = Math.cos(angle);

    switch (abilityId) {
      case 'homing_rocket':
        this._spawnHomingShell({
          ownerId,
          ownerName,
          ownerRef: null,
          x,
          y: Math.max(0.65, y + 0.65),
          z,
          angle,
          speed: 78,
        });
        break;

      case 'banana_bunch':
        this._spawnBanana({
          ownerId,
          ownerName,
          x,
          y: Math.max(0.4, y + 0.4),
          z,
          vx: -fx * 3.0,
          vy: 3.5,
          vz: -fz * 3.0,
          angle,
        });
        break;

      case 'bomb_toss':
        this._spawnBobomb({
          ownerId,
          ownerName,
          ownerRef: null,
          x,
          y: Math.max(1.0, y),
          z,
          vx: Number.isFinite(payload.vx) ? payload.vx : fx * 28,
          vy: Number.isFinite(payload.vy) ? payload.vy : 16.5,
          vz: Number.isFinite(payload.vz) ? payload.vz : fz * 28,
          angle,
        });
        break;

      case 'lightning_zap':
        this._triggerLightning({
          ownerId,
          ownerName,
          ownerRef: null,
          x,
          y,
          z,
          context,
          isRemote: true,
        });
        break;

      case 'super_horn':
        this._triggerSuperHorn({
          ownerId,
          ownerName,
          ownerRef: null,
          x,
          y,
          z,
          context,
          isRemote: true,
        });
        break;

      case 'star_power':
      case 'mega_giant':
      case 'triple_boost': {
        const remotes = context.remotePlayers || [];
        const match = Array.isArray(remotes)
          ? remotes.find((rp) => rp.id === ownerId)
          : remotes?.get?.(ownerId);
        if (match) {
          if (!match.items) match.items = this.createPlayerItemState();
          if (abilityId === 'star_power') match.items.starTimer = 8.0;
          if (abilityId === 'mega_giant') match.items.megaTimer = 9.0;
          if (abilityId === 'triple_boost') match.items.boostTimer = 1.65;
        }
        break;
      }

      default:
        break;
    }

    context.onEvent?.({
      type: 'remote_ability',
      abilityId,
      playerId: ownerId,
      playerName: ownerName,
      x,
      y,
      z,
    });
  }

  _spawnHomingShell({ ownerId, ownerName, ownerRef, x, y, z, angle, speed = 78 }) {
    const proj = {
      id: this.nextProjectileId++,
      type: 'homing_rocket',
      kind: 'homing_rocket',
      abilityId: 'homing_rocket',
      ownerId,
      ownerName,
      ownerRef: ownerRef || null,
      x,
      y,
      z,
      vx: Math.sin(angle) * speed,
      vy: 0,
      vz: Math.cos(angle) * speed,
      speed,
      angle,
      spin: 0,
      radius: 1.35,
      ttl: 5.5,
      maxTtl: 5.5,
      age: 0,
      color: '#ef4444',
    };
    this.projectiles.push(proj);
    return proj;
  }

  _spawnBanana({ ownerId, ownerName, x, y, z, vx = 0, vy = 4, vz = 0, angle = 0 }) {
    const proj = {
      id: this.nextProjectileId++,
      type: 'banana',
      kind: 'banana_bunch',
      abilityId: 'banana_bunch',
      ownerId,
      ownerName,
      x,
      y,
      z,
      vx,
      vy,
      vz,
      angle,
      radius: 1.35,
      armTimer: 0.22,
      ownerGraceTimer: 0.85,
      ttl: 24.0,
      maxTtl: 24.0,
      age: 0,
      grounded: false,
      color: '#eab308',
    };
    this.projectiles.push(proj);
    return proj;
  }

  _spawnBobomb({ ownerId, ownerName, ownerRef, x, y, z, vx, vy, vz, angle = 0 }) {
    const proj = {
      id: this.nextProjectileId++,
      type: 'bobomb',
      kind: 'bomb_toss',
      abilityId: 'bomb_toss',
      ownerId,
      ownerName,
      ownerRef: ownerRef || null,
      x,
      y,
      z,
      vx,
      vy,
      vz,
      angle,
      radius: 1.4,
      blastRadius: 13.0,
      fuseTimer: 1.4,
      ttl: 1.4,
      maxTtl: 1.4,
      age: 0,
      bounces: 0,
      color: '#1e293b',
    };
    this.projectiles.push(proj);
    return proj;
  }

  spawnHazardProjectile(spec) {
    const proj = {
      id: this.nextProjectileId++,
      type: spec.type || 'tank_shell',
      kind: spec.kind || spec.type || 'tank_shell',
      ownerId: spec.ownerId || 'police',
      ownerName: spec.ownerName || 'Police',
      x: spec.x || 0,
      y: spec.y ?? 1.5,
      z: spec.z || 0,
      vx: spec.vx || 0,
      vy: spec.vy || 0,
      vz: spec.vz || 0,
      targetX: spec.targetX ?? spec.x ?? 0,
      targetZ: spec.targetZ ?? spec.z ?? 0,
      angle: spec.angle || 0,
      radius: spec.radius || 1.2,
      blastRadius: spec.blastRadius || 8.5,
      gravity: spec.gravity ?? 28,
      ttl: spec.ttl || 3.2,
      maxTtl: spec.ttl || 3.2,
      age: 0,
      color: spec.color || '#ef4444',
    };
    this.projectiles.push(proj);
    return proj;
  }

  _triggerLightning({ ownerId, ownerName, ownerRef, x, y, z, context, isRemote }) {
    const zapRadius = 75;
    const cops = context.cops || [];
    let zappedCount = 0;

    // Spawn central bolt visual at caster
    this.projectiles.push({
      id: this.nextProjectileId++,
      type: 'lightning',
      kind: 'lightning_zap',
      abilityId: 'lightning_zap',
      ownerId,
      x,
      y: y + 0.5,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      angle: 0,
      radius: 2.2,
      ttl: 0.6,
      maxTtl: 0.6,
      progress: 0,
      color: '#38bdf8',
    });

    for (let i = 0; i < cops.length; i++) {
      const cop = cops[i];
      if (!cop || cop.wrecked || cop.alive === false) continue;
      const dist = Math.hypot(cop.x - x, cop.z - z);
      if (dist <= zapRadius) {
        cop.zapTimer = 6.5;
        cop.shrunkTimer = 6.5;
        cop.stunTimer = 6.5;
        cop.speedMultZap = 0.5;
        cop.vx *= 0.45;
        cop.vz *= 0.45;
        zappedCount++;
        if (zappedCount <= 8) {
          this.projectiles.push({
            id: this.nextProjectileId++,
            type: 'lightning',
            kind: 'lightning_zap',
            abilityId: 'lightning_zap',
            ownerId,
            x: cop.x,
            y: cop.y || 0,
            z: cop.z,
            vx: 0,
            vy: 0,
            vz: 0,
            angle: 0,
            radius: 1.6,
            ttl: 0.55,
            maxTtl: 0.55,
            progress: 0,
            color: '#38bdf8',
          });
        }
      }
    }

    if (ownerRef && zappedCount > 0) {
      ownerRef.score = (ownerRef.score || 0) + zappedCount * 45;
    }

    // Shrink rival players
    const remotes = Array.isArray(context.remotePlayers)
      ? context.remotePlayers
      : Array.from(context.remotePlayers?.values?.() || []);
    for (const rival of remotes) {
      if (!rival || rival.id === ownerId || rival.alive === false) continue;
      if (rival.starActive || rival.megaActive) continue;
      if (!rival.items) rival.items = this.createPlayerItemState();
      rival.items.shrunkTimer = 6.0;
      rival.shrunkTimer = 6.0;
      rival.shrunkActive = true;
    }

    const local = context.localPlayer;
    if (isRemote && local && local.id !== ownerId && local.alive !== false) {
      const protectedBuff = (local.items?.starTimer || 0) > 0 || (local.items?.megaTimer || 0) > 0;
      if (!protectedBuff) {
        if (!local.items) local.items = this.createPlayerItemState();
        local.items.shrunkTimer = 6.0;
        local.shrunkTimer = 6.0;
        local.shrunkActive = true;
        local.vx *= 0.55;
        local.vz *= 0.55;
        local.lastBumpedBy = { id: ownerId, name: ownerName, time: context.time || 0 };
        this.projectiles.push({
          id: this.nextProjectileId++,
          type: 'lightning',
          kind: 'lightning_zap',
          abilityId: 'lightning_zap',
          ownerId,
          x: local.x,
          y: local.y || 0,
          z: local.z,
          vx: 0,
          vy: 0,
          vz: 0,
          angle: 0,
          radius: 1.8,
          ttl: 0.65,
          maxTtl: 0.65,
          progress: 0,
          color: '#38bdf8',
        });
        context.onEvent?.({
          type: 'pvp_slam',
          reason: 'lightning',
          attackerId: ownerId,
          attackerName: ownerName,
          x: local.x,
          y: local.y || 0,
          z: local.z,
        });
      }
    }
  }

  _triggerSuperHorn({ ownerId, ownerName, ownerRef, x, y, z, context, isRemote }) {
    const maxRadius = 20.0;
    this.projectiles.push({
      id: this.nextProjectileId++,
      type: 'shockwave',
      kind: 'super_horn',
      abilityId: 'super_horn',
      ownerId,
      x,
      y: (y || 0) + 0.6,
      z,
      vx: 0,
      vy: 0,
      vz: 0,
      angle: 0,
      radius: 2.0,
      maxRadius,
      ttl: 0.45,
      maxTtl: 0.45,
      progress: 0,
      color: '#a855f7',
    });

    // Blast all cops within 20 units violently outward
    const cops = context.cops || [];
    for (let i = 0; i < cops.length; i++) {
      const cop = cops[i];
      if (!cop || cop.wrecked || cop.alive === false) continue;
      const dx = cop.x - x;
      const dz = cop.z - z;
      const dist = Math.hypot(dx, dz);
      if (dist <= maxRadius) {
        const inv = dist > 0.001 ? 1 / dist : 1;
        const nx = dist > 0.001 ? dx * inv : 1;
        const nz = dist > 0.001 ? dz * inv : 0;
        const falloff = 1 - (dist / maxRadius) * 0.45;
        const force = 58 * falloff;
        if (cop.type !== 'heli' && cop.type !== 'tank' && dist < 10.5) {
          this._wreckCop(cop, nx * force, 21, nz * force, ownerRef, 'super_horn', context);
        } else {
          cop.vx = nx * force;
          cop.vz = nz * force;
          if (cop.type !== 'heli') cop.vy = 16 * falloff;
          cop.spinTimer = 1.65;
          if (ownerRef) ownerRef.score = (ownerRef.score || 0) + 55;
        }
      }
    }

    // Fling nearby civilian traffic outward
    const traffic = context.traffic || [];
    for (let i = 0; i < traffic.length; i++) {
      const car = traffic[i];
      if (!car || car.wrecked) continue;
      const dx = car.x - x;
      const dz = car.z - z;
      const dist = Math.hypot(dx, dz);
      if (dist <= maxRadius) {
        const inv = dist > 0.001 ? 1 / dist : 1;
        const nx = dist > 0.001 ? dx * inv : 0;
        const nz = dist > 0.001 ? dz * inv : 1;
        const force = 48 * (1 - (dist / maxRadius) * 0.4);
        car.vx = nx * force;
        car.vz = nz * force;
        car.vy = 13;
        car.spinTimer = 1.5;
        car.panic = true;
      }
    }

    // Clear nearby bananas, incoming homing shells & tank shells
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      if (pr.type === 'shockwave' || pr.type === 'lightning') continue;
      if (pr.ownerId === ownerId && pr.type !== 'banana') continue;
      const dist = Math.hypot(pr.x - x, pr.z - z);
      if (dist <= maxRadius) {
        this.projectiles.splice(i, 1);
      }
    }

    // Blast rival / local player if in shockwave radius
    const local = context.localPlayer;
    if (isRemote && local && local.id !== ownerId && local.alive !== false) {
      const protectedBuff = (local.items?.starTimer || 0) > 0 || (local.items?.megaTimer || 0) > 0;
      const dx = local.x - x;
      const dz = local.z - z;
      const dist = Math.hypot(dx, dz);
      if (!protectedBuff && dist <= maxRadius) {
        const inv = dist > 0.001 ? 1 / dist : 1;
        const nx = dist > 0.001 ? dx * inv : 1;
        const nz = dist > 0.001 ? dz * inv : 0;
        const force = 46 * (1 - (dist / maxRadius) * 0.4);
        local.vx += nx * force;
        local.vz += nz * force;
        local.vy = Math.max(local.vy || 0, 14);
        local.spinOutTimer = Math.max(local.spinOutTimer || 0, 1.15);
        local.lastBumpedBy = { id: ownerId, name: ownerName, time: context.time || 0 };
        context.onEvent?.({
          type: 'pvp_slam',
          reason: 'super_horn',
          attackerId: ownerId,
          attackerName: ownerName,
          x: local.x,
          y: local.y || 0,
          z: local.z,
        });
      }
    }

    context.onEvent?.({
      type: 'horn',
      superHorn: true,
      x,
      y,
      z,
      intensity: 1.25,
    });
  }

  detonateExplosion(x, y, z, radius, ownerId, ownerName, ownerRef, context = {}, options = {}) {
    context.onEvent?.({
      type: 'explosion',
      x,
      y,
      z,
      radius,
      ownerId: ownerId || null,
      intensity: Math.min(1.6, radius / 9),
    });

    // Blast cops in radius
    const cops = context.cops || [];
    for (let i = 0; i < cops.length; i++) {
      const cop = cops[i];
      if (!cop || cop.wrecked || cop.alive === false || cop.type === 'heli') continue;
      const dx = cop.x - x;
      const dz = cop.z - z;
      const dist = Math.hypot(dx, dz);
      if (dist <= radius + (cop.radius || 2.0)) {
        const inv = dist > 0.001 ? 1 / dist : 1;
        const nx = dist > 0.001 ? dx * inv : 0.7;
        const nz = dist > 0.001 ? dz * inv : 0.7;
        const force = 44 * (1 - Math.min(0.65, dist / (radius + 3)));
        if (cop.type === 'tank' && dist > radius * 0.65 && !options.instantTankKill) {
          cop.hp = Math.max(0, (cop.hp || 180) - 110);
          cop.vx += nx * force * 0.6;
          cop.vz += nz * force * 0.6;
          if (cop.hp <= 0) {
            this._wreckCop(cop, nx * force, 20, nz * force, ownerRef, 'explosion', context);
          }
        } else {
          this._wreckCop(cop, nx * force, 23, nz * force, ownerRef, 'explosion', context);
        }
      }
    }

    // Launch civilian traffic in radius
    const traffic = context.traffic || [];
    for (let i = 0; i < traffic.length; i++) {
      const car = traffic[i];
      if (!car || car.wrecked) continue;
      const dx = car.x - x;
      const dz = car.z - z;
      const dist = Math.hypot(dx, dz);
      if (dist <= radius + (car.radius || 2.0)) {
        const inv = dist > 0.001 ? 1 / dist : 1;
        const nx = dist > 0.001 ? dx * inv : 1;
        const nz = dist > 0.001 ? dz * inv : 0;
        car.vx = nx * 38;
        car.vz = nz * 38;
        car.vy = 16;
        car.spinTimer = 1.7;
        car.panic = true;
      }
    }

    // Affect localPlayer if inside blast (for enemy bombs, tank shells, heli bombs, gas pumps)
    const local = context.localPlayer;
    if (local && local.alive !== false) {
      const isSelfBomb = ownerId && ownerId === local.id && !options.hurtOwner;
      const protectedBuff = (local.items?.starTimer || 0) > 0 || (local.items?.megaTimer || 0) > 0;
      const dx = local.x - x;
      const dz = local.z - z;
      const dist = Math.hypot(dx, dz);
      if (!isSelfBomb && !protectedBuff && dist <= radius + (local.radius || 2.0)) {
        const inv = dist > 0.001 ? 1 / dist : 1;
        const nx = dist > 0.001 ? dx * inv : Math.sin(local.angle || 0);
        const nz = dist > 0.001 ? dz * inv : Math.cos(local.angle || 0);
        const falloff = Math.max(0.25, 1 - dist / (radius + 3));
        local.vx += nx * 30 * falloff;
        local.vz += nz * 30 * falloff;
        local.vy = Math.max(local.vy || 0, 12 * falloff);
        const maxDmg = options.maxPlayerDamage ?? 22;
        if (!local._dmgCooldown || local._dmgCooldown <= 0) {
          local.hp = Math.max(0, local.hp - Math.round(maxDmg * falloff));
          local._dmgCooldown = 0.45;
        }
        if (ownerId && ownerId !== local.id && ownerId !== 'police' && ownerId !== 'world') {
          local.lastBumpedBy = { id: ownerId, name: ownerName || 'Rival', time: context.time || 0 };
        }
      }
    }
  }

  _collectTargetCandidates(ownerId, context) {
    const candidates = [];
    const cops = context.cops || [];
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i];
      if (!c || c.wrecked || c.alive === false || c.type === 'heli') continue;
      candidates.push({ kind: 'cop', entity: c });
    }
    const remotes = Array.isArray(context.remotePlayers)
      ? context.remotePlayers
      : Array.from(context.remotePlayers?.values?.() || []);
    for (let i = 0; i < remotes.length; i++) {
      const rp = remotes[i];
      if (!rp || rp.id === ownerId || rp.alive === false) continue;
      candidates.push({ kind: 'player', entity: rp });
    }
    if (context.localPlayer && context.localPlayer.id !== ownerId && context.localPlayer.alive !== false) {
      candidates.push({ kind: 'player', entity: context.localPlayer });
    }
    return candidates;
  }

  updateProjectiles(dt, context = {}) {
    const world = context.world;
    const cops = context.cops || [];

    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const proj = this.projectiles[i];
      proj.age = (proj.age || 0) + dt;
      proj.ttl -= dt;
      if (proj.ttl <= 0) {
        if (proj.type === 'bobomb' || proj.type === 'tank_shell' || proj.type === 'heli_bomb') {
          this.detonateExplosion(
            proj.x,
            proj.y,
            proj.z,
            proj.blastRadius || 12,
            proj.ownerId,
            proj.ownerName,
            proj.ownerRef,
            context
          );
        }
        this.projectiles.splice(i, 1);
        continue;
      }

      if (proj.type === 'shockwave') {
        const progress = 1 - proj.ttl / (proj.maxTtl || 0.45);
        proj.progress = Math.max(0, Math.min(1, progress));
        proj.radius = 2.0 + (proj.maxRadius - 2.0) * proj.progress;
        continue;
      }

      if (proj.type === 'lightning') {
        proj.progress = 1 - proj.ttl / (proj.maxTtl || 0.6);
        continue;
      }

      if (proj.type === 'homing_rocket' || proj.type === 'homing_shell') {
        proj.spin = (proj.spin || 0) + dt * 22;
        const speed = proj.speed || 78;
        const dirLen = Math.hypot(proj.vx, proj.vz) || 1;
        let dxNorm = proj.vx / dirLen;
        let dzNorm = proj.vz / dirLen;

        // Track nearest cop or nearest alive rival player if closer / in front
        const candidates = this._collectTargetCandidates(proj.ownerId, context);
        let best = null;
        let bestScore = Infinity;
        for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
          const cand = candidates[cIdx];
          const tx = cand.entity.x - proj.x;
          const tz = cand.entity.z - proj.z;
          const dist = Math.hypot(tx, tz);
          if (dist > 98 || dist < 0.01) continue;
          const dot = (tx / dist) * dxNorm + (tz / dist) * dzNorm;
          const frontWeight = dot > 0.2 ? 0.68 : dot > -0.25 ? 0.95 : 1.35;
          const rivalWeight = cand.kind === 'player' && dot > 0.15 ? 0.88 : 1.0;
          const score = dist * frontWeight * rivalWeight;
          if (score < bestScore) {
            bestScore = score;
            best = cand;
          }
        }

        if (best) {
          const tx = best.entity.x - proj.x;
          const tz = best.entity.z - proj.z;
          const targetAngle = Math.atan2(tx, tz);
          let diff = targetAngle - proj.angle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const maxTurn = 9.5 * dt;
          proj.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));
          dxNorm = Math.sin(proj.angle);
          dzNorm = Math.cos(proj.angle);
          proj.vx = dxNorm * speed;
          proj.vz = dzNorm * speed;
        }

        proj.x += proj.vx * dt;
        proj.z += proj.vz * dt;
        const g = world?.getGroundHeight ? world.getGroundHeight(proj.x, proj.z) : { y: 0 };
        proj.y = Math.max(0.55, (g.y || 0) + 0.65);

        if (world?.resolveBuildingCollision) {
          const wall = world.resolveBuildingCollision(proj);
          if (wall?.hit) {
            this.detonateExplosion(proj.x, proj.y, proj.z, 6.5, proj.ownerId, proj.ownerName, proj.ownerRef, context);
            this.projectiles.splice(i, 1);
            continue;
          }
        }

        // Check impact with cops or rival players
        let hitSomething = false;
        for (let cIdx = 0; cIdx < cops.length; cIdx++) {
          const cop = cops[cIdx];
          if (!cop || cop.wrecked || cop.alive === false || cop.type === 'heli') continue;
          if (Math.hypot(cop.x - proj.x, cop.z - proj.z) <= proj.radius + (cop.radius || 2.0)) {
            this._wreckCop(cop, dxNorm * 32, 27, dzNorm * 32, proj.ownerRef, 'homing_rocket', context);
            this.detonateExplosion(proj.x, proj.y, proj.z, 7.5, proj.ownerId, proj.ownerName, proj.ownerRef, context);
            hitSomething = true;
            break;
          }
        }

        if (!hitSomething) {
          const local = context.localPlayer;
          if (local && local.id !== proj.ownerId && local.alive !== false) {
            const dist = Math.hypot(local.x - proj.x, local.z - proj.z);
            if (dist <= proj.radius + (local.radius || 2.0) * (local.scale || 1)) {
              const protectedBuff = (local.items?.starTimer || 0) > 0 || (local.items?.megaTimer || 0) > 0;
              if (!protectedBuff) {
                local.vx += dxNorm * 32;
                local.vz += dzNorm * 32;
                local.vy = 19;
                local.spinOutTimer = 1.35;
                local.lastBumpedBy = { id: proj.ownerId, name: proj.ownerName || 'Rival', time: context.time || 0 };
                context.onEvent?.({
                  type: 'pvp_slam',
                  reason: 'homing_rocket',
                  attackerId: proj.ownerId,
                  attackerName: proj.ownerName,
                  x: local.x,
                  y: local.y || 0,
                  z: local.z,
                });
              }
              this.detonateExplosion(proj.x, proj.y, proj.z, 7.0, proj.ownerId, proj.ownerName, null, context);
              hitSomething = true;
            }
          }
        }

        if (!hitSomething) {
          const remotes = Array.isArray(context.remotePlayers)
            ? context.remotePlayers
            : Array.from(context.remotePlayers?.values?.() || []);
          for (const rp of remotes) {
            if (!rp || rp.id === proj.ownerId || rp.alive === false) continue;
            if (Math.hypot(rp.x - proj.x, rp.z - proj.z) <= proj.radius + (rp.radius || 2.0)) {
              this.detonateExplosion(proj.x, proj.y, proj.z, 7.0, proj.ownerId, proj.ownerName, proj.ownerRef, context);
              hitSomething = true;
              break;
            }
          }
        }

        if (hitSomething) {
          this.projectiles.splice(i, 1);
        }
        continue;
      }

      if (proj.type === 'banana') {
        if (proj.armTimer > 0) proj.armTimer = Math.max(0, proj.armTimer - dt);
        if (proj.ownerGraceTimer > 0) proj.ownerGraceTimer = Math.max(0, proj.ownerGraceTimer - dt);

        const g = world?.getGroundHeight ? world.getGroundHeight(proj.x, proj.z) : { y: 0, surface: 'road' };
        const floorY = (g.y || 0) + 0.35;
        if (!proj.grounded) {
          proj.vy -= 32 * dt;
          proj.x += proj.vx * dt;
          proj.y += proj.vy * dt;
          proj.z += proj.vz * dt;
          if (proj.y <= floorY) {
            proj.y = floorY;
            proj.vx = 0;
            proj.vy = 0;
            proj.vz = 0;
            proj.grounded = true;
          }
        } else {
          proj.y = floorY;
        }

        if (g.surface === 'water' && proj.y <= -1.0) {
          this.projectiles.splice(i, 1);
          continue;
        }

        if (proj.armTimer <= 0) {
          let triggered = false;
          for (let cIdx = 0; cIdx < cops.length; cIdx++) {
            const cop = cops[cIdx];
            if (!cop || cop.wrecked || cop.alive === false || cop.type === 'heli') continue;
            if (Math.hypot(cop.x - proj.x, cop.z - proj.z) <= proj.radius + (cop.radius || 2.0)) {
              cop.spinTimer = 1.6;
              cop.vx *= 0.48;
              cop.vz *= 0.48;
              cop.spinVel = 15;
              context.onEvent?.({
                type: 'smash',
                x: cop.x,
                y: (cop.y || 0) + 0.5,
                z: cop.z,
                color: '#eab308',
                intensity: 0.7,
              });
              triggered = true;
              break;
            }
          }

          if (!triggered && context.localPlayer && context.localPlayer.alive !== false) {
            const lp = context.localPlayer;
            const sameOwnerBlocked = lp.id === proj.ownerId && proj.ownerGraceTimer > 0;
            if (!sameOwnerBlocked) {
              const dist = Math.hypot(lp.x - proj.x, lp.z - proj.z);
              if (dist <= proj.radius + (lp.radius || 2.0) * (lp.scale || 1)) {
                const protectedBuff = (lp.items?.starTimer || 0) > 0 || (lp.items?.megaTimer || 0) > 0;
                if (!protectedBuff) {
                  lp.spinOutTimer = 1.6;
                  lp.vx *= 0.62;
                  lp.vz *= 0.62;
                  if (proj.ownerId && proj.ownerId !== lp.id) {
                    lp.lastBumpedBy = { id: proj.ownerId, name: proj.ownerName || 'Rival', time: context.time || 0 };
                  }
                  context.onEvent?.({
                    type: 'pvp_slam',
                    reason: 'banana',
                    attackerId: proj.ownerId,
                    attackerName: proj.ownerName,
                    x: lp.x,
                    y: lp.y || 0,
                    z: lp.z,
                  });
                }
                triggered = true;
              }
            }
          }

          if (!triggered && Array.isArray(context.remotePlayers)) {
            for (let rIdx = 0; rIdx < context.remotePlayers.length; rIdx++) {
              const rp = context.remotePlayers[rIdx];
              if (!rp || rp.alive === false) continue;
              if (rp.id === proj.ownerId && proj.ownerGraceTimer > 0) continue;
              if (Math.hypot(rp.x - proj.x, rp.z - proj.z) <= proj.radius + (rp.radius || 2.0) * (rp.scale || 1)) {
                triggered = true;
                break;
              }
            }
          }

          if (triggered) {
            this.projectiles.splice(i, 1);
          }
        }
        continue;
      }

      if (proj.type === 'bobomb') {
        proj.fuseTimer -= dt;
        proj.vy -= 38 * dt;
        proj.x += proj.vx * dt;
        proj.y += proj.vy * dt;
        proj.z += proj.vz * dt;
        proj.angle += dt * 7;

        const g = world?.getGroundHeight ? world.getGroundHeight(proj.x, proj.z) : { y: 0 };
        const floorY = (g.y || 0) + 0.6;
        if (proj.y <= floorY) {
          proj.y = floorY;
          proj.vy = Math.abs(proj.vy) * 0.48;
          proj.vx *= 0.76;
          proj.vz *= 0.76;
          proj.bounces = (proj.bounces || 0) + 1;
        }

        if (world?.resolveBuildingCollision) {
          world.resolveBuildingCollision(proj);
        }

        let directImpact = proj.fuseTimer <= 0;
        if (!directImpact && proj.age >= 0.14) {
          for (let cIdx = 0; cIdx < cops.length; cIdx++) {
            const cop = cops[cIdx];
            if (!cop || cop.wrecked || cop.alive === false || cop.type === 'heli') continue;
            if (Math.hypot(cop.x - proj.x, cop.z - proj.z) <= proj.radius + (cop.radius || 2.0)) {
              directImpact = true;
              break;
            }
          }
        }

        if (directImpact) {
          this.detonateExplosion(
            proj.x,
            proj.y,
            proj.z,
            proj.blastRadius || 13.0,
            proj.ownerId,
            proj.ownerName,
            proj.ownerRef,
            context
          );
          this.projectiles.splice(i, 1);
        }
        continue;
      }

      if (proj.type === 'tank_shell' || proj.type === 'heli_bomb') {
        proj.vy -= (proj.gravity ?? 28) * dt;
        proj.x += proj.vx * dt;
        proj.y += proj.vy * dt;
        proj.z += proj.vz * dt;
        const g = world?.getGroundHeight ? world.getGroundHeight(proj.x, proj.z) : { y: 0 };
        if (proj.y <= (g.y || 0) + 0.35) {
          this.detonateExplosion(
            proj.x,
            g.y || 0,
            proj.z,
            proj.blastRadius || 8.5,
            'police',
            'Police',
            null,
            context,
            { maxPlayerDamage: proj.type === 'tank_shell' ? 24 : 18 }
          );
          this.projectiles.splice(i, 1);
        }
      }
    }
  }

  getProjectiles() {
    return this.projectiles;
  }
}
