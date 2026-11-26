// Smashy Kart Zero-Dependency HTTP + RFC-6455 WebSocket Party Multiplayer Server (Node v24)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, 'public');

const FORBIDDEN_PORTS = new Set([8766, 8767, 8800]);
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_WS_PAYLOAD = 512 * 1024; // 512KB ceiling (plenty for 30KB avatar PNG/WebP data URLs)
const MAX_ROOM_PLAYERS = 10;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 0/O/1/I ambiguity

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
};

function classifyIpv4Priority(ip) {
  if (ip.startsWith('192.168.')) return 1;
  if (ip.startsWith('10.')) return 2;
  const parts = ip.split('.').map(Number);
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return 3;
  if (ip.startsWith('169.254.')) return 9; // Link-local last
  return 5; // e.g., Tailscale 100.x.x.x
}

export function getNetworkInfo(port) {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, list] of Object.entries(interfaces)) {
    if (!Array.isArray(list)) continue;
    for (const iface of list) {
      const isV4 = iface.family === 'IPv4' || iface.family === 4;
      if (!isV4 || iface.internal || !iface.address) continue;
      candidates.push({
        ip: iface.address,
        interface: name,
        priority: classifyIpv4Priority(iface.address),
      });
    }
  }

  candidates.sort((a, b) => a.priority - b.priority || a.ip.localeCompare(b.ip));
  const lanIps = [];
  for (const c of candidates) {
    if (!lanIps.includes(c.ip)) lanIps.push(c.ip);
  }

  const urls = lanIps.map((ip) => `http://${ip}:${port}`);
  const shareBaseUrl = urls[0] || `http://localhost:${port}`;

  return {
    port,
    hostname: os.hostname(),
    lanIps,
    shareBaseUrl,
    urls: urls.length > 0 ? urls : [shareBaseUrl],
  };
}

// Encode unmasked server->client RFC-6455 WebSocket frame (<126, 16-bit, and 64-bit lengths)
function encodeWsFrame(opcode, payloadBuffer) {
  const payload = Buffer.isBuffer(payloadBuffer)
    ? payloadBuffer
    : Buffer.from(String(payloadBuffer || ''), 'utf8');
  const len = payload.length;

  let header;
  if (len < 126) {
    header = Buffer.allocUnsafe(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

function createClosePayload(code = 1000, reason = '') {
  const reasonBuf = Buffer.from(String(reason).slice(0, 80), 'utf8');
  const buf = Buffer.allocUnsafe(2 + reasonBuf.length);
  buf.writeUInt16BE(code, 0);
  reasonBuf.copy(buf, 2);
  return buf;
}

function sanitizeProfile(raw = {}, fallbackName = 'Player') {
  const out = {};
  if (typeof raw.name === 'string') {
    out.name = raw.name.trim().slice(0, 22) || fallbackName;
  }
  if (
    raw.characterMode === 'car_driver' ||
    raw.characterMode === 'photo_car' ||
    raw.characterMode === 'runner'
  ) {
    out.characterMode = raw.characterMode;
  }
  if (typeof raw.vehicleId === 'string') {
    out.vehicleId = raw.vehicleId.slice(0, 24);
  }
  if (typeof raw.primaryColor === 'string') {
    out.primaryColor = raw.primaryColor.slice(0, 16);
  }
  if (typeof raw.accentColor === 'string') {
    out.accentColor = raw.accentColor.slice(0, 16);
  }
  if (typeof raw.avatarId === 'string') {
    out.avatarId = raw.avatarId.slice(0, 48);
  }
  if (
    typeof raw.avatarDataUrl === 'string' &&
    raw.avatarDataUrl.length <= 240 * 1024 &&
    /^data:image\/(?:png|webp|jpeg|jpg);base64,[A-Za-z0-9+/=]+$/.test(raw.avatarDataUrl)
  ) {
    out.avatarDataUrl = raw.avatarDataUrl;
  }
  if (raw.ready !== undefined) {
    out.ready = Boolean(raw.ready);
  }
  return out;
}

function defaultRoomSettings() {
  return {
    biome: 'city',
    copIntensity: 1.0,
    startStars: 1,
    trafficDensity: 1.0,
    itemBoxDensity: 1.2,
    gravityMult: 1.0,
    worldSeed: Math.floor(100000 + Math.random() * 900000),
    enabledItems: {
      homing_rocket: true,
      triple_boost: true,
      star_power: true,
      mega_giant: true,
      banana_bunch: true,
      bomb_toss: true,
      lightning_zap: true,
      super_horn: true,
    },
  };
}

function sanitizeRoomSettings(current, patch = {}) {
  const next = { ...current };
  if (patch.biome === 'city' || patch.biome === 'desert' || patch.biome === 'snow') {
    next.biome = patch.biome;
  }
  if (Number.isFinite(Number(patch.copIntensity))) {
    next.copIntensity = Math.max(0.4, Math.min(2.0, Number(patch.copIntensity)));
  }
  if (Number.isFinite(Number(patch.startStars))) {
    next.startStars = Math.max(1, Math.min(5, Math.round(Number(patch.startStars))));
  }
  if (Number.isFinite(Number(patch.trafficDensity))) {
    next.trafficDensity = Math.max(0, Math.min(2.0, Number(patch.trafficDensity)));
  }
  if (Number.isFinite(Number(patch.itemBoxDensity))) {
    next.itemBoxDensity = Math.max(0.3, Math.min(2.5, Number(patch.itemBoxDensity)));
  }
  if (Number.isFinite(Number(patch.gravityMult))) {
    next.gravityMult = Math.max(0.4, Math.min(1.6, Number(patch.gravityMult)));
  }
  if (Number.isFinite(Number(patch.worldSeed))) {
    next.worldSeed = Math.floor(Math.abs(Number(patch.worldSeed))) || 777123;
  }
  if (patch.enabledItems && typeof patch.enabledItems === 'object') {
    next.enabledItems = { ...next.enabledItems };
    for (const [k, v] of Object.entries(patch.enabledItems)) {
      next.enabledItems[k] = Boolean(v);
    }
  }
  return next;
}

export function createSmashyServer() {
  const clients = new Map(); // id -> client
  const rooms = new Map();   // code -> room
  let nextClientNum = 1;

  function generateRoomCode() {
    for (let attempt = 0; attempt < 200; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += ROOM_ALPHABET[crypto.randomInt(0, ROOM_ALPHABET.length)];
      }
      if (!rooms.has(code)) return code;
    }
    return `R${crypto.randomInt(100, 999)}`;
  }

  function sendJson(client, obj) {
    if (!client || client.closed || client.socket.destroyed) return;
    try {
      const frame = encodeWsFrame(0x1, Buffer.from(JSON.stringify(obj), 'utf8'));
      client.socket.write(frame);
    } catch {
      // Ignore write failures on tearing-down sockets
    }
  }

  function broadcastRoom(room, obj, excludeId = null) {
    if (!room) return;
    const raw = Buffer.from(JSON.stringify(obj), 'utf8');
    const frame = encodeWsFrame(0x1, raw);
    for (const member of room.clients.values()) {
      if (excludeId && member.id === excludeId) continue;
      if (!member.closed && !member.socket.destroyed) {
        try {
          member.socket.write(frame);
        } catch {
          // ignore
        }
      }
    }
  }

  function serializeRoomPlayer(client, spawnIndex = 0) {
    return {
      id: client.id,
      playerId: client.id,
      isHost: Boolean(client.roomCode && rooms.get(client.roomCode)?.hostId === client.id),
      spawnIndex,
      name: client.profile.name,
      characterMode: client.profile.characterMode,
      vehicleId: client.profile.vehicleId,
      primaryColor: client.profile.primaryColor,
      accentColor: client.profile.accentColor,
      avatarId: client.profile.avatarId || client.id,
      avatarDataUrl: client.profile.avatarDataUrl || null,
      ready: Boolean(client.profile.ready),
    };
  }

  function serializeRoom(room) {
    const memberList = Array.from(room.clients.values());
    return {
      code: room.code,
      roomCode: room.code,
      hostId: room.hostId,
      state: room.state,
      settings: room.settings,
      players: memberList.map((c, idx) => serializeRoomPlayer(c, idx)),
    };
  }

  function broadcastRoomState(room) {
    if (!room) return;
    const snapshot = serializeRoom(room);
    broadcastRoom(room, {
      type: 'room_state',
      ...snapshot,
    });
  }

  function computeStandings(room) {
    if (!room?.match) return [];
    const now = Date.now();
    const elapsedSec = Math.max(0, (now - room.match.liveStartAt) / 1000);
    const list = Array.from(room.match.participants.values()).map((p) => {
      const liveSurvival = p.alive ? Math.max(p.survivalTime, elapsedSec) : p.survivalTime;
      return {
        ...p,
        survivalTime: Number(liveSurvival.toFixed(2)),
      };
    });

    // Sort "Who Lasts Longer": alive survivors first, then longest survivalTime, then score
    list.sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (Math.abs(b.survivalTime - a.survivalTime) > 0.001) {
        return b.survivalTime - a.survivalTime;
      }
      return (b.score || 0) - (a.score || 0);
    });

    return list.map((p, idx) => ({
      rank: idx + 1,
      winner: idx === 0,
      crowned: idx === 0,
      id: p.id,
      playerId: p.id,
      name: p.name,
      characterMode: p.characterMode,
      vehicleId: p.vehicleId,
      primaryColor: p.primaryColor,
      accentColor: p.accentColor,
      avatarId: p.avatarId,
      alive: p.alive,
      survivalTime: p.survivalTime,
      score: Math.round(p.score || 0),
      copsWrecked: p.copsWrecked || 0,
      eliminatedReason: p.eliminatedReason,
      killerName: p.killerName,
    }));
  }

  function evaluateMatchEnd(room) {
    if (!room?.match || room.match.finished) return;
    const total = room.match.participants.size;
    if (total === 0) return;

    const participants = Array.from(room.match.participants.values());
    const alive = participants.filter((p) => p.alive);

    // Multiplayer (>=2 players): crown the last player standing as soon as <=1 remains alive!
    // Solo room (1 player): finish when 0 remain alive.
    const shouldFinish = (total >= 2 && alive.length <= 1) || alive.length === 0;
    if (!shouldFinish) return;

    if (alive.length === 1) {
      const maxEliminatedTime = participants
        .filter((p) => !p.alive)
        .reduce((mx, p) => Math.max(mx, p.survivalTime || 0), 0);
      const elapsedSec = Math.max(0, (Date.now() - room.match.liveStartAt) / 1000);
      alive[0].survivalTime = Math.max(alive[0].survivalTime || 0, elapsedSec, maxEliminatedTime + 0.05);
    }

    room.match.finished = true;
    room.state = 'results';
    if (room.match.countdownTimer) {
      clearTimeout(room.match.countdownTimer);
      room.match.countdownTimer = null;
    }

    const standings = computeStandings(room);
    const winner = standings[0] || null;

    broadcastRoom(room, {
      type: 'match_results',
      code: room.code,
      roomCode: room.code,
      winnerId: winner ? winner.id : null,
      winnerName: winner ? winner.name : null,
      standings,
      leaderboard: standings,
    });
  }

  function removeClientFromRoom(client) {
    if (!client.roomCode) return;
    const room = rooms.get(client.roomCode);
    client.roomCode = null;
    if (!room) return;

    room.clients.delete(client.id);

    if (room.clients.size === 0) {
      if (room.match?.countdownTimer) clearTimeout(room.match.countdownTimer);
      rooms.delete(room.code);
      return;
    }

    // Automatic host promotion if host leaves!
    if (room.hostId === client.id) {
      const nextHost = room.clients.values().next().value;
      room.hostId = nextHost.id;
      broadcastRoom(room, {
        type: 'host_promoted',
        code: room.code,
        hostId: nextHost.id,
        hostName: nextHost.profile.name,
      });
    }

    // If match is underway and disconnected player was still alive, mark eliminated
    if (room.match && !room.match.finished) {
      const part = room.match.participants.get(client.id);
      if (part && part.alive) {
        part.alive = false;
        part.eliminatedReason = 'disconnected';
        part.survivalTime = Math.max(
          part.survivalTime || 0,
          Math.max(0, (Date.now() - room.match.liveStartAt) / 1000)
        );
        broadcastRoom(room, {
          type: 'player_eliminated',
          playerId: client.id,
          playerName: part.name,
          reason: 'disconnected',
          killerName: null,
          announcement: `${part.name} disconnected!`,
          survivalTime: Number(part.survivalTime.toFixed(2)),
          standings: computeStandings(room),
        });
        evaluateMatchEnd(room);
      }
    }

    broadcastRoomState(room);
  }

  function formatEliminationAnnouncement(playerName, reason, killerName) {
    if (killerName) {
      if (reason === 'drowned') return `${killerName} slammed ${playerName} into the river!`;
      if (reason === 'busted') return `${killerName} boxed ${playerName} into the cops — BUSTED!`;
      return `${killerName} wrecked ${playerName}!`;
    }
    if (reason === 'drowned') return `${playerName} drowned in the river!`;
    if (reason === 'busted') return `${playerName} got BUSTED by the police!`;
    return `${playerName} WRECKED out!`;
  }

  function handleWsMessage(client, msg) {
    if (!msg || typeof msg !== 'object') return;
    const type = msg.type;

    switch (type) {
      case 'ping': {
        sendJson(client, { type: 'pong', clientTime: msg.clientTime || Date.now(), serverTime: Date.now() });
        break;
      }

      case 'create_room': {
        removeClientFromRoom(client);
        Object.assign(client.profile, sanitizeProfile(msg.profile || msg, client.profile.name));
        const code = generateRoomCode();
        const settings = sanitizeRoomSettings(defaultRoomSettings(), msg.settings || {});
        const room = {
          code,
          hostId: client.id,
          state: 'lobby',
          settings,
          clients: new Map([[client.id, client]]),
          match: null,
          createdAt: Date.now(),
        };
        rooms.set(code, room);
        client.roomCode = code;

        const serialized = serializeRoom(room);
        sendJson(client, {
          type: 'room_joined',
          code,
          roomCode: code,
          playerId: client.id,
          isHost: true,
          room: serialized,
        });
        broadcastRoomState(room);
        break;
      }

      case 'join_room': {
        const rawCode = String(msg.code || msg.roomCode || '')
          .trim()
          .toUpperCase();
        const room = rooms.get(rawCode);
        if (!room) {
          sendJson(client, { type: 'error', code: 'ROOM_NOT_FOUND', message: `Room "${rawCode}" not found.` });
          return;
        }
        if (room.clients.size >= MAX_ROOM_PLAYERS && !room.clients.has(client.id)) {
          sendJson(client, { type: 'error', code: 'ROOM_FULL', message: `Room "${rawCode}" is full (max 10).` });
          return;
        }

        if (client.roomCode && client.roomCode !== rawCode) {
          removeClientFromRoom(client);
        }

        Object.assign(client.profile, sanitizeProfile(msg.profile || msg, client.profile.name));
        room.clients.set(client.id, client);
        client.roomCode = rawCode;

        const serialized = serializeRoom(room);
        sendJson(client, {
          type: 'room_joined',
          code: rawCode,
          roomCode: rawCode,
          playerId: client.id,
          isHost: room.hostId === client.id,
          room: serialized,
        });
        broadcastRoomState(room);
        break;
      }

      case 'leave_room': {
        removeClientFromRoom(client);
        sendJson(client, { type: 'room_left' });
        break;
      }

      case 'update_profile': {
        const patch = sanitizeProfile(msg.profile || msg, client.profile.name);
        Object.assign(client.profile, patch);
        if (client.roomCode) {
          const room = rooms.get(client.roomCode);
          if (room) broadcastRoomState(room);
        } else {
          sendJson(client, { type: 'profile_ack', profile: client.profile });
        }
        break;
      }

      case 'update_room_settings': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room || room.hostId !== client.id) {
          sendJson(client, { type: 'error', code: 'NOT_HOST', message: 'Only the host can update room settings.' });
          return;
        }
        room.settings = sanitizeRoomSettings(room.settings, msg.settings || msg);
        broadcastRoom(room, {
          type: 'room_settings_updated',
          code: room.code,
          roomCode: room.code,
          settings: room.settings,
        });
        broadcastRoomState(room);
        break;
      }

      case 'start_match': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room || room.hostId !== client.id) {
          sendJson(client, { type: 'error', code: 'NOT_HOST', message: 'Only the host can start the match.' });
          return;
        }

        if (room.match?.countdownTimer) clearTimeout(room.match.countdownTimer);
        const seed = Number.isFinite(Number(msg.seed))
          ? Math.floor(Math.abs(Number(msg.seed)))
          : Math.floor(100000 + Math.random() * 900000);
        room.settings.worldSeed = seed;
        room.state = 'countdown';

        const countdownSec = 3;
        const now = Date.now();
        const startAt = now + countdownSec * 1000;
        const participants = new Map();
        const playersPayload = [];

        let idx = 0;
        for (const member of room.clients.values()) {
          const spawnIndex = idx++;
          participants.set(member.id, {
            id: member.id,
            name: member.profile.name,
            spawnIndex,
            characterMode: member.profile.characterMode,
            vehicleId: member.profile.vehicleId,
            primaryColor: member.profile.primaryColor,
            accentColor: member.profile.accentColor,
            avatarId: member.profile.avatarId || member.id,
            alive: true,
            survivalTime: 0,
            score: 0,
            copsWrecked: 0,
            stars: room.settings.startStars || 1,
            eliminatedReason: null,
            killerName: null,
          });
          playersPayload.push(serializeRoomPlayer(member, spawnIndex));
        }

        room.match = {
          seed,
          createdAt: now,
          liveStartAt: startAt,
          finished: false,
          participants,
          countdownTimer: setTimeout(() => {
            if (room.state === 'countdown' && room.match && !room.match.finished) {
              room.state = 'playing';
              room.match.liveStartAt = Date.now();
              broadcastRoom(room, {
                type: 'match_start',
                code: room.code,
                roomCode: room.code,
                seed,
                settings: room.settings,
                players: playersPayload,
              });
            }
          }, countdownSec * 1000),
        };
        room.match.countdownTimer.unref?.();

        broadcastRoom(room, {
          type: 'match_countdown',
          code: room.code,
          roomCode: room.code,
          countdown: countdownSec,
          countdownSec,
          startAt,
          seed,
          settings: room.settings,
          players: playersPayload,
        });
        break;
      }

      case 'player_state': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room) return;

        const st = msg.state && typeof msg.state === 'object' ? msg.state : msg;
        const cleanState = {
          id: client.id,
          playerId: client.id,
          name: client.profile.name,
          characterMode: st.characterMode || client.profile.characterMode,
          vehicleId: st.vehicleId || client.profile.vehicleId,
          primaryColor: st.primaryColor || client.profile.primaryColor,
          accentColor: st.accentColor || client.profile.accentColor,
          avatarId: st.avatarId || client.profile.avatarId || client.id,
          x: Number(st.x) || 0,
          y: Number(st.y) || 0,
          z: Number(st.z) || 0,
          vx: Number(st.vx) || 0,
          vy: Number(st.vy) || 0,
          vz: Number(st.vz) || 0,
          angle: Number(st.angle) || 0,
          speed: Number(st.speed) || 0,
          drifting: Boolean(st.drifting),
          scale: Number(st.scale) || 1.0,
          hp: Number.isFinite(Number(st.hp)) ? Number(st.hp) : 100,
          maxHp: Number.isFinite(Number(st.maxHp)) ? Number(st.maxHp) : 100,
          alive: st.alive !== false,
          survivalTime: Math.max(0, Number(st.survivalTime) || 0),
          stars: Math.max(1, Math.min(5, Number(st.stars) || 1)),
          score: Math.max(0, Number(st.score) || 0),
          copsWrecked: Math.max(0, Number(st.copsWrecked) || 0),
          activeBuffs: st.activeBuffs || null,
          sentAt: Date.now(),
        };

        if (room.match && room.match.participants.has(client.id)) {
          const part = room.match.participants.get(client.id);
          if (part.alive) {
            part.survivalTime = Math.max(part.survivalTime, cleanState.survivalTime);
            part.score = cleanState.score;
            part.copsWrecked = cleanState.copsWrecked;
            part.stars = cleanState.stars;
          }
        }

        broadcastRoom(
          room,
          {
            type: 'player_state',
            playerId: client.id,
            state: cleanState,
          },
          client.id
        );
        break;
      }

      case 'ability_event': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room) return;
        const evPayload = msg.event && typeof msg.event === 'object' ? msg.event : msg;
        broadcastRoom(
          room,
          {
            type: 'ability_event',
            playerId: client.id,
            playerName: client.profile.name,
            event: {
              ...evPayload,
              playerId: client.id,
              ownerName: client.profile.name,
            },
          },
          client.id
        );
        break;
      }

      case 'pvp_bump': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room) return;
        broadcastRoom(
          room,
          {
            type: 'pvp_bump',
            fromId: client.id,
            fromName: client.profile.name,
            targetId: msg.targetId || null,
            vx: Number(msg.vx) || 0,
            vy: Number(msg.vy) || 0,
            vz: Number(msg.vz) || 0,
            spinOut: Number(msg.spinOut) || 0,
            power: Boolean(msg.power),
          },
          client.id
        );
        break;
      }

      case 'player_eliminated': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room || !room.match) return;

        const part = room.match.participants.get(client.id);
        if (!part || !part.alive) return;

        const reason =
          msg.reason === 'drowned' || msg.reason === 'wrecked' || msg.reason === 'busted'
            ? msg.reason
            : 'busted';
        const killerName = typeof msg.killerName === 'string' && msg.killerName.trim()
          ? msg.killerName.trim().slice(0, 22)
          : null;
        const elapsed = Math.max(0, (Date.now() - room.match.liveStartAt) / 1000);
        const reportedSurvival = Number(msg.survivalTime);
        const finalSurvival = Number.isFinite(reportedSurvival) && reportedSurvival > 0
          ? reportedSurvival
          : Math.max(part.survivalTime, elapsed);

        part.alive = false;
        part.survivalTime = Number(finalSurvival.toFixed(2));
        if (Number.isFinite(Number(msg.score))) part.score = Number(msg.score);
        if (Number.isFinite(Number(msg.copsWrecked))) part.copsWrecked = Number(msg.copsWrecked);
        part.eliminatedReason = reason;
        part.killerName = killerName;

        const announcement = formatEliminationAnnouncement(part.name, reason, killerName);
        broadcastRoom(room, {
          type: 'player_eliminated',
          playerId: client.id,
          playerName: part.name,
          reason,
          killerName,
          announcement,
          survivalTime: part.survivalTime,
          standings: computeStandings(room),
        });

        evaluateMatchEnd(room);
        break;
      }

      case 'return_to_lobby': {
        if (!client.roomCode) return;
        const room = rooms.get(client.roomCode);
        if (!room) return;
        if (room.state !== 'results' && room.hostId !== client.id) return;
        if (room.match?.countdownTimer) clearTimeout(room.match.countdownTimer);
        room.match = null;
        room.state = 'lobby';
        broadcastRoom(room, {
          type: 'return_to_lobby',
          code: room.code,
          roomCode: room.code,
        });
        broadcastRoomState(room);
        break;
      }

      default:
        break;
    }
  }

  function closeClient(client, code = 1000, reason = '') {
    if (!client || client.closed) return;
    client.closed = true;
    clients.delete(client.id);
    removeClientFromRoom(client);
    if (!client.socket.destroyed) {
      try {
        client.socket.write(encodeWsFrame(0x8, createClosePayload(code, reason)));
        client.socket.end();
      } catch {
        client.socket.destroy();
      }
    }
  }

  function consumeWsFrames(client, chunk) {
    client.readBuf = client.readBuf.length === 0 ? chunk : Buffer.concat([client.readBuf, chunk]);

    while (client.readBuf.length >= 2 && !client.closed) {
      const buf = client.readBuf;
      const b0 = buf[0];
      const b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      const len7 = b1 & 0x7f;

      let offset = 2;
      let payloadLen = len7;

      if (len7 === 126) {
        if (buf.length < 4) break;
        payloadLen = buf.readUInt16BE(2);
        offset = 4;
      } else if (len7 === 127) {
        if (buf.length < 10) break;
        const hi = buf.readUInt32BE(2);
        const lo = buf.readUInt32BE(6);
        payloadLen = hi * 0x100000000 + lo;
        offset = 10;
      }

      if (payloadLen > MAX_WS_PAYLOAD) {
        closeClient(client, 1009, 'Payload too large');
        return;
      }

      const maskLen = masked ? 4 : 0;
      const frameTotal = offset + maskLen + payloadLen;
      if (buf.length < frameTotal) break;

      const payload = Buffer.from(buf.subarray(offset + maskLen, frameTotal));
      if (masked) {
        const m0 = buf[offset];
        const m1 = buf[offset + 1];
        const m2 = buf[offset + 2];
        const m3 = buf[offset + 3];
        const mask = [m0, m1, m2, m3];
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= mask[i & 3];
        }
      }

      client.readBuf = buf.subarray(frameTotal);

      // Control frames (Close 0x8, Ping 0x9, Pong 0xA)
      if (opcode === 0x8) {
        closeClient(client, 1000, 'Normal closure');
        return;
      }
      if (opcode === 0x9) {
        if (!client.socket.destroyed) {
          client.socket.write(encodeWsFrame(0xA, payload));
        }
        continue;
      }
      if (opcode === 0xA) {
        client.lastPong = Date.now();
        continue;
      }

      // Data frames (Continuation 0x0, Text 0x1, Binary 0x2)
      if (opcode === 0x1 || opcode === 0x2 || opcode === 0x0) {
        client.fragmentBytes += payload.length;
        if (client.fragmentBytes > MAX_WS_PAYLOAD) {
          closeClient(client, 1009, 'Fragmented message too large');
          return;
        }
        client.fragments.push(payload);

        if (fin) {
          const fullBuf =
            client.fragments.length === 1 ? client.fragments[0] : Buffer.concat(client.fragments);
          client.fragments = [];
          client.fragmentBytes = 0;

          try {
            const parsed = JSON.parse(fullBuf.toString('utf8'));
            handleWsMessage(client, parsed);
          } catch {
            sendJson(client, { type: 'error', code: 'BAD_JSON', message: 'Malformed JSON message' });
          }
        }
      }
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const hostHeader = req.headers.host || 'localhost';
      const parsedUrl = new URL(req.url || '/', `http://${hostHeader}`);
      const pathname = parsedUrl.pathname;

      if (pathname === '/api/network-info' && (req.method === 'GET' || req.method === 'HEAD')) {
        const addr = server.address();
        const activePort = typeof addr === 'object' && addr ? addr.port : 4567;
        const info = getNetworkInfo(activePort);
        const body = JSON.stringify(info);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method Not Allowed');
        return;
      }

      const rawPathPart = String(req.url || '/').split('?')[0];
      let decodedRaw;
      let relPath;
      try {
        decodedRaw = decodeURIComponent(rawPathPart);
        relPath = decodeURIComponent(pathname);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad Request');
        return;
      }
      if (decodedRaw.includes('..') || decodedRaw.includes('\0') || relPath.includes('\0')) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }
      if (relPath === '/' || relPath === '') relPath = '/index.html';

      const targetPath = path.resolve(PUBLIC_DIR, `.${relPath}`);
      if (targetPath !== PUBLIC_DIR && !targetPath.startsWith(PUBLIC_DIR + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      let stat;
      try {
        stat = await fs.stat(targetPath);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      const finalFile = stat.isDirectory() ? path.join(targetPath, 'index.html') : targetPath;
      const ext = path.extname(finalFile).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      let fileBytes;
      try {
        fileBytes = await fs.readFile(finalFile);
      } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': fileBytes.length,
        'Cache-Control': 'no-store',
      });
      res.end(req.method === 'HEAD' ? undefined : fileBytes);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Internal Server Error');
    }
  });

  server.on('upgrade', (req, socket, head) => {
    const upgradeHeader = String(req.headers.upgrade || '').toLowerCase();
    const wsKey = req.headers['sec-websocket-key'];
    let parsedUrl;
    try {
      parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    } catch {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    if (upgradeHeader !== 'websocket' || !wsKey || (parsedUrl.pathname !== '/ws' && parsedUrl.pathname !== '/')) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const acceptKey = crypto
      .createHash('sha1')
      .update(wsKey.trim() + WS_GUID)
      .digest('base64');

    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${acceptKey}`,
        '\r\n',
      ].join('\r\n')
    );
    socket.setNoDelay(true);

    const num = nextClientNum++;
    const id = `p_${num}_${crypto.randomBytes(3).toString('hex')}`;
    const client = {
      id,
      socket,
      roomCode: null,
      closed: false,
      lastPong: Date.now(),
      readBuf: Buffer.alloc(0),
      fragments: [],
      fragmentBytes: 0,
      profile: {
        name: `Player ${num}`,
        characterMode: 'car_driver',
        vehicleId: 'sedan',
        primaryColor: '#ef4444',
        accentColor: '#fef08a',
        avatarId: 'default_hero',
        avatarDataUrl: null,
        ready: true,
      },
    };
    clients.set(id, client);

    sendJson(client, {
      type: 'welcome',
      playerId: id,
      serverTime: Date.now(),
    });

    if (head && head.length > 0) {
      consumeWsFrames(client, head);
    }

    socket.on('data', (chunk) => consumeWsFrames(client, chunk));
    socket.on('close', () => closeClient(client));
    socket.on('end', () => closeClient(client));
    socket.on('error', () => closeClient(client));
  });

  // RFC-6455 Ping keepalive every 20s
  const keepAliveTimer = setInterval(() => {
    const now = Date.now();
    const pingFrame = encodeWsFrame(0x9, Buffer.from('sk'));
    for (const client of clients.values()) {
      if (now - client.lastPong > 65000) {
        closeClient(client, 1001, 'Ping timeout');
        continue;
      }
      if (!client.socket.destroyed) {
        try {
          client.socket.write(pingFrame);
        } catch {
          closeClient(client);
        }
      }
    }
  }, 20000);
  keepAliveTimer.unref?.();

  server.on('close', () => {
    clearInterval(keepAliveTimer);
    for (const client of clients.values()) {
      client.socket.destroy();
    }
    clients.clear();
    rooms.clear();
  });

  return { server, clients, rooms };
}

export function startServer(customPort, customHost = '0.0.0.0') {
  const rawPort =
    customPort !== undefined
      ? Number(customPort)
      : process.env.PORT !== undefined && process.env.PORT !== ''
        ? Number(process.env.PORT)
        : 4567;
  const safePort = Number.isFinite(rawPort) && !FORBIDDEN_PORTS.has(rawPort) ? rawPort : 4567;
  const host = process.env.HOST || customHost || '0.0.0.0';

  const { server, clients, rooms } = createSmashyServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(safePort, host, () => {
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : safePort;
      const netInfo = getNetworkInfo(boundPort);
      resolve({ server, port: boundPort, netInfo, clients, rooms });
    });
  });
}

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  startServer()
    .then(({ port, netInfo }) => {
      console.log(`Smashy Kart server listening on http://0.0.0.0:${port}`);
      console.log(`Shareable Phone Wi-Fi URL: ${netInfo.shareBaseUrl}`);
    })
    .catch((err) => {
      console.error('Failed to start Smashy Kart server:', err);
      process.exitCode = 1;
    });
}
