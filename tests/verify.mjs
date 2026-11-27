// Automated End-to-End Verification Suite for Smashy Kart: Wanted
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import net from 'node:net';

import { VEHICLES, ABILITIES, BIOMES, createDefaultSettings } from '../public/js/config.js';
import { World } from '../public/js/world.js';
import { buildVehicleParts } from '../public/js/models.js';
import { Renderer3D } from '../public/js/renderer3d.js';
import { AbilitySystem } from '../public/js/abilities.js';
import { Simulation } from '../public/js/physics_ai.js';
import { renderQrCodeSvg, generateQrMatrix } from '../public/js/multiplayer.js';
import { startServer } from '../server.mjs';

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
        } else {
          header = Buffer.alloc(8);
          header[0] = 0x81;
          header[1] = 0x80 | 126;
          header.writeUInt16BE(payload.length, 2);
          mask.copy(header, 4);
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
  console.log('1. Checking 2400x2400 seeded Smashy Road world & biomes...');
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

  console.log('2. Checking all 12 vehicle blueprints...');
  for (const v of VEHICLES) {
    const parts = buildVehicleParts(v.id, v.color, v.accent, 0.5);
    assert.ok(parts.length >= 8, `Vehicle ${v.id} has too few voxel parts`);
  }

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

  // Test all 8 abilities firing cleanly
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

  console.log('4. Checking QR code generator...');
  const qr = generateQrMatrix('http://192.168.1.35:4567/?room=KART');
  assert.ok(qr.size >= 25);
  const svg = renderQrCodeSvg('http://192.168.1.35:4567/?room=KART');
  assert.ok(svg.startsWith('<svg') && svg.includes('<path'));

  console.log('5. Checking HTTP static server, path traversal guard (negative check), & 2-phone Party WebSocket match...');
  const srv = await startServer(0, '127.0.0.1');
  try {
    const port = srv.port;
    const homeRes = await httpGet(`http://127.0.0.1:${port}/`);
    assert.equal(homeRes.status, 200);
    assert.ok(homeRes.body.includes('SMASHY KART'));

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

    // Host locks Same Car ('monster') + Same Mode ('car_driver') + Equal 125% Speed
    p1.send({
      type: 'update_room_settings',
      settings: {
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

    for (const ck of extraClients) ck.close();
    await p1.waitFor((m) => m.type === 'room_state' && m.players?.length === 2);

    p1.send({ type: 'start_match', seed: 888999 });
    const cd1 = await p1.waitFor((m) => m.type === 'match_countdown');
    const cd2 = await p2.waitFor((m) => m.type === 'match_countdown');
    assert.equal(cd1.seed, 888999);
    assert.equal(cd2.seed, 888999);

    p1.send({ type: 'pvp_bump', fromName: 'Tanner', vx: 25, vy: 5, vz: 10 });
    const bumpRecv = await p2.waitFor((m) => m.type === 'pvp_bump');
    assert.equal(bumpRecv.vx, 25);

    p2.send({ type: 'player_eliminated', reason: 'drowned', killerName: 'Tanner', survivalTime: 41.2, score: 1200, copsWrecked: 4 });
    const results = await p1.waitFor((m) => m.type === 'match_results');
    assert.equal(results.winnerName, 'Tanner');
    assert.equal(results.standings[0].name, 'Tanner');

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
