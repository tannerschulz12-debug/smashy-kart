// Automated End-to-End Verification Suite for Smashy Kart: Wanted
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import net from 'node:net';

import {
  WORLD_CONFIG,
  VEHICLES,
  COP_VEHICLES,
  ABILITIES,
  BIOMES,
  DEFAULT_KEYBINDS,
  HUD_LAYOUT_PRESETS,
  createDefaultSettings,
  clampDropRatePct,
  createDefaultItemWeights,
  cloneItemWeights,
  sliderToDropPct,
  dropPctToSlider,
  computeAbilityDropOdds,
} from '../public/js/config.js';
import { World } from '../public/js/world.js';
import { buildVehicleParts } from '../public/js/models.js';
import { Renderer3D, POV_CAMERA_RIGS } from '../public/js/renderer3d.js';
import { AbilitySystem, NUKE_COUNTDOWN_SEC } from '../public/js/abilities.js';
import { SoundManager, SOUND_SLOTS } from '../public/js/audio.js';
import { Simulation } from '../public/js/physics_ai.js';
import { renderQrCodeSvg, generateQrMatrix, MultiplayerClient } from '../public/js/multiplayer.js';
import { startServer } from '../server.mjs';

function createSampleWavBytes(numSamples = 4500, sampleRate = 11025) {
  const buf = Buffer.alloc(44 + numSamples * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + numSamples * 2, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(numSamples * 2, 40);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5;
    buf.writeInt16LE(Math.round(s * 0x7fff), 44 + i * 2);
  }
  return buf;
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') });
      });
    }).on('error', reject);
  });
}

// Minimal RFC-6455 masked client helper for testing server.mjs in Node without external packages
function connectTestWs(port) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(
        `GET /ws HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`
      );
    });

    let upgraded = false;
    let buf = Buffer.alloc(0);
    const messages = [];
    const waiters = [];

    const pushMsg = (obj) => {
      for (let i = 0; i < waiters.length; i++) {
        if (waiters[i].pred(obj)) {
          const w = waiters.splice(i, 1)[0];
          w.resolve(obj);
          return;
        }
      }
      messages.push(obj);
    };

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const header = buf.subarray(0, idx).toString('utf8');
        if (!header.includes('101')) {
          reject(new Error(`Unexpected handshake: ${header}`));
          return;
        }
        upgraded = true;
        buf = buf.subarray(idx + 4);
        resolve(api);
      }

      while (buf.length >= 2) {
        const b1 = buf[1];
        let len = b1 & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          offset = 10;
        }
        if (buf.length < offset + len) return;
        const payload = buf.subarray(offset, offset + len).toString('utf8');
        buf = buf.subarray(offset + len);
        try {
          pushMsg(JSON.parse(payload));
        } catch {
          // ignore non-json
        }
      }
    });

    socket.on('error', reject);

    const api = {
      send(obj) {
        const payload = Buffer.from(JSON.stringify(obj), 'utf8');
        const mask = crypto.randomBytes(4);
        let header;
        if (payload.length < 126) {
          header = Buffer.alloc(6);
          header[0] = 0x81;
          header[1] = 0x80 | payload.length;
          mask.copy(header, 2);
        } else if (payload.length < 65536) {
          header = Buffer.alloc(8);
          header[0] = 0x81;
          header[1] = 0x80 | 126;
          header.writeUInt16BE(payload.length, 2);
          mask.copy(header, 4);
        } else {
          header = Buffer.alloc(14);
          header[0] = 0x81;
          header[1] = 0x80 | 127;
          header.writeBigUInt64BE(BigInt(payload.length), 2);
          mask.copy(header, 10);
        }
        const masked = Buffer.alloc(payload.length);
        for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3];
        socket.write(Buffer.concat([header, masked]));
      },
      waitFor(pred, timeoutMs = 4000) {
        const existingIdx = messages.findIndex(pred);
        if (existingIdx !== -1) {
          return Promise.resolve(messages.splice(existingIdx, 1)[0]);
        }
        return new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('Timed out waiting for WS message')), timeoutMs);
          waiters.push({
            pred,
            resolve: (val) => {
              clearTimeout(t);
              res(val);
            },
          });
        });
      },
      close() {
        socket.destroy();
      },
    };
  });
}

async function runAllChecks() {
  console.log('1. Checking 4800x4800 (2x bigger) seeded Smashy Road world, Airport runways & Sugar boxes...');
  assert.equal(WORLD_CONFIG.WORLD_SIZE, 4800, 'World must be 2x bigger (4800x4800)');
  assert.equal(WORLD_CONFIG.HALF_WORLD, 2400);
  for (const biomeId of Object.keys(BIOMES)) {
    const wA = new World(424242, biomeId, { itemBoxDensity: 1.3 });
    const wB = new World(424242, biomeId, { itemBoxDensity: 1.3 });
    const chunksA = wA.getVisibleChunks(0, 0);
    const chunksB = wB.getVisibleChunks(0, 0);
    assert.equal(chunksA.length, chunksB.length, `Chunk count mismatch in ${biomeId}`);
    assert.equal(chunksA[0].buildings.length, chunksB[0].buildings.length, 'Non-deterministic buildings');
  }

  const world = new World(777123, 'city', { itemBoxDensity: 1.4 });
  const spawns = Array.from({ length: 16 }, (_, i) => world.findSpawnPoint(i));
  const spawnKeys = new Set();
  for (let i = 0; i < spawns.length; i++) {
    const key = `${spawns[i].x},${spawns[i].z}`;
    assert.equal(spawnKeys.has(key), false, `Spawn ${i} overlaps an earlier player slot`);
    spawnKeys.add(key);
    const g = world.getGroundHeight(spawns[i].x, spawns[i].z);
    assert.notEqual(g.surface, 'water', `Spawn ${i} landed in water`);
    const hit = world.resolveBuildingCollision({ ...spawns[i], y: 0, vx: 0, vz: 0, radius: 2.1 });
    assert.equal(hit.hit, false, `Spawn ${i} overlaps a building`);
  }

  // Verify off-screen directional edge/corner waypoint projection in all 4 directions (including behind camera!)
  const mockRenderer = new Renderer3D(null);
  mockRenderer.resize(390, 844, 1);
  mockRenderer.setCamera({ x: 0, y: 0, z: 0, vx: 0, vz: 0, angle: 0 }, 'chase', 0, 1);
  const pad = { left: 60, right: 60, top: 100, bottom: 100 };
  const wpOnScreen = mockRenderer.projectWaypoint(0, 2, 5, pad);
  assert.equal(wpOnScreen.onScreen, true, 'Close friend in front should be onScreen');
  const wpBehind = mockRenderer.projectWaypoint(0, 2, -400, { left: 10, right: 10, top: 76, bottom: 12 });
  assert.equal(wpBehind.onScreen, false, 'Friend 400m behind should be offScreen');
  assert.equal(Math.round(wpBehind.y), 844 - 12, 'Friend directly behind in chase cam must pin flush to bottom edge');
  const wpFarEast = mockRenderer.projectWaypoint(-400, 2, 20, { left: 10, right: 10, top: 76, bottom: 12 });
  assert.equal(wpFarEast.onScreen, false);
  assert.ok(wpFarEast.x >= 10 && wpFarEast.x <= 380, 'Off-screen X must stay clamped inside outer rim');

  // Verify First-Person Point-of-View ('pov') camera mode & self-cutout suppression ID
  mockRenderer.setCamera({ id: 'local', x: 0, y: 0, z: 0, vx: 0, vz: 40, angle: 0, sugarActive: true }, 'pov', 0, 1, { povFov: 78 });
  assert.equal(mockRenderer.currentCameraMode, 'pov');
  assert.equal(mockRenderer.povFocusId, 'local');
  const wpAheadPov = mockRenderer.projectWaypoint(0, 1.8, 25, { left: 10, right: 10, top: 76, bottom: 12 });
  assert.equal(wpAheadPov.onScreen, true, 'Road 25m ahead must project cleanly into First-Person POV view');

  console.log('2. Checking all 12 vehicle blueprints (exterior + zero-clipping First-Person Hood POV + attract camera)...');
  for (const v of VEHICLES) {
    const parts = buildVehicleParts(v.id, v.color, v.accent, 0.5);
    assert.ok(parts.length >= 8, `Vehicle ${v.id} has too few voxel parts`);

    const rig = POV_CAMERA_RIGS[v.id];
    assert.ok(rig && Number.isFinite(rig.eyeY) && Number.isFinite(rig.fwdZ), `Missing POV_CAMERA_RIGS for ${v.id}`);
    const povParts = buildVehicleParts(v.id, v.color, v.accent, 0.5, { povSelf: true, steer: 0.4, time: 1.0 });
    assert.ok(povParts.length >= 4, `Vehicle ${v.id} POV hood has too few parts`);
    const minSafeZ = rig.fwdZ + 0.36;
    for (const p of povParts) {
      const partBackZ = p.oz - p.sz * 0.5;
      assert.ok(
        partBackZ >= minSafeZ - 0.02,
        `Vehicle ${v.id} POV part clips near plane (partBackZ=${partBackZ.toFixed(2)} < minSafeZ=${minSafeZ.toFixed(2)})`
      );
    }
  }
  assert.ok(POV_CAMERA_RIGS.photo_car && POV_CAMERA_RIGS.runner, 'photo_car and runner POV rigs must exist');
  for (const cv of COP_VEHICLES) {
    const extParts = buildVehicleParts(cv.id, cv.color, cv.accent, 0.5);
    assert.ok(extParts.length >= 8, `Cop vehicle ${cv.id} exterior has too few parts`);
    const cRig = POV_CAMERA_RIGS[cv.id];
    assert.ok(cRig && Number.isFinite(cRig.eyeY) && Number.isFinite(cRig.fwdZ), `Missing POV_CAMERA_RIGS for ${cv.id}`);
    const cPovParts = buildVehicleParts(cv.id, cv.color, cv.accent, 0.5, { povSelf: true, steer: 0.3, time: 1.0 });
    assert.ok(cPovParts.length >= 3, `Cop vehicle ${cv.id} POV has too few parts`);
    const minSafeCopZ = cRig.fwdZ + 0.36;
    for (const p of cPovParts) {
      const partBackZ = p.oz - p.sz * 0.5;
      assert.ok(
        partBackZ >= minSafeCopZ - 0.02,
        `Cop vehicle ${cv.id} POV part clips near plane (partBackZ=${partBackZ.toFixed(2)} < minSafeZ=${minSafeCopZ.toFixed(2)})`
      );
    }
  }

  mockRenderer.setCamera({ id: 'local', x: 0, y: 0, z: 0, vx: 0, vz: 25, angle: 0 }, 'attract', 0, 0.5);
  assert.equal(mockRenderer.povFocusId, null, 'Attract showcase camera must keep roof face cutout visible');
  mockRenderer.setGraphicsQuality('performance');
  mockRenderer.setGraphicsQuality('high');

  // Verify Claw HUD preset & Default Keybinds
  assert.ok(HUD_LAYOUT_PRESETS.claw.brake.yPct <= 30, 'Claw preset must place Brake at top pointer-finger zone');
  assert.ok(HUD_LAYOUT_PRESETS.claw.useItem.yPct <= 30, 'Claw preset must place Use Item at top pointer-finger zone');
  assert.ok(DEFAULT_KEYBINDS.brake.includes('KeyS'), 'Default Brake keybind must include KeyS');

  console.log('3. Checking Mario Kart AbilitySystem + all 3 locked character modes...');
  const settings = createDefaultSettings();
  const abilities = new AbilitySystem(settings);
  const sim = new Simulation(world, abilities, settings);

  for (const mode of ['car_driver', 'photo_car', 'runner']) {
    sim.resetRun(777123, { ...settings, characterMode: mode });
    assert.equal(sim.localPlayer.characterMode, mode);
    for (let step = 0; step < 30; step++) {
      sim.update(1 / 60, { left: step < 15, right: step >= 15, brake: false, useItem: false, horn: false }, step / 60);
    }
    assert.equal(sim.localPlayer.characterMode, mode, 'Character mode must stay locked during run');
    assert.ok(sim.localPlayer.speed > 5, `${mode} failed to accelerate`);
  }

  // Test all 10 abilities (including Tactical Nuke, Twin-Rocket RPG & 3x Sugar Rush!) firing cleanly
  assert.ok(ABILITIES.some((a) => a.id === 'tactical_nuke'), 'Tactical Nuke must be in ABILITIES');
  assert.ok(ABILITIES.some((a) => a.id === 'sugar_rush'), 'Sugar Rush must be in ABILITIES');
  abilities.reset();
  sim.localPlayer.items.heldItem = 'homing_rocket';
  sim.localPlayer.items.charges = 1;
  const rpgRes = abilities.useHeldItem(sim.localPlayer, {
    world,
    cops: sim.cops,
    traffic: sim.traffic,
    localPlayer: sim.localPlayer,
    remotePlayers: [],
    onEvent: () => {},
  });
  assert.equal(rpgRes.used, true);
  const rpgRockets = abilities.getProjectiles().filter((p) => p.type === 'rpg_rocket' || p.type === 'homing_rocket');
  assert.equal(rpgRockets.length, 2, 'Twin-Rocket RPG must launch TWO rockets simultaneously');

  for (const ab of ABILITIES) {
    sim.localPlayer.items.heldItem = ab.id;
    sim.localPlayer.items.charges = ab.charges || 1;
    const res = abilities.useHeldItem(sim.localPlayer, {
      world,
      cops: sim.cops,
      traffic: sim.traffic,
      localPlayer: sim.localPlayer,
      remotePlayers: [],
      onEvent: () => {},
    });
    assert.equal(res.used, true, `Ability ${ab.id} failed to activate`);
  }
  assert.ok(sim.localPlayer.sugarActive || sim.localPlayer.items.sugarTimer >= 0, 'Sugar Rush state tracked');

  console.log('3b. Checking 0.1%–1000% ability drop probability math, 500% box density, & 500% Sugar Box spawn rate...');
  assert.equal(clampDropRatePct(0.01), 0.1);
  assert.equal(clampDropRatePct(0.1), 0.1);
  assert.equal(clampDropRatePct(500), 500);
  assert.equal(clampDropRatePct(1000), 1000);
  assert.equal(clampDropRatePct(2500), 1000);

  assert.equal(sliderToDropPct(0), 0.1, 'sliderToDropPct(0) must equal 0.1');
  assert.equal(sliderToDropPct(20), 5, 'sliderToDropPct(20) must equal 5');
  assert.equal(sliderToDropPct(50), 100, 'sliderToDropPct(50) must equal 100');
  assert.equal(sliderToDropPct(80), 500, 'sliderToDropPct(80) must equal 500');
  assert.equal(sliderToDropPct(100), 1000, 'sliderToDropPct(100) must equal 1000');

  assert.equal(dropPctToSlider(0.1), 0);
  assert.equal(dropPctToSlider(5), 20);
  assert.equal(dropPctToSlider(100), 50);
  assert.equal(dropPctToSlider(500), 80);
  assert.equal(dropPctToSlider(1000), 100);

  const defWeights = createDefaultItemWeights();
  for (const ab of ABILITIES) {
    assert.equal(defWeights[ab.id], 100, `Default weight for ${ab.id} must be 100`);
  }
  const defaultOdds = computeAbilityDropOdds(settings.enabledItems, defWeights);
  const oddsSum = Object.values(defaultOdds).reduce((acc, v) => acc + v, 0);
  assert.ok(Math.abs(oddsSum - 100) < 1e-6, `computeAbilityDropOdds must sum to ~100%, got ${oddsSum}`);

  // Verify World 500% itemBoxDensity (>= 2.5x boxes vs 100%) & 500% sugarBoxRate (>80% sugar boxes) & non-overlapping (x,z)
  const world100 = new World(777123, 'city', { itemBoxDensity: 1.0, sugarBoxRate: 1.0 });
  const world500 = new World(777123, 'city', { itemBoxDensity: 5.0, sugarBoxRate: 5.0 });
  const worldZeroSugar = new World(777123, 'city', { itemBoxDensity: 1.2, sugarBoxRate: 0.0 });

  const boxes100 = world100.getVisibleChunks(0, 0).flatMap((c) => c.itemBoxes);
  const boxes500 = world500.getVisibleChunks(0, 0).flatMap((c) => c.itemBoxes);
  const boxesZeroSugar = worldZeroSugar.getVisibleChunks(0, 0).flatMap((c) => c.itemBoxes);

  assert.ok(
    boxes500.length >= boxes100.length * 2.5,
    `itemBoxDensity 5.0 (${boxes500.length}) must spawn >= 2.5x boxes vs 1.0 (${boxes100.length})`
  );
  const sugar500Count = boxes500.filter((b) => b.boxType === 'sugar').length;
  const sugar500Ratio = sugar500Count / Math.max(1, boxes500.length);
  assert.ok(
    sugar500Ratio > 0.8,
    `sugarBoxRate 5.0 must produce >80% sugar boxes, got ${(sugar500Ratio * 100).toFixed(1)}%`
  );
  assert.equal(
    boxesZeroSugar.filter((b) => b.boxType === 'sugar').length,
    0,
    'sugarBoxRate 0.0 must produce 0% sugar boxes'
  );

  const coordSet500 = new Set();
  for (const bx of boxes500) {
    const cKey = `${bx.x.toFixed(2)},${bx.z.toFixed(2)}`;
    assert.equal(coordSet500.has(cKey), false, `Overlapping item box at (${cKey}) in 500% world`);
    coordSet500.add(cKey);
  }

  // Verify AbilitySystem weighted pickup rolling: homing_rocket: 1000 & all others 0.1 -> >95% homing_rocket!
  const extremeWeights = {};
  const minWeights = {};
  for (const ab of ABILITIES) {
    extremeWeights[ab.id] = ab.id === 'homing_rocket' ? 1000 : 0.1;
    minWeights[ab.id] = 0.1;
  }
  const weightedAbilities = new AbilitySystem({
    ...createDefaultSettings(),
    itemWeights: cloneItemWeights(extremeWeights),
  });
  let rpgRolls = 0;
  for (let i = 0; i < 100; i++) {
    const dummyPlayer = { id: 'tester', items: weightedAbilities.createPlayerItemState() };
    assert.equal(weightedAbilities.triggerItemBox(dummyPlayer, 0), true);
    weightedAbilities.updatePlayerItemState(dummyPlayer, 2.0, {});
    if (dummyPlayer.items.heldItem === 'homing_rocket') rpgRolls++;
  }
  assert.ok(
    rpgRolls > 95,
    `Expected >95 homing_rocket rolls out of 100 at 1000% vs 0.1%, got ${rpgRolls}`
  );

  // Verify all enabled abilities at 0.1% still roll cleanly without divide-by-zero
  const allPointOneAbilities = new AbilitySystem({
    ...createDefaultSettings(),
    itemWeights: cloneItemWeights(minWeights),
  });
  const pointOnePlayer = { id: 'tester2', items: allPointOneAbilities.createPlayerItemState() };
  assert.equal(allPointOneAbilities.triggerItemBox(pointOnePlayer, 0.5), true);
  allPointOneAbilities.updatePlayerItemState(pointOnePlayer, 2.0, {});
  assert.ok(ABILITIES.some((a) => a.id === pointOnePlayer.items.heldItem));

  console.log('3c. Checking aiCopsEnabled:false, Playable Police Team (Heli flight & Tank), & 2.0s soft-tracking missiles...');
  assert.deepEqual(
    COP_VEHICLES.map((c) => c.id),
    ['cop_cruiser', 'cop_swat', 'cop_heli', 'cop_tank'],
    'COP_VEHICLES must expose all 4 playable Police units'
  );
  const heliDef = COP_VEHICLES.find((c) => c.id === 'cop_heli');
  const tankDef = COP_VEHICLES.find((c) => c.id === 'cop_tank');
  assert.equal(heliDef.flying, true);
  assert.equal(heliDef.hasMissile, true);
  assert.equal(heliDef.missileCooldown, 2.0);
  assert.equal(tankDef.hasMissile, true);
  assert.equal(tankDef.missileCooldown, 2.0);
  assert.equal(tankDef.maxHp, 220);
  assert.equal(tankDef.mass, 2.6);

  // Verify aiCopsEnabled: false spawns 0 AI police, keeps wantedStars === 0, emits zero star_up events, and never triggers AI arrest progress
  sim.resetRun(777123, { ...settings, playerRole: 'runner', aiCopsEnabled: false, autoAccelerate: false });
  assert.equal(sim.cops.length, 0, 'aiCopsEnabled: false must spawn 0 initial AI cops');
  assert.equal(sim.wantedStars, 0, 'aiCopsEnabled: false must set wantedStars === 0 at resetRun');
  let starUpCount = 0;
  for (let step = 0; step < 520; step++) {
    const evs = sim.update(0.05, {}, (step + 1) * 0.05);
    if (evs.some((e) => e.type === 'star_up')) starUpCount++;
  }
  assert.equal(sim.cops.length, 0, 'aiCopsEnabled: false must keep 0 AI cops during gameplay');
  assert.equal(sim.wantedStars, 0, 'aiCopsEnabled: false must keep wantedStars === 0 past 25s');
  assert.equal(starUpCount, 0, 'aiCopsEnabled: false must emit zero star_up events');
  assert.equal(sim.localPlayer.bustedProgress, 0, 'aiCopsEnabled: false must keep bustedProgress at 0');

  // Verify playing as Cop with aiCopsEnabled: true also suppresses star_up wanted toasts
  sim.resetRun(777123, { ...settings, playerRole: 'cop', copVehicleId: 'cop_cruiser', aiCopsEnabled: true, autoAccelerate: false });
  let copStarUpCount = 0;
  for (let step = 0; step < 500; step++) {
    const evs = sim.update(0.05, {}, (step + 1) * 0.05);
    if (evs.some((e) => e.type === 'star_up')) copStarUpCount++;
  }
  assert.equal(copStarUpCount, 0, 'playerRole: cop must suppress star_up wanted toasts');

  // Verify cop_heli flies cleanly over downtown buildings AND rivers without colliding or drowning!
  sim.resetRun(777123, { ...settings, playerRole: 'cop', copVehicleId: 'cop_heli', aiCopsEnabled: false });
  assert.equal(sim.localPlayer.playerRole, 'cop');
  assert.equal(sim.localPlayer.copVehicleId, 'cop_heli');
  assert.equal(sim.localPlayer.flying, true);
  assert.ok(sim.localPlayer.y >= 11.0, `cop_heli must hover >= 11m, got y=${sim.localPlayer.y}`);

  // Place cop_heli directly above non-bridge river water (gx = 1 -> x = 60, cz = 5 -> river center)
  const riverZ = world.getRiverCenterZ(60, 5);
  assert.equal(world.getGroundHeight(60, riverZ).surface, 'water', 'Test coordinate must be open river water');
  sim.localPlayer.x = 60;
  sim.localPlayer.z = riverZ;
  for (let step = 0; step < 20; step++) {
    sim.update(1 / 60, { left: false, right: false, brake: false }, step / 60);
  }
  assert.equal(sim.localPlayer.alive, true, 'cop_heli must fly over river water without drowning');
  assert.ok(sim.localPlayer.y >= 11.0, 'cop_heli must stay airborne above river');

  // Place cop_heli directly through a building footprint and confirm no wall slowdown/damage
  const anyBuilding = world.getVisibleChunks(0, 0).flatMap((c) => c.buildings)[0];
  assert.ok(anyBuilding, 'Expected at least one building in visible chunks');
  sim.localPlayer.x = anyBuilding.x;
  sim.localPlayer.z = anyBuilding.z;
  const hpBeforeFlyOver = sim.localPlayer.hp;
  sim.update(1 / 60, { left: false, right: false, brake: false }, 1.0);
  assert.equal(sim.localPlayer.hp, hpBeforeFlyOver, 'cop_heli must fly cleanly over buildings without collision damage');

  // Verify strict 2.0s missile cooldown for BOTH cop_heli and cop_tank + light turn-rate cap (<= 1.2 rad/s) + 10m break-lock!
  for (const unitId of ['cop_heli', 'cop_tank']) {
    abilities.reset();
    sim.resetRun(777123, { ...settings, playerRole: 'cop', copVehicleId: unitId, aiCopsEnabled: false });
    const copP = sim.localPlayer;
    const ctx = {
      world,
      cops: [],
      traffic: [],
      localPlayer: copP,
      remotePlayers: [{ id: 'runner_target', name: 'Runner', playerRole: 'runner', alive: true, x: 18, y: 0, z: 34, radius: 2.1 }],
      onEvent: () => {},
    };

    const shot1 = abilities.fireCopMissile(copP, ctx);
    assert.equal(shot1.used, true, `${unitId} initial missile shot must fire`);
    assert.equal(copP.copMissileCooldown, 2.0, `${unitId} must set strict 2.0s cooldown`);
    assert.ok(shot1.projectile && shot1.projectile.maxTurnRate <= 1.2, 'Missile maxTurnRate must be <= 1.2 rad/s');

    // Measure actual turn rate over 0.1s step toward off-axis runner in forward cone (dist ~38.5m > 10m)
    const ang0 = shot1.projectile.angle;
    abilities.updateProjectiles(0.1, ctx);
    const turnRateObserved = Math.abs(shot1.projectile.angle - ang0) / 0.1;
    assert.ok(
      turnRateObserved > 0 && turnRateObserved <= 1.2001,
      `${unitId} missile turn rate (${turnRateObserved.toFixed(3)} rad/s) must be gentle (>0 and <= 1.2 rad/s)`
    );

    // At 0.5s elapsed (1.5s cooldown remaining), 2nd shot MUST be rejected!
    abilities.updatePlayerItemState(copP, 0.5, ctx);
    const shotEarly = abilities.fireCopMissile(copP, ctx);
    assert.equal(shotEarly.used, false, `${unitId} 2nd missile shot at 0.5s must be rejected by 2.0s cooldown`);

    // Advance another 1.55s (2.05s total elapsed) -> next shot MUST succeed!
    abilities.updatePlayerItemState(copP, 1.55, ctx);
    const shotReady = abilities.fireCopMissile(copP, ctx);
    assert.equal(shotReady.used, true, `${unitId} missile shot at 2.05s must succeed`);
  }

  // Verify terminal 10m break-lock: missile stops turning once target is within <= 10m horizontally
  abilities.reset();
  const closeCtx = {
    world,
    cops: [],
    traffic: [],
    localPlayer: sim.localPlayer,
    remotePlayers: [{ id: 'close_runner', name: 'Juker', playerRole: 'runner', alive: true, x: 4, y: 0, z: 7, radius: 2.0 }],
    onEvent: () => {},
  };
  sim.localPlayer.x = 0;
  sim.localPlayer.z = 0;
  sim.localPlayer.angle = 0;
  sim.localPlayer.turretAngle = 0;
  sim.localPlayer.copMissileCooldown = 0;
  const closeShot = abilities.fireCopMissile(sim.localPlayer, closeCtx);
  const preBreakAng = closeShot.projectile.angle;
  abilities.updateProjectiles(0.05, closeCtx);
  assert.equal(closeShot.projectile.angle, preBreakAng, 'Cop missile must stop homing inside 10m horizontal distance');

  console.log('3d. Checking Tactical Nuke (0.1%–1000% odds, 2x real-player kill multiplier, 5.0s live tracking, Party vs Solo NPC ban)...');
  assert.equal(ABILITIES.length, 10, 'ABILITIES must contain all 10 items including Tactical Nuke');
  assert.equal(ABILITIES[0].id, 'tactical_nuke', 'tactical_nuke must be featured at index 0 of ABILITIES');
  assert.equal(NUKE_COUNTDOWN_SEC, 5.0, 'NUKE_COUNTDOWN_SEC must be exactly 5.0 seconds');
  assert.equal(createDefaultSettings().nukeKillDoubleOdds, true, 'nukeKillDoubleOdds must default to true');

  // Verify 0.1%–1000% drop rate & nukeKillDoubleOdds doubling weight on real-player kills (0 -> 1 -> 2)
  const nukeOdds0 = computeAbilityDropOdds(settings.enabledItems, defWeights, { playerKills: 0, nukeKillDoubleOdds: true });
  const nukeOdds1 = computeAbilityDropOdds(settings.enabledItems, defWeights, { playerKills: 1, nukeKillDoubleOdds: true });
  const nukeOdds2 = computeAbilityDropOdds(settings.enabledItems, defWeights, { playerKills: 2, nukeKillDoubleOdds: true });
  const nukeOddsOff = computeAbilityDropOdds(settings.enabledItems, defWeights, { playerKills: 2, nukeKillDoubleOdds: false });
  assert.ok(nukeOdds1.tactical_nuke > nukeOdds0.tactical_nuke * 1.8, '1 real-player kill must double Tactical Nuke weight');
  assert.ok(nukeOdds2.tactical_nuke > nukeOdds1.tactical_nuke * 1.7, '2 real-player kills must quadruple Tactical Nuke weight');
  assert.ok(Math.abs(nukeOddsOff.tactical_nuke - nukeOdds0.tactical_nuke) < 1e-6, 'nukeKillDoubleOdds: false must preserve base odds');

  const nuke1000Weights = {};
  for (const ab of ABILITIES) nuke1000Weights[ab.id] = ab.id === 'tactical_nuke' ? 1000 : 0.1;
  const nuke1000Odds = computeAbilityDropOdds(settings.enabledItems, nuke1000Weights);
  assert.ok(nuke1000Odds.tactical_nuke > 99, `1000% Nuke Chaos must yield >99% Tactical Nuke odds, got ${nuke1000Odds.tactical_nuke.toFixed(2)}%`);

  // Verify AbilitySystem pickup rolling multiplies Nuke odds by 2^playerKills while ignoring AI copsWrecked
  const nukeRollAbilities = new AbilitySystem({ ...createDefaultSettings(), nukeKillDoubleOdds: true });
  let nukeHits0 = 0;
  let nukeHits6 = 0;
  for (let i = 0; i < 200; i++) {
    const p0 = { id: 'p0', playerKills: 0, copsWrecked: 50, items: nukeRollAbilities.createPlayerItemState() };
    nukeRollAbilities.triggerItemBox(p0, 0);
    nukeRollAbilities.updatePlayerItemState(p0, 2.0, {});
    if (p0.items.heldItem === 'tactical_nuke') nukeHits0++;

    const p6 = { id: 'p6', playerKills: 6, copsWrecked: 0, items: nukeRollAbilities.createPlayerItemState() };
    nukeRollAbilities.triggerItemBox(p6, 0);
    nukeRollAbilities.updatePlayerItemState(p6, 2.0, {});
    if (p6.items.heldItem === 'tactical_nuke') nukeHits6++;
  }
  assert.ok(
    nukeHits6 > nukeHits0 + 40,
    `6 real-player kills (64x Nuke weight) must dramatically increase Nuke rolls (${nukeHits6} vs ${nukeHits0})`
  );

  // Party mode: refuses to target NPCs when no alive real player exists (does NOT consume Nuke)
  abilities.reset();
  const partyLauncher = {
    id: 'p_launcher',
    name: 'Tanner',
    alive: true,
    x: 0,
    y: 0,
    z: 0,
    angle: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    hp: 100,
    maxHp: 100,
    items: abilities.createPlayerItemState(),
  };
  partyLauncher.items.heldItem = 'tactical_nuke';
  partyLauncher.items.charges = 1;
  const partyCop = { id: 'cop_1', type: 'cruiser', x: 10, y: 0, z: 10, alive: true, wrecked: false, radius: 2.0 };
  const partyNpc = { id: 'npc_1', type: 'sedan', x: 12, y: 0, z: 12, alive: true, wrecked: false, radius: 1.95 };
  const noTargetEvs = [];
  const partyNoTargetRes = abilities.useHeldItem(partyLauncher, {
    world,
    cops: [partyCop],
    traffic: [partyNpc],
    localPlayer: partyLauncher,
    remotePlayers: [{ id: 'p_dead', name: 'Eliminated', alive: false, x: 15, y: 0, z: 15 }],
    isParty: true,
    onEvent: (ev) => noTargetEvs.push(ev),
  });
  assert.equal(partyNoTargetRes.used, false, 'Party mode must refuse to target NPCs when no alive real player exists');
  assert.equal(partyNoTargetRes.reason, 'no_real_target');
  assert.equal(partyLauncher.items.heldItem, 'tactical_nuke', 'Refused Party Nuke must not consume heldItem');
  assert.equal(partyLauncher.items.charges, 1, 'Refused Party Nuke must preserve charge');
  assert.ok(noTargetEvs.some((e) => e.type === 'nuke_no_target'), 'Refused Party Nuke must emit nuke_no_target');

  // Party mode: refuses explicit cop click even when an alive real player is present
  const partyVictim = {
    id: 'p_victim',
    name: 'Friend',
    alive: true,
    x: 30,
    y: 0,
    z: 40,
    vx: 0,
    vy: 0,
    vz: 0,
    hp: 100,
    maxHp: 100,
    radius: 2.1,
    items: abilities.createPlayerItemState(),
  };
  const partyCopReject = abilities.useHeldItem(partyLauncher, {
    world,
    cops: [partyCop],
    traffic: [partyNpc],
    localPlayer: partyLauncher,
    remotePlayers: [partyVictim],
    isParty: true,
    targetId: 'cop_1',
    targetKind: 'cop',
    onEvent: () => {},
  });
  assert.equal(partyCopReject.used, false, 'Party mode must NEVER target AI cops even when explicitly clicked');
  assert.equal(partyLauncher.items.heldItem, 'tactical_nuke');

  // Party mode: locks onto alive real player, tracks moving player over exact 5.0s countdown, & guarantees 100% lethal hit!
  const partyFireEvs = [];
  const partyFireRes = abilities.useHeldItem(partyLauncher, {
    world,
    cops: [partyCop],
    traffic: [partyNpc],
    localPlayer: partyLauncher,
    remotePlayers: [partyVictim],
    isParty: true,
    targetId: 'p_victim',
    targetKind: 'player',
    onEvent: (ev) => partyFireEvs.push(ev),
  });
  assert.equal(partyFireRes.used, true, 'Party Nuke must fire on locked real player');
  assert.equal(partyFireRes.netEvent?.targetId, 'p_victim');
  assert.equal(partyFireRes.netEvent?.targetKind, 'player');
  assert.ok(partyLauncher.items.nukeSafeTimer >= 6.0, 'Launcher must get nukeSafeTimer protection');
  assert.ok(partyFireEvs.some((e) => e.type === 'nuke_incoming' && e.countdown === 5.0));

  const victimAbilities = new AbilitySystem(createDefaultSettings());
  const victimEvs = [];
  const victimCtx = {
    world,
    cops: [],
    traffic: [],
    localPlayer: partyVictim,
    remotePlayers: [partyLauncher],
    isParty: true,
    time: 10.0,
    onEvent: (ev) => victimEvs.push(ev),
  };
  victimAbilities.spawnNetworkAbilityEvent(partyFireRes.netEvent, victimCtx);
  const inboundNuke = victimAbilities.getProjectiles().find((p) => p.type === 'tactical_nuke');
  assert.ok(inboundNuke, 'Victim client must spawn inbound tactical_nuke projectile');
  assert.equal(inboundNuke.countdown, 5.0, 'Inbound Nuke countdown must start at 5.0s');

  for (let s = 0; s < 19; s++) {
    partyVictim.x += 10;
    partyVictim.z += 8;
    victimCtx.time += 0.25;
    victimAbilities.updateProjectiles(0.25, victimCtx);
  }
  assert.equal(partyVictim.hp, 100, 'Nuke must NOT detonate before full 5.0s countdown completes');
  assert.equal(inboundNuke.x, partyVictim.x, 'Inbound Nuke must live-track moving victim X');
  assert.equal(inboundNuke.z, partyVictim.z, 'Inbound Nuke must live-track moving victim Z');

  partyVictim.x += 10;
  partyVictim.z += 8;
  victimCtx.time += 0.25;
  victimAbilities.updateProjectiles(0.25, victimCtx);
  assert.equal(partyVictim.hp, 0, 'Locked Tactical Nuke must guarantee 100% lethal hit (hp === 0) on moving player');
  assert.equal(partyVictim.lastBumpedBy?.reason, 'nuked', 'Victim lastBumpedBy.reason must be nuked');
  assert.equal(partyVictim.lastBumpedBy?.id, 'p_launcher', 'Victim lastBumpedBy.id must credit launcher');
  assert.ok(victimEvs.some((e) => e.type === 'nuke_detonate'), 'Nuke detonation must emit nuke_detonate');
  assert.ok(victimAbilities.getProjectiles().some((p) => p.type === 'nuke_cloud'), 'Nuke detonation must spawn nuke_cloud');

  // Solo mode: CAN target an AI cop ('cop_1'), tracks moving cop over exact 5.0s, spawns nuke_cloud, & wrecks cop!
  abilities.reset();
  sim.resetRun(777123, { ...settings, playerRole: 'runner', aiCopsEnabled: true, isParty: false });
  assert.ok(sim.cops.length >= 1, 'Solo mode with aiCopsEnabled: true must spawn initial AI cops');
  const soloCop = sim.cops[0];
  assert.equal(soloCop.id, 'cop_1', 'First spawned AI cop must have stable ID cop_1');
  sim.localPlayer.items.heldItem = 'tactical_nuke';
  sim.localPlayer.items.charges = 1;
  const soloNukeFire = sim.fireTargetedNuke('cop_1', 'cop');
  assert.equal(soloNukeFire.used, true, 'Solo mode must allow targeting AI cop cop_1');
  const soloNukeProj = abilities.getProjectiles().find((p) => p.type === 'tactical_nuke');
  assert.ok(soloNukeProj && soloNukeProj.targetId === 'cop_1' && soloNukeProj.targetKind === 'cop');

  const soloNukeCtx = {
    world,
    cops: sim.cops,
    traffic: sim.traffic,
    localPlayer: sim.localPlayer,
    remotePlayers: [],
    isParty: false,
    time: 1.0,
    onEvent: () => {},
  };
  for (let s = 0; s < 19; s++) {
    soloCop.x += 4;
    soloCop.z -= 3;
    abilities.updateProjectiles(0.25, soloNukeCtx);
  }
  assert.equal(soloCop.wrecked, false, 'Solo cop must remain alive until exact 5.0s impact');
  assert.equal(soloNukeProj.x, soloCop.x, 'Solo Nuke must live-track moving cop X');
  assert.equal(soloNukeProj.z, soloCop.z, 'Solo Nuke must live-track moving cop Z');

  abilities.updateProjectiles(0.25, soloNukeCtx);
  assert.equal(soloCop.wrecked, true, 'Solo Tactical Nuke must wreck locked cop_1 at 5.0s');
  assert.equal(sim.localPlayer.playerKills, 0, 'Wrecking AI cops must NEVER increment real-player kills');
  assert.ok(abilities.getProjectiles().some((p) => p.type === 'nuke_cloud'), 'Solo Nuke detonation must spawn nuke_cloud');

  console.log('4. Checking QR code generator...');
  const qr = generateQrMatrix('http://192.168.1.35:4567/?room=KART');
  assert.ok(qr.size >= 25);
  const svg = renderQrCodeSvg('http://192.168.1.35:4567/?room=KART');
  assert.ok(svg.startsWith('<svg') && svg.includes('<path'));

  console.log('4b. Checking SoundManager lobby sound overlay, compact WAV export, & payload validation...');
  assert.equal(createDefaultSettings().lobbyRules.shareHostSounds, true, 'shareHostSounds must default to true');
  const sm = new SoundManager(0.85);
  const sampleWavBytes = createSampleWavBytes(4500, 11025);
  const sampleHornWav = `data:audio/wav;base64,${sampleWavBytes.toString('base64')}`;
  sm.customRecords.set('horn', {
    slot: 'horn',
    blob: new Blob([sampleWavBytes], { type: 'audio/wav' }),
    buffer: null,
    duration: 0.41,
    label: 'Tanner Airhorn',
    updatedAt: Date.now(),
  });
  const exportedHorn = await sm.exportSlotForNetwork('horn');
  assert.ok(exportedHorn && exportedHorn.dataUrl.startsWith('data:audio/wav;base64,'));
  assert.equal(exportedHorn.slot, 'horn');
  assert.ok(exportedHorn.dataUrl.length <= 190000, 'Exported lobby sound must stay under 190k chars');
  const exportedAll = await sm.exportAllCustomSoundsForNetwork();
  assert.equal(exportedAll.length, 1);
  assert.equal(await sm.setLobbySound('horn', exportedHorn.dataUrl, 'Host Airhorn'), true);
  assert.equal(sm.getLobbySoundCount(), 1);
  assert.equal(await sm.setLobbySound('horn', 'data:text/html;base64,PHNjcmlwdD4=', 'Bad'), false);
  assert.equal(sm.getLobbySoundCount(), 1, 'Invalid lobby sound must not corrupt valid slot');
  sm.setLobbyOverride(true, 'Tanner');
  assert.equal(sm.lobbyOverrideEnabled, true);
  assert.equal(sm.lobbyHostName, 'Tanner');
  sm.clearLobbySounds();
  assert.equal(sm.getLobbySoundCount(), 0);
  assert.equal(sm.lobbyOverrideEnabled, false);
  assert.equal(sm.hasCustomSound('horn'), true, 'Clearing lobby sounds must preserve personal saved sounds');

  // Verify custom 'nuke' sound slot (5.0s export, lobby overlay, & cloud relay sound/settings/nuked sync)
  assert.ok(SOUND_SLOTS.includes('nuke'), 'SOUND_SLOTS must include nuke');
  sm.customRecords.set('nuke', {
    slot: 'nuke',
    blob: new Blob([sampleWavBytes], { type: 'audio/wav' }),
    buffer: null,
    duration: 0.41,
    label: 'Tanner Nuke Siren',
    updatedAt: Date.now(),
  });
  const exportedNuke = await sm.exportSlotForNetwork('nuke');
  assert.ok(exportedNuke && exportedNuke.slot === 'nuke' && exportedNuke.dataUrl.startsWith('data:audio/wav;base64,'));
  assert.equal(await sm.setLobbySound('nuke', exportedNuke.dataUrl, 'Host Nuke Siren'), true);
  sm.clearLobbySounds();

  const cloudHost = new MultiplayerClient({ forceCloud: true });
  cloudHost.isHost = true;
  cloudHost.roomCode = 'NUKE';
  cloudHost.mqtt = { connected: false, publish: () => {} };
  cloudHost._cloudHostRoom = {
    code: 'NUKE',
    hostId: cloudHost.playerId,
    state: 'lobby',
    settings: {},
    members: new Map([[cloudHost.playerId, { id: cloudHost.playerId, profile: { name: 'Tanner' } }]]),
    hostSounds: new Map(),
    match: null,
  };
  let cloudNukeSoundEvt = null;
  cloudHost.on('sound_sync', (m) => {
    if (m.slot === 'nuke') cloudNukeSoundEvt = m;
  });
  await cloudHost._sendCloudCommand({
    type: 'update_room_settings',
    settings: { nukeKillDoubleOdds: false, itemWeights: { tactical_nuke: 1000 } },
  });
  assert.equal(cloudHost._cloudHostRoom.settings.nukeKillDoubleOdds, false, 'Cloud relay must sync nukeKillDoubleOdds');
  assert.equal(cloudHost._cloudHostRoom.settings.itemWeights?.tactical_nuke, 1000, 'Cloud relay must sync itemWeights.tactical_nuke');
  await cloudHost._sendCloudCommand({
    type: 'sound_sync',
    slot: 'nuke',
    dataUrl: exportedNuke.dataUrl,
    label: 'Cloud Nuke Voice',
  });
  assert.equal(cloudHost._cloudHostRoom.hostSounds.get('nuke')?.label, 'Cloud Nuke Voice', 'Cloud host must cache nuke sound slot');
  assert.equal(cloudNukeSoundEvt?.slot, 'nuke', 'Cloud client must accept and emit sound_sync for nuke slot');

  console.log('5. Checking HTTP static server, path traversal guard (negative check), & 2-phone Party WebSocket match...');
  const srv = await startServer(0, '127.0.0.1');
  try {
    const port = srv.port;
    const homeRes = await httpGet(`http://127.0.0.1:${port}/`);
    assert.equal(homeRes.status, 200);
    assert.ok(homeRes.body.includes('SMASHY KART'));
    assert.equal(homeRes.body.includes('id="hud-item-slot"'), false, 'Front-middle mystery box must be gone');
    assert.ok(homeRes.body.includes('id="settings-modal"'), 'Personal Settings modal must exist');
    assert.ok(homeRes.body.includes('id="btn-use-item"'), 'Side clickable item box must exist');
    assert.ok(homeRes.body.includes('id="btn-brake"'), 'Visible Brake button must exist');
    assert.ok(homeRes.body.includes('id="hud-layout-editor"'), 'Customizable Claw HUD layout editor must exist');
    assert.ok(homeRes.body.includes('id="keybinds-list"'), 'Keyboard keybind remapper must exist');
    assert.ok(homeRes.body.includes('id="nuke-flash"'), 'Nuke flash overlay must exist');
    assert.ok(homeRes.body.includes('id="nuke-target-hint"'), 'Nuke target hint must exist');
    assert.ok(homeRes.body.includes('id="nuke-countdown-banner"'), 'Nuke countdown banner must exist');
    assert.ok(homeRes.body.includes('data-rpreset="nuke1000"'), '1000% Nuke Chaos preset chip must exist');
    assert.ok(homeRes.body.includes('icon-180.png'), 'iOS apple-touch-icon PNG must be linked');

    const iconRes = await httpGet(`http://127.0.0.1:${port}/icon-180.png`);
    assert.equal(iconRes.status, 200, 'icon-180.png must serve 200 OK');
    const swRes = await httpGet(`http://127.0.0.1:${port}/sw.js`);
    assert.equal(swRes.status, 200, 'sw.js must serve 200 OK');

    const mainJsRes = await httpGet(`http://127.0.0.1:${port}/js/main.js`);
    assert.equal(mainJsRes.status, 200);

    // Negative check: path traversal outside public/ must be rejected
    const badRes = await httpGet(`http://127.0.0.1:${port}/../server.mjs`);
    assert.ok(badRes.status === 403 || badRes.status === 404, `Expected 403/404, got ${badRes.status}`);

    // Negative check: malformed WebSocket Host header must return 400 without crashing server
    await new Promise((res, rej) => {
      const s = net.createConnection({ host: '127.0.0.1', port }, () => {
        s.write('GET /ws HTTP/1.1\r\nHost: :::bad host:::\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
      });
      s.on('data', (d) => {
        assert.ok(d.toString('utf8').includes('400'));
        s.destroy();
        res();
      });
      s.on('error', rej);
    });

    const netRes = await httpGet(`http://127.0.0.1:${port}/api/network-info`);
    assert.equal(netRes.status, 200);
    const netJson = JSON.parse(netRes.body);
    assert.equal(netJson.port, port);

    // Two phones connect, sync custom photo dataUrl, start match, bump each other, and crown last survivor
    const p1 = await connectTestWs(port);
    const p2 = await connectTestWs(port);
    await p1.waitFor((m) => m.type === 'welcome');
    await p2.waitFor((m) => m.type === 'welcome');

    const fakeAvatar = 'data:image/png;base64,' + 'A'.repeat(18000); // >126 bytes exercises 16-bit WS frame
    p1.send({
      type: 'create_room',
      profile: { name: 'Tanner', characterMode: 'photo_car', vehicleId: 'muscle', avatarDataUrl: fakeAvatar, ready: true },
      settings: { biome: 'city' },
    });
    const created = await p1.waitFor((m) => m.type === 'room_joined');
    assert.equal(created.code.length, 4);

    p2.send({
      type: 'join_room',
      code: created.code,
      profile: { name: 'Friend', characterMode: 'runner', vehicleId: 'kart', avatarDataUrl: fakeAvatar, ready: true },
    });
    await p2.waitFor((m) => m.type === 'room_joined');
    const syncedRoom = await p1.waitFor((m) => m.type === 'room_state' && m.players?.length === 2);
    assert.equal(syncedRoom.players[1].avatarDataUrl.length, fakeAvatar.length);

    // Verify 16 players can join one room + Lobby Manager universal lock overrides guest car/mode!
    const extraClients = [];
    for (let k = 3; k <= 16; k++) {
      const ck = await connectTestWs(port);
      await ck.waitFor((m) => m.type === 'welcome');
      ck.send({
        type: 'join_room',
        code: created.code,
        profile: { name: `P${k}`, characterMode: 'runner', vehicleId: 'f1', ready: true },
      });
      await ck.waitFor((m) => m.type === 'room_joined');
      extraClients.push(ck);
    }
    const full16 = await p1.waitFor((m) => m.type === 'room_state' && m.players?.length === 16);
    assert.equal(full16.players.length, 16, 'Room must hold 16 players');

    // Host locks Same Car ('monster') + Same Mode ('car_driver') + Equal 125% Speed + 500% Drop Rates!
    p1.send({
      type: 'update_room_settings',
      settings: {
        itemBoxDensity: 5.0,
        sugarBoxRate: 4.5,
        nukeKillDoubleOdds: false,
        itemWeights: {
          tactical_nuke: 1000,
          homing_rocket: 1000,
          lightning_zap: 0.1,
        },
        lobbyRules: {
          lockStats: true,
          allowCarChoice: false,
          allowModeChoice: false,
          universalVehicleId: 'monster',
          universalCharacterMode: 'car_driver',
          universalSpeedMult: 1.25,
        },
      },
    });
    const lockedRoom = await p2.waitFor(
      (m) => m.type === 'room_state' && m.settings?.lobbyRules?.allowCarChoice === false
    );
    assert.ok(lockedRoom.players.every((pl) => pl.vehicleId === 'monster' && pl.characterMode === 'car_driver'));
    assert.equal(lockedRoom.settings.itemBoxDensity, 5.0, 'Room must sync itemBoxDensity: 5.0 to guests');
    assert.equal(lockedRoom.settings.sugarBoxRate, 4.5, 'Room must sync sugarBoxRate: 4.5 to guests');
    assert.equal(lockedRoom.settings.nukeKillDoubleOdds, false, 'Room must sync nukeKillDoubleOdds: false to all 16 players');
    assert.equal(lockedRoom.settings.itemWeights?.tactical_nuke, 1000, 'Room must sync tactical_nuke: 1000');
    assert.equal(lockedRoom.settings.itemWeights?.homing_rocket, 1000, 'Room must sync homing_rocket: 1000');
    assert.equal(lockedRoom.settings.itemWeights?.lightning_zap, 0.1, 'Room must sync lightning_zap: 0.1');
    assert.equal(lockedRoom.settings.itemWeights?.sugar_rush, 100, 'Unspecified room weights must default to 100');

    // Verify 16-player room sync of aiCopsEnabled: false, playerRole: 'cop' ('cop_heli'), & allowPlayerCops lock!
    p2.send({ type: 'update_profile', profile: { playerRole: 'cop', copVehicleId: 'cop_heli' } });
    const copProfileRoom = await p1.waitFor(
      (m) => m.type === 'room_state' && m.players?.find((pl) => pl.name === 'Friend')?.playerRole === 'cop'
    );
    const p2InRoom = copProfileRoom.players.find((pl) => pl.name === 'Friend');
    assert.equal(p2InRoom.playerRole, 'cop');
    assert.equal(p2InRoom.copVehicleId, 'cop_heli');

    // Host toggles aiCopsEnabled: false & allowPlayerCops: false -> forces guest p2 back to 'runner'!
    p1.send({
      type: 'update_room_settings',
      settings: {
        aiCopsEnabled: false,
        lobbyRules: {
          ...lockedRoom.settings.lobbyRules,
          allowPlayerCops: false,
        },
      },
    });
    const noCopRoom = await p2.waitFor(
      (m) => m.type === 'room_state' && m.settings?.aiCopsEnabled === false && m.settings?.lobbyRules?.allowPlayerCops === false
    );
    assert.equal(noCopRoom.settings.aiCopsEnabled, false, 'Room must sync aiCopsEnabled: false across all 16 players');
    assert.equal(
      noCopRoom.players.find((pl) => pl.name === 'Friend')?.playerRole,
      'runner',
      'allowPlayerCops: false must force guests to runner'
    );

    // Re-enable allowPlayerCops: true and reset p2 to 'runner' for classic 2p match flow below
    p2.send({ type: 'update_profile', profile: { playerRole: 'runner' } });
    p1.send({
      type: 'update_room_settings',
      settings: {
        aiCopsEnabled: true,
        lobbyRules: {
          ...lockedRoom.settings.lobbyRules,
          allowPlayerCops: true,
        },
      },
    });
    await p2.waitFor((m) => m.type === 'room_state' && m.settings?.lobbyRules?.allowPlayerCops === true);

    for (const ck of extraClients) ck.close();
    await p1.waitFor((m) => m.type === 'room_state' && m.players?.length === 2);

    // Verify Lobby Owner sound_sync broadcast (including 'nuke' slot!), late-join replay, guest forgery rejection, & horn_event relay!
    p1.send({ type: 'sound_sync', slot: 'horn', dataUrl: sampleHornWav, label: 'Tanner Airhorn' });
    const guestSound = await p2.waitFor((m) => m.type === 'sound_sync' && m.slot === 'horn');
    assert.equal(guestSound.dataUrl, sampleHornWav, 'Guest must receive exact Host sound_sync WAV payload');
    assert.equal(guestSound.label, 'Tanner Airhorn');
    assert.equal(guestSound.hostName, 'Tanner');

    p1.send({ type: 'sound_sync', slot: 'nuke', dataUrl: sampleHornWav, label: 'Tanner Nuke Siren' });
    const guestNukeSound = await p2.waitFor((m) => m.type === 'sound_sync' && m.slot === 'nuke');
    assert.equal(guestNukeSound.dataUrl, sampleHornWav, 'Guest must receive exact Host nuke sound_sync WAV payload');
    assert.equal(guestNukeSound.label, 'Tanner Nuke Siren');

    // Late-joining Guest #3 must automatically receive cached Host sound_sync (horn + nuke) on join_room!
    const p3 = await connectTestWs(port);
    await p3.waitFor((m) => m.type === 'welcome');
    p3.send({
      type: 'join_room',
      code: created.code,
      profile: { name: 'LateJoiner', characterMode: 'car_driver', vehicleId: 'sedan', ready: true },
    });
    await p3.waitFor((m) => m.type === 'room_joined');
    const lateSound = await p3.waitFor((m) => m.type === 'sound_sync' && m.slot === 'horn');
    assert.equal(lateSound.dataUrl, sampleHornWav, 'Late-joining guest must receive cached Host sound_sync');
    assert.equal(lateSound.hostName, 'Tanner');
    const lateNukeSound = await p3.waitFor((m) => m.type === 'sound_sync' && m.slot === 'nuke');
    assert.equal(lateNukeSound.dataUrl, sampleHornWav, 'Late-joining guest must receive cached Host nuke sound_sync');

    // Negative security check: Guest forging sound_sync or sound_sync_clear MUST be rejected!
    p2.send({ type: 'sound_sync', slot: 'boost', dataUrl: sampleHornWav, label: 'Forged Boost' });
    const forgeErr = await p2.waitFor((m) => m.type === 'error' && m.code === 'NOT_HOST');
    assert.equal(forgeErr.code, 'NOT_HOST', 'Non-host sound_sync must be rejected with NOT_HOST');
    p2.send({ type: 'sound_sync_clear' });
    const forgeClearErr = await p2.waitFor((m) => m.type === 'error' && m.code === 'NOT_HOST');
    assert.equal(forgeClearErr.code, 'NOT_HOST', 'Non-host sound_sync_clear must be rejected with NOT_HOST');

    // Live horn_event relays from any room member to all other members
    p1.send({ type: 'horn_event', x: 12.5, z: -34.25 });
    const hornP2 = await p2.waitFor((m) => m.type === 'horn_event');
    const hornP3 = await p3.waitFor((m) => m.type === 'horn_event');
    assert.equal(hornP2.playerName, 'Tanner');
    assert.equal(hornP2.x, 12.5);
    assert.equal(hornP2.z, -34.25);
    assert.equal(hornP3.playerName, 'Tanner');

    // Host clearing lobby sounds notifies guests cleanly
    p1.send({ type: 'sound_sync_clear' });
    await p2.waitFor((m) => m.type === 'sound_sync_clear');

    p3.close();
    await p1.waitFor((m) => m.type === 'room_state' && m.players?.length === 2);

    p1.send({ type: 'start_match', seed: 888999 });
    const cd1 = await p1.waitFor((m) => m.type === 'match_countdown');
    const cd2 = await p2.waitFor((m) => m.type === 'match_countdown');
    assert.equal(cd1.seed, 888999);
    assert.equal(cd2.seed, 888999);

    p1.send({ type: 'pvp_bump', fromName: 'Tanner', vx: 25, vy: 5, vz: 10 });
    const bumpRecv = await p2.waitFor((m) => m.type === 'pvp_bump');
    assert.equal(bumpRecv.vx, 25);

    p2.send({ type: 'player_eliminated', reason: 'nuked', killerName: 'Tanner', killerId: created.playerId, survivalTime: 41.2, score: 1200, copsWrecked: 4 });
    const elimRecv = await p1.waitFor((m) => m.type === 'player_eliminated');
    assert.equal(elimRecv.reason, 'nuked', 'LAN server must preserve nuked elimination reason');
    assert.equal(elimRecv.killerId, created.playerId, 'LAN server must relay killerId for 2x Nuke odds');
    assert.ok(elimRecv.announcement.includes('☢️') && elimRecv.announcement.includes('NUKED'), 'LAN server must format Nuke announcement');
    const results = await p1.waitFor((m) => m.type === 'match_results');
    assert.equal(results.winnerName, 'Tanner');
    assert.equal(results.standings[0].name, 'Tanner');

    // Verify Asymmetric Cops vs. Runners match end: Police Officer eliminating Runner crowns Police Team ('winnerTeam: cop')!
    p1.send({ type: 'return_to_lobby' });
    await p2.waitFor((m) => m.type === 'return_to_lobby');
    p1.send({ type: 'update_profile', profile: { playerRole: 'cop', copVehicleId: 'cop_tank' } });
    p2.send({ type: 'update_profile', profile: { playerRole: 'runner', vehicleId: 'kart' } });
    await p2.waitFor(
      (m) =>
        m.type === 'room_state' &&
        m.players?.some((pl) => pl.name === 'Tanner' && pl.playerRole === 'cop' && pl.copVehicleId === 'cop_tank')
    );
    p1.send({ type: 'start_match', seed: 777555 });
    await p1.waitFor((m) => m.type === 'match_countdown');
    await p2.waitFor((m) => m.type === 'match_countdown');
    p2.send({ type: 'player_eliminated', reason: 'wrecked', killerName: 'Tanner', survivalTime: 18.4, score: 620, copsWrecked: 1 });
    const copWinResults = await p1.waitFor((m) => m.type === 'match_results' && m.winnerTeam === 'cop');
    assert.equal(copWinResults.winnerTeam, 'cop', 'Eliminating all runners must crown winnerTeam: cop');
    assert.equal(copWinResults.winnerName, 'Tanner');

    p1.close();
    p2.close();
  } finally {
    await new Promise((res) => srv.server.close(res));
  }

  console.log('ALL SMASHY KART VERIFICATION CHECKS PASSED!');
}

runAllChecks().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
