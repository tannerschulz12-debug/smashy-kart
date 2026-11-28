# Smashy Kart Module Contract

All client modules live in `public/js/` as native ES modules (`import ... from './...'`), zero external npm/CDN dependencies.
Server lives in `server.mjs` (Node v24 built-in `node:http`, `node:fs`, `node:path`, `node:crypto`, `node:os`).

## Coordinate System & Conventions
- Right-handed 3D Y-up. Ground is `y = 0`. Water is `y = -1.6`. Bridges peak around `y = 1.8`.
- World spans `-1200 .. +1200` on X and Z (`WORLD_SIZE = 2400`, `CHUNK_SIZE = 60`, chunk coords `cx, cz` in `-20 .. 19`).
- Heading `angle` in radians:
  - Forward unit vector: `fx = Math.sin(angle)`, `fz = Math.cos(angle)`.
  - Steer LEFT: `angle += turnRate * dt`. Steer RIGHT: `angle -= turnRate * dt`.

## 1. `public/js/world.js` (Subagent 1)
Exports `export class World`:
- `constructor(seed = 777123, biomeId = 'city', options = { itemBoxDensity: 1.2 })`
- `reset(seed, biomeId, options)`
- `update(dt, focusX, focusZ)` — streams chunks within `VIEW_CHUNK_RADIUS` around `(focusX, focusZ)`, rotates floating item boxes, respawns collected item boxes after 12s, updates active explosions/geysers.
- `getVisibleChunks(focusX, focusZ)` — returns array of active chunk objects `{ cx, cz, key, tiles, buildings, props, ramps, itemBoxes, gasStations }`.
- `getGroundHeight(x, z)` — returns `{ y, surface: 'road'|'grass'|'water'|'bridge'|'ramp', rampSlopeX, rampSlopeZ, speedFactor }`.
  - Bridges span across river chunks so cars driving on roads cross rivers safely, while swerving off-bridge into water (`surface === 'water'`) splashes & drowns (`y = -1.6`)!
  - Ramps smoothly elevate `y` from `0` up to `3.6` along their direction so hitting a ramp launches cars/runners into the air!
- `resolveBuildingCollision(entity)` — tests `entity` (`{ x, y, z, vx, vz, radius }`) against solid buildings/canyon walls in nearby chunks; pushes entity out, reflects/dampens velocity, returns `{ hit: boolean, impactSpeed: number, normalX, normalZ, building }`. (If `entity.y > building.height`, entity flies right over!)
- `collideProps(entity, onSmash)` — checks destructible props (`tree`, `fence`, `hydrant`, `streetlight`, `crate`, `cone`, `cactus`, `snowman`, `gas_pump`) in nearby chunks; marks smashed props (`prop.smashed = true`), triggers `onSmash(prop)` (note: `gas_pump` triggers a chain-reaction gas station explosion!), returns array of smashed props.
- `collectItemBoxes(entity)` — checks uncollected `?` item boxes within `entity.radius + 1.8`; marks box collected (`respawnTimer = 12`), returns number collected.
- `findSpawnPoint(index = 0)` — returns `{ x, z, angle }` on a safe wide central road near `(0, 0)` spaced cleanly for up to 8 lobby players (`index = 0..7`) so friends start side-by-side in view of each other!
- `findRoadSpawnNear(x, z, minDist = 55, maxDist = 95)` — returns `{ x, z, angle }` on a valid road/ground tile for spawning police & traffic.

## 2. `public/js/models.js` (Subagent 1)
Exports voxel blueprint helpers & entity draw-list emitters:
- `buildVehicleParts(vehicleId, primaryColor, accentColor, wheelSpin = 0)` -> returns array of box parts `{ ox, oy, oz, sx, sy, sz, color, emissive }`.
- `emitPlayerVisuals(batcher, player, time)` -> emits all 3D boxes + textured photo elements for `player` supporting all 3 `characterMode`s:
  1. `'car_driver'`: 3D blocky vehicle + spinning wheels + large crisp custom photo cutout popping out of roof/cockpit (tilts with steering/speed) + hood decal!
  2. `'photo_car'`: "Look Like a Car" — chunky 3D car chassis & spinning wheels where the entire sculpted body/cab/hood displays the player's uploaded photo texture with headlights, bumper, and exhaust!
  3. `'runner'`: "Just Myself" — sprinting 3D blocky character (pumping legs & arms proportional to speed) with custom photo head/torso billboard/box, oversized sneakers, and cape/trail!
  - Also renders Star Power rainbow cycle, Mega Giant `scale`, Lightning shrunk `scale`, shield/turbo flames, and overhead floating nametag info if remote player.
- `emitCopVisuals(batcher, cop, time)` -> renders `'cruiser'`, `'suv'`, `'swat'`, `'heli'`, `'army'`, `'tank'` with flashing red/blue lightbars, spinning helicopter rotor + ground spotlight ring, tank turret, AND optional friend photo cutout popping out of the cop roof (`cop.avatarId`)!
- `emitTrafficVisuals(batcher, car, time)` -> civilian voxel cars/trucks/buses.
- `emitPropVisuals(batcher, prop, biomeId, time)` -> trees, fences, hydrants, lamps, gas stations with canopy, ramps with yellow chevron stripes, etc.
- `emitItemBoxVisuals(batcher, box, time)` -> floating bobbing rotating rainbow translucent/bright Mario Kart `?` cube with ground glow & `?` texture on faces!
- `emitProjectileVisuals(batcher, proj, time)` -> Red Homing Shell, Banana Peel, Ticking Bob-omb, Tank Shell, Shockwave ring, Lightning bolt!

## 3. `public/js/renderer3d.js` (Subagent 1)
Exports `export class Renderer3D`:
- `constructor(canvas)`
- `resize(width, height, dpr)`
- `registerPhotoTexture(avatarId, imageOrCanvasOrDataUrl)` -> uploads/updates WebGL texture for `avatarId` (with clean alpha cutout support + fallback generated smiley/face texture when `'default_hero'`).
- `hasTexture(avatarId)` -> boolean
- `setCamera(focusEntity, cameraMode = 'smashy', shakeAmount = 0, dt = 0.016)` -> smooth critically-damped Smashy Road camera (`'smashy'` angled isometric-perspective OR `'chase'` behind-entity perspective) with dynamic FOV/zoom pull-back at high speed or Mega Giant mode, plus screen shake!
- `projectToScreen(x, y, z)` -> returns `{ x, y, visible }` in CSS pixels (for crisp HTML floating player names/crowns/alerts in multiplayer!).
- `spawnDebris(x, y, z, color, count = 8, speed = 14, scale = 0.45)` -> spawns 3D tumbling voxel debris cubes with gravity & ground bounce!
- `spawnSmoke(x, y, z, color = '#e2e8f0', count = 2, size = 0.7)` -> rising expanding 3D blocky smoke/fire/dust puffs!
- `addSkidMark(x1, z1, x2, z2, width = 0.42, alpha = 0.45)` -> persistent dark tire skid ribbons on road!
- `spawnExplosionVisual(x, y, z, radius = 7)` -> flash sphere/cubes + fiery orange/yellow/black voxel burst + scorch mark!
- `render(sceneState, dt, time)` ->
  - Pass 1: 2048x2048 Directional Sun Shadow Map FBO over visible region around focus!
  - Pass 2: Main viewport clear with sky gradient, ground/water/road/building/prop instanced voxel batches with PCF soft-crisp shadow sampling + hemisphere lighting + fog, skid marks, vehicles/runners, textured 3D photo cutouts/wraps, spinning `?` boxes (with auto-generated `?` canvas texture!), projectiles, particles/debris!

## 4. `public/js/abilities.js` (Subagent 2)
Exports `export class AbilitySystem`:
- `constructor(settings)`
- `updateSettings(settings)`
- `createPlayerItemState()` -> `{ heldItem: null, charges: 0, rouletteTimer: 0, rouletteDisplayId: null, starTimer: 0, megaTimer: 0, boostTimer: 0, shrunkTimer: 0, shockwaveVisualTimer: 0 }`
- `triggerItemBox(playerState, rankBias = 0)` -> starts 1.15s Mario Kart roulette spin (if nothing held and not already spinning) picking from `settings.enabledItems`!
- `updatePlayerItemState(player, dt, context)` -> advances roulette timer, ticks active buffs (`starTimer`, `megaTimer`, `boostTimer`, `shrunkTimer`), applies Star/Mega contact knockouts.
- `useHeldItem(player, context)` -> activates `player.items.heldItem` (decrements `charges`, spawns homing rocket / banana / bob-omb / lightning / shockwave / turbo / star / mega), triggers `context.onEvent({ type, ... })`, returns `{ used: boolean, abilityId }`.
- `spawnNetworkAbilityEvent(event, context)` -> reproduces remote player's thrown shell/banana/bomb/lightning/horn in multiplayer!
- `updateProjectiles(dt, context)` -> updates `this.projectiles` (homing shells steering toward nearest cop or rival player, bouncing bob-ombs exploding in AoE, bananas spinning out cars/cops for 1.6s, expanding shockwave rings, lightning bolts).
- `getProjectiles()` -> array of active projectiles for `Renderer3D`.

## 5. `public/js/physics_ai.js` (Subagent 2)
Exports `export class Simulation`:
- Manages local player physics, remote player interpolation + PvP collisions, civilian traffic, 5-star police AI, helicopters, tanks, arrest ("BUSTED") & health ("WRECKED") logic, score & chaos combos!
- `constructor(world, abilitySystem, settings)`
- `resetRun(seed, settings, rosterPlayers)`
- `createLocalPlayer(spawn, settings)`
- `syncRemotePlayers(remoteSnapshots, localId)`
- `applyPvPCollision(localPlayer, remotePlayers)` -> bouncy car-to-car / runner impacts returning impulse notifications so friends can slam each other into cops, buildings, or rivers!
- `update(dt, input, time)` ->
  - `input`: `{ left: boolean, right: boolean, brake: boolean, useItem: boolean, horn: boolean, steerAxis: number | null }`
  - Updates local player movement (supporting `'car_driver'`, `'photo_car'`, and `'runner'` — NO hopping out of cars mid-run!), ramp launches, water splash hazard, building & prop smashing, gas station chain explosions, `?` item box pickups, civilian traffic, escalating 1-5★ cops (`cruiser`, `suv`, `swat`, `heli`, `army`, `tank`), busted meter (`0..1`), health (`0..maxHp`), score, survival seconds, cops wrecked count.
  - Emits callbacks/events array `events` for audio & camera shake (`smash`, `explosion`, `pickup_box`, `roulette_tick`, `roulette_lock`, `item_used`, `cop_wrecked`, `pvp_slam`, `water_splash`, `busted`, `wrecked`, `star_up`).

## 6. `public/js/audio.js` (Subagent 2)
Exports `export class SoundManager`:
- Built-in zero-file Web Audio synthesizer (engine idle/rev, drift screech, siren wail, Mario Kart roulette ticks + lock fanfare, star power catchy synth loop, explosions, smash crunch, splash, busted buzzer, horn) PLUS Custom Sound Recorder & File Uploader persisted in IndexedDB (`smashy_kart_sounds_v1`)!
- Slots: `'boost'`, `'crash'`, `'item'`, `'horn'`, `'busted'`.
- Methods: `unlock()`, `setVolume(v)`, `updateLoopSounds(speedRatio, drifting, wantedStars, starActive, paused)`, `playEvent(eventName, intensity)`, `startMicRecording()`, `stopMicRecording(slot)`, `uploadAudioFile(slot, file)`, `hasCustomSound(slot)`, `previewSlot(slot)`, `clearCustomSound(slot)`, `getSavedSlotsSummary()`.

## 7. `public/js/photo_studio.js` (Subagent 2)
Exports `export class PhotoStudio`:
- Persists custom uploaded people in IndexedDB (`smashy_kart_people_v1`) + ships with 4 fun built-in illustrated starter characters so the game looks lively even before uploading!
- Interactive crop/zoom + Magic Background Cutout (flood-fill edge background removal with adjustable tolerance slider + circle/head/full/car-wrap mask modes) -> outputs clean transparent 256x256 PNG/WebP data URL (< 30KB for fast WebSocket lobby sync!).
- Methods: `init()`, `getPeople()`, `getPerson(id)`, `savePerson({ id, name, dataUrl, useAsCop })`, `deletePerson(id)`, `processImageToCutout(imgSource, options)` (`{ zoom, offsetX, offsetY, magicCutout, tolerance, shape: 'cutout'|'circle'|'full' }`), `getCopAvatarPool()`.

## 8. `server.mjs` + `public/js/multiplayer.js` (Subagent 2)
- `server.mjs`:
  - Listens on `process.env.PORT || 4567` bound to `0.0.0.0`.
  - Serves `public/` safely (path-traversal protected).
  - `GET /api/network-info` -> `{ port, lanIps: [...], hostname, urls: [...] }`.
  - WebSocket `/ws` (pure Node RFC-6455 implementation supporting fragmented/large frames up to 256KB for avatar thumbnails + ping/pong keepalive):
    - Messages: `create_room`, `join_room`, `update_profile` (name, characterMode, vehicleId, primaryColor, accentColor, avatarDataUrl, ready), `update_room_settings` (host updates biome, copIntensity, startStars, enabledItems, worldSeed), `start_match` (3s countdown + shared seed + spawn indices), `player_state` (20Hz x,y,z,vx,vz,angle,hp,alive,survivalTime,stars,score,activeBuffs), `ability_event`, `pvp_bump`, `player_eliminated` (reason, killerName), `return_to_lobby`.
    - Tracks "Who Lasts Longer" standings per match and crowns the last surviving player (or longest survival time when the final survivor falls)!
- `public/js/multiplayer.js`:
  - Exports `MultiplayerClient` + `renderQrCodeSvg(text)` (genuine self-contained ISO 18004 QR code SVG generator, Byte mode + Reed-Solomon ECC, zero external dependencies!).
