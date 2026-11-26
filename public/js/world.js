// Deterministic Seeded 3D Smashy Road World (2400x2400, 1600 chunks, rivers, bridges, ramps, districts, ? boxes)

import { WORLD_CONFIG, BIOMES } from './config.js';

const {
  WORLD_SIZE,
  HALF_WORLD,
  CHUNK_SIZE,
  ROAD_WIDTH,
  HIGHWAY_WIDTH,
  VIEW_CHUNK_RADIUS,
  WATER_Y,
  BRIDGE_Y,
} = WORLD_CONFIG;

const MIN_CHUNK = -Math.floor(HALF_WORLD / CHUNK_SIZE); // -20
const MAX_CHUNK = Math.floor(HALF_WORLD / CHUNK_SIZE) - 1; // 19
const RIVER_ROWS = new Set([5, -7]);
const ITEM_BOX_RESPAWN_SEC = 12.0;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function nextRandom() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashChunkSeed(worldSeed, cx, cz, salt = 0) {
  let h = (worldSeed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ ((cx + 1024) | 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ ((cz + 2048) | 0), 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ (salt | 0), 0x27d4eb2f) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep01(t) {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

const CITY_PALETTE = [
  { body: '#60a5fa', roof: '#1e3a8a', accent: '#dbeafe' },
  { body: '#f87171', roof: '#7f1d1d', accent: '#fee2e2' },
  { body: '#fbbf24', roof: '#78350f', accent: '#fef3c7' },
  { body: '#34d399', roof: '#065f46', accent: '#d1fae5' },
  { body: '#a78bfa', roof: '#4c1d95', accent: '#ede9fe' },
  { body: '#94a3b8', roof: '#334155', accent: '#f1f5f9' },
  { body: '#fb923c', roof: '#7c2d12', accent: '#ffedd5' },
  { body: '#38bdf8', roof: '#0c4a6e', accent: '#e0f2fe' },
];

const HOUSE_PALETTE = [
  { body: '#fef08a', roof: '#dc2626', accent: '#ffffff' },
  { body: '#bfdbfe', roof: '#1d4ed8', accent: '#ffffff' },
  { body: '#fbcfe8', roof: '#be185d', accent: '#ffffff' },
  { body: '#bbf7d0', roof: '#15803d', accent: '#ffffff' },
  { body: '#fed7aa', roof: '#9a3412', accent: '#fff7ed' },
  { body: '#e2e8f0', roof: '#475569', accent: '#ffffff' },
];

const DESERT_PALETTE = [
  { body: '#d97742', roof: '#9a3412', accent: '#fed7aa' },
  { body: '#c26338', roof: '#7c2d12', accent: '#ffedd5' },
  { body: '#e59866', roof: '#a04000', accent: '#fdebd0' },
  { body: '#f0b27a', roof: '#873600', accent: '#fef5e7' },
  { body: '#d4ac6e', roof: '#7d6608', accent: '#fcf3cf' },
];

const SNOW_PALETTE = [
  { body: '#92400e', roof: '#f8fafc', accent: '#fde68a' },
  { body: '#78350f', roof: '#f1f5f9', accent: '#fef3c7' },
  { body: '#475569', roof: '#ffffff', accent: '#e2e8f0' },
  { body: '#991b1b', roof: '#f8fafc', accent: '#fecaca' },
  { body: '#1e3a8a', roof: '#f8fafc', accent: '#bfdbfe' },
];

export class World {
  constructor(seed = 777123, biomeId = 'city', options = { itemBoxDensity: 1.2 }) {
    this.chunks = new Map();
    this.collectedBoxes = new Set();
    this.geysers = [];
    this.time = 0;
    this.reset(seed, biomeId, options);
  }

  reset(seed = 777123, biomeId = 'city', options = { itemBoxDensity: 1.2 }) {
    this.seed = (Number(seed) || 777123) >>> 0;
    this.biomeId = BIOMES[biomeId] ? biomeId : 'city';
    this.biome = BIOMES[this.biomeId];
    this.options = {
      itemBoxDensity: 1.2,
      ...(options || {}),
    };
    this.chunks = new Map();
    this.collectedBoxes = new Set();
    this.geysers = [];
    this.time = 0;

    // Pre-warm central starting region so frame 0 and spawn queries are instant
    for (let cz = -3; cz <= 3; cz++) {
      for (let cx = -3; cx <= 3; cx++) {
        this._getOrCreateChunk(cx, cz);
      }
    }
  }

  // Grid road helpers: grid lines sit at multiples of CHUNK_SIZE (x = gx * 60, z = gz * 60)
  isHighwayGrid(g) {
    return Math.abs(g) % 4 === 0;
  }

  getNSRoadHalfWidth(gx) {
    return this.isHighwayGrid(gx) ? HIGHWAY_WIDTH * 0.5 : ROAD_WIDTH * 0.5;
  }

  getEWRoadHalfWidth(gz) {
    return this.isHighwayGrid(gz) ? HIGHWAY_WIDTH * 0.5 : ROAD_WIDTH * 0.5;
  }

  hasBridgeAtGridX(gx) {
    // All highways (gx % 4 === 0, including x = 0) and even avenues cross rivers with sturdy bridges
    return Math.abs(gx) % 2 === 0;
  }

  isRiverChunkZ(cz) {
    return RIVER_ROWS.has(cz);
  }

  getRiverCenterZ(x, cz) {
    const baseZ = cz * CHUNK_SIZE + CHUNK_SIZE * 0.5;
    const phase = ((this.seed % 4096) * 0.013) + (cz === 5 ? 0.65 : 2.35);
    const wave =
      Math.sin(x * 0.021 + phase) * 5.2 +
      Math.cos(x * 0.0085 - phase * 0.7) * 2.4;
    return baseZ + wave; // stays well within [cz*60 + 22, cz*60 + 38]
  }

  getRiverHalfWidth() {
    return 13.5;
  }

  _isCentralPlazaRoad(x, z) {
    // Wide central multiplayer crossroad & starting boulevard around (0, 0)
    const ax = Math.abs(x);
    const az = Math.abs(z);
    if (ax <= 18.5 && az <= 28.0) return true;
    if (az <= 16.0 && ax <= 26.0) return true;
    return false;
  }

  _worldToChunkCoord(v) {
    return clamp(Math.floor(v / CHUNK_SIZE), MIN_CHUNK, MAX_CHUNK);
  }

  _getOrCreateChunk(cx, cz) {
    if (cx < MIN_CHUNK || cx > MAX_CHUNK || cz < MIN_CHUNK || cz > MAX_CHUNK) {
      return null;
    }
    const key = `${cx},${cz}`;
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = this._generateChunk(cx, cz, key);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  _chooseDistrict(cx, cz, rng) {
    if (this.isRiverChunkZ(cz)) return 'river';
    if (cx >= -1 && cx <= 0 && cz >= -1 && cz <= 0) return 'plaza';

    const dist = Math.hypot(cx + 0.5, cz + 0.5);
    const roll = rng();

    // Guaranteed stunt park & gas station near center so action happens fast!
    if (cx === 1 && cz === 1) return 'gas_station';
    if (cx === -2 && cz === 1) return 'stunt_park';
    if (cx === 1 && cz === -2) return 'park';

    if (roll < 0.085) return 'gas_station';
    if (roll < 0.175) return 'stunt_park';
    if (roll < 0.31) return 'park';

    if (dist < 6.5) {
      return roll < 0.78 ? 'downtown' : 'suburban';
    }
    if (dist < 13.0) {
      return roll < 0.45 ? 'downtown' : 'suburban';
    }
    return roll < 0.24 ? 'downtown' : 'suburban';
  }

  _pickPalette(district, rng) {
    if (this.biomeId === 'desert') {
      return DESERT_PALETTE[Math.floor(rng() * DESERT_PALETTE.length)];
    }
    if (this.biomeId === 'snow') {
      return SNOW_PALETTE[Math.floor(rng() * SNOW_PALETTE.length)];
    }
    const list = district === 'suburban' ? HOUSE_PALETTE : CITY_PALETTE;
    return list[Math.floor(rng() * list.length)];
  }

  _generateChunk(cx, cz, key) {
    const rng = mulberry32(hashChunkSeed(this.seed, cx, cz, 101));
    const x0 = cx * CHUNK_SIZE;
    const z0 = cz * CHUNK_SIZE;
    const x1 = x0 + CHUNK_SIZE;
    const z1 = z0 + CHUNK_SIZE;
    const centerX = x0 + CHUNK_SIZE * 0.5;
    const centerZ = z0 + CHUNK_SIZE * 0.5;

    const district = this._chooseDistrict(cx, cz, rng);

    const westRoadHalf = this.getNSRoadHalfWidth(cx);
    const eastRoadHalf = this.getNSRoadHalfWidth(cx + 1);
    const southRoadHalf = this.getEWRoadHalfWidth(cz);
    const northRoadHalf = this.getEWRoadHalfWidth(cz + 1);

    // Interior lot bounds inside sidewalks
    const sidewalkW = 2.4;
    const lotMinX = x0 + westRoadHalf + sidewalkW;
    const lotMaxX = x1 - eastRoadHalf - sidewalkW;
    const lotMinZ = z0 + southRoadHalf + sidewalkW;
    const lotMaxZ = z1 - northRoadHalf - sidewalkW;

    const chunk = {
      cx,
      cz,
      key,
      x0,
      z0,
      x1,
      z1,
      district,
      lotBounds: { minX: lotMinX, maxX: lotMaxX, minZ: lotMinZ, maxZ: lotMaxZ },
      tiles: [],
      buildings: [],
      props: [],
      ramps: [],
      itemBoxes: [],
      gasStations: [],
      bridges: [],
    };

    // Base road/lot descriptor tiles for renderer & queries
    chunk.tiles.push({
      type: district === 'stunt_park' || district === 'gas_station' ? 'paved_lot' : 'ground',
      x: centerX,
      z: centerZ,
      w: CHUNK_SIZE,
      d: CHUNK_SIZE,
      westRoadHalf,
      eastRoadHalf,
      southRoadHalf,
      northRoadHalf,
      westHighway: this.isHighwayGrid(cx),
      eastHighway: this.isHighwayGrid(cx + 1),
      southHighway: this.isHighwayGrid(cz),
      northHighway: this.isHighwayGrid(cz + 1),
    });

    let propSeq = 0;
    const addProp = (type, px, pz, opts = {}) => {
      if (this._isCentralPlazaRoad(px, pz)) return null;
      const defaults = {
        tree: { radius: 1.05, height: 5.4 },
        cactus: { radius: 0.95, height: 4.4 },
        snowman: { radius: 1.0, height: 3.2 },
        fence: { radius: 1.15, height: 1.3 },
        hydrant: { radius: 0.65, height: 1.2 },
        streetlight: { radius: 0.65, height: 6.2 },
        crate: { radius: 0.95, height: 1.5 },
        cone: { radius: 0.55, height: 1.0 },
        gas_pump: { radius: 1.15, height: 2.6 },
      }[type] || { radius: 0.9, height: 2.0 };

      const prop = {
        id: `${key}:p${propSeq++}`,
        type,
        x: px,
        y: opts.y || 0,
        z: pz,
        radius: opts.radius ?? defaults.radius,
        height: opts.height ?? defaults.height,
        angle: opts.angle ?? 0,
        scale: opts.scale ?? 1.0,
        color: opts.color || null,
        stationId: opts.stationId || null,
        explosive: type === 'gas_pump',
        smashed: false,
        smashTime: -1,
      };
      chunk.props.push(prop);
      return prop;
    };

    const addBuilding = (bx, bz, bw, bd, height, styleOpts = {}) => {
      const b = {
        id: `${key}:b${chunk.buildings.length}`,
        x: bx,
        z: bz,
        w: bw,
        d: bd,
        minX: bx - bw * 0.5,
        maxX: bx + bw * 0.5,
        minZ: bz - bd * 0.5,
        maxZ: bz + bd * 0.5,
        height,
        color: styleOpts.color || '#60a5fa',
        roofColor: styleOpts.roofColor || '#1e3a8a',
        accentColor: styleOpts.accentColor || '#dbeafe',
        style: styleOpts.style || 'skyscraper',
        tiers: styleOpts.tiers || 1,
        hasWindows: styleOpts.hasWindows !== false,
        seed: Math.floor(rng() * 100000),
      };
      chunk.buildings.push(b);
      return b;
    };

    let rampSeq = 0;
    const addRamp = (rx, rz, rw, rlen, angle, height = 3.6) => {
      const ramp = {
        id: `${key}:r${rampSeq++}`,
        x: rx,
        z: rz,
        w: rw,
        length: rlen,
        height,
        angle,
        dirX: Math.sin(angle),
        dirZ: Math.cos(angle),
      };
      chunk.ramps.push(ramp);
      return ramp;
    };

    let boxSeq = 0;
    const addItemBox = (bx, by, bz) => {
      const box = {
        id: `${key}:ib${boxSeq++}`,
        x: bx,
        y: by,
        z: bz,
        collected: false,
        respawnTimer: 0,
        phase: rng() * Math.PI * 2,
        spinAngle: rng() * Math.PI * 2,
        bobOffset: 0,
      };
      chunk.itemBoxes.push(box);
      return box;
    };

    const floraType = () => {
      if (this.biomeId === 'desert') return 'cactus';
      if (this.biomeId === 'snow') return rng() < 0.25 ? 'snowman' : 'tree';
      return 'tree';
    };

    // District generation
    if (district === 'river') {
      this._populateRiverChunk(chunk, rng, addProp, addRamp, addItemBox, floraType);
    } else if (district === 'plaza') {
      this._populatePlazaChunk(chunk, rng, addBuilding, addProp, addRamp, addItemBox, floraType);
    } else if (district === 'downtown') {
      this._populateDowntownChunk(chunk, rng, addBuilding, addProp, floraType);
    } else if (district === 'suburban') {
      this._populateSuburbanChunk(chunk, rng, addBuilding, addProp, floraType);
    } else if (district === 'park') {
      this._populateParkChunk(chunk, rng, addBuilding, addProp, floraType);
    } else if (district === 'gas_station') {
      this._populateGasStationChunk(chunk, rng, addBuilding, addProp, addItemBox, floraType);
    } else if (district === 'stunt_park') {
      this._populateStuntParkChunk(chunk, rng, addProp, addRamp, addItemBox);
    }

    // Sidewalk streetlights & hydrants along roads (outside river chunks & central plaza)
    if (district !== 'river' && district !== 'plaza') {
      this._populateStreetFurniture(chunk, rng, addProp);
    }

    // Highway jump ramps & floating Mario Kart ? Item Boxes on roads/intersections
    if (district !== 'river') {
      this._populateRoadRampsAndBoxes(chunk, rng, addRamp, addItemBox);
    }

    return chunk;
  }

  _populateRiverChunk(chunk, rng, addProp, addRamp, addItemBox, floraType) {
    const { cx, cz, x0, z0, x1, z1 } = chunk;
    // West border NS road at x = x0 belongs to this chunk's bridge check if cx % 2 === 0
    if (this.hasBridgeAtGridX(cx)) {
      const bw = this.getNSRoadHalfWidth(cx) * 2;
      chunk.bridges.push({
        x: x0,
        zStart: z0 + 6.0,
        zEnd: z1 - 6.0,
        flatStart: z0 + 16.0,
        flatEnd: z1 - 16.0,
        w: bw,
        height: BRIDGE_Y,
      });
      // Item boxes on bridge crest!
      if (rng() < 0.75 * this.options.itemBoxDensity) {
        addItemBox(x0 - 3.2, BRIDGE_Y, z0 + CHUNK_SIZE * 0.5);
        addItemBox(x0 + 3.2, BRIDGE_Y, z0 + CHUNK_SIZE * 0.5);
      }
    } else {
      // Non-bridge street T-junction: either warning cones/fence or an epic river-jump stunt ramp!
      if (Math.abs(cx) % 4 === 1) {
        // Stunt jump ramps on both banks to leap over the water!
        const southRamp = addRamp(x0, z0 + 11.5, 8.5, 11.0, 0, 3.6);
        addItemBox(southRamp.x, 3.6, southRamp.z + 4.2);
        const northRamp = addRamp(x0, z1 - 11.5, 8.5, 11.0, Math.PI, 3.6);
        addItemBox(northRamp.x, 3.6, northRamp.z - 4.2);
      } else {
        for (let ox = -4.5; ox <= 4.5; ox += 3.0) {
          addProp('cone', x0 + ox, z0 + 8.5);
          addProp('cone', x0 + ox, z1 - 8.5);
        }
      }
    }

    // Riverbank trees/fences between bridges
    for (let sx = x0 + 14; sx <= x1 - 14; sx += 9.5) {
      const rc = this.getRiverCenterZ(sx, cz);
      const southBankZ = rc - this.getRiverHalfWidth() - 3.2;
      const northBankZ = rc + this.getRiverHalfWidth() + 3.2;
      if (southBankZ > z0 + 9 && rng() < 0.65) {
        addProp(floraType(), sx + (rng() - 0.5) * 2.5, southBankZ);
      }
      if (northBankZ < z1 - 9 && rng() < 0.65) {
        addProp(floraType(), sx + (rng() - 0.5) * 2.5, northBankZ);
      }
      if (rng() < 0.45 && southBankZ - 2.2 > z0 + 8) {
        addProp('fence', sx, southBankZ - 2.2, { angle: 0 });
      }
    }
  }

  _populatePlazaChunk(chunk, rng, addBuilding, addProp, addRamp, addItemBox, floraType) {
    const { cx, cz, lotBounds } = chunk;
    // Set back corner landmark tower safely away from central starting plaza (|x| > 26, |z| > 29)
    const cornerX = cx === -1 ? lotBounds.minX + 10.5 : lotBounds.maxX - 10.5;
    const cornerZ = cz === -1 ? lotBounds.minZ + 9.5 : lotBounds.maxZ - 9.5;
    const pal = this._pickPalette('downtown', rng);
    addBuilding(cornerX, cornerZ, 15.0, 14.0, 20 + Math.floor(rng() * 10), {
      color: pal.body,
      roofColor: pal.roof,
      accentColor: pal.accent,
      style: this.biomeId === 'desert' ? 'mesa' : this.biomeId === 'snow' ? 'chalet' : 'skyscraper',
      tiers: 2,
    });

    // Decorative corner trees & lamp posts outside the wide starting road
    const propX = cx === -1 ? -22.5 : 22.5;
    const propZ = cz === -1 ? -22.5 : 22.5;
    addProp(floraType(), propX, propZ);
    addProp('streetlight', cx === -1 ? -20.5 : 20.5, cz === -1 ? -10.0 : 14.0);

    // Guaranteed starting-boulevard ? Item Boxes right ahead of the 8-player grid!
    if (cx === 0 && cz === 0) {
      addItemBox(-9.0, 0, 24.0);
      addItemBox(-3.0, 0, 24.0);
      addItemBox(3.0, 0, 24.0);
      addItemBox(9.0, 0, 24.0);

      // Guaranteed highway jump ramp slightly further north at z = 50 in chunk (0,0)/(0,1)
      const startRamp = addRamp(0, 48.0, 9.2, 13.0, 0, 3.6);
      addItemBox(0, 3.6, startRamp.z + 5.0);
    }
    if (cx === 0 && cz === -1) {
      // Rear item boxes if someone reverses or loops South
      addItemBox(-5.5, 0, -34.0);
      addItemBox(5.5, 0, -34.0);
    }
  }

  _populateDowntownChunk(chunk, rng, addBuilding, addProp, floraType) {
    const { lotBounds } = chunk;
    const lotW = lotBounds.maxX - lotBounds.minX;
    const lotD = lotBounds.maxZ - lotBounds.minZ;
    if (lotW < 14 || lotD < 14) return;

    const subLayout = rng();
    if (subLayout < 0.28) {
      // Hero landmark mega-tower in center with corner trees & crates
      const pal = this._pickPalette('downtown', rng);
      const bw = Math.min(24, lotW - 8);
      const bd = Math.min(24, lotD - 8);
      const cx = (lotBounds.minX + lotBounds.maxX) * 0.5;
      const cz = (lotBounds.minZ + lotBounds.maxZ) * 0.5;
      addBuilding(cx, cz, bw, bd, 24 + Math.floor(rng() * 14), {
        color: pal.body,
        roofColor: pal.roof,
        accentColor: pal.accent,
        style: this.biomeId === 'desert' ? 'mesa' : this.biomeId === 'snow' ? 'chalet' : 'skyscraper',
        tiers: 3,
      });
      addProp(floraType(), lotBounds.minX + 2.5, lotBounds.minZ + 2.5);
      addProp(floraType(), lotBounds.maxX - 2.5, lotBounds.minZ + 2.5);
      addProp(floraType(), lotBounds.minX + 2.5, lotBounds.maxZ - 2.5);
      addProp(floraType(), lotBounds.maxX - 2.5, lotBounds.maxZ - 2.5);
    } else {
      // 2x2 city block of varied skyscrapers with an alley gap you can squeeze through!
      const halfW = lotW * 0.5;
      const halfD = lotD * 0.5;
      const alley = 3.2;
      for (let ix = 0; ix < 2; ix++) {
        for (let iz = 0; iz < 2; iz++) {
          if (rng() < 0.14) {
            // Pocket courtyard with trees & smashable crates
            const px = lotBounds.minX + (ix + 0.5) * halfW;
            const pz = lotBounds.minZ + (iz + 0.5) * halfD;
            addProp(floraType(), px - 2.5, pz - 2.0);
            addProp(floraType(), px + 2.5, pz + 2.0);
            addProp('crate', px + 2.0, pz - 2.0);
            addProp('crate', px - 2.0, pz + 2.0);
            continue;
          }
          const pal = this._pickPalette('downtown', rng);
          const bw = Math.max(9.5, halfW - alley - rng() * 2.5);
          const bd = Math.max(9.5, halfD - alley - rng() * 2.5);
          const bx = lotBounds.minX + (ix + 0.5) * halfW;
          const bz = lotBounds.minZ + (iz + 0.5) * halfD;
          const h =
            this.biomeId === 'desert'
              ? 12 + Math.floor(rng() * 14)
              : 14 + Math.floor(rng() * 19);
          addBuilding(bx, bz, bw, bd, h, {
            color: pal.body,
            roofColor: pal.roof,
            accentColor: pal.accent,
            style: this.biomeId === 'desert' ? (rng() < 0.6 ? 'mesa' : 'diner') : this.biomeId === 'snow' ? 'chalet' : 'skyscraper',
            tiers: h > 22 ? 2 : 1,
          });
        }
      }
    }
  }

  _populateSuburbanChunk(chunk, rng, addBuilding, addProp, floraType) {
    const { lotBounds } = chunk;
    const lotW = lotBounds.maxX - lotBounds.minX;
    const lotD = lotBounds.maxZ - lotBounds.minZ;
    if (lotW < 14 || lotD < 14) return;

    const halfW = lotW * 0.5;
    const halfD = lotD * 0.5;

    for (let ix = 0; ix < 2; ix++) {
      for (let iz = 0; iz < 2; iz++) {
        if (rng() < 0.16) continue;
        const pal = this._pickPalette('suburban', rng);
        const qx = lotBounds.minX + (ix + 0.5) * halfW;
        const qz = lotBounds.minZ + (iz + 0.5) * halfD;
        const bw = clamp(halfW * 0.56, 8.0, 12.5);
        const bd = clamp(halfD * 0.54, 8.0, 12.0);
        const h = 5.6 + rng() * 2.8;
        const style =
          this.biomeId === 'desert'
            ? rng() < 0.45 ? 'diner' : 'adobe'
            : this.biomeId === 'snow'
              ? 'cabin'
              : 'house';

        addBuilding(qx, qz, bw, bd, h, {
          color: pal.body,
          roofColor: pal.roof,
          accentColor: pal.accent,
          style,
          tiers: 1,
        });

        // Yard tree / cactus / snowman
        const yardX = qx + (ix === 0 ? -bw * 0.62 : bw * 0.62);
        const yardZ = qz + (iz === 0 ? -bd * 0.62 : bd * 0.62);
        if (
          yardX > lotBounds.minX + 1.5 &&
          yardX < lotBounds.maxX - 1.5 &&
          yardZ > lotBounds.minZ + 1.5 &&
          yardZ < lotBounds.maxZ - 1.5
        ) {
          addProp(floraType(), yardX, yardZ, { scale: 0.85 + rng() * 0.35 });
        }
      }
    }

    // White picket fences along block perimeter for satisfying Smashy Road fence-smashing chains!
    for (let fx = lotBounds.minX + 4; fx <= lotBounds.maxX - 4; fx += 5.2) {
      if (Math.abs(fx - (lotBounds.minX + lotBounds.maxX) * 0.5) < 4.5) continue; // driveway gap
      if (rng() < 0.8) addProp('fence', fx, lotBounds.minZ + 1.1, { angle: 0 });
      if (rng() < 0.8) addProp('fence', fx, lotBounds.maxZ - 1.1, { angle: 0 });
    }
  }

  _populateParkChunk(chunk, rng, addBuilding, addProp, floraType) {
    const { lotBounds } = chunk;
    const cx = (lotBounds.minX + lotBounds.maxX) * 0.5;
    const cz = (lotBounds.minZ + lotBounds.maxZ) * 0.5;

    // Optional small central park gazebo / monument (low height so ramp jumpers can even clear it!)
    if (rng() < 0.55) {
      addBuilding(cx, cz, 6.4, 6.4, 4.2, {
        color: this.biomeId === 'desert' ? '#d97742' : '#e2e8f0',
        roofColor: this.biomeId === 'snow' ? '#f8fafc' : '#38bdf8',
        accentColor: '#ffffff',
        style: 'monument',
        hasWindows: false,
      });
    }

    // Lush cluster of smashable trees / cacti / snowmen & park fences
    const treeCount = 10 + Math.floor(rng() * 7);
    for (let i = 0; i < treeCount; i++) {
      const tx = lotBounds.minX + 3.0 + rng() * Math.max(4, lotBounds.maxX - lotBounds.minX - 6.0);
      const tz = lotBounds.minZ + 3.0 + rng() * Math.max(4, lotBounds.maxZ - lotBounds.minZ - 6.0);
      if (Math.hypot(tx - cx, tz - cz) < 5.8) continue;
      addProp(floraType(), tx, tz, { scale: 0.85 + rng() * 0.45 });
    }

    // Smashable wooden crates & park perimeter fences
    for (let i = 0; i < 4; i++) {
      const px = cx + (i % 2 === 0 ? -7.5 : 7.5);
      const pz = cz + (i < 2 ? -7.5 : 7.5);
      addProp('crate', px, pz);
    }
    for (let fx = lotBounds.minX + 4.5; fx <= lotBounds.maxX - 4.5; fx += 6.0) {
      if (Math.abs(fx - cx) < 5.0) continue;
      addProp('fence', fx, lotBounds.minZ + 1.2, { angle: 0 });
      addProp('fence', fx, lotBounds.maxZ - 1.2, { angle: 0 });
    }
  }

  _populateGasStationChunk(chunk, rng, addBuilding, addProp, addItemBox, floraType) {
    const { key, lotBounds } = chunk;
    const cx = (lotBounds.minX + lotBounds.maxX) * 0.5;
    const cz = (lotBounds.minZ + lotBounds.maxZ) * 0.5;
    const stationId = `${key}:gs0`;

    // Convenience store building at back of lot
    const storeZ = lotBounds.maxZ - 6.8;
    addBuilding(cx, storeZ, Math.min(18.0, lotBounds.maxX - lotBounds.minX - 6), 8.5, 6.2, {
      color: '#f8fafc',
      roofColor: '#dc2626',
      accentColor: '#fde047',
      style: 'gas_store',
    });

    // Red & white overhead canopy metadata (cars drive straight underneath canopyHeight = 5.4!)
    const canopyZ = cz - 3.5;
    const station = {
      id: stationId,
      x: cx,
      z: canopyZ,
      w: 18.0,
      d: 11.0,
      clearanceY: 5.2,
      damaged: false,
    };
    chunk.gasStations.push(station);

    // Canopy support pillars on far outer edges + explosive gas_pump props underneath!
    const pumpOffsets = [-5.2, 0.0, 5.2];
    for (const ox of pumpOffsets) {
      addProp('gas_pump', cx + ox, canopyZ, { stationId });
    }
    addProp('cone', cx - 8.5, canopyZ - 4.5);
    addProp('cone', cx + 8.5, canopyZ - 4.5);
    addProp('crate', lotBounds.minX + 3.5, storeZ - 1.5);
    addProp('crate', lotBounds.maxX - 3.5, storeZ - 1.5);
    addProp(floraType(), lotBounds.maxX - 3.0, lotBounds.maxZ - 3.0);

    // Risk-reward Mario Kart ? box right under the explosive gas station canopy!
    if (rng() < 0.85 * this.options.itemBoxDensity) {
      addItemBox(cx - 2.6, 0, canopyZ - 3.8);
    }
  }

  _populateStuntParkChunk(chunk, rng, addProp, addRamp, addItemBox) {
    const { lotBounds } = chunk;
    const cx = (lotBounds.minX + lotBounds.maxX) * 0.5;
    const cz = (lotBounds.minZ + lotBounds.maxZ) * 0.5;

    // Two opposing super ramps with ? boxes at the launch lips!
    const r1 = addRamp(cx - 7.5, cz, 7.6, 13.5, 0, 3.6);
    const r2 = addRamp(cx + 7.5, cz, 7.6, 13.5, Math.PI, 3.6);
    addItemBox(r1.x, 3.6, r1.z + r1.length * 0.42);
    addItemBox(r2.x, 3.6, r2.z - r2.length * 0.42);

    // Optional East-West ramp if lot is roomy
    if (lotBounds.maxX - lotBounds.minX > 32) {
      const r3 = addRamp(cx, cz - 11.5, 7.0, 11.5, Math.PI * 0.5, 3.6);
      addItemBox(r3.x + r3.length * 0.42, 3.6, r3.z);
    }

    // Slalom cones & crate pyramids to smash through
    for (let i = -2; i <= 2; i++) {
      addProp('cone', cx, cz + i * 3.8);
    }
    addProp('crate', lotBounds.minX + 3.5, lotBounds.minZ + 3.5);
    addProp('crate', lotBounds.minX + 5.2, lotBounds.minZ + 3.5);
    addProp('crate', lotBounds.maxX - 3.5, lotBounds.maxZ - 3.5);
    addProp('crate', lotBounds.maxX - 5.2, lotBounds.maxZ - 3.5);
  }

  _populateStreetFurniture(chunk, rng, addProp) {
    const { lotBounds } = chunk;
    const midX = (lotBounds.minX + lotBounds.maxX) * 0.5;
    const midZ = (lotBounds.minZ + lotBounds.maxZ) * 0.5;

    // Streetlights at sidewalk corners & midpoints
    addProp('streetlight', lotBounds.minX - 1.1, lotBounds.minZ - 1.1, { angle: Math.PI * 0.25 });
    if (rng() < 0.7) {
      addProp('streetlight', lotBounds.maxX + 1.1, lotBounds.maxZ + 1.1, { angle: -Math.PI * 0.75 });
    }
    if (rng() < 0.55) {
      addProp('hydrant', lotBounds.minX - 1.0, midZ, { angle: 0 });
    }
    if (rng() < 0.45) {
      addProp('hydrant', midX, lotBounds.minZ - 1.0, { angle: Math.PI * 0.5 });
    }
  }

  _populateRoadRampsAndBoxes(chunk, rng, addRamp, addItemBox) {
    const { cx, cz, x0, z0 } = chunk;
    const density = clamp(this.options.itemBoxDensity ?? 1.2, 0.2, 3.0);

    // Intersection (x0, z0) owned uniquely by chunk (cx, cz) — never duplicated!
    if (!(cx === 0 && cz === 0)) {
      const isMajor = this.isHighwayGrid(cx) || this.isHighwayGrid(cz);
      const boxChance = (isMajor ? 0.62 : 0.34) * density;
      if (rng() < boxChance) {
        if (isMajor && rng() < 0.55) {
          // Pair of Mario Kart ? boxes across the intersection!
          addItemBox(x0 - 3.5, 0, z0);
          addItemBox(x0 + 3.5, 0, z0);
        } else {
          addItemBox(x0, 0, z0);
        }
      }
    }

    // Mid-segment NS road (x = x0, z = z0 + 30) owned uniquely by chunk (cx, cz)
    const midZ = z0 + CHUNK_SIZE * 0.5;
    if (!this._isCentralPlazaRoad(x0, midZ)) {
      if (this.isHighwayGrid(cx) && rng() < 0.26) {
        const dirAngle = rng() < 0.5 ? 0 : Math.PI;
        const ramp = addRamp(x0 + (dirAngle === 0 ? 4.2 : -4.2), midZ, 7.6, 12.5, dirAngle, 3.6);
        addItemBox(
          ramp.x + ramp.dirX * (ramp.length * 0.42),
          3.6,
          ramp.z + ramp.dirZ * (ramp.length * 0.42)
        );
      } else if (rng() < 0.32 * density) {
        addItemBox(x0 - 2.8, 0, midZ);
        if (rng() < 0.5 * density) addItemBox(x0 + 2.8, 0, midZ);
      }
    }

    // Mid-segment EW road (x = x0 + 30, z = z0) owned uniquely by chunk (cx, cz)
    // Skip riverside roads right adjacent to river chunks only if inside river (we already filtered river chunks)
    const midX = x0 + CHUNK_SIZE * 0.5;
    if (!this._isCentralPlazaRoad(midX, z0)) {
      if (this.isHighwayGrid(cz) && rng() < 0.24) {
        const dirAngle = rng() < 0.5 ? Math.PI * 0.5 : -Math.PI * 0.5;
        const ramp = addRamp(midX, z0 + (dirAngle > 0 ? -4.2 : 4.2), 7.6, 12.5, dirAngle, 3.6);
        addItemBox(
          ramp.x + ramp.dirX * (ramp.length * 0.42),
          3.6,
          ramp.z + ramp.dirZ * (ramp.length * 0.42)
        );
      } else if (rng() < 0.3 * density) {
        addItemBox(midX, 0, z0 - 2.8);
        if (rng() < 0.45 * density) addItemBox(midX, 0, z0 + 2.8);
      }
    }
  }

  update(dt, focusX = 0, focusZ = 0) {
    const safeDt = Math.max(0, Number(dt) || 0);
    this.time += safeDt;

    // Stream chunks around focus and animate visible item boxes
    const visible = this.getVisibleChunks(focusX, focusZ);
    for (let i = 0; i < visible.length; i++) {
      const boxes = visible[i].itemBoxes;
      for (let j = 0; j < boxes.length; j++) {
        const box = boxes[j];
        if (!box.collected) {
          box.spinAngle = this.time * 1.9 + box.phase;
          box.bobOffset = Math.sin(this.time * 3.4 + box.phase) * 0.32;
        }
      }
    }

    // Respawn collected item boxes after 12 seconds globally
    if (this.collectedBoxes.size > 0 && safeDt > 0) {
      for (const box of this.collectedBoxes) {
        box.respawnTimer -= safeDt;
        if (box.respawnTimer <= 0) {
          box.respawnTimer = 0;
          box.collected = false;
          this.collectedBoxes.delete(box);
        }
      }
    }

    // Update active hydrant water geysers & gas fire plumes
    for (let i = this.geysers.length - 1; i >= 0; i--) {
      this.geysers[i].ttl -= safeDt;
      if (this.geysers[i].ttl <= 0) {
        this.geysers.splice(i, 1);
      }
    }
  }

  getVisibleChunks(focusX = 0, focusZ = 0) {
    const ccx = this._worldToChunkCoord(focusX);
    const ccz = this._worldToChunkCoord(focusZ);
    const r = VIEW_CHUNK_RADIUS;
    const out = [];

    const minX = Math.max(MIN_CHUNK, ccx - r);
    const maxX = Math.min(MAX_CHUNK, ccx + r);
    const minZ = Math.max(MIN_CHUNK, ccz - r);
    const maxZ = Math.min(MAX_CHUNK, ccz + r);

    for (let cz = minZ; cz <= maxZ; cz++) {
      for (let cx = minX; cx <= maxX; cx++) {
        const chunk = this._getOrCreateChunk(cx, cz);
        if (chunk) out.push(chunk);
      }
    }
    return out;
  }

  _getNearbyChunks(x, z, radiusChunks = 1) {
    const ccx = this._worldToChunkCoord(x);
    const ccz = this._worldToChunkCoord(z);
    const out = [];
    for (let dz = -radiusChunks; dz <= radiusChunks; dz++) {
      for (let dx = -radiusChunks; dx <= radiusChunks; dx++) {
        const chunk = this._getOrCreateChunk(ccx + dx, ccz + dz);
        if (chunk) out.push(chunk);
      }
    }
    return out;
  }

  getGroundHeight(x, z) {
    // Outside map perimeter becomes open water boundary
    if (Math.abs(x) > HALF_WORLD || Math.abs(z) > HALF_WORLD) {
      return {
        y: WATER_Y,
        surface: 'water',
        rampSlopeX: 0,
        rampSlopeZ: 0,
        speedFactor: 0.42,
      };
    }

    const cx = this._worldToChunkCoord(x);
    const cz = this._worldToChunkCoord(z);

    // 1. Check ramps in current + adjacent chunks (in case ramp sits near a chunk seam)
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const chunk = this._getOrCreateChunk(cx + dx, cz + dz);
        if (!chunk || chunk.ramps.length === 0) continue;
        for (let i = 0; i < chunk.ramps.length; i++) {
          const ramp = chunk.ramps[i];
          const rx = x - ramp.x;
          const rz = z - ramp.z;
          const along = rx * ramp.dirX + rz * ramp.dirZ;
          const across = rx * ramp.dirZ - rz * ramp.dirX;
          if (Math.abs(along) <= ramp.length * 0.5 && Math.abs(across) <= ramp.w * 0.5) {
            const t = clamp((along + ramp.length * 0.5) / ramp.length, 0, 1);
            const slope = ramp.height / ramp.length;
            return {
              y: ramp.height * t,
              surface: 'ramp',
              rampSlopeX: ramp.dirX * slope,
              rampSlopeZ: ramp.dirZ * slope,
              speedFactor: 1.08,
            };
          }
        }
      }
    }

    // 2. River & bridge check in river chunk rows (cz === 5 or cz === -7)
    if (this.isRiverChunkZ(cz)) {
      const nearestGX = Math.round(x / CHUNK_SIZE);
      const bridgeX = nearestGX * CHUNK_SIZE;
      const bridgeHalfW = this.getNSRoadHalfWidth(nearestGX);
      const z0 = cz * CHUNK_SIZE;
      const z1 = z0 + CHUNK_SIZE;

      if (
        this.hasBridgeAtGridX(nearestGX) &&
        Math.abs(x - bridgeX) <= bridgeHalfW &&
        z >= z0 + 6.0 &&
        z <= z1 - 6.0
      ) {
        const rampLen = 10.0;
        let y = BRIDGE_Y;
        let slopeZ = 0;
        if (z < z0 + 6.0 + rampLen) {
          const u = (z - (z0 + 6.0)) / rampLen;
          y = BRIDGE_Y * smoothstep01(u);
          slopeZ = (BRIDGE_Y / rampLen) * 6 * u * (1 - u);
        } else if (z > z1 - 6.0 - rampLen) {
          const u = (z1 - 6.0 - z) / rampLen;
          y = BRIDGE_Y * smoothstep01(u);
          slopeZ = -(BRIDGE_Y / rampLen) * 6 * u * (1 - u);
        }
        return {
          y,
          surface: 'bridge',
          rampSlopeX: 0,
          rampSlopeZ: slopeZ,
          speedFactor: 1.0,
        };
      }

      const riverZ = this.getRiverCenterZ(x, cz);
      if (Math.abs(z - riverZ) <= this.getRiverHalfWidth()) {
        return {
          y: WATER_Y,
          surface: 'water',
          rampSlopeX: 0,
          rampSlopeZ: 0,
          speedFactor: 0.42,
        };
      }
    }

    // 3. Central plaza, grid roads, highways, stunt parks & gas station lots
    if (this._isCentralPlazaRoad(x, z)) {
      return {
        y: 0,
        surface: 'road',
        rampSlopeX: 0,
        rampSlopeZ: 0,
        speedFactor: 1.0,
      };
    }

    const nearestGX = Math.round(x / CHUNK_SIZE);
    const distNS = Math.abs(x - nearestGX * CHUNK_SIZE);
    const onNS =
      distNS <= this.getNSRoadHalfWidth(nearestGX) &&
      (!this.isRiverChunkZ(cz) || this.hasBridgeAtGridX(nearestGX));

    const nearestGZ = Math.round(z / CHUNK_SIZE);
    const distEW = Math.abs(z - nearestGZ * CHUNK_SIZE);
    const onEW = distEW <= this.getEWRoadHalfWidth(nearestGZ);

    const curChunk = this._getOrCreateChunk(cx, cz);
    const onPavedLot =
      curChunk &&
      (curChunk.district === 'stunt_park' || curChunk.district === 'gas_station') &&
      x >= curChunk.lotBounds.minX - 2.5 &&
      x <= curChunk.lotBounds.maxX + 2.5 &&
      z >= curChunk.lotBounds.minZ - 2.5 &&
      z <= curChunk.lotBounds.maxZ + 2.5;

    if (onNS || onEW || onPavedLot) {
      return {
        y: 0,
        surface: 'road',
        rampSlopeX: 0,
        rampSlopeZ: 0,
        speedFactor: 1.0,
      };
    }

    return {
      y: 0,
      surface: 'grass',
      rampSlopeX: 0,
      rampSlopeZ: 0,
      speedFactor: 0.88,
    };
  }

  resolveBuildingCollision(entity) {
    const r = Math.max(0.4, entity.radius || 1.8);
    const ey = entity.y || 0;
    const nearby = this._getNearbyChunks(entity.x, entity.z, 1);

    let hit = false;
    let maxImpactSpeed = 0;
    let outNX = 0;
    let outNZ = 0;
    let hitBuilding = null;

    for (let c = 0; c < nearby.length; c++) {
      const buildings = nearby[c].buildings;
      for (let i = 0; i < buildings.length; i++) {
        const b = buildings[i];
        // Entities flying higher than the building roof sail cleanly over!
        if (ey > b.height) continue;

        const qx = clamp(entity.x, b.minX, b.maxX);
        const qz = clamp(entity.z, b.minZ, b.maxZ);
        const dx = entity.x - qx;
        const dz = entity.z - qz;
        const distSq = dx * dx + dz * dz;

        if (distSq >= r * r) continue;

        let nx = 0;
        let nz = 0;
        let overlap = 0;

        if (distSq > 1e-6) {
          const dist = Math.sqrt(distSq);
          nx = dx / dist;
          nz = dz / dist;
          overlap = r - dist;
        } else {
          // Center inside AABB: push out along shallowest axis
          const dLeft = entity.x - b.minX;
          const dRight = b.maxX - entity.x;
          const dSouth = entity.z - b.minZ;
          const dNorth = b.maxZ - entity.z;
          const minD = Math.min(dLeft, dRight, dSouth, dNorth);
          if (minD === dLeft) {
            nx = -1;
            overlap = dLeft + r;
          } else if (minD === dRight) {
            nx = 1;
            overlap = dRight + r;
          } else if (minD === dSouth) {
            nz = -1;
            overlap = dSouth + r;
          } else {
            nz = 1;
            overlap = dNorth + r;
          }
        }

        entity.x += nx * (overlap + 0.01);
        entity.z += nz * (overlap + 0.01);

        const vx = entity.vx || 0;
        const vz = entity.vz || 0;
        const vn = vx * nx + vz * nz;
        const impact = vn < 0 ? -vn : 0;

        if (vn < 0) {
          const restitution = 0.32;
          entity.vx = (vx - (1 + restitution) * vn * nx) * 0.94;
          entity.vz = (vz - (1 + restitution) * vn * nz) * 0.94;
        }

        if (!hit || impact >= maxImpactSpeed) {
          hit = true;
          maxImpactSpeed = impact;
          outNX = nx;
          outNZ = nz;
          hitBuilding = b;
        }
      }
    }

    // Soft world-border guardrail inside [-HALF_WORLD + 8, HALF_WORLD - 8]
    const limit = HALF_WORLD - 8;
    if (Math.abs(entity.x) > limit) {
      const nx = entity.x > 0 ? -1 : 1;
      const vn = (entity.vx || 0) * nx;
      const impact = vn < 0 ? -vn : 0;
      entity.x = clamp(entity.x, -limit, limit);
      if (vn < 0) entity.vx = -(entity.vx || 0) * 0.4;
      if (!hit) {
        hit = true;
        maxImpactSpeed = impact;
        outNX = nx;
        outNZ = 0;
      }
    }
    if (Math.abs(entity.z) > limit) {
      const nz = entity.z > 0 ? -1 : 1;
      const vn = (entity.vz || 0) * nz;
      const impact = vn < 0 ? -vn : 0;
      entity.z = clamp(entity.z, -limit, limit);
      if (vn < 0) entity.vz = -(entity.vz || 0) * 0.4;
      if (!hit) {
        hit = true;
        maxImpactSpeed = impact;
        outNX = 0;
        outNZ = nz;
      }
    }

    return {
      hit,
      impactSpeed: maxImpactSpeed,
      normalX: outNX,
      normalZ: outNZ,
      building: hitBuilding,
    };
  }

  collideProps(entity, onSmash) {
    const r = Math.max(0.5, entity.radius || 1.8);
    const ey = entity.y || 0;
    const nearby = this._getNearbyChunks(entity.x, entity.z, 1);
    const smashed = [];

    for (let c = 0; c < nearby.length; c++) {
      const chunk = nearby[c];
      const props = chunk.props;
      for (let i = 0; i < props.length; i++) {
        const prop = props[i];
        if (prop.smashed) continue;
        if (ey > (prop.y || 0) + prop.height + 0.6) continue;

        const dx = entity.x - prop.x;
        const dz = entity.z - prop.z;
        const reach = r + prop.radius;
        if (dx * dx + dz * dz > reach * reach) continue;

        this._smashSingleProp(chunk, prop, smashed, onSmash);
      }
    }

    return smashed;
  }

  _smashSingleProp(chunk, prop, smashedList, onSmash) {
    if (prop.smashed) return;
    prop.smashed = true;
    prop.smashTime = this.time;
    smashedList.push(prop);

    if (prop.type === 'hydrant') {
      this.geysers.push({
        type: 'water',
        x: prop.x,
        y: prop.y || 0,
        z: prop.z,
        ttl: 5.5,
      });
    } else if (prop.type === 'gas_pump') {
      this.geysers.push({
        type: 'fire',
        x: prop.x,
        y: prop.y || 0,
        z: prop.z,
        ttl: 7.0,
      });
      // Chain-reaction across sibling gas_pumps & crates in the same gas station!
      if (prop.stationId) {
        for (const gs of chunk.gasStations) {
          if (gs.id === prop.stationId) gs.damaged = true;
        }
        for (const other of chunk.props) {
          if (
            !other.smashed &&
            (other.stationId === prop.stationId ||
              Math.hypot(other.x - prop.x, other.z - prop.z) <= 6.5)
          ) {
            other.smashed = true;
            other.smashTime = this.time;
            smashedList.push(other);
            if (typeof onSmash === 'function') onSmash(other);
          }
        }
      }
    }

    if (typeof onSmash === 'function') {
      onSmash(prop);
    }
  }

  collectItemBoxes(entity) {
    const r = (entity.radius || 1.8) + 1.8;
    const rSq = r * r;
    const ey = entity.y || 0;
    const nearby = this._getNearbyChunks(entity.x, entity.z, 1);
    let collectedCount = 0;

    for (let c = 0; c < nearby.length; c++) {
      const boxes = nearby[c].itemBoxes;
      for (let i = 0; i < boxes.length; i++) {
        const box = boxes[i];
        if (box.collected) continue;
        const dx = entity.x - box.x;
        const dz = entity.z - box.z;
        if (dx * dx + dz * dz > rSq) continue;
        if (Math.abs(ey - (box.y || 0)) > 4.2) continue;

        box.collected = true;
        box.respawnTimer = ITEM_BOX_RESPAWN_SEC;
        this.collectedBoxes.add(box);
        collectedCount++;
      }
    }

    return collectedCount;
  }

  findSpawnPoint(index = 0) {
    // 12 clean starting-grid slots (4 columns x 3 rows) on the wide central plaza boulevard facing North (angle = 0)
    const idx = ((Math.floor(index) % 12) + 12) % 12;
    const col = idx % 4;
    const row = Math.floor(idx / 4);
    const laneOffsets = [-10.5, -3.5, 3.5, 10.5];
    const x = laneOffsets[col];
    const z = -6.0 - row * 9.0;
    return { x, z, angle: 0 };
  }

  findRoadSpawnNear(x, z, minDist = 55, maxDist = 95) {
    const safeMin = Math.max(20, minDist);
    const safeMax = Math.max(safeMin + 10, maxDist);
    const seedVal = hashChunkSeed(
      this.seed,
      Math.round(x * 0.5),
      Math.round(z * 0.5),
      Math.floor(this.time * 10)
    );
    const rng = mulberry32(seedVal);

    for (let attempt = 0; attempt < 24; attempt++) {
      const theta = rng() * Math.PI * 2;
      const dist = safeMin + rng() * (safeMax - safeMin);
      let cx = clamp(x + Math.cos(theta) * dist, -HALF_WORLD + 90, HALF_WORLD - 90);
      let cz = clamp(z + Math.sin(theta) * dist, -HALF_WORLD + 90, HALF_WORLD - 90);

      // Snap onto nearest valid NS or EW road
      const snapNS = attempt % 2 === 0;
      let sx = cx;
      let sz = cz;
      let angle = 0;

      if (snapNS) {
        let gx = Math.round(cx / CHUNK_SIZE);
        const chunkZ = this._worldToChunkCoord(cz);
        if (this.isRiverChunkZ(chunkZ) && !this.hasBridgeAtGridX(gx)) {
          gx += 1; // shift to adjacent bridge-bearing avenue!
        }
        sx = clamp(gx * CHUNK_SIZE + (rng() < 0.5 ? -3.2 : 3.2), -HALF_WORLD + 60, HALF_WORLD - 60);
        sz = cz;
        angle = z >= sz ? 0 : Math.PI;
      } else {
        let gz = Math.round(cz / CHUNK_SIZE);
        sx = cx;
        sz = clamp(gz * CHUNK_SIZE + (rng() < 0.5 ? -3.2 : 3.2), -HALF_WORLD + 60, HALF_WORLD - 60);
        angle = x >= sx ? Math.PI * 0.5 : -Math.PI * 0.5;
      }

      const actualDist = Math.hypot(sx - x, sz - z);
      if (actualDist < safeMin * 0.72) continue;

      const gh = this.getGroundHeight(sx, sz);
      if (gh.surface === 'water') continue;

      const probe = { x: sx, y: gh.y, z: sz, vx: 0, vz: 0, radius: 2.6 };
      const col = this.resolveBuildingCollision(probe);
      if (!col.hit) {
        return { x: sx, z: sz, angle };
      }
    }

    // Guaranteed fallback on nearest highway axis
    const fallbackZ = clamp(z + (z > 0 ? -safeMin : safeMin), -HALF_WORLD + 80, HALF_WORLD - 80);
    return {
      x: 0,
      z: fallbackZ,
      angle: z >= fallbackZ ? 0 : Math.PI,
    };
  }

  getRoadGridInfo(x, z) {
    const nearestGX = Math.round(x / CHUNK_SIZE);
    const nearestGZ = Math.round(z / CHUNK_SIZE);
    const nearestNSX = nearestGX * CHUNK_SIZE;
    const nearestEWZ = nearestGZ * CHUNK_SIZE;
    const distToNS = Math.abs(x - nearestNSX);
    const distToEW = Math.abs(z - nearestEWZ);
    const nsHalf = this.getNSRoadHalfWidth(nearestGX);
    const ewHalf = this.getEWRoadHalfWidth(nearestGZ);
    const chunkX = this._worldToChunkCoord(x);
    const chunkZ = this._worldToChunkCoord(z);

    const nsValidHere = !this.isRiverChunkZ(chunkZ) || this.hasBridgeAtGridX(nearestGX);
    const onNSRoad = nsValidHere && distToNS <= nsHalf;
    const onEWRoad = distToEW <= ewHalf;

    const northChunkRiver = this.isRiverChunkZ(nearestGZ);
    const southChunkRiver = this.isRiverChunkZ(nearestGZ - 1);
    const bridgeHere = this.hasBridgeAtGridX(nearestGX);

    return {
      nearestNSX,
      nearestEWZ,
      distToNS,
      distToEW,
      onNSRoad,
      onEWRoad,
      isIntersection: onNSRoad && onEWRoad,
      isHighwayNS: this.isHighwayGrid(nearestGX),
      isHighwayEW: this.isHighwayGrid(nearestGZ),
      nsRoadWidth: nsHalf * 2,
      ewRoadWidth: ewHalf * 2,
      canGoNorth: (!northChunkRiver || bridgeHere) && nearestGZ < MAX_CHUNK,
      canGoSouth: (!southChunkRiver || bridgeHere) && nearestGZ > MIN_CHUNK,
      canGoEast: nearestGX < MAX_CHUNK,
      canGoWest: nearestGX > MIN_CHUNK,
      chunkX,
      chunkZ,
    };
  }
}
