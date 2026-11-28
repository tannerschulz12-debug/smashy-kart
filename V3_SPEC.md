# Smashy Kart v3 Shared Spec (Home App, 12-Car Hood POV, Claw HUD Editor, Keybinds & 16-Player Party)

All source files live in:
`/Users/tannerschulz/.gemini/antigravity/brain/2d80f737-5b97-4868-a6a6-72a230629c6e/scratch/smashy-kart`

## Hard Rules for ALL Workers
1. **NEVER** read, edit, or touch any file in `/Users/tannerschulz/Sites/sebwite-ag-lane` or any personal/vault folder.
2. **ZERO `run_command` or MCP calls in author workers**: Use `read_file`, `write_file`, and `edit_file` ONLY inside `/Users/tannerschulz/.gemini/antigravity/brain/2d80f737-5b97-4868-a6a6-72a230629c6e/scratch/smashy-kart/`. (Do not pop up terminal or browser permission prompts!)
3. **Strict File Ownership**:
   - `pov-3d-cam` owns ONLY `public/js/models.js` and `public/js/renderer3d.js`.
   - `home-app-ui` owns ONLY `public/index.html` and `public/styles.css`.
   - `controls-main` owns ONLY `public/js/main.js` and `public/js/audio.js`.
   - `verifier` is read-only + runs verification check on `scratch/smashy-kart` and reports to `@coordinator` (never edits author files).
4. `public/js/config.js` and `public/js/physics_ai.js` are ALREADY updated with:
   - `DEFAULT_KEYBINDS`, `formatKeyCodeLabel(code)`, `HUD_LAYOUT_PRESETS` (`thumbs`, `claw`, `lefty`), `cloneHudLayout(presetName)`, `cloneKeybinds(src)`
   - Expanded `createDefaultSettings()` with:
     `cameraMode`, `povFov` (78), `cameraShakeMult` (1.0), `graphicsQuality` ('high'|'balanced'|'performance'), `speedUnit` ('mph'|'kmh'), `touchStyle` ('split'|'buttons'|'joystick'), `autoAccelerate` (true), `invertSteer` (false), `steerSensitivity` (1.0), `steerDeadzone` (0.05), `showTouchControlsDesktop` (true), `showKeyHints` (true), `showSpeedometer` (true), `showMinimap` (true), `showFps` (false), `showQuickCamBtn` (true), `screenEffects` (true), `haptics` (true), `soundVolume` (0.85), `sfxEngineVol` (0.85), `sfxActionVol` (1.0), `hudLayoutPreset` ('thumbs'|'claw'|'lefty'|'custom'), `hudLayout`, `keybinds`.
   - `physics_ai.js` already reads `input.gas` (when `settings.autoAccelerate === false`), `input.brake` (with snappy handbrake-drift kick when turning at speed!), `settings.invertSteer`, and `settings.steerDeadzone`.

---

## 1. `pov-3d-cam` Spec (`public/js/models.js` & `public/js/renderer3d.js`)

### A. Fix the "Cheesy Roof/Clipping Line" & Perfect Hood POV Across ALL 12 Cars + `photo_car` + `runner`
- **Root cause found**: In `models.js`, cabin roof slabs, glass blocks, convertible chrome header (`part(0, 1.5, 0.6, ...)`), pickup roof lightbar (`part(0, 2.1, 0.95, ...)`), and `photo_car` upper cab (`z = -0.15..+0.92, y = 1.72`) intersected `nearClip` (`z_eye + 0.42`) right near eye height, drawing a cheesy thin horizontal bar across the screen!
- **Required changes in `public/js/models.js`**:
  1. Update `buildVehicleParts(vehicleId = 'sedan', primaryColor = '#ef4444', accentColor = '#fef08a', wheelSpin = 0, opts = {})` (keep 4-arg calls working identically so `tests/verify.mjs` passes!).
  2. When `opts.povSelf === true`:
     - **Remove ALL cabin roofs, cabin glass blocks, windshield top bars, rear spoilers, roof cones (`van`), roof lightbars (`pickup`), rollbars (`monster`), exhaust stacks (`dozer`), and antennas (`mini`)** that sit behind or near the driver's eye or could clip the near plane!
     - Sculpt a **clean, awesome, car-specific Hood / Bonnet + Front Fenders + Cowl/Steering Rim** in front of the camera (`z >= 0.72` to `z <= 2.55`) for EVERY SINGLE ONE of the 12 vehicles:
       - `sedan` (*Getaway Coupe*): Sleek sculpted hood (`z = 0.78..2.02, y = 0.96`), center accent racing spear, raised left/right fender ridges (`x = ±0.88, y = 1.06`), dark dashboard cowl lip at `z = 0.76, y = 1.04`, warm headlight tips!
       - `muscle` (*V8 Muscle Beast*): Brawny long hood + twin racing stripes + gleaming **chrome V8 supercharger blower & red butterfly scoop** (`z = 1.28, y = 1.30`) vibrating subtly right out front!
       - `kart` (*Pipe Frame Kart*): Exposed spinning front kart wheels (`x = ±1.02, z = 1.15`) + sloped nosecone & accent number plate + sporty angled steering wheel top arc at the bottom of view (`z = 0.68, y = 0.96`)!
       - `supercar` (*Apex Hypercar*): Low exotic V-shaped wedge nose + sharp sculpted left/right aero fender crests (`x = ±0.92`)!
       - `monster` (*Crusher 4x4*): Towering lifted 4x4 hood (`y = 1.92, z = 0.85..2.12`) + wide muscular off-road fenders!
       - `convertible` (*Miami Drop-Top*): Clean open-top roadster hood + twin accent spears + dark stitched dash cowl & sporty wheel arc (ZERO floating chrome windshield bar!).
       - `van` (*Party Ice-Cream Van*): Clean cab-forward panoramic view with retro pastel dash shelf & front nose trim (`z = 1.45..2.22, y = 1.48`) — NO glass wall or ice-cream cone clipping!
       - `pickup` (*Baja Trophy Truck*): Muscular raised power-dome hood + wide Baja flared fenders (NO overhead lightbar clipping!).
       - `f1` (*Turbo Open-Wheel*): True Formula 1 cockpit view! Exposed wide front slicks (`x = ±1.16, z = 1.48`), pointed nosecone (`z = 1.0..2.35`), wide multi-element front wing & endplates, and F1 steering yoke rim at base (no center halo pillar blocking view!).
       - `mini` (*Pocket Buggy*): Rounded compact hood + iconic bug-eye round headlight pods peeking up on the left & right front fenders!
       - `dozer` (*Wrecking Rig*): Heavy industrial armored nose (`y = 1.48, z = 0.85..1.85`) + twin yellow hydraulic arms + **massive steel bulldozer plow blade (`z = 2.38`)** right out front!
       - `gold` (*24K Legend Cruiser*): Long gleaming 24K hood + center gold trim + glowing golden crown hood ornament standing proudly at `z = 2.12`!
  3. In `emitPlayerVisuals`:
     - Pass `{ povSelf: isPovSelf, steer: steerVal, time }` to `buildVehicleParts(...)`.
     - For `car_driver`: when `isPovSelf === true`, suppress the roof sunroof collar, roof cutout, AND tilt/place the hood photo decal (`VEHICLE_HOOD_POS`) flat (`pitch = -Math.PI * 0.5 + airPitch`) slightly forward (`z >= 1.35`) OR omit on `f1`/`kart`/`dozer` where nose geometry is narrow, so the hood decal NEVER forms a thin horizontal edge line!
     - For `photo_car`: when `isPovSelf === true`, suppress the upper `cabPos` box (`y = 1.72`) and crest card, keeping ONLY the sculpted lower custom-photo hood body (`z = 0.65..2.05, y = 0.96`) + front fenders/lights so `photo_car` has a clean custom-photo hood with ZERO roof clipping!
     - Keep `emitTwinRpgLauncher(..., isPovSelf)` cleanly mounted on the right front fender (`x = 1.06, z = 1.28`) so its twin warhead tips look badass in POV without blocking center!

### B. Exported Per-Vehicle `POV_CAMERA_RIGS`, Cinematic `'attract'` Showcase Camera & `setGraphicsQuality` in `public/js/renderer3d.js`
1. Export `POV_CAMERA_RIGS` mapping all 12 vehicle IDs + `photo_car` + `runner` to `{ eyeY, fwdZ, basePitch }`:
   - Tune every entry so `eyeZ + nearClip (0.36)` is strictly behind the visible hood (`z >= 0.72`), the hood occupies the bottom ~16–22% of the screen, and ZERO roof or near-plane line ever appears!
2. Add `cameraMode === 'attract'` in `setCamera(focusEntity, cameraMode, shakeAmount, dt, extraOpts)`:
   - Smoothly advance `this.attractOrbitPhase = (this.attractOrbitPhase || 0) + safeDt * 0.42`.
   - Orbit gently around the hero chase-quarter angle (`orbitYaw = angle + Math.PI + Math.sin(this.attractOrbitPhase) * 0.68`, `dist = 13.2 * entityScale`, `height = 4.9 * entityScale`, looking at `(fx + Math.sin(angle) * 2.2, fy + 1.65 * entityScale, fz + Math.cos(angle) * 2.2)`, `fov = 45°`).
   - Make sure `this.povFocusId = null` in `'attract'` so your custom roof face cutout IS proudly visible on the Home Screen!
3. Add `setGraphicsQuality(quality = 'high')` method on `Renderer3D`:
   - `'high'`: shadows enabled, max debris `650`, max smoke `420`
   - `'balanced'`: shadows enabled, max debris `340`, max smoke `220`
   - `'performance'`: skip shadow FBO pass (bind clean white/neutral shadow fallback or `uShadowsEnabled = 0` uniform if supported, or light shadow update every 2nd frame + max debris `160`, max smoke `90`) so older phones/laptops lock 60 FPS!

---

## 2. `home-app-ui` Spec (`public/index.html` & `public/styles.css`)

### A. `<head>` Native App Icons & Meta Tags (`public/index.html`)
- Include:
  ```html
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="Smashy Kart" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <link rel="icon" type="image/png" sizes="192x192" href="./icon-192.png" />
  <link rel="icon" type="image/svg+xml" href="./icon.svg" />
  <link rel="apple-touch-icon" sizes="180x180" href="./icon-180.png" />
  <link rel="manifest" href="./manifest.webmanifest" />
  ```

### B. Redesigned Mobile-First Arcade Home Screen (`#home-screen`)
- **NO giant dark box blocking the middle of the screen!** `.screen-overlay` uses `justify-content: space-between` with a transparent center stage (`25%..64%` vertical height completely clear!) so the close-up 3D getaway chase & police sirens shine right in the center!
- **Top Section (`.home-top-cluster`)**:
  - `.home-topbar`:
    - Left: `.racer-profile-pill` containing `#home-avatar-img`, `#btn-quick-photo` (small camera icon badge), `#home-player-name` (`maxlength="16"`), and `#solo-best-bar` (`🏆 <strong id="best-time-label">0.0s</strong> · <strong id="best-score-label">0</strong> PTS`).
    - Right: `.home-top-actions` containing:
      - `#btn-install-app` (`📲 Get App` arcade pill — hidden automatically when already installed on Home Screen!)
      - `#btn-home-settings` (`data-open-modal="settings-modal"`, 44x44px tactile gear button with crisp SVG icon).
  - `.arcade-marquee`:
    - Custom 3D extruded tilted arcade titleplate (`<h1>` containing `SMASHY KART` — note `tests/verify.mjs` checks `homeRes.body.includes('SMASHY KART')`!) flanked by animated red/blue police siren light caps + bold gold championship badge (`5-STAR CHASE · UP TO 16 PLAYERS`). No eyebrow kicker text above `<h1>`, no wordy paragraph!
- **Bottom Section (`.home-bottom-dock`)**:
  - `.stage-switcher-bar` (compact sleek glass/asphalt bar floating right above the Play buttons so players swap cars/modes/maps live in 3D!):
    - Car stepper: `#btn-prev-car` (`◀`), `#home-car-name` (`Getaway Coupe`), `#btn-next-car` (`▶`)
    - `#home-mode-pills` (`data-mode="car_driver"`, `data-mode="photo_car"`, `data-mode="runner"`)
    - `#btn-cycle-biome` (`🏙️ City` — cycles `city` -> `desert` -> `snow`)
    - Keep `<span id="home-loadout-summary" class="sr-only"></span>` (visually hidden or subtle) so existing summary updates never null-ref!
  - `.primary-cta-row`:
    - `#btn-open-lobby` (Gold 3D tactile arcade button with crisp authored SVG party icon: `PLAY WITH FRIENDS` · `16-Player Party Lobby · QR Invite`)
    - `#btn-play-solo` (Crimson 3D tactile arcade button with crisp authored SVG flame/flag icon: `PLAY SOLO NOW` · `Instant 5-Star Police Chase`)
  - `.workshop-dock` (4 crisp authored-SVG dock buttons, consistent 2px stroke):
    - `data-open-modal="people-modal"` (`Faces & Cops`)
    - `data-open-modal="garage-modal"` (`12 Cars & Tune`)
    - `data-open-modal="world-modal"` (`World & ? Items`)
    - `data-open-modal="sound-modal"` (`Custom Voices`)

### C. Native "Add to Home Screen" App Modal (`#install-modal`)
- Backdrop `#install-modal.modal-backdrop.hidden` with `data-close-modal="install-modal"`:
  - Shows `./icon-180.png` (`width="72" height="72"`, rounded squircle shadow) + `"Install Smashy Kart App"`
  - `#btn-trigger-native-install` (Gold button, shown when Chrome/Android `beforeinstallprompt` is available: `"Install App Now"`)
  - Clean 2-step iPhone / Android visual guide cards with crisp SVG icons:
    1. **On iPhone (Safari)**: Tap the **Share** button at the bottom of Safari, then tap **Add to Home Screen**.
    2. **Full-Screen Arcade App**: Opens instantly from your Home Screen with its own custom icon and zero browser bars!

### D. Fully Customizable In-Game HUD + Visible Brake + Keycap Badges + HUD Layout Editor (`#hud` & `#hud-layout-editor`)
- **NEVER re-add `#hud-item-slot`** (`tests/verify.mjs` asserts `id="hud-item-slot"` is `false`!).
- Inside `#hud`:
  - Add circular radar canvas `<canvas id="hud-minimap" class="hud-minimap" width="112" height="112"></canvas>` under `.hud-left-stack` (toggled by `showMinimap`), and `<div id="hud-fps" class="hud-fps hidden">60 FPS</div>` under `.hud-right-stack`.
  - Keep `#btn-quick-cam` (with optional `#keycap-cam` badge `[C]`), `#btn-ingame-settings`, `#btn-pause`.
- Inside `#touch-controls`:
  - Keep `#split-steer` (`#steer-left-zone`, `#steer-right-zone`) for invisible split-screen tap steering when `touchStyle === 'split'`.
  - Make **7 individually positionable HUD widgets** (each with `class="hud-widget"` and `data-hud-widget="<id>"` positioned by `left: X%; top: Y%; transform: translate(-50%, -50%) scale(S); opacity: O`):
    1. `data-hud-widget="steerLeft"` (`#hud-widget-steerLeft`): `<button id="btn-steer-left" class="hud-pad-btn" type="button">◀ <kbd id="keycap-steerLeft" class="hud-keycap">A</kbd></button>`
    2. `data-hud-widget="steerRight"` (`#hud-widget-steerRight`): `<button id="btn-steer-right" class="hud-pad-btn" type="button">▶ <kbd id="keycap-steerRight" class="hud-keycap">D</kbd></button>`
    3. `data-hud-widget="joystick"` (`#joystick-zone`, `class="hud-widget joystick-zone hidden"`): contains `#joystick-base` & `#joystick-stick`.
    4. `data-hud-widget="brake"` (`#hud-widget-brake`): **Unmistakable, high-contrast Crimson/Amber Tactile Brake/Drift Pedal** `<button id="btn-brake" class="brake-pedal-btn" type="button"><span class="pedal-title">BRAKE</span><span class="pedal-sub">DRIFT</span><kbd id="keycap-brake" class="hud-keycap">S</kbd></button>`!
    5. `data-hud-widget="gas"` (`#hud-widget-gas`, hidden when `autoAccelerate === true`): `<button id="btn-gas" class="gas-pedal-btn" type="button"><span class="pedal-title">GAS</span><kbd id="keycap-gas" class="hud-keycap">W</kbd></button>`
    6. `data-hud-widget="useItem"` (`#hud-widget-useItem`): contains `<button id="btn-use-item" class="use-item-btn disabled" type="button"><span id="btn-use-item-icon" class="use-icon">?</span><span id="btn-use-item-label" class="use-label">ITEM</span><span id="btn-use-item-charges" class="use-charges hidden">x3</span><kbd id="keycap-useItem" class="hud-keycap">SPACE</kbd></button>`
    7. `data-hud-widget="horn"` (`#hud-widget-horn`): `<button id="btn-horn" class="horn-btn" type="button">📢<kbd id="keycap-horn" class="hud-keycap">H</kbd></button>`
- **Full-Screen HUD Button Layout Editor Overlay (`#hud-layout-editor`, sibling inside `<body>` above `#hud`, `.hidden` by default)**:
  - Subtle translucent grid backdrop (`pointer-events: auto`) + compact docked control bar (`#hud-editor-toolbar`, movable top/center so top corners stay free for Claw buttons!):
    - Preset pills (`#hud-preset-btns`):
      - `data-hpreset="thumbs"` (`👍 Classic Thumbs`)
      - `data-hpreset="claw"` (`🦅 4-Finger Claw` — puts BRAKE at top-left index finger & ITEM at top-right index finger!)
      - `data-hpreset="lefty"` (`🫲 Left-Handed`)
    - Selected widget inspector (`#hud-editor-selected-name`, `#rng-widget-scale` `0.7..1.6`, `#val-widget-scale`, `#rng-widget-opacity` `0.4..1.0`, `#val-widget-opacity`)
    - Action buttons: `#btn-hud-editor-reset` (`↺ Reset`), `#btn-hud-editor-done` (`✓ Save Layout`)
  - When `body.editing-hud-layout` is active, `#hud` & `#touch-controls` stay visible above the grid (`z-index: 45`), every `.hud-widget` shows a dashed gold grab ring + drag handle, and `#hud-editor-toolbar` sits at `z-index: 46`!

### E. 4-Tab Pro Video-Game `#settings-modal` & 16-Player Lobby Polish
- Upgrade `#settings-modal` (`modal-panel wide`) with 4 clean tab buttons (`#settings-tabs` -> `data-stab="camera" | "controls" | "keyboard" | "audio"`):
  1. **`data-stab-pane="camera"` (`Camera & Display`)**:
     - `#settings-cam-btns` (`data-cam="smashy" | "chase" | "pov"`)
     - `#rng-pov-fov` (`62..96`) + `#val-pov-fov`
     - `#rng-cam-shake` (`0..1.5`, step `0.1`) + `#val-cam-shake`
     - `#settings-gfx-btns` (`data-gfx="high" | "balanced" | "performance"`)
     - `#settings-unit-btns` (`data-unit="mph" | "kmh"`)
     - Toggles: `#chk-show-desktop-btns` ("Show On-Screen Buttons on Mac/PC"), `#chk-show-keyhints` ("Show Keyboard Keycaps on Buttons ([S], [SPACE])"), `#chk-show-minimap` ("Show Live GPS Radar Minimap"), `#chk-show-speedo` ("Show Speedometer & Drift Gauge"), `#chk-show-fps` ("Show FPS Counter"), `#chk-show-quickcam` ("Show Quick Camera Button (🎥)"), `#chk-screen-fx` ("Speed Streaks & Siren Edge Flash").
  2. **`data-stab-pane="controls"` (`Controls & Claw HUD`)**:
     - Big prominent button: `#btn-open-hud-editor` (`✋ Customize Screen Button Positions (Claw / Free Drag)`)
     - Quick HUD Layout Preset row (`#settings-hpreset-btns`: `data-hpreset="thumbs" | "claw" | "lefty"`)
     - `#settings-touch-btns` (`data-touch="split"` `"Buttons + Split Screen"`, `data-touch="buttons"` `"Buttons Only"`, `data-touch="joystick"` `"Thumb Joystick + Buttons"`)
     - Toggles: `#chk-auto-accel` ("Auto-Accelerate (uncheck for Manual Gas [W] / Pedal)"), `#chk-invert-steer` ("Invert Left/Right Steering"), `#chk-haptics` ("Phone Vibration Feedback")
     - Sliders: `#rng-steer-sens` (`0.7..1.4`) + `#val-steer-sens`, `#rng-steer-deadzone` (`0..0.22`, step `0.02`) + `#val-steer-deadzone`.
  3. **`data-stab-pane="keyboard"` (`Mac / PC Keybinds`)**:
     - Interactive container `#keybinds-list` (rendered dynamically by `main.js` for all 8 actions: `steerLeft`, `steerRight`, `brake`, `gas`, `useItem`, `horn`, `cycleCamera`, `pause`, showing Primary & Secondary key slots — click any slot to rebind!)
     - `#btn-reset-keybinds` (`↺ Reset Default Keyboard Keys`)
  4. **`data-stab-pane="audio"` (`Audio & Voice`)**:
     - `#rng-settings-vol` + `#val-settings-vol` (Master Volume)
     - `#rng-engine-vol` + `#val-engine-vol` (Engine & Tire Drift Volume)
     - `#rng-action-vol` + `#val-action-vol` (Sirens, Explosions & Items Volume)
     - `#btn-settings-voice-studio` (`🎙️ Record Custom Screams & Horns`)
     - `#btn-reset-personal-settings` (`↺ Reset All Settings`)
- In `#lobby-modal`: make sure `#lobby-roster` uses a responsive multi-column grid (`grid-template-columns: repeat(auto-fill, minmax(185px, 1fr)); max-height: 240px; overflow-y: auto`) so up to **16 players** (`16/16`) display crisply without pushing `START PARTY CHASE!` off-screen!

---

## 3. `controls-main` Spec (`public/js/main.js` & `public/js/audio.js`)

1. **`public/js/audio.js`**:
   - Add `setChannelVolumes({ engine = 0.85, action = 1.0 })` on `SoundManager` so engine/skid loops scale by `engine` and `playEvent(...)` / sirens scale by `action` (while `setVolume(master)` continues to work identically!).
2. **`public/js/main.js`**:
   - Import `DEFAULT_KEYBINDS`, `formatKeyCodeLabel`, `HUD_LAYOUT_PRESETS`, `cloneHudLayout`, `cloneKeybinds` from `./config.js`.
   - Safely merge saved `hudLayout` and `keybinds` inside `loadSavedSettings()` so upgrading from v1/v2 `localStorage` never loses or nulls any key or widget!
   - **PWA Service Worker & Install App Flow**:
     - Register `./sw.js` cleanly on load (`if ('serviceWorker' in navigator)`).
     - Capture `window.addEventListener('beforeinstallprompt', ...)` into `this.deferredInstallPrompt`.
     - Detect standalone mode (`window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true`) and hide `#btn-install-app` when already installed!
     - Clicking `#btn-install-app`: if `this.deferredInstallPrompt` exists, trigger native prompt; otherwise open `#install-modal`. Wire `#btn-trigger-native-install`.
   - **Home Screen Live 3D Showcase Controls**:
     - In `_renderFrame`, pass `this.mode === 'attract' ? 'attract' : this.settings.cameraMode` to `this.renderer.setCamera(...)`, and scale cameraShake by `this.settings.cameraShakeMult ?? 1.0`.
     - In `_respawnAttractHero()`, set `this.sim.wantedStars = 2` and spawn 2 active police cruisers so sirens flash in the Home Screen 3D showcase!
     - Wire `#btn-prev-car` & `#btn-next-car` (cycles `VEHICLES`, updates `this.settings.vehicleId`, updates `#home-car-name`, and live-updates `this.sim.localPlayer.vehicleId` + colors in `'attract'` without resetting the whole street!).
     - Wire `#btn-cycle-biome` (cycles `city` -> `desert` -> `snow`, updates `#btn-cycle-biome` label, resets attract world immediately!).
   - **Full Draggable HUD Layout Editor (`#hud-layout-editor`) & Claw Preset**:
     - `_applyHudLayout()`: positions all 7 `[data-hud-widget]` elements using `settings.hudLayout[id]` (`left: clamp(xPct, 6, 94)%`, `top: clamp(yPct, 8, 93)%`, `transform: translate(-50%, -50%) scale(scale)`, `opacity`).
     - Handles visibility per `touchStyle`, `autoAccelerate` (`#hud-widget-gas` shown when `!autoAccelerate` or during Layout Editor!), and `showTouchControlsDesktop` (detect coarse pointer via `matchMedia('(pointer: coarse)')`; when desktop & `showTouchControlsDesktop === false`, hide touch buttons unless Layout Editor is open!).
     - Entering HUD Layout Editor (`#btn-open-hud-editor`): closes `#settings-modal`, ensures `#hud` + `#touch-controls` + `#hud-layout-editor` are shown (even if opened from Home Screen — previewing over the live 3D background and returning cleanly to Home Screen or active match when `#btn-hud-editor-done` is clicked!), lets user tap/drag ANY `.hud-widget` with pointer capture to move `(xPct, yPct)` smoothly, select it to adjust `#rng-widget-scale` & `#rng-widget-opacity`, or tap `thumbs` / `claw` / `lefty` / `reset`!
   - **Custom Mac/PC Keyboard Keybinds & Live HUD Keycaps**:
     - Helper `_isActionPressed(actionName)` checks if any bound `code` in `this.settings.keybinds[actionName]` is in `this.keys`.
     - In `keydown`:
       - If `this.listeningKeybind` (`{ action, slotIndex }`) is active: capture `e.code` (if `Escape`, cancel listening; otherwise assign `this.settings.keybinds[action][slotIndex] = e.code`, remove duplicate from same action, save, re-render `#keybinds-list` and `#keycap-*` badges!), `e.preventDefault()`, `return`.
       - Match discrete actions (`useItem`, `horn`, `cycleCamera`, `pause`) against `this.settings.keybinds`! Pressing `pause` (`Escape`) during gameplay toggles `#settings-modal` so MacBook players get a real video-game Esc menu (with a `Quit to Title` button or existing `✕`)!
     - Update `#keycap-*` badges (`#keycap-brake`, `#keycap-useItem`, `#keycap-horn`, `#keycap-steerLeft`, `#keycap-steerRight`, `#keycap-gas`, `#keycap-cam`) with `formatKeyCodeLabel(keybinds[action][0])` and toggle `.hidden` based on `settings.showKeyHints`!
   - **Live Circular Minimap (`_renderMinimap()`) & FPS Counter & KM/H Support**:
     - Draw player center arrow, nearby roads/water tint, red/blue pulsing cop dots, pink Sugar box dots, and yellow/colored friend dots onto `#hud-minimap` when `settings.showMinimap !== false`!
     - Support `speedUnit === 'kmh'` (`* 3.54` vs `* 2.2` MPH) on `#hud-speedo` and `#hud-speedo-unit`!
     - Never let Host `_applyHostSettings` overwrite personal settings (`cameraMode`, `povFov`, `cameraShakeMult`, `graphicsQuality`, `speedUnit`, `touchStyle`, `autoAccelerate`, `invertSteer`, `steerSensitivity`, `steerDeadzone`, `hudLayout`, `hudLayoutPreset`, `keybinds`, `show*`, `soundVolume`, `sfx*`).
