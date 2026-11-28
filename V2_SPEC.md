# Smashy Kart v2 Upgrade — Shared Swarm Interface Spec

Working directory for ALL edits:
`/Users/tannerschulz/.gemini/antigravity/brain/2d80f737-5b97-4868-a6a6-72a230629c6e/scratch/smashy-kart/`

STRICT SAFETY RULES FOR ALL WORKERS:
1. NEVER read, edit, or touch anything in `/Users/tannerschulz/Sites/sebwite-ag-lane` or any personal/private directory.
2. NEVER launch headless Chrome / Playwright / browser suites. Verify your owned JS modules using `node --check` and Node unit scripts inside the scratch folder.
3. Touch ONLY the files explicitly assigned in your brief!

---

## Shared Cross-Module Contracts for v2

### A. 2x Bigger World (`4800 x 4800`) + Dedicated Sugar Mystery Boxes (`world.js` <-> `physics_ai.js` <-> `models.js`)
- `WORLD_CONFIG.WORLD_SIZE = 4800`, `HALF_WORLD = 2400` (`80 x 80 = 6400` chunks).
- `world.js` adds LRU eviction on `this.chunks` (keep max `260` chunks, never evicting chunks with active `collectedBoxes` respawn timers or within `VIEW_CHUNK_RADIUS + 2`) AND `renderer3d.js` adds LRU eviction on its static chunk cache (`max 260` chunks) so driving across the 4800x4800 world uses flat memory at 60 FPS!
- **Sugar Mystery Boxes** in `chunk.itemBoxes`:
  - Each box in `chunk.itemBoxes` has `box.boxType = 'normal' | 'sugar'` (`~22%` of road/ramp boxes are `'sugar'`, plus rows of `'sugar'` boxes on the new **Airport Stunt Runway** districts!).
  - Keep `world.collectItemBoxes(entity)` backward-compatible returning `number` of `'normal'` boxes collected, AND add `world.collectSugarBoxes(entity)` returning `number` of `'sugar'` boxes collected (or `world.collectAllMysteryBoxes(entity)` returning `{ normal: number, sugar: number }` while `collectItemBoxes(entity)` still returns total count for existing `tests/verify.mjs`!).
    - Specifically:
      - `world.collectItemBoxes(entity)` -> returns `number` (for `tests/verify.mjs` compatibility; only collects `'normal'` boxes OR collects any box when `collectAllMysteryBoxes` isn't used). Even cleaner:
        - Keep `world.collectItemBoxes(entity)` collecting `'normal'` boxes (returns `number`), AND add `world.collectSugarBoxes(entity)` collecting `'sugar'` boxes (returns `number`)! In `tests/verify.mjs` chunk `(0,0)` still has `'normal'` boxes on the starting boulevard!
- **Creative New World Landmarks**:
  - Add an **Airport Stunt Runway & Sky-Jump District** (`district === 'airport'` at e.g. `(cx in 6..8, cz in 6..8)` and `(cx in -8..-6, cz in -8..-6)` plus outer rings, plus river-crossing highways extended across `cz === 14` and `cz === -16` in the bigger `4800x4800` world!) featuring wide runway tarmac, control tower, voxel stunt jets, mega-high `5.2`-unit super-ramps, and lines of sparkling pink-cyan `'sugar'` mystery boxes!

### B. First-Person Point-of-View Camera (`cameraMode === 'pov'`) (`renderer3d.js` <-> `models.js` <-> `main.js`)
- `setCamera(focusEntity, cameraMode = 'smashy', shakeAmount = 0, dt = 0.016, extraOpts = {})`
  - Accepts `cameraMode`: `'smashy' | 'chase' | 'pov'`, and optional `extraOpts = { povFov: 76 }`.
  - When `cameraMode === 'pov'`:
    - Smoothly tracks `focusEntity.angle` (`povYaw` exponentially smoothed at `dt * 18` so steering feels responsive yet silky, never jittery!).
    - Eye position sits at driver cockpit/eye height (`y = fy + (mode === 'runner' ? 2.45 : 1.88) * scale`), slightly forward (`+0.32 * scale` along forward vector `(sin(yaw), cos(yaw))`) so the player clearly sees their **own 3D blocky car hood, hood stripe/headlights, or pumping 3D sprinter arms** at the bottom of the view!
    - Look target sits `28` units ahead along `(sin(yaw), pitchOffset, cos(yaw))` where `pitchOffset` tilts up/down with `focusEntity.vy` when flying off giant ramps!
    - Dynamic FOV: base `(extraOpts.povFov || 76)°`, expanding smoothly up to `92°` during `sugarActive` (`sugarTimer > 0`), `86°` during `boostActive` / `starActive`!
    - Near clip plane in `'pov'` mode lowered to `0.45` (and far clip `850.0`) in `_updateCameraMatrices()` so your car's front hood (`1.2–2.2` units ahead) renders crisply without near-plane clipping!
    - Expose `renderer.currentCameraMode` and `renderer.povFocusId = (cameraMode === 'pov' ? focusEntity?.id : null)` so `emitPlayerVisuals(batcher, player, time)` in `models.js` **hides ONLY the roof-popout driver head card & overhead items of `player` when `batcher.povFocusId === player.id`**, preventing your own custom photo cutout from blocking your windshield in POV while still showing your hood & every friend's cutout!

### C. Twin-Rocket RPG (`id: 'homing_rocket'`) & 3x Sugar Rush (`id: 'sugar_rush'`) + Drift Mini-Turbo (`abilities.js` <-> `physics_ai.js` <-> `models.js` <-> `multiplayer.js`)
- **`AbilitySystem` (`abilities.js`)**:
  - `createPlayerItemState()` includes `sugarTimer: 0` alongside `starTimer`, `megaTimer`, `boostTimer`, `shrunkTimer`, `shockwaveVisualTimer`.
  - Add `triggerSugarBox(playerState)` -> immediately spins a crisp `0.55s` candy roulette (or sets `heldItem = 'sugar_rush', charges = 1` if empty; if already holding something else and picking up a dedicated Sugar Mystery Box, either queues into empty slot OR triggers an instant `2.2s` bonus Sugar Surge if hand is already full so hitting a Sugar Box NEVER feels wasted!!).
  - **`sugar_rush` (`id: 'sugar_rush'`)**:
    - Activates `items.sugarTimer = 4.5`, `player.sugarTimer = 4.5`, `player.sugarActive = true`, `player.spinOutTimer = 0`, `player.bustedProgress = 0`!
    - Launches forward immediately at **3x mushroom boost power**: `topSpeed` multiplier in `physics_ai.js` is **`2.35x`** (`+135%` speed = **3x** the `+45%` boost of `triple_boost`!), `accel * 3.6`, ignores offroad slow!
    - **Sugar Wall-Ricochet & Cop Bowling**: While `player.sugarActive` (`sugarTimer > 0`), touching any ground cop or civilian car blasts them flying (`_wreckCop` / fling) like Star Power, AND colliding with a building in `physics_ai.js` bounces cleanly off the wall normal with **zero HP damage** and candy debris sparks so 3x speed feels euphoric and controllable!
  - **`homing_rocket` -> Twin-Rocket RPG**:
    - Firing `homing_rocket` spawns **TWO RPG warhead rockets simultaneously**:
      - Left barrel (`lateral = -1.15`, `barrelSide = -1`) & Right barrel (`lateral = +1.15`, `barrelSide = +1`)!
      - Target assignment: scans alive cops & rival players ahead/nearby; Rocket #1 locks onto the closest valid target (`preferredTargetId`), Rocket #2 locks onto the **2nd closest distinct target** (or the same target if only 1 target is nearby, e.g. double-tapping a heavy Tank!).
      - Projectile `type: 'rpg_rocket'` (also supported as alias in `models.js` `emitProjectileVisuals` alongside `'homing_rocket'`), `speed: 88`, `blastRadius: 9.5`, twin smoke trail!
      - `netEvent` carries `twinRpg: true` so `spawnNetworkAbilityEvent` spawns BOTH rockets on every friend's phone!
  - `player.activeBuffs` includes `sugar: items.sugarTimer > 0`, and `player.heldItemId = items.heldItem` so `models.js` can render a **3D Voxel Twin-Barrel RPG Launcher** on the car roof / runner shoulder whenever holding `'homing_rocket'`!
- **Creative Bonus in `physics_ai.js` — Mario Kart Drift Sparks & Mini-Turbo**:
  - Track `player.driftCharge` (`0..2.5s` while `player.drifting && player.grounded && Math.abs(player.steerInput) > 0.2`):
    - `driftCharge >= 0.75`: `player.driftSparkTier = 1` (Blue rear-wheel sparks in `models.js`!)
    - `driftCharge >= 1.55`: `player.driftSparkTier = 2` (Orange/Gold rear-wheel sparks in `models.js`!)
    - When player straightens out after `driftSparkTier >= 1`, grants a crisp free mini-boost (`items.boostTimer = Math.max(items.boostTimer, tier === 2 ? 0.95 : 0.55)`) + emits `{ type: 'mini_turbo', tier }`!
  - Also apply `this.settings.steerSensitivity` (`0.7 .. 1.4`, default `1.0`) to `lp.handling` in `_updateLocalPlayerPhysics` (note: `steerSensitivity` is a personal control preference, never locked by Lobby Rules!).

### D. Personal Settings, Side-Only Mystery Box Button, & Smooth Editors (`index.html`, `styles.css`, `photo_studio.js`, `main.js`)
- **NO Front-Middle Item Box**:
  - Remove `#hud-item-slot` from `.hud-top` in `public/index.html`! The top-middle of the screen stays 100% wide open!
  - All roulette spinning (`spinning` class, cycling icon & shortName), locked pop (`locked-pop`), held ability name (`TWIN RPG`, `SUGAR 3X`, etc.), and charges badge (`#btn-use-item-charges`, e.g. `x3`) live directly inside the right-side clickable `#btn-use-item` button!
- **Dedicated ⚙️ Personal Settings Modal (`#settings-modal`)**:
  - Accessible from:
    1) Home screen workshop bar (`⚙️ Settings`)
    2) Inside Party Lobby (`⚙️ My Settings` button — works even when Host locked car stats, because camera/controls/volume are personal!)
    3) **In-Game Top-Right HUD** (`#btn-ingame-settings` `⚙️` button right next to `#btn-quick-cam` `🎥` and `#btn-pause` `✕`) so players can switch camera angle, FOV, steering style, sensitivity, or volume **live mid-game without leaving the chase**!
  - Camera options: `Smashy Overhead` (`smashy`), `Behind Chase` (`chase`), and **`First-Person POV` (`pov`)**! Pressing `C` or `V` on keyboard or tapping `#btn-quick-cam` (`🎥`) cycles `smashy -> chase -> pov` live with a tiny corner toast (`🎥 POV Camera`)!
- **Smooth Drag-and-Pinch Photo & Garage Editing**:
  - `photo_studio.js`: cache decoded offscreen image + background-erased mask canvas (`prepareEditableSource(imgSource, tolerance, magicCutout)`) so dragging (`pointerdown`/`pointermove` directly on `#photo-crop-canvas`) and pinching/wheel-zooming redraws at **instant 60fps** without recomputing CIE-LAB flood-fill on every frame! Also allow clicking `✏️ Edit` on any saved custom person to re-open them in the editor!
  - `garage-modal`: add 1-tap tuning preset pills (`⚖️ Balanced`, `💨 Drift Pro`, `🚀 Top Speed`, `🦏 Heavy Tank`) + visual stat progress bars on vehicles + instant swatch tiles!
