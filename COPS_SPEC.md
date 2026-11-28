# Smashy Kart — Playable Police Team (Tank, Helicopter, SWAT, Cruiser), 2.0s Soft-Tracking Missiles & AI Cops ON/OFF Spec

All files live in:
`/Users/tannerschulz/.gemini/antigravity/brain/2d80f737-5b97-4868-a6a6-72a230629c6e/scratch/smashy-kart/`

## User Request (Verbatim Goals)
1. **Clear "AI Police Chase: ON / OFF" + Clear Photo Face Label**:
   - "the cops on and cops off doesn’t make much sense to me. Does that mean they’re chasing after you or not chasing after you and as the owner I wanna be able to turn that on and off"
   - Rename the photo-card toggle in `#people-grid` from confusing `"🚔 Cop ON / Cop OFF"` to **`🚔 Face on Cops` / `Face Only Me`** (with plain helper text `"Put uploaded faces onto AI police cars"`).
   - Add a **true `🚔 AI Police Chasing Players: ON / OFF` toggle (`aiCopsEnabled: true | false`)**:
     - Visible right in **Lobby Manager Controls (`#host-manager-panel`)** (`#perm-ai-cops`, synced to all 16 players!) AND in **World & Items (`#world-modal`)** (`#chk-ai-cops`)!
     - When `aiCopsEnabled === false`: **0 AI police spawn or chase anyone** (`sim.cops = []`, no AI arrest bar)! Players can cruise freely or battle purely **Friends vs. Friends (Human Cops vs. Getaway Runners)**!
2. **Playable Police Role (`playerRole: 'runner' | 'cop'`) & 4 Playable Police Vehicles (`COP_VEHICLES`)**:
   - "I want where some people can choose to play as a cop in different [vehicles] like the tank or the helicopter and if you’re in the helicopter, you need to be able to shoot missiles at people and same as the tank, but I don’t want them tracking that hard and I want there to be like a two second cooldown for each shot"
   - Export `COP_VEHICLES` from `public/js/config.js`:
     1. `{ id: 'cop_cruiser', copType: 'cruiser', name: 'Police Interceptor', icon: '🚔', speed: 51, accel: 41, handling: 3.6, drift: 0.89, mass: 1.35, maxHp: 125, radius: 2.15, hasMissile: false, desc: 'Fast V8 pursuit cruiser with siren surge & PIT slam' }`
     2. `{ id: 'cop_swat', copType: 'swat', name: 'Armored SWAT Truck', icon: '🛡️', speed: 45, accel: 34, handling: 2.95, drift: 0.86, mass: 2.0, maxHp: 175, radius: 2.5, hasMissile: false, desc: 'Heavy battering-ram truck that boxes in & wrecks runners' }`
     3. `{ id: 'cop_heli', copType: 'heli', name: 'Police Attack Heli', icon: '🚁', speed: 55, accel: 46, handling: 3.9, drift: 0.92, mass: 1.4, maxHp: 135, radius: 2.2, flying: true, hoverY: 11.5, hasMissile: true, missileCooldown: 2.0, desc: 'Flies over buildings & rivers! Fires air-to-ground missiles (2s cooldown)' }`
     4. `{ id: 'cop_tank', copType: 'tank', name: 'Heavy Police Tank', icon: '🪖', speed: 40, accel: 31, handling: 2.85, drift: 0.82, mass: 2.6, maxHp: 220, radius: 2.75, hasMissile: true, missileCooldown: 2.0, desc: 'Unstoppable armored tank! Fires cannon missiles (2s cooldown)' }`
   - Settings fields in `createDefaultSettings()`:
     - `aiCopsEnabled: true` (whether AI computer police spawn & chase players)
     - `playerRole: 'runner'` (`'runner'` = Getaway Driver/Runner | `'cop'` = Play as Police Officer!)
     - `copVehicleId: 'cop_heli'` (`'cop_cruiser' | 'cop_swat' | 'cop_heli' | 'cop_tank'`)
     - `lobbyRules.allowPlayerCops: true` (Lobby Manager permission switch: `"Allow players to play as Police (Cruiser / SWAT / Helicopter / Tank)"`)

---

## Exact Gameplay, Physics, Weapon & 3D Rendering Mechanics

### 1. Built-in 2.0s-Cooldown Soft-Tracking Missiles for `cop_heli` & `cop_tank` (`abilities.js` + `physics_ai.js`)
- Every player playing with `playerRole === 'cop'` and `copVehicleId === 'cop_heli'` or `'cop_tank'` has:
  - `player.hasCopMissile = true`, `player.copMissileCooldown = 0` (`0..2.0` seconds, decremented every frame by `dt`).
  - Pressing `Use Item` (`#btn-use-item` / `[SPACE]` / `[E]`):
    - If `player.copMissileCooldown > 0`: plays a subtle click / ignored until `0.0s`!
    - If `player.copMissileCooldown <= 0`:
      - Sets `player.copMissileCooldown = 2.0` (**strict 2.0-second cooldown**!).
      - Calls `abilitySystem.fireCopMissile(player, context)` -> spawns a `type: 'cop_missile'` projectile (`sourceUnit: 'heli' | 'tank'`) AND emits `item_used` with `netEvent: { abilityId: 'cop_missile', sourceUnit, ... }` so all 16 players see and take real hits from the missile!
  - **Soft / Light Homing Behavior (`type: 'cop_missile'` in `abilities.js`)**:
    - Speed: `64 m/s` (`ttl: 3.4s`).
    - Targets: Getaway Runners first (`rp.playerRole !== 'cop'`), or rival players if all-cops free-for-all, or nearby runaway traffic/cops in Solo Cop Mode!
    - **LIGHT / GENTLE TRACKING (Not hard tracking!)**:
      - Maximum horizontal yaw turn rate = **`1.15 rad/s`** (less than 1/5th of the RPG's hard lock — a runner who drifts or swerves sharply dodges it cleanly!).
      - Forward lock cone `dot > 0.52` (`~58°` cone ahead — never whips 180° around corners!).
      - **Break-lock terminal window**: stops homing completely once within `10m` horizontally of the target so last-second jukes evade the blast!
    - **Vertical path**:
      - From **`cop_heli`** (`y ~ 11.5m`): launches from helicopter weapon pylons angled smoothly downward toward ground target height (`y = groundY + 0.9m`), detonating in a fiery `5.8m` shockwave (`36 HP` damage + knockback impulse, never an unfair 1-hit instant kill on a full-HP friend!) when hitting a player, vehicle, building, or ground!
      - From **`cop_tank`** (`y ~ 1.85m`): launches from the cannon muzzle (`z + 3.8m`) with muzzle flash & camera recoil, skimming `1.1m` above ground height and detonating on player/vehicle/wall contact!
  - What about `cop_cruiser` and `cop_swat`?
    - They can pick up `?` boxes normally AND have a built-in `2.0s` cooldown **Siren Ram Boost** when their item slot is empty (or normal `?` items)! (Whereas `cop_heli` flies above street boxes at `y = 11.5m` and `cop_tank` uses its permanent `2.0s` Cannon Missile!).

### 2. Flying Helicopter & Heavy Tank Player Physics (`physics_ai.js`)
- When `lp.playerRole === 'cop'`:
  - **AI Cops are on YOUR team!** AI police cars do NOT chase, ram, or arrest (`bustedProgress = 0`) a player whose `playerRole === 'cop'`! (In Solo Mode when playing AS a Cop with `aiCopsEnabled: true`, spawn 6–8 runaway **Street Racer** outlaw cars marked with red/gold outlaw arrows so Solo Helicopter/Tank players have fun targets to chase & blast with missiles!)
  - **`cop_heli` (Flying Helicopter Physics)**:
    - `lp.flying = true`: hovers smoothly at `targetAlt = Math.max(groundY + 10.5, 11.5)` (`lp.y += (targetAlt - lp.y) * Math.min(1, dt * 6.0)`), **flies cleanly OVER buildings, trees, fences, and rivers** (`resolveBuildingCollision` skipped when `lp.y > building.height - 0.5` or `lp.flying`, and **immune to river drowning**!).
    - Responsive banking & yaw turning + air-brake hover (`input.brake` lets the helicopter hover in place & pivot to aim missiles!).
  - **`cop_tank` (Heavy Police Tank Physics)**:
    - `220 HP`, `2.6x` mass, smashes straight through props, traffic, and fences; immune to banana spin-outs!
  - **PvP Cops vs. Runners Interaction**:
    - Human Cops (`playerRole === 'cop'`) slamming into Getaway Runners deal heavy pursuit ram knockback + arrest pressure; in Party Mode (`server.mjs` & `multiplayer.js`), if there is at least 1 Getaway Runner and 1 Human Cop at match start:
      - Eliminating ALL Getaway Runners ends the match with **`🚔 POLICE TEAM WINS!`** (crowning top Police Officer); or if 1 last Getaway Runner outlasts everyone else (or all Cops wreck out), that Getaway Runner wins! If everyone picks Runner (classic mode) or everyone picks Cop (tank/heli battle royale!), classic last-one-standing rules apply seamlessly!

### 3. 3D Visuals & First-Person POV for All 4 Playable Cop Units (`models.js` + `renderer3d.js`)
- In `models.js` (`emitPlayerVisuals`):
  - When `player.playerRole === 'cop'`, render the player using the rich 3D voxel Police Cruiser (`cop_cruiser`), Armored SWAT (`cop_swat`), Flying Attack Helicopter with spinning blades + twin side missile pods + ground searchlight (`cop_heli`), or Olive/Navy Police Tank with rotating turret + cannon + siren bar (`cop_tank`), PLUS the player's **custom uploaded face cutout wearing the 3D voxel Police Cap & Gold Badge** (`!isPovSelf`)!
  - **Zero-Clipping First-Person POV (`isPovSelf === true`) for all 4 Cop Units** + entries in `POV_CAMERA_RIGS` (`renderer3d.js`):
    1. `cop_cruiser`: Black-and-white police hood + heavy front PIT push-bar + red/blue strobe reflection glow on hood (`z >= 0.78`)!
    2. `cop_swat`: Armored navy hood + heavy steel battering-ram bullbar out front (`z >= 0.85`)!
    3. `cop_heli`: **Awesome Helicopter Cockpit Nose View** (`eyeY: 1.55` above heli origin, looking slightly downward `basePitch: -0.22` over the street below!) with lower cockpit instrument console + twin side-mounted missile pod tips peeking in at bottom-left/bottom-right (`z >= 0.82`) — ZERO rotor or roof clipping lines!
    4. `cop_tank`: **Awesome Tank Commander / Gunner View** (`eyeY: 2.18`, `fwdZ: 0.35`) showing the sloped armored glacis + the **long high-velocity tank cannon barrel** extending straight ahead (`z = 0.85..3.75`) with zero turret-roof clipping!
  - Also render `type: 'cop_missile'` in `emitProjectileVisuals` (`models.js`): sleek white/crimson tactical missile with glowing cyan/amber thruster tail!

### 4. UI Controls on Home Screen, Garage, Party Lobby & HUD (`index.html`, `styles.css`, `main.js`)
- **Home Screen & Party Lobby & Garage**:
  - Team / Role Switcher right in `.stage-switcher-bar` (Home), `.lobby-self-strip` (Party Lobby), and `#garage-modal`:
    - `🏎️ Runner` vs `🚔 Play as Cop` (`data-role="runner" | "cop"`).
    - When `🚔 Play as Cop` is active:
      - Home Screen `◀ / ▶` stepper cycles the **4 Police Units** (`🚔 Interceptor`, `🛡️ SWAT Truck`, `🚁 Attack Heli`, `🪖 Police Tank`) live in the 3D background stage (watching your Helicopter hover or Tank roll right on the Home Screen!!)!
      - Party Lobby shows a compact 4-pill Cop Unit picker (`🚔 Cruiser` · `🛡️ SWAT` · `🚁 Heli` · `🪖 Tank`) and marks Police players with a `🚔 COP` badge in the 16-player roster!
      - Garage shows a dedicated **Police Precinct Fleet (4 Units)** section!
- **Clear AI Police ON/OFF Controls + Clear Photo Face Label**:
  - In `#host-manager-panel` (Party Lobby Manager):
    - Top prominent switch `#perm-ai-cops`: **`🚔 AI Police Chasing Players (ON / OFF)`** — *"Turn OFF so no computer cops chase anyone (pure friends battle or Human Cops vs. Runners!)"*
    - Switch `#perm-allow-cops`: **`Allow Players to Join Police Team (Heli / Tank / SWAT / Cruiser)`**
  - In `#world-modal` (`World & Items`):
    - Prominent switch `#chk-ai-cops`: **`🚔 AI Police Chase Enabled`** (dims `#rng-cop-intensity` & `#rng-start-stars` when OFF with label `"OFF — Peaceful / PvP Only"`!).
  - In `#people-modal` (`#people-grid` cards & `#toggle-custom-cops`):
    - Rename card pill to `🚔 Cop Face: ON` / `Cop Face: OFF` so it unambiguously means *"use this person's face on AI cops"*!
- **In-Game HUD for Helicopter & Tank (`_updateHud` in `main.js`)**:
  - When `lp.playerRole === 'cop'` and `lp.hasCopMissile`:
    - `#btn-use-item` displays **`🎯` + `MISSILE`** (ready, glowing tactical red/cyan!) when `copMissileCooldown <= 0`, and **`⏳` + `1.4s`** (live countdown of the 2.0s reload!) while reloading!
    - `#hp-label` shows `HELI` / `TANK` / `COP` instead of `CAR`!
