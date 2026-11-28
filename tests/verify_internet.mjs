// Live 24/7 Internet Party Relay Test (MQTT-over-WSS across 2 simulated phones!)
import assert from 'node:assert/strict';
import { MultiplayerClient, generateQrMatrix, renderQrCodeSvg } from '../public/js/multiplayer.js';

function createSampleWavDataUrl(numSamples = 4500, sampleRate = 11025) {
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
    const s = Math.sin((2 * Math.PI * 523.25 * i) / sampleRate) * 0.5;
    buf.writeInt16LE(Math.round(s * 0x7fff), 44 + i * 2);
  }
  return `data:audio/wav;base64,${buf.toString('base64')}`;
}

function waitForEvent(client, eventName, predicate = () => true, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error(`Timed out waiting for ${eventName}`));
    }, timeoutMs);
    const off = client.on(eventName, (payload) => {
      if (predicate(payload)) {
        clearTimeout(timer);
        off();
        resolve(payload);
      }
    });
  });
}

async function runInternetPartyTest() {
  console.log('1. Verifying Version 4 QR Code for full 61-byte GitHub Pages HTTPS room URL...');
  const ghUrl = 'https://tannerschulz12-debug.github.io/smashy-kart/?room=KART';
  const qr = generateQrMatrix(ghUrl);
  assert.equal(qr.version, 4);
  assert.equal(qr.size, 33);
  const svg = renderQrCodeSvg(ghUrl);
  assert.ok(svg.startsWith('<svg') && svg.includes('data-qr-version="4"'));

  console.log('2. Connecting 2 simulated phones over live WSS internet relay (no local server)...');
  const phone1 = new MultiplayerClient({ forceCloud: true });
  const phone2 = new MultiplayerClient({ forceCloud: true });

  try {
    const avatar1 = 'data:image/png;base64,' + 'A'.repeat(22000);
    const avatar2 = 'data:image/png;base64,' + 'B'.repeat(22000);

    const hostJoinedP = waitForEvent(phone1, 'room_joined');
    await phone1.createRoom(
      { name: 'Tanner', characterMode: 'photo_car', vehicleId: 'supercar', avatarDataUrl: avatar1, ready: true },
      { biome: 'desert', startStars: 2 }
    );
    const hostJoined = await hostJoinedP;
    const code = hostJoined.code;
    console.log(`   Created Internet Room Code: ${code} via ${phone1.mqtt.brokerUrl}`);
    assert.equal(code.length, 4);

    const joinerJoinedP = waitForEvent(phone2, 'room_joined');
    const hostSeesTwoP = waitForEvent(phone1, 'room_state', (r) => r.players?.length === 2);
    await phone2.joinRoom(code, {
      name: 'FriendPhone',
      characterMode: 'runner',
      vehicleId: 'kart',
      avatarDataUrl: avatar2,
      ready: true,
    });

    const [joinerJoined, twoRoom] = await Promise.all([joinerJoinedP, hostSeesTwoP]);
    assert.equal(joinerJoined.code, code);
    assert.equal(twoRoom.players[0].avatarDataUrl.length, avatar1.length);
    assert.equal(twoRoom.players[1].avatarDataUrl.length, avatar2.length);
    console.log('   Both 22KB custom photo cutouts synced phone-to-phone over internet WSS!');

    // Verify Host custom sound_sync (~12KB WAV) + horn_event + sound_sync_clear over live WSS internet room!
    const sampleHornWav = createSampleWavDataUrl(4500, 11025);
    const soundSyncP = waitForEvent(phone2, 'sound_sync', (m) => m.slot === 'horn');
    phone1.syncHostSound('horn', sampleHornWav, 'Host Airhorn');
    const soundRecv = await soundSyncP;
    assert.equal(soundRecv.slot, 'horn');
    assert.equal(soundRecv.dataUrl, sampleHornWav, 'Guest phone must receive exact 12KB Host WAV payload');
    assert.equal(soundRecv.label, 'Host Airhorn');
    assert.equal(soundRecv.hostName, 'Tanner');

    const hornRecvP = waitForEvent(phone2, 'horn_event');
    phone1.sendHornEvent({ x: 42, z: -18 });
    const hornRecv = await hornRecvP;
    assert.equal(hornRecv.playerName, 'Tanner');
    assert.equal(hornRecv.x, 42);
    assert.equal(hornRecv.z, -18);

    const soundClearP = waitForEvent(phone2, 'sound_sync_clear');
    phone1.clearAllHostSounds();
    await soundClearP;
    console.log('   Live ~12KB Host sound_sync + horn_event synced phone-to-phone over internet WSS!');

    const cd1P = waitForEvent(phone1, 'match_countdown');
    const cd2P = waitForEvent(phone2, 'match_countdown');
    phone1.startMatch(999111);
    const [cd1, cd2] = await Promise.all([cd1P, cd2P]);
    assert.equal(cd1.seed, 999111);
    assert.equal(cd2.seed, 999111);

    // 1-hop peer state + bump relay (verify real username is preserved in player_state, NEVER "Friend"!)
    const stateRecvP = waitForEvent(phone2, 'player_state');
    phone1.sendPlayerState({ name: 'Tanner', x: 14, y: 0, z: 28, vx: 12, vy: 0, vz: 30, angle: 0.2, speed: 32 }, true);
    const stateRecv = await stateRecvP;
    assert.equal(stateRecv.name, 'Tanner', 'Remote player_state must carry real username');
    const interp = phone2.getInterpolatedRemotePlayers();
    assert.equal(interp[0]?.name, 'Tanner', 'Interpolated remote snapshot must preserve real username');

    const bumpP = waitForEvent(phone2, 'pvp_bump');
    phone1.sendPvpBump({ fromId: phone1.playerId, fromName: 'Tanner', vx: 30, vy: 6, vz: -12 });
    const bump = await bumpP;
    assert.equal(bump.vx, 30);

    // Eliminate FriendPhone -> verify Tanner crowned #1!
    const res1P = waitForEvent(phone1, 'match_results');
    const res2P = waitForEvent(phone2, 'match_results');
    phone2.sendPlayerEliminated('drowned', 'Tanner', 38.4, 950, 3);
    const [res1, res2] = await Promise.all([res1P, res2P]);
    assert.equal(res1.winnerName, 'Tanner');
    assert.equal(res2.winnerName, 'Tanner');
    console.log('   Live internet match crowned winner:', res1.winnerName);
  } finally {
    phone1.disconnect();
    phone2.disconnect();
  }

  console.log('ALL 24/7 INTERNET PARTY CHECKS PASSED!');
}

runInternetPartyTest().catch((err) => {
  console.error('INTERNET PARTY CHECK FAILED:', err);
  process.exit(1);
});
