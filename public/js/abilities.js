// Mario Kart Item Box Roulette, 9 Signature Abilities, Cop 2s Soft-Tracking Missiles, Projectiles & Multiplayer Sync
import { ABILITIES, WORLD_CONFIG, clampDropRatePct } from './config.js';

const COP_MISSILE_COOLDOWN = 2.0;
export const COP_MISSILE_SPEED = 104;
export const RPG_ROCKET_SPEED = 104;
const COP_MISSILE_TTL = 3.4;
const COP_MISSILE_TURN_RATE = 1.15; // Gentle <= 1.15 rad/s tracking so runners can juke/dodge!
const COP_MISSILE_CONE_DOT = 0.52;
const COP_MISSILE_BREAK_DIST = 10.0; // Stops homing inside 10m horizontal distance!
const COP_MISSILE_BLAST_RADIUS = 5.8;
const COP_MISSILE_DAMAGE = 36;

export const NUKE_COUNTDOWN_SEC = 5.0;

const ROULETTE_DURATION = 1.15;
const SUGAR_ROULETTE_DURATION = 0.5;
const ABILITY_MAP = new Map(ABILITIES.map((ab) => [ab.id, ab]));

export class AbilitySystem {
  constructor(settings = {}) {
    this.settings = { ...(settings || {}) };
    this.projectiles = [];
    this.nextProjectileId = 1;
    this._targetIdMap = new WeakMap();
    this._nextAutoTargetId = 1;
  }

  _getEntityId(entity) {
    if (!entity || typeof entity !== 'object') return null;
    if (entity.id != null) return entity.id;
    let autoId = this._targetIdMap.get(entity);
    if (!autoId) {
      autoId = `auto_tgt_${this._nextAutoTargetId++}`;
      this._targetIdMap.set(entity, autoId);
    }
    return autoId;
  }

  updateSettings(settings = {}) {
    this.settings = { ...this.settings, ...(settings || {}) };
  }

  _getScaledMissileSpeed(baseSpeed = COP_MISSILE_SPEED) {
    const speedMult = Number(this.settings?.speedMult) || 1.0;
    return Math.round(baseSpeed * Math.max(1.0, Math.min(1.25, speedMult * 0.85)));
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
  }

  _resolveItemState(playerOrState) {
    if (!playerOrState) return null;
    if (playerOrState.items && typeof playerOrState.items === 'object') {
      return playerOrState.items;
    }
    return playerOrState;
  }

  _pickWeightedAbility(enabled, rankBias = 0, playerState = null) {
    if (!enabled || !enabled.length) return null;
    const bias = Math.max(0, Math.min(1, Number(rankBias) || 0));
    const itemWeights = this.settings?.itemWeights;
    const nukeKillDouble = this.settings?.nukeKillDoubleOdds !== false;
    const playerKills = Math.max(0, Math.floor(Number(playerState?.playerKills) || 0));
    const weights = enabled.map((ab) => {
      const rateMult = clampDropRatePct(itemWeights?.[ab.id] ?? 100) / 100;
      let w = (ab.weight || 1.0) * rateMult;
      if (ab.id === 'tactical_nuke' && nukeKillDouble && playerKills > 0) {
        w *= Math.pow(2, Math.min(8, playerKills));
      }
      if (bias > 0) {
        if (ab.id === 'star_power' || ab.id === 'mega_giant' || ab.id === 'lightning_zap') {
          w *= 1 + bias * 0.95;
        } else if (ab.id === 'sugar_rush') {
          w *= 1 + bias * 0.65;
        } else if (ab.id === 'triple_boost' || ab.id === 'super_horn') {
          w *= 1 + bias * 0.4;
        }
      }
      return Math.max(0, w);
    });
    const total = weights.reduce((acc, v) => acc + v, 0);
    if (!(total > 0)) {
      return enabled[Math.floor(Math.random() * enabled.length)];
    }
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

    const target = this._pickWeightedAbility(enabled, rankBias, playerState);
    if (!target) return false;

    const startIdx = Math.floor(Math.random() * enabled.length);
    items.rouletteTimer = ROULETTE_DURATION;
    items.rouletteDisplayId = enabled[startIdx].id;
    items.forcedResultId = null;
    Object.defineProperties(items, {
      _rouletteTargetId: { value: target.id, writable: true, configurable: true, enumerable: false },
      _rouletteDuration: { value: ROULETTE_DURATION, writable: true, configurable: true, enumerable: false },
      _rouletteTickAccum: { value: 0, writable: true, configurable: true, enumerable: false },
      _rouletteIndex: { value: startIdx, writable: true, configurable: true, enumerable: false },
    });
    return true;
  }

  triggerSugarBox(playerState, context = {}) {
    const items = this._resolveItemState(playerState);
    if (!items) return false;
    const isPlayerEntity = Boolean(playerState && playerState.items === items);

    // Creative feel-good bonus: if already holding an item (or mid-spin), grant an instant 2.2s Sugar Surge
    // right away without overwriting their held item so hitting a Sugar Box ALWAYS feels exhilarating!
    if (items.heldItem || items.rouletteTimer > 0) {
      items.sugarTimer = Math.max(items.sugarTimer || 0, 2.2);
      items.shrunkTimer = 0;
      if (isPlayerEntity) {
        playerState.sugarTimer = items.sugarTimer;
        playerState.sugarActive = true;
        playerState.spinOutTimer = 0;
        playerState.bustedProgress = 0;
        if (playerState.activeBuffs) playerState.activeBuffs.sugar = true;
        const ang = playerState.angle || 0;
        const fx = Math.sin(ang);
        const fz = Math.cos(ang);
        const curFwd = (playerState.vx || 0) * fx + (playerState.vz || 0) * fz;
        const surgeFwd = Math.max(curFwd + 42, (playerState.baseSpeed || 46) * 2.15);
        playerState.vx = fx * surgeFwd;
        playerState.vz = fz * surgeFwd;
        playerState.speed = Math.hypot(playerState.vx, playerState.vz);
        context?.onEvent?.({
          type: 'sugar_surge',
          playerId: playerState.id || 'local',
          duration: 2.2,
          x: playerState.x || 0,
          y: playerState.y || 0,
          z: playerState.z || 0,
        });
      }
      return { mode: 'surge', sugarTimer: items.sugarTimer };
    }

    // Empty slot: start fast 0.5s Sugar roulette locked onto 'sugar_rush'!
    const enabled = this.getEnabledAbilities();
    const startIdx = enabled.length > 0 ? Math.floor(Math.random() * enabled.length) : 0;
    items.rouletteTimer = SUGAR_ROULETTE_DURATION;
    items.forcedResultId = 'sugar_rush';
    items.rouletteDisplayId = enabled.length > 0 ? enabled[startIdx].id : 'sugar_rush';
    Object.defineProperties(items, {
      _rouletteTargetId: { value: 'sugar_rush', writable: true, configurable: true, enumerable: false },
      _rouletteDuration: { value: SUGAR_ROULETTE_DURATION, writable: true, configurable: true, enumerable: false },
      _rouletteTickAccum: { value: 0, writable: true, configurable: true, enumerable: false },
      _rouletteIndex: { value: startIdx, writable: true, configurable: true, enumerable: false },
    });
    return { mode: 'roulette', abilityId: 'sugar_rush' };
  }

  updatePlayerItemState(player, dt, context = {}) {
    if (!player) return;
    if (!player.items) {
      player.items = this.createPlayerItemState();
    }
    const items = player.items;
    const enabled = this.getEnabledAbilities();

    // 1. Advance Mario Kart '?' / Sugar Item Box roulette
    if (items.rouletteTimer > 0) {
      const totalDur = items._rouletteDuration || ROULETTE_DURATION;
      items.rouletteTimer = Math.max(0, items.rouletteTimer - dt);
      const progress = 1 - items.rouletteTimer / totalDur;
      const tickInterval = 0.05 + progress * progress * 0.085;
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
        const forcedId =
          items.forcedResultId && ABILITY_MAP.has(items.forcedResultId)
            ? items.forcedResultId
            : null;
        const lockedTargetValid =
          items._rouletteTargetId && enabled.some((a) => a.id === items._rouletteTargetId);
        const lockedId = forcedId
          ? forcedId
          : lockedTargetValid
            ? items._rouletteTargetId
            : this._pickWeightedAbility(enabled, 0, player)?.id || enabled[0]?.id || null;
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
        items.forcedResultId = null;
        items._rouletteTargetId = null;
        items._rouletteDuration = ROULETTE_DURATION;
      }
    }

    // 2. Tick active timed buffs
    if (items.starTimer > 0) items.starTimer = Math.max(0, items.starTimer - dt);
    if (items.megaTimer > 0) items.megaTimer = Math.max(0, items.megaTimer - dt);
    if (items.boostTimer > 0) items.boostTimer = Math.max(0, items.boostTimer - dt);
    if (items.sugarTimer > 0) items.sugarTimer = Math.max(0, items.sugarTimer - dt);
    if (items.shrunkTimer > 0) items.shrunkTimer = Math.max(0, items.shrunkTimer - dt);
    if (items.shockwaveVisualTimer > 0) {
      items.shockwaveVisualTimer = Math.max(0, items.shockwaveVisualTimer - dt);
    }
    if (items.nukeSafeTimer > 0) {
      items.nukeSafeTimer = Math.max(0, items.nukeSafeTimer - dt);
    }
    if (player.copMissileCooldown === undefined) {
      player.copMissileCooldown = Number(items.copMissileCooldown) || 0;
    }
    if (
      this.settings?.instantCopMissileReload &&
      player.playerRole === 'cop' &&
      (player.copVehicleId === 'cop_heli' || player.copVehicleId === 'cop_tank')
    ) {
      player.copMissileCooldown = 0;
      items.copMissileCooldown = 0;
    } else if (player.copMissileCooldown > 0) {
      player.copMissileCooldown = Math.max(0, player.copMissileCooldown - dt);
    } else {
      player.copMissileCooldown = 0;
    }
    items.copMissileCooldown = player.copMissileCooldown;

    if (items.sugarTimer > 0) {
      player.spinOutTimer = 0;
      player.bustedProgress = 0;
    }
    if (player.playerRole === 'cop' && player.copVehicleId === 'cop_tank') {
      player.spinOutTimer = 0;
    }

    // Sync player-level convenience flags & visual scale
    const baseScale = player.baseScale || 1.0;
    let targetScale = baseScale;
    if (items.megaTimer > 0) {
      targetScale = baseScale * 2.3;
    } else if (items.shrunkTimer > 0 && items.sugarTimer <= 0) {
      targetScale = baseScale * 0.55;
    }
    const prevScale = player.scale || baseScale;
    const blend = Math.min(1, dt * 14);
    player.scale = prevScale + (targetScale - prevScale) * blend;

    player.heldItemId = items.heldItem;
    player.starTimer = items.starTimer;
    player.megaTimer = items.megaTimer;
    player.boostTimer = items.boostTimer;
    player.sugarTimer = items.sugarTimer;
    player.shrunkTimer = items.shrunkTimer;
    player.starActive = items.starTimer > 0;
    player.megaActive = items.megaTimer > 0;
    player.boostActive = items.boostTimer > 0;
    player.sugarActive = items.sugarTimer > 0;
    player.shrunkActive = items.shrunkTimer > 0;
    player.activeBuffs = {
      star: items.starTimer > 0,
      mega: items.megaTimer > 0,
      boost: items.boostTimer > 0,
      sugar: items.sugarTimer > 0,
      shrunk: items.shrunkTimer > 0,
      shockwave: items.shockwaveVisualTimer > 0,
    };

    // 3. Star Power, Mega Giant & 3x Sugar Rush Cop-Bowling contact knockouts
    if (player.alive !== false && (items.starTimer > 0 || items.megaTimer > 0 || items.sugarTimer > 0)) {
      const isSugarOnly = items.sugarTimer > 0 && items.starTimer <= 0 && items.megaTimer <= 0;
      const copPad = items.sugarTimer > 0 ? 0.8 : 0.65;
      const trafficPad = items.sugarTimer > 0 ? 0.8 : 0.5;
      const playerRadius = (player.radius || 2.1) * (player.scale || 1.0);
      const cops = player.playerRole === 'cop' ? [] : context.cops || [];
      for (let i = 0; i < cops.length; i++) {
        const cop = cops[i];
        if (!cop || cop.wrecked || cop.alive === false || cop.type === 'heli') continue;
        const dx = cop.x - player.x;
        const dz = cop.z - player.z;
        const dist = Math.hypot(dx, dz);
        const hitDist = playerRadius + (cop.radius || 2.1) + copPad;
        if (dist <= hitDist) {
          const inv = dist > 0.001 ? 1 / dist : 1;
          const nx = dist > 0.001 ? dx * inv : Math.sin(player.angle || 0);
          const nz = dist > 0.001 ? dz * inv : Math.cos(player.angle || 0);
          const cause =
            items.megaTimer > 0 ? 'mega_giant' : items.starTimer > 0 ? 'star_power' : 'sugar_rush';
          const flingH = isSugarOnly ? 48 : 42;
          const flingV = isSugarOnly ? 26 : 24;
          this._wreckCop(cop, nx * flingH, flingV, nz * flingH, player, cause, context);
        }
      }

      const traffic = context.traffic || [];
      for (let i = 0; i < traffic.length; i++) {
        const car = traffic[i];
        if (!car || car.wrecked || car._flungCooldown > 0) continue;
        const dx = car.x - player.x;
        const dz = car.z - player.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= playerRadius + (car.radius || 2.0) + trafficPad) {
          const inv = dist > 0.001 ? 1 / dist : 1;
          const nx = dist > 0.001 ? dx * inv : Math.sin(player.angle || 0);
          const nz = dist > 0.001 ? dz * inv : Math.cos(player.angle || 0);
          car.vx = nx * (isSugarOnly ? 44 : 36);
          car.vz = nz * (isSugarOnly ? 44 : 36);
          car.vy = isSugarOnly ? 18 : 15;
          car.spinTimer = 1.6;
          car.panic = true;
          car._flungCooldown = 0.8;
          player.score = (player.score || 0) + 45;
          context.onEvent?.({
            type: 'smash',
            x: car.x,
            y: (car.y || 0) + 0.8,
            z: car.z,
            color: isSugarOnly ? '#f472b6' : car.color || '#f59e0b',
            intensity: isSugarOnly ? 0.95 : 0.85,
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

  fireCopMissile(player, context = {}) {
    if (!player || player.alive === false) {
      return { used: false, fired: false, abilityId: null };
    }
    const copUnit = player.copVehicleId || 'cop_heli';
    const isMissileUnit = copUnit === 'cop_heli' || copUnit === 'cop_tank';
    const instantReload = Boolean(this.settings?.instantCopMissileReload) && isMissileUnit;
    if (!instantReload && (player.copMissileCooldown || 0) > 0) {
      return {
        used: false,
        fired: false,
        abilityId: null,
        cooldownLeft: player.copMissileCooldown,
      };
    }

    if (!player.items) {
      player.items = this.createPlayerItemState();
    }

    // Ground Cruiser & SWAT: 2.0s-cooldown Siren Surge speed burst when item slot is empty!
    if (copUnit === 'cop_cruiser' || copUnit === 'cop_swat') {
      player.copMissileCooldown = COP_MISSILE_COOLDOWN;
      player.items.copMissileCooldown = COP_MISSILE_COOLDOWN;
      player.items.boostTimer = Math.max(player.items.boostTimer || 0, 0.85);
      player.boostTimer = player.items.boostTimer;
      player.boostActive = true;
      player.spinOutTimer = 0;
      if (player.activeBuffs) player.activeBuffs.boost = true;

      const angle = player.angle || 0;
      const fx = Math.sin(angle);
      const fz = Math.cos(angle);
      const curFwd = (player.vx || 0) * fx + (player.vz || 0) * fz;
      const surgeFwd = Math.max(curFwd + 20, (player.baseSpeed || 48) * 1.38);
      player.vx = fx * surgeFwd;
      player.vz = fz * surgeFwd;
      player.speed = Math.hypot(player.vx, player.vz);

      const netEvent = {
        abilityId: 'cop_siren_surge',
        playerId: player.id || 'local',
        ownerName: player.name || 'Officer',
        x: player.x || 0,
        y: player.y || 0,
        z: player.z || 0,
        angle,
      };
      context.onEvent?.({
        type: 'item_used',
        abilityId: 'cop_siren_surge',
        playerId: player.id || 'local',
        chargesLeft: 0,
        cooldown: COP_MISSILE_COOLDOWN,
        x: player.x || 0,
        y: player.y || 0,
        z: player.z || 0,
        netEvent,
      });
      return {
        used: true,
        fired: false,
        abilityId: 'cop_siren_surge',
        chargesLeft: 0,
        cooldown: COP_MISSILE_COOLDOWN,
        netEvent,
      };
    }

    // Attack Helicopter & Police Tank: 2.0s cooldown (or 0s instant reload when enabled!)
    const sourceUnit = copUnit === 'cop_tank' ? 'tank' : 'heli';
    const appliedCooldown = instantReload ? 0 : COP_MISSILE_COOLDOWN;
    player.copMissileCooldown = appliedCooldown;
    if (player.items) player.items.copMissileCooldown = appliedCooldown;

    const px = Number(player.x) || 0;
    const pz = Number(player.z) || 0;
    const launchAngle =
      sourceUnit === 'tank' && Number.isFinite(player.turretAngle)
        ? player.turretAngle
        : Number(player.angle) || 0;
    const fx = Math.sin(launchAngle);
    const fz = Math.cos(launchAngle);
    const g = context.world?.getGroundHeight ? context.world.getGroundHeight(px, pz) : { y: 0 };
    const groundY = Number.isFinite(player.groundY) ? player.groundY : g.y || 0;

    let sx;
    let sy;
    let sz;
    let vy = 0;
    const missileSpeed = this._getScaledMissileSpeed(COP_MISSILE_SPEED);

    if (sourceUnit === 'tank') {
      sx = px + fx * 3.8;
      sz = pz + fz * 3.8;
      sy = Math.max(1.1, (Number.isFinite(player.y) ? player.y : groundY) + 1.35);
      vy = 0;
    } else {
      sx = px + fx * 2.15;
      sz = pz + fz * 2.15;
      const heliY = Number.isFinite(player.y) && player.y > 2 ? player.y : Math.max(groundY + 10.5, 11.5);
      sy = Math.max(groundY + 2.5, heliY - 0.55);

      const lockCand = this._pickInitialCopMissileTarget(sx, sz, launchAngle, player.id || 'local', context);
      const aimDist = lockCand ? Math.max(15, Math.min(78, lockCand.dist)) : 36;
      const targetFloorY = lockCand ? (lockCand.entity.y || 0) + 0.9 : groundY + 0.9;
      const estFlightT = Math.max(0.24, aimDist / missileSpeed);
      vy = Math.max(-42, Math.min(-3.0, (targetFloorY - sy) / estFlightT));
    }

    const vx = fx * missileSpeed;
    const vz = fz * missileSpeed;

    const proj = this._spawnCopMissile({
      ownerId: player.id || 'local',
      ownerName: player.name || 'Officer',
      ownerRole: player.playerRole || 'cop',
      ownerRef: player,
      sourceUnit,
      x: sx,
      y: sy,
      z: sz,
      vx,
      vy,
      vz,
      speed: missileSpeed,
      angle: launchAngle,
      context,
    });

    const netEvent = {
      abilityId: 'cop_missile',
      sourceUnit,
      playerId: player.id || 'local',
      ownerName: player.name || 'Officer',
      x: sx,
      y: sy,
      z: sz,
      vx,
      vy,
      vz,
      speed: missileSpeed,
      angle: launchAngle,
    };

    context.onEvent?.({
      type: 'item_used',
      abilityId: 'cop_missile',
      sourceUnit,
      playerId: player.id || 'local',
      chargesLeft: 0,
      cooldown: appliedCooldown,
      x: sx,
      y: sy,
      z: sz,
      netEvent,
    });

    return {
      used: true,
      fired: true,
      abilityId: 'cop_missile',
      sourceUnit,
      chargesLeft: 0,
      cooldown: appliedCooldown,
      projectile: proj,
      netEvent,
    };
  }

  useHeldItem(player, context = {}) {
    if (!player || player.alive === false) {
      return { used: false, abilityId: null };
    }
    if (player.playerRole === 'cop') {
      const copUnit = player.copVehicleId || 'cop_heli';
      if (copUnit === 'cop_heli' || copUnit === 'cop_tank') {
        return this.fireCopMissile(player, context);
      }
      if (!player.items?.heldItem || (player.items?.charges || 0) <= 0) {
        return this.fireCopMissile(player, context);
      }
    }
    if (!player.items) {
      return { used: false, abilityId: null };
    }
    const items = player.items;
    const abilityId = items.heldItem;
    if (!abilityId || items.charges <= 0) {
      return { used: false, abilityId: null };
    }

    const angle = player.angle || 0;
    const fx = Math.sin(angle);
    const fz = Math.cos(angle);
    const pr = (player.radius || 2.1) * (player.scale || 1.0);
    const px = player.x || 0;
    const py = player.y || 0;
    const pz = player.z || 0;

    let resolvedNuke = null;
    if (abilityId === 'tactical_nuke') {
      resolvedNuke = this._resolveNukeTarget({
        ownerId: player.id || 'local',
        targetId: context.targetId || null,
        targetKind: context.targetKind || null,
        isParty: context.isParty,
        px,
        pz,
        fx,
        fz,
        context,
      });
      if (!resolvedNuke) {
        context.onEvent?.({
          type: 'nuke_no_target',
          playerId: player.id || 'local',
        });
        return { used: false, reason: 'no_real_target', abilityId: 'tactical_nuke' };
      }
    }

    items.charges -= 1;
    if (items.charges <= 0) {
      items.heldItem = null;
      items.charges = 0;
      items.rouletteDisplayId = null;
    }
    player.heldItemId = items.heldItem;

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
      case 'tactical_nuke': {
        items.nukeSafeTimer = 6.5;
        const dropX = resolvedNuke.x ?? px + fx * 22;
        const dropZ = resolvedNuke.z ?? pz + fz * 22;
        const dropY = resolvedNuke.groundY ?? (py || 0);
        netEvent.targetId = resolvedNuke.targetId || null;
        netEvent.targetKind = resolvedNuke.targetKind || 'point';
        netEvent.targetName = resolvedNuke.targetName || 'Target';
        netEvent.dropX = dropX;
        netEvent.dropY = dropY;
        netEvent.dropZ = dropZ;
        this._spawnTacticalNuke({
          ownerId: player.id || 'local',
          ownerName: player.name || 'Player',
          ownerRef: player,
          targetId: resolvedNuke.targetId || null,
          targetKind: resolvedNuke.targetKind || 'point',
          targetName: resolvedNuke.targetName || 'Target',
          x: dropX,
          groundY: dropY,
          z: dropZ,
          context,
        });
        break;
      }

      case 'homing_rocket': {
        netEvent.twinRpg = true;
        netEvent.playerRadius = pr;
        this._spawnTwinRpg({
          ownerId: player.id || 'local',
          ownerName: player.name || 'Player',
          ownerRef: player,
          x: px,
          y: py,
          z: pz,
          angle,
          playerRadius: pr,
          context,
        });
        break;
      }

      case 'sugar_rush': {
        items.sugarTimer = 4.5;
        items.shrunkTimer = 0;
        player.sugarTimer = 4.5;
        player.sugarActive = true;
        player.spinOutTimer = 0;
        player.bustedProgress = 0;
        if (player.activeBuffs) player.activeBuffs.sugar = true;
        const curFwd = (player.vx || 0) * fx + (player.vz || 0) * fz;
        const nextFwd = Math.max(curFwd + 55, (player.baseSpeed || 46) * 2.35);
        player.vx = fx * nextFwd;
        player.vz = fz * nextFwd;
        player.speed = Math.hypot(player.vx, player.vz);
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
      case 'tactical_nuke': {
        const targetId = payload.targetId || null;
        const targetKind = payload.targetKind || (targetId ? 'player' : 'point');
        let targetName = payload.targetName || 'Target';
        let dropX = Number.isFinite(Number(payload.dropX)) ? Number(payload.dropX) : x;
        let dropY = Number.isFinite(Number(payload.dropY)) ? Number(payload.dropY) : y;
        let dropZ = Number.isFinite(Number(payload.dropZ)) ? Number(payload.dropZ) : z;

        if (targetId) {
          let liveEnt = null;
          if (
            context.localPlayer &&
            String(context.localPlayer.id) === String(targetId) &&
            context.localPlayer.alive !== false
          ) {
            liveEnt = context.localPlayer;
          } else {
            const remotes = Array.isArray(context.remotePlayers)
              ? context.remotePlayers
              : Array.from(context.remotePlayers?.values?.() || []);
            liveEnt =
              remotes.find((rp) => rp && String(rp.id) === String(targetId) && rp.alive !== false) || null;
          }
          if (liveEnt) {
            dropX = liveEnt.x;
            dropY = liveEnt.y || 0;
            dropZ = liveEnt.z;
            if (!payload.targetName && liveEnt.name) {
              targetName = liveEnt.name;
            }
          }
        }

        this._spawnTacticalNuke({
          ownerId,
          ownerName,
          ownerRef: null,
          targetId,
          targetKind,
          targetName,
          x: dropX,
          groundY: dropY,
          z: dropZ,
          context,
        });
        break;
      }

      case 'homing_rocket':
      case 'rpg_rocket':
        if (payload.twinRpg === false) {
          this._spawnHomingShell({
            ownerId,
            ownerName,
            ownerRef: null,
            x,
            y: Math.max(0.65, y + 0.65),
            z,
            angle,
            speed: this._getScaledMissileSpeed(RPG_ROCKET_SPEED),
          });
        } else {
          this._spawnTwinRpg({
            ownerId,
            ownerName,
            ownerRef: null,
            x,
            y,
            z,
            angle,
            playerRadius: Number(payload.playerRadius) || 2.1,
            context,
          });
        }
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

      case 'cop_missile': {
        const srcUnit = payload.sourceUnit === 'tank' ? 'tank' : 'heli';
        const missileSpeed =
          Number.isFinite(Number(payload.speed)) && Number(payload.speed) > 0
            ? Number(payload.speed)
            : this._getScaledMissileSpeed(COP_MISSILE_SPEED);
        this._spawnCopMissile({
          ownerId,
          ownerName,
          ownerRole: 'cop',
          ownerRef: null,
          sourceUnit: srcUnit,
          x,
          y: Number.isFinite(Number(payload.y)) ? Number(payload.y) : srcUnit === 'heli' ? 11.0 : 1.4,
          z,
          vx: Number.isFinite(Number(payload.vx)) ? Number(payload.vx) : fx * missileSpeed,
          vy: Number.isFinite(Number(payload.vy)) ? Number(payload.vy) : srcUnit === 'heli' ? -14.0 : 0,
          vz: Number.isFinite(Number(payload.vz)) ? Number(payload.vz) : fz * missileSpeed,
          speed: missileSpeed,
          angle,
          context,
        });
        break;
      }

      case 'cop_surge':
      case 'cop_siren_surge':
      case 'star_power':
      case 'mega_giant':
      case 'triple_boost':
      case 'sugar_rush': {
        const remotes = context.remotePlayers || [];
        const match = Array.isArray(remotes)
          ? remotes.find((rp) => rp.id === ownerId)
          : remotes?.get?.(ownerId);
        if (match) {
          if (!match.items) match.items = this.createPlayerItemState();
          if (!match.activeBuffs) match.activeBuffs = {};
          if (abilityId === 'star_power') {
            match.items.starTimer = 8.0;
            match.starTimer = 8.0;
            match.starActive = true;
            match.activeBuffs.star = true;
          }
          if (abilityId === 'mega_giant') {
            match.items.megaTimer = 9.0;
            match.megaTimer = 9.0;
            match.megaActive = true;
            match.activeBuffs.mega = true;
          }
          if (abilityId === 'triple_boost' || abilityId === 'cop_siren_surge' || abilityId === 'cop_surge') {
            const dur = abilityId === 'cop_siren_surge' || abilityId === 'cop_surge' ? 0.85 : 1.65;
            match.items.boostTimer = dur;
            match.boostTimer = dur;
            match.boostActive = true;
            match.activeBuffs.boost = true;
          }
          if (abilityId === 'sugar_rush') {
            match.items.sugarTimer = 4.5;
            match.sugarTimer = 4.5;
            match.sugarActive = true;
            match.activeBuffs.sugar = true;
          }
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

  _pickTopTwoTargets(x, z, angle, ownerId, context = {}) {
    const candidates = this._collectTargetCandidates(ownerId, context);
    if (candidates.length === 0) return [null, null];

    const fx = Math.sin(angle);
    const fz = Math.cos(angle);
    const scored = [];

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      const ent = cand.entity;
      if (!ent) continue;
      const tx = ent.x - x;
      const tz = ent.z - z;
      const dist = Math.hypot(tx, tz);
      if (dist > 140 || dist < 0.01) continue;
      const dot = (tx / dist) * fx + (tz / dist) * fz;
      if (dot <= -0.35) continue;

      const frontWeight = dot > 0.3 ? 0.66 : dot > 0.0 ? 0.86 : 1.15;
      const rivalWeight = cand.kind === 'player' && dot > 0.15 ? 0.88 : 1.0;
      scored.push({
        entity: ent,
        kind: cand.kind,
        dist,
        dot,
        score: dist * frontWeight * rivalWeight,
      });
    }

    scored.sort((a, b) => a.score - b.score);
    const first = scored[0]?.entity || null;
    const second = scored[1]?.entity || first;
    return [first, second];
  }

  _spawnTwinRpg({ ownerId, ownerName, ownerRef, x, y, z, angle = 0, playerRadius = 2.1, context = {} }) {
    const fx = Math.sin(angle);
    const fz = Math.cos(angle);
    const perpX = Math.cos(angle);
    const perpZ = -Math.sin(angle);
    const fwdDist = playerRadius + 1.85;
    const baseY = Math.max(0.85, (y || 0) + 1.05);

    const [target1, target2] = this._pickTopTwoTargets(x, z, angle, ownerId, context);
    const barrels = [
      { lateral: -1.15, barrelSide: -1, spread: -0.09, target: target1 },
      { lateral: 1.15, barrelSide: 1, spread: 0.09, target: target2 },
    ];

    const rocketSpeed = this._getScaledMissileSpeed(RPG_ROCKET_SPEED);
    const spawned = [];
    for (let i = 0; i < barrels.length; i++) {
      const b = barrels[i];
      const sx = x + fx * fwdDist + perpX * b.lateral;
      const sz = z + fz * fwdDist + perpZ * b.lateral;
      const launchAngle = angle + b.spread;
      spawned.push(
        this._spawnRpgRocket({
          ownerId,
          ownerName,
          ownerRef,
          x: sx,
          y: baseY,
          z: sz,
          angle: launchAngle,
          speed: rocketSpeed,
          turnRate: 7.2,
          blastRadius: 9.5,
          barrelSide: b.barrelSide,
          preferredTarget: b.target,
        })
      );
    }
    return spawned;
  }

  _spawnRpgRocket({
    ownerId,
    ownerName,
    ownerRef,
    x,
    y,
    z,
    angle = 0,
    speed = RPG_ROCKET_SPEED,
    turnRate = 7.2,
    blastRadius = 9.5,
    barrelSide = -1,
    preferredTarget = null,
  }) {
    const preferredTargetId = preferredTarget ? this._getEntityId(preferredTarget) : null;
    const proj = {
      id: this.nextProjectileId++,
      type: 'rpg_rocket',
      kind: 'homing_rocket',
      abilityId: 'homing_rocket',
      barrelSide,
      preferredTargetId,
      preferredTarget: preferredTarget || null,
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
      turnRate,
      blastRadius,
      angle,
      spin: 0,
      radius: 1.4,
      ttl: 5.5,
      maxTtl: 5.5,
      age: 0,
      color: '#ef4444',
    };
    this.projectiles.push(proj);
    return proj;
  }

  _spawnHomingShell({ ownerId, ownerName, ownerRef, x, y, z, angle, speed = RPG_ROCKET_SPEED }) {
    return this._spawnRpgRocket({
      ownerId,
      ownerName,
      ownerRef,
      x,
      y,
      z,
      angle,
      speed,
      turnRate: 7.2,
      blastRadius: 9.5,
      barrelSide: 0,
      preferredTarget: null,
    });
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
      if (
        pr.type === 'shockwave' ||
        pr.type === 'lightning' ||
        pr.type === 'tactical_nuke' ||
        pr.type === 'nuke_cloud'
      ) {
        continue;
      }
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

    // Blast cops in radius (unless fired by a friendly Cop player!)
    const cops = options.skipAiCops ? [] : context.cops || [];
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

    // Launch civilian traffic & outlaw street racers in radius
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
        if (options.isCopAttack && !car._copTakedownAwarded) {
          car._copTakedownAwarded = true;
          car.wrecked = Boolean(car.isOutlaw);
          if (ownerRef) {
            ownerRef.score = (ownerRef.score || 0) + 150;
            ownerRef.copsWrecked = (ownerRef.copsWrecked || 0) + 1;
          }
          context.onEvent?.({
            type: 'cop_wrecked',
            copType: 'outlaw',
            cause: 'cop_missile',
            ownerId: ownerId || null,
            x: car.x,
            y: (car.y || 0) + 0.9,
            z: car.z,
            points: 150,
          });
        }
      }
    }

    // Affect localPlayer if inside blast (for enemy bombs, cop missiles, tank shells, heli bombs, gas pumps)
    const local = context.localPlayer;
    if (local && local.alive !== false) {
      const isSelfBomb = ownerId && ownerId === local.id && !options.hurtOwner;
      const protectedBuff = (local.items?.starTimer || 0) > 0 || (local.items?.megaTimer || 0) > 0;
      const dx = local.x - x;
      const dz = local.z - z;
      const yd = Math.abs((local.y || 0) - (y || 0));
      const dist = Math.hypot(dx, dz);
      if (!isSelfBomb && !protectedBuff && yd <= radius + 4.5 && dist <= radius + (local.radius || 2.0)) {
        const inv = dist > 0.001 ? 1 / dist : 1;
        const nx = dist > 0.001 ? dx * inv : Math.sin(local.angle || 0);
        const nz = dist > 0.001 ? dz * inv : Math.cos(local.angle || 0);
        const falloff = options.directHitPlayer === local ? 1.0 : Math.max(0.35, 1 - dist / (radius + 3));
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
          if (options.isCopAttack) {
            context.onEvent?.({
              type: 'pvp_slam',
              reason: 'cop_missile',
              attackerId: ownerId,
              attackerName: ownerName || 'Officer',
              x: local.x,
              y: local.y || 0,
              z: local.z,
            });
          }
        }
      }
    }
  }

  _collectCopMissileTargets(ownerId, context = {}) {
    const out = [];
    const remotes = Array.isArray(context.remotePlayers)
      ? context.remotePlayers
      : Array.from(context.remotePlayers?.values?.() || []);
    for (let i = 0; i < remotes.length; i++) {
      const rp = remotes[i];
      if (!rp || rp.id === ownerId || rp.alive === false) continue;
      out.push({
        kind: 'player',
        priority: rp.playerRole !== 'cop' ? 0.72 : 1.05,
        entity: rp,
      });
    }
    if (context.localPlayer && context.localPlayer.id !== ownerId && context.localPlayer.alive !== false) {
      const lp = context.localPlayer;
      out.push({
        kind: 'player',
        priority: lp.playerRole !== 'cop' ? 0.72 : 1.05,
        entity: lp,
      });
    }
    const traffic = context.traffic || [];
    const hasPlayerTargets = out.length > 0;
    for (let i = 0; i < traffic.length; i++) {
      const car = traffic[i];
      if (!car || car.wrecked) continue;
      if (hasPlayerTargets && !car.isOutlaw) continue;
      out.push({
        kind: 'traffic',
        priority: car.isOutlaw ? 0.85 : 1.35,
        entity: car,
      });
    }
    return out;
  }

  _pickInitialCopMissileTarget(x, z, angle, ownerId, context = {}) {
    const candidates = this._collectCopMissileTargets(ownerId, context);
    if (candidates.length === 0) return null;
    const fx = Math.sin(angle);
    const fz = Math.cos(angle);
    let best = null;
    let bestScore = Infinity;

    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i];
      const ent = cand.entity;
      if (!ent) continue;
      const tx = ent.x - x;
      const tz = ent.z - z;
      const dist = Math.hypot(tx, tz);
      if (dist <= COP_MISSILE_BREAK_DIST || dist > 95) continue;
      const dot = (tx / dist) * fx + (tz / dist) * fz;
      if (dot <= COP_MISSILE_CONE_DOT) continue;
      const score = dist * cand.priority * (1.25 - dot * 0.35);
      if (score < bestScore) {
        bestScore = score;
        best = { entity: ent, dist, dot };
      }
    }
    return best;
  }

  _spawnCopMissile({
    ownerId,
    ownerName,
    ownerRole = 'cop',
    ownerRef = null,
    sourceUnit = 'heli',
    x,
    y,
    z,
    vx,
    vy = 0,
    vz,
    speed = null,
    angle = 0,
    context = {},
  }) {
    const missileSpeed =
      Number.isFinite(Number(speed)) && Number(speed) > 0
        ? Number(speed)
        : this._getScaledMissileSpeed(COP_MISSILE_SPEED);
    const initTarget = this._pickInitialCopMissileTarget(x, z, angle, ownerId, context);
    const proj = {
      id: this.nextProjectileId++,
      type: 'cop_missile',
      kind: 'cop_missile',
      abilityId: 'cop_missile',
      sourceUnit: sourceUnit === 'tank' ? 'tank' : 'heli',
      ownerId,
      ownerName,
      ownerRole,
      ownerRef: ownerRef || null,
      x,
      y,
      z,
      vx,
      vy,
      vz,
      speed: missileSpeed,
      turnRate: COP_MISSILE_TURN_RATE,
      maxTurnRate: COP_MISSILE_TURN_RATE,
      coneDot: COP_MISSILE_CONE_DOT,
      breakLockDist: COP_MISSILE_BREAK_DIST,
      lockBroken: false,
      preferredTargetId: initTarget ? this._getEntityId(initTarget.entity) : null,
      blastRadius: COP_MISSILE_BLAST_RADIUS,
      damage: COP_MISSILE_DAMAGE,
      angle,
      pitch: Math.atan2(vy || 0, missileSpeed),
      spin: 0,
      radius: 1.35,
      ttl: COP_MISSILE_TTL,
      maxTtl: COP_MISSILE_TTL,
      age: 0,
      color: '#38bdf8',
    };
    // Safety cap: keep cop_missile <= 48 and total projectiles <= 96 for smooth 60fps during rapid tapping
    while (this.projectiles.length >= 96) {
      const oldestIdx = this.projectiles.findIndex((p) => p?.type === 'cop_missile');
      if (oldestIdx === -1) break;
      this.projectiles.splice(oldestIdx, 1);
    }
    let copMissileCount = 0;
    let oldestCopMissileIdx = -1;
    for (let i = 0; i < this.projectiles.length; i++) {
      if (this.projectiles[i]?.type === 'cop_missile') {
        if (oldestCopMissileIdx === -1) oldestCopMissileIdx = i;
        copMissileCount++;
      }
    }
    while (copMissileCount >= 48 && oldestCopMissileIdx !== -1) {
      this.projectiles.splice(oldestCopMissileIdx, 1);
      copMissileCount--;
      oldestCopMissileIdx = this.projectiles.findIndex((p) => p?.type === 'cop_missile');
    }
    this.projectiles.push(proj);
    return proj;
  }

  _findLiveEntityById(targetId, context = {}) {
    if (!targetId) return null;
    const tid = String(targetId);
    if (context.localPlayer && String(context.localPlayer.id) === tid && context.localPlayer.alive !== false) {
      return context.localPlayer;
    }
    const remotes = Array.isArray(context.remotePlayers)
      ? context.remotePlayers
      : Array.from(context.remotePlayers?.values?.() || []);
    for (let i = 0; i < remotes.length; i++) {
      const rp = remotes[i];
      if (rp && String(rp.id) === tid && rp.alive !== false) return rp;
    }
    const cops = context.cops || [];
    for (let i = 0; i < cops.length; i++) {
      const c = cops[i];
      if (!c || c.wrecked || c.alive === false) continue;
      if (String(c.id ?? this._getEntityId(c)) === tid) return c;
    }
    const traffic = context.traffic || [];
    for (let i = 0; i < traffic.length; i++) {
      const t = traffic[i];
      if (!t || t.wrecked || t.alive === false) continue;
      if (String(t.id ?? this._getEntityId(t)) === tid) return t;
    }
    return null;
  }

  _resolveNukeTarget({ ownerId, targetId = null, targetKind = null, isParty, px = 0, pz = 0, fx = 0, fz = 1, context = {} }) {
    const remotes = Array.isArray(context.remotePlayers)
      ? context.remotePlayers
      : Array.from(context.remotePlayers?.values?.() || []);
    const partyMode =
      isParty !== undefined
        ? Boolean(isParty)
        : context.isParty !== undefined
          ? Boolean(context.isParty)
          : remotes.length > 0;

    const alivePlayers = [];
    for (let i = 0; i < remotes.length; i++) {
      const rp = remotes[i];
      if (!rp || rp.id === ownerId || rp.alive === false) continue;
      alivePlayers.push(rp);
    }
    if (
      context.localPlayer &&
      context.localPlayer.id !== ownerId &&
      context.localPlayer.alive !== false &&
      !alivePlayers.some((p) => p.id === context.localPlayer.id)
    ) {
      alivePlayers.push(context.localPlayer);
    }

    if (partyMode) {
      // Party mode NEVER targets AI cops or traffic NPCs!
      if (targetKind === 'cop' || targetKind === 'traffic') {
        return null;
      }
      if (targetId) {
        const tid = String(targetId);
        const match = alivePlayers.find((p) => String(p.id) === tid);
        if (match) {
          return {
            entity: match,
            targetId: match.id,
            targetKind: 'player',
            targetName: match.name || 'Rival',
            x: match.x,
            z: match.z,
            groundY: match.y || 0,
          };
        }
        return null;
      }
      if (alivePlayers.length === 0) {
        return null;
      }
      let nearest = alivePlayers[0];
      let bestDist = Math.hypot((nearest.x || 0) - px, (nearest.z || 0) - pz);
      for (let i = 1; i < alivePlayers.length; i++) {
        const cand = alivePlayers[i];
        const d = Math.hypot((cand.x || 0) - px, (cand.z || 0) - pz);
        if (d < bestDist) {
          bestDist = d;
          nearest = cand;
        }
      }
      return {
        entity: nearest,
        targetId: nearest.id,
        targetKind: 'player',
        targetName: nearest.name || 'Rival',
        x: nearest.x,
        z: nearest.z,
        groundY: nearest.y || 0,
      };
    }

    // Solo mode: allow targeting alive AI cops or civilian traffic NPCs, with forward point fallback
    const copNames = {
      cruiser: 'Police Cruiser',
      suv: 'Police SUV',
      swat: 'SWAT Truck',
      heli: 'Police Heli',
      army: 'Army Truck',
      tank: 'Police Tank',
    };
    const cops = (context.cops || []).filter((c) => c && !c.wrecked && c.alive !== false);
    const traffic = (context.traffic || []).filter((t) => t && !t.wrecked && t.alive !== false);

    const makeCopTarget = (c) => {
      const cid = String(c.id ?? this._getEntityId(c));
      return {
        entity: c,
        targetId: cid,
        targetKind: 'cop',
        targetName: c.name || copNames[c.type] || 'Police Car',
        x: c.x,
        z: c.z,
        groundY: c.y || 0,
      };
    };
    const makeTrafficTarget = (t) => {
      const tid = String(t.id ?? this._getEntityId(t));
      return {
        entity: t,
        targetId: tid,
        targetKind: 'traffic',
        targetName: t.name || (t.isOutlaw ? 'Outlaw Racer' : 'Traffic Car'),
        x: t.x,
        z: t.z,
        groundY: t.y || 0,
      };
    };

    if (targetId) {
      const tid = String(targetId);
      if (targetKind !== 'traffic') {
        const copMatch = cops.find((c) => String(c.id ?? this._getEntityId(c)) === tid);
        if (copMatch) return makeCopTarget(copMatch);
      }
      if (targetKind !== 'cop') {
        const trafficMatch = traffic.find((t) => String(t.id ?? this._getEntityId(t)) === tid);
        if (trafficMatch) return makeTrafficTarget(trafficMatch);
      }
    }

    if (cops.length > 0) {
      let bestCop = cops[0];
      let bestDist = Math.hypot((bestCop.x || 0) - px, (bestCop.z || 0) - pz);
      for (let i = 1; i < cops.length; i++) {
        const d = Math.hypot((cops[i].x || 0) - px, (cops[i].z || 0) - pz);
        if (d < bestDist) {
          bestDist = d;
          bestCop = cops[i];
        }
      }
      return makeCopTarget(bestCop);
    }

    if (traffic.length > 0) {
      let bestCar = traffic[0];
      let bestDist = Math.hypot((bestCar.x || 0) - px, (bestCar.z || 0) - pz);
      for (let i = 1; i < traffic.length; i++) {
        const d = Math.hypot((traffic[i].x || 0) - px, (traffic[i].z || 0) - pz);
        if (d < bestDist) {
          bestDist = d;
          bestCar = traffic[i];
        }
      }
      return makeTrafficTarget(bestCar);
    }

    const dropX = px + fx * 22;
    const dropZ = pz + fz * 22;
    const g = context.world?.getGroundHeight ? context.world.getGroundHeight(dropX, dropZ) : { y: 0 };
    return {
      entity: null,
      targetId: null,
      targetKind: 'point',
      targetName: 'Ground Zero',
      x: dropX,
      z: dropZ,
      groundY: g.y || 0,
    };
  }

  _spawnTacticalNuke({
    ownerId,
    ownerName,
    ownerRef = null,
    targetId = null,
    targetKind = 'point',
    targetName = 'Target',
    x = 0,
    groundY = 0,
    z = 0,
    context = {},
  }) {
    const gy = Number(groundY) || 0;
    const proj = {
      id: this.nextProjectileId++,
      type: 'tactical_nuke',
      kind: 'tactical_nuke',
      abilityId: 'tactical_nuke',
      ownerId,
      ownerName,
      ownerRef: ownerRef || null,
      targetId: targetId || null,
      targetKind: targetKind || 'point',
      targetName: targetName || 'Target',
      x,
      y: gy + 145,
      z,
      startY: 145,
      targetY: gy,
      countdown: NUKE_COUNTDOWN_SEC,
      maxCountdown: NUKE_COUNTDOWN_SEC,
      ttl: NUKE_COUNTDOWN_SEC + 0.5,
      maxTtl: NUKE_COUNTDOWN_SEC + 0.5,
      blastRadius: 65,
      angle: 0,
      radius: 2.0,
      age: 0,
      color: '#84cc16',
    };
    this.projectiles.push(proj);
    context?.onEvent?.({
      type: 'nuke_incoming',
      x,
      y: gy,
      z,
      ownerId,
      ownerName,
      targetId: targetId || null,
      targetKind: targetKind || 'point',
      targetName: targetName || 'Target',
      countdown: NUKE_COUNTDOWN_SEC,
    });
    return proj;
  }

  _detonateTacticalNuke(proj, context = {}) {
    const groundY = proj.targetY || 0;
    const blastRadius = proj.blastRadius || 65;

    // Towering 3D mushroom cloud + expanding ground shockwave ring
    this.projectiles.push({
      id: this.nextProjectileId++,
      type: 'nuke_cloud',
      kind: 'nuke_cloud',
      abilityId: 'tactical_nuke',
      ownerId: proj.ownerId,
      ownerName: proj.ownerName,
      x: proj.x,
      y: groundY,
      z: proj.z,
      vx: 0,
      vy: 0,
      vz: 0,
      angle: 0,
      radius: 4,
      maxRadius: blastRadius,
      ttl: 4.5,
      maxTtl: 4.5,
      age: 0,
      color: '#84cc16',
    });

    // 1. 100% Hit Rate Direct Lock
    const lp = context.localPlayer;
    let directHitLocal = false;
    if (lp && lp.alive !== false && proj.targetId && String(lp.id) === String(proj.targetId)) {
      directHitLocal = true;
      lp.hp = 0;
      lp.vy = Math.max(lp.vy || 0, 30);
      lp.vx = (lp.vx || 0) + (Math.random() - 0.5) * 28;
      lp.vz = (lp.vz || 0) + (Math.random() - 0.5) * 28;
      lp.nukedBy = proj.ownerName || 'Rival';
      lp.lastBumpedBy = {
        id: proj.ownerId,
        name: proj.ownerName || 'Rival',
        time: context.time || 0,
        reason: 'nuked',
      };
      context.onEvent?.({
        type: 'pvp_slam',
        reason: 'tactical_nuke',
        attackerId: proj.ownerId,
        attackerName: proj.ownerName,
        x: lp.x,
        y: lp.y || 0,
        z: lp.z,
      });
    }

    const cops = context.cops || [];
    if (proj.targetKind === 'cop' && proj.targetId) {
      const tid = String(proj.targetId);
      const lockedCop = cops.find(
        (c) => c && !c.wrecked && c.alive !== false && String(c.id ?? this._getEntityId(c)) === tid
      );
      if (lockedCop) {
        this._wreckCop(lockedCop, 0, 32, 0, proj.ownerRef, 'tactical_nuke', context);
      }
    }

    const traffic = context.traffic || [];
    if (proj.targetKind === 'traffic' && proj.targetId) {
      const tid = String(proj.targetId);
      const lockedCar = traffic.find(
        (t) => t && !t.wrecked && t.alive !== false && String(t.id ?? this._getEntityId(t)) === tid
      );
      if (lockedCar) {
        lockedCar.wrecked = true;
        lockedCar.vy = 30;
        lockedCar.spinTimer = 2.0;
        lockedCar.panic = true;
      }
    }

    // 2. Collateral Blast — vaporizes ALL AI cops within 75m (including helis & tanks!)
    for (let i = 0; i < cops.length; i++) {
      const cop = cops[i];
      if (!cop || cop.wrecked || cop.alive === false) continue;
      const dx = cop.x - proj.x;
      const dz = cop.z - proj.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= 75) {
        const inv = dist > 0.001 ? 1 / dist : 1;
        const nx = dist > 0.001 ? dx * inv : 0.7;
        const nz = dist > 0.001 ? dz * inv : 0.7;
        const falloff = 1 - Math.min(0.55, dist / 85);
        const fling = 52 * falloff;
        this._wreckCop(cop, nx * fling, 28, nz * fling, proj.ownerRef, 'tactical_nuke', context);
      }
    }

    // Launch all civilian traffic within 70m
    for (let i = 0; i < traffic.length; i++) {
      const car = traffic[i];
      if (!car || car.wrecked) continue;
      const dx = car.x - proj.x;
      const dz = car.z - proj.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= 70) {
        const inv = dist > 0.001 ? 1 / dist : 1;
        const nx = dist > 0.001 ? dx * inv : 1;
        const nz = dist > 0.001 ? dz * inv : 0;
        const falloff = 1 - Math.min(0.5, dist / 80);
        car.vx = nx * 55 * falloff;
        car.vz = nz * 55 * falloff;
        car.vy = 26;
        car.spinTimer = 2.0;
        car.panic = true;
      }
    }

    // Collateral blast on non-owner localPlayer within 60m (launcher protected by nukeSafeTimer & ownerId)
    if (
      lp &&
      lp.alive !== false &&
      !directHitLocal &&
      lp.id !== proj.ownerId &&
      (lp.items?.nukeSafeTimer || 0) <= 0
    ) {
      const dx = lp.x - proj.x;
      const dz = lp.z - proj.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= 60) {
        const inv = dist > 0.001 ? 1 / dist : 1;
        const nx = dist > 0.001 ? dx * inv : Math.sin(lp.angle || 0);
        const nz = dist > 0.001 ? dz * inv : Math.cos(lp.angle || 0);
        const falloff = Math.max(0.2, 1 - dist / 65);
        const dmg = Math.round(55 * falloff);
        lp.hp = Math.max(0, (lp.hp || 0) - dmg);
        lp.vx = (lp.vx || 0) + nx * 42 * falloff;
        lp.vz = (lp.vz || 0) + nz * 42 * falloff;
        lp.vy = Math.max(lp.vy || 0, 20 * falloff);
        lp.spinOutTimer = Math.max(lp.spinOutTimer || 0, 1.35);
        lp.lastBumpedBy = {
          id: proj.ownerId,
          name: proj.ownerName || 'Rival',
          time: context.time || 0,
          reason: 'nuked',
        };
        if (lp.hp <= 0) {
          lp.nukedBy = proj.ownerName || 'Rival';
        }
        context.onEvent?.({
          type: 'pvp_slam',
          reason: 'tactical_nuke',
          attackerId: proj.ownerId,
          attackerName: proj.ownerName,
          x: lp.x,
          y: lp.y || 0,
          z: lp.z,
        });
      }
    }

    context.onEvent?.({
      type: 'nuke_detonate',
      x: proj.x,
      y: groundY,
      z: proj.z,
      radius: blastRadius,
      ownerId: proj.ownerId,
      ownerName: proj.ownerName,
      targetId: proj.targetId || null,
      targetName: proj.targetName || 'Target',
    });
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

      if (proj.type === 'tactical_nuke') {
        if (proj.targetId) {
          const liveTarget = this._findLiveEntityById(proj.targetId, context);
          if (liveTarget) {
            proj.x = liveTarget.x;
            proj.z = liveTarget.z;
            proj.targetY = liveTarget.y || 0;
          }
        }
        proj.countdown = Math.max(0, (proj.countdown ?? NUKE_COUNTDOWN_SEC) - dt);
        const frac = proj.countdown / (proj.maxCountdown || NUKE_COUNTDOWN_SEC);
        proj.y = (proj.targetY || 0) + 1.0 + (proj.startY || 145) * Math.pow(frac, 1.35);
        proj.angle = (proj.angle || 0) + dt * 4.5;
        if (proj.countdown <= 0) {
          this._detonateTacticalNuke(proj, context);
          this.projectiles.splice(i, 1);
        }
        continue;
      }

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

      if (proj.type === 'nuke_cloud') {
        const maxTtl = proj.maxTtl || 4.5;
        const maxR = proj.maxRadius || 65;
        const prog = Math.max(0, Math.min(1, 1 - proj.ttl / maxTtl));
        proj.radius = Math.min(maxR, 4 + prog * 1.8 * maxR);
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

      if (proj.type === 'cop_missile') {
        proj.spin = (proj.spin || 0) + dt * 18;
        const speed = proj.speed || COP_MISSILE_SPEED;
        const maxTurnRate = Math.min(COP_MISSILE_TURN_RATE, proj.maxTurnRate || COP_MISSILE_TURN_RATE);
        const coneDot = proj.coneDot ?? COP_MISSILE_CONE_DOT;
        const breakDist = proj.breakLockDist ?? COP_MISSILE_BREAK_DIST;
        const blastRadius = proj.blastRadius || COP_MISSILE_BLAST_RADIUS;
        const maxDmg = proj.damage || COP_MISSILE_DAMAGE;

        let fx = Math.sin(proj.angle);
        let fz = Math.cos(proj.angle);

        if (!proj.lockBroken) {
          const candidates = this._collectCopMissileTargets(proj.ownerId, context);
          let bestCand = null;
          let bestScore = Infinity;

          for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
            const cand = candidates[cIdx];
            const ent = cand.entity;
            if (!ent) continue;
            const tx = ent.x - proj.x;
            const tz = ent.z - proj.z;
            const horizDist = Math.hypot(tx, tz);
            if (horizDist <= breakDist) {
              if (!proj.preferredTargetId || this._getEntityId(ent) === proj.preferredTargetId) {
                proj.lockBroken = true;
              }
              continue;
            }
            if (horizDist > 95) continue;
            const dot = (tx / horizDist) * fx + (tz / horizDist) * fz;
            if (dot <= coneDot) continue;
            const prefBoost =
              proj.preferredTargetId && this._getEntityId(ent) === proj.preferredTargetId ? 0.85 : 1.0;
            const score = horizDist * cand.priority * prefBoost * (1.25 - dot * 0.35);
            if (score < bestScore) {
              bestScore = score;
              bestCand = { entity: ent, horizDist };
            }
          }

          if (!proj.lockBroken && bestCand) {
            proj.preferredTargetId = this._getEntityId(bestCand.entity);
            const tx = bestCand.entity.x - proj.x;
            const tz = bestCand.entity.z - proj.z;
            const targetAngle = Math.atan2(tx, tz);
            let diff = targetAngle - proj.angle;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            const maxStep = maxTurnRate * dt;
            proj.angle += Math.max(-maxStep, Math.min(maxStep, diff));
            fx = Math.sin(proj.angle);
            fz = Math.cos(proj.angle);

            if (proj.sourceUnit === 'heli') {
              const desiredY = (bestCand.entity.y || 0) + 0.9;
              const estT = Math.max(0.2, bestCand.horizDist / speed);
              const desiredVy = Math.max(-42, Math.min(6, (desiredY - proj.y) / estT));
              proj.vy = (proj.vy || 0) + (desiredVy - (proj.vy || 0)) * Math.min(1, dt * 4.5);
            }
          }
        }

        proj.vx = fx * speed;
        proj.vz = fz * speed;
        proj.x += proj.vx * dt;
        proj.z += proj.vz * dt;

        const g = world?.getGroundHeight
          ? world.getGroundHeight(proj.x, proj.z)
          : { y: 0, surface: 'road' };
        const surfaceY = g.surface === 'water' ? WORLD_CONFIG.WATER_Y : g.y || 0;

        if (proj.sourceUnit === 'heli') {
          proj.y += (proj.vy || 0) * dt;
          proj.pitch = Math.atan2(proj.vy || 0, speed);
          if (proj.y <= surfaceY + 0.35) {
            proj.y = surfaceY + 0.35;
            this.detonateExplosion(proj.x, proj.y, proj.z, blastRadius, proj.ownerId, proj.ownerName, proj.ownerRef, context, {
              maxPlayerDamage: maxDmg,
              skipAiCops: proj.ownerRole === 'cop',
              isCopAttack: true,
            });
            this.projectiles.splice(i, 1);
            continue;
          }
        } else {
          const skimY = g.surface === 'water' ? Math.max(1.1, proj.y || 1.35) : (g.y || 0) + 1.1;
          proj.y += (skimY - proj.y) * Math.min(1, dt * 14);
          proj.pitch = 0;
        }

        if (world?.resolveBuildingCollision) {
          const wall = world.resolveBuildingCollision(proj);
          if (wall?.hit) {
            this.detonateExplosion(proj.x, proj.y, proj.z, blastRadius, proj.ownerId, proj.ownerName, proj.ownerRef, context, {
              maxPlayerDamage: maxDmg,
              skipAiCops: proj.ownerRole === 'cop',
              isCopAttack: true,
            });
            this.projectiles.splice(i, 1);
            continue;
          }
        }

        let hitTarget = null;
        const local = context.localPlayer;
        if (local && local.id !== proj.ownerId && local.alive !== false) {
          const yd = Math.abs((local.y || 0) + 1.0 - proj.y);
          const hd = Math.hypot(local.x - proj.x, local.z - proj.z);
          if (yd <= 3.2 && hd <= proj.radius + (local.radius || 2.0) * (local.scale || 1)) {
            hitTarget = local;
          }
        }

        if (!hitTarget) {
          const remotes = Array.isArray(context.remotePlayers)
            ? context.remotePlayers
            : Array.from(context.remotePlayers?.values?.() || []);
          for (let rIdx = 0; rIdx < remotes.length; rIdx++) {
            const rp = remotes[rIdx];
            if (!rp || rp.id === proj.ownerId || rp.alive === false) continue;
            const yd = Math.abs((rp.y || 0) + 1.0 - proj.y);
            const hd = Math.hypot(rp.x - proj.x, rp.z - proj.z);
            if (yd <= 3.2 && hd <= proj.radius + (rp.radius || 2.0) * (rp.scale || 1)) {
              hitTarget = rp;
              break;
            }
          }
        }

        if (!hitTarget) {
          const traffic = context.traffic || [];
          for (let tIdx = 0; tIdx < traffic.length; tIdx++) {
            const car = traffic[tIdx];
            if (!car || car.wrecked) continue;
            const yd = Math.abs((car.y || 0) + 0.9 - proj.y);
            const hd = Math.hypot(car.x - proj.x, car.z - proj.z);
            if (yd <= 2.8 && hd <= proj.radius + (car.radius || 2.0)) {
              hitTarget = car;
              break;
            }
          }
        }

        if (hitTarget) {
          this.detonateExplosion(proj.x, proj.y, proj.z, blastRadius, proj.ownerId, proj.ownerName, proj.ownerRef, context, {
            maxPlayerDamage: maxDmg,
            skipAiCops: proj.ownerRole === 'cop',
            isCopAttack: true,
            directHitPlayer: hitTarget === local ? local : null,
          });
          this.projectiles.splice(i, 1);
        }
        continue;
      }

      if (proj.type === 'rpg_rocket' || proj.type === 'homing_rocket' || proj.type === 'homing_shell') {
        proj.spin = (proj.spin || 0) + dt * 24;
        const speed = proj.speed || RPG_ROCKET_SPEED;
        const turnRate = proj.turnRate || 7.2;
        const blastRadius = proj.blastRadius || 9.5;
        const dirLen = Math.hypot(proj.vx, proj.vz) || 1;
        let dxNorm = proj.vx / dirLen;
        let dzNorm = proj.vz / dirLen;

        // Maintain lock on assigned preferredTargetId if alive & in cone; otherwise re-acquire
        const candidates = this._collectTargetCandidates(proj.ownerId, context);
        let best = null;

        if (proj.preferredTargetId) {
          for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
            const cand = candidates[cIdx];
            if (this._getEntityId(cand.entity) === proj.preferredTargetId) {
              const tx = cand.entity.x - proj.x;
              const tz = cand.entity.z - proj.z;
              const dist = Math.hypot(tx, tz);
              if (dist <= 155 && dist >= 0.01) {
                const dot = (tx / dist) * dxNorm + (tz / dist) * dzNorm;
                if (dot > -0.65) {
                  best = cand;
                }
              }
              break;
            }
          }
        }

        if (!best) {
          let bestScore = Infinity;
          for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
            const cand = candidates[cIdx];
            const tx = cand.entity.x - proj.x;
            const tz = cand.entity.z - proj.z;
            const dist = Math.hypot(tx, tz);
            if (dist > 135 || dist < 0.01) continue;
            const dot = (tx / dist) * dxNorm + (tz / dist) * dzNorm;
            if (dot <= -0.35) continue;
            const frontWeight = dot > 0.25 ? 0.66 : dot > 0 ? 0.88 : 1.2;
            const rivalWeight = cand.kind === 'player' && dot > 0.15 ? 0.88 : 1.0;
            const score = dist * frontWeight * rivalWeight;
            if (score < bestScore) {
              bestScore = score;
              best = cand;
            }
          }
          if (best) {
            proj.preferredTarget = best.entity;
            proj.preferredTargetId = this._getEntityId(best.entity);
          }
        }

        if (best) {
          const tx = best.entity.x - proj.x;
          const tz = best.entity.z - proj.z;
          const targetAngle = Math.atan2(tx, tz);
          let diff = targetAngle - proj.angle;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          const maxTurn = turnRate * dt;
          proj.angle += Math.max(-maxTurn, Math.min(maxTurn, diff));
          dxNorm = Math.sin(proj.angle);
          dzNorm = Math.cos(proj.angle);
          proj.vx = dxNorm * speed;
          proj.vz = dzNorm * speed;
        }

        proj.x += proj.vx * dt;
        proj.z += proj.vz * dt;
        const g = world?.getGroundHeight ? world.getGroundHeight(proj.x, proj.z) : { y: 0 };
        proj.y = Math.max(0.65, (g.y || 0) + 0.75);

        if (world?.resolveBuildingCollision) {
          const wall = world.resolveBuildingCollision(proj);
          if (wall?.hit) {
            this.detonateExplosion(
              proj.x,
              proj.y,
              proj.z,
              blastRadius,
              proj.ownerId,
              proj.ownerName,
              proj.ownerRef,
              context
            );
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
            this._wreckCop(cop, dxNorm * 36, 28, dzNorm * 36, proj.ownerRef, 'homing_rocket', context);
            this.detonateExplosion(
              proj.x,
              proj.y,
              proj.z,
              blastRadius,
              proj.ownerId,
              proj.ownerName,
              proj.ownerRef,
              context
            );
            hitSomething = true;
            break;
          }
        }

        if (!hitSomething) {
          const local = context.localPlayer;
          if (local && local.id !== proj.ownerId && local.alive !== false) {
            const dist = Math.hypot(local.x - proj.x, local.z - proj.z);
            if (dist <= proj.radius + (local.radius || 2.0) * (local.scale || 1)) {
              const protectedBuff =
                (local.items?.starTimer || 0) > 0 ||
                (local.items?.megaTimer || 0) > 0 ||
                (local.items?.sugarTimer || 0) > 0;
              if (!protectedBuff) {
                local.vx += dxNorm * 34;
                local.vz += dzNorm * 34;
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
              this.detonateExplosion(proj.x, proj.y, proj.z, blastRadius, proj.ownerId, proj.ownerName, null, context);
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
              this.detonateExplosion(
                proj.x,
                proj.y,
                proj.z,
                blastRadius,
                proj.ownerId,
                proj.ownerName,
                proj.ownerRef,
                context
              );
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
            const copBananaImmune =
              lp.flying || (lp.playerRole === 'cop' && lp.copVehicleId === 'cop_tank');
            if (!sameOwnerBlocked && !lp.flying) {
              const dist = Math.hypot(lp.x - proj.x, lp.z - proj.z);
              if (dist <= proj.radius + (lp.radius || 2.0) * (lp.scale || 1)) {
                const protectedBuff =
                  copBananaImmune ||
                  (lp.items?.starTimer || 0) > 0 ||
                  (lp.items?.megaTimer || 0) > 0 ||
                  (lp.items?.sugarTimer || 0) > 0;
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
