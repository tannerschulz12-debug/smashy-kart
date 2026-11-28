// 3D Blocky Voxel Blueprints & Entity Visual Emitters for Smashy Kart
// Supports all 12 vehicles, all 3 characterModes (car_driver, photo_car, runner),
// 6 police unit types (cruiser, suv, swat, heli, army, tank), traffic, props, ? item boxes, and Mario Kart projectiles.

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function hslToHex(h, s, l) {
  const hh = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + hh * 12) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * clamp(color, 0, 1))
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Rotates local offset (ox, oy, oz) by R_y(yaw) * R_x(pitch) * R_z(roll)
// Matches right-handed convention: forward (+Z) -> (sin(yaw), 0, cos(yaw))
export function transformLocalOffset(ox, oy, oz, yaw, pitch = 0, roll = 0) {
  // 1. Roll around Z
  let x1 = ox;
  let y1 = oy;
  let z1 = oz;
  if (roll !== 0) {
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    x1 = ox * cr - oy * sr;
    y1 = ox * sr + oy * cr;
  }
  // 2. Pitch around X
  let x2 = x1;
  let y2 = y1;
  let z2 = z1;
  if (pitch !== 0) {
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    y2 = y1 * cp - z1 * sp;
    z2 = y1 * sp + z1 * cp;
  }
  // 3. Yaw around Y
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  return {
    x: x2 * cy + z2 * sy,
    y: y2,
    z: -x2 * sy + z2 * cy,
  };
}

function part(ox, oy, oz, sx, sy, sz, color, emissive = 0, rx = 0, ry = 0, rz = 0) {
  return { ox, oy, oz, sx, sy, sz, color, emissive, rx, ry, rz };
}

function emitPartList(batcher, parts, rootX, rootY, rootZ, yaw, pitch, roll, scale = 1, colorOverride = null, extraEmissive = 0) {
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const w = transformLocalOffset(p.ox * scale, p.oy * scale, p.oz * scale, yaw, pitch, roll);
    const col = colorOverride && p.emissive < 0.5 ? colorOverride : p.color;
    const em = clamp((p.emissive || 0) + extraEmissive, 0, 1);
    batcher.addBox(
      rootX + w.x,
      rootY + w.y,
      rootZ + w.z,
      p.sx * scale,
      p.sy * scale,
      p.sz * scale,
      col,
      yaw + (p.ry || 0),
      pitch + (p.rx || 0),
      roll + (p.rz || 0),
      em
    );
  }
}

function addWheels(parts, wheelX, frontZ, rearZ, tireRadius, tireWidth, wheelSpin, rimColor = '#e2e8f0') {
  const s = tireRadius * 2;
  const hubS = s * 0.52;
  const positions = [
    [-wheelX, tireRadius, frontZ],
    [wheelX, tireRadius, frontZ],
    [-wheelX, tireRadius, rearZ],
    [wheelX, tireRadius, rearZ],
  ];
  for (let i = 0; i < positions.length; i++) {
    const [wx, wy, wz] = positions[i];
    parts.push(part(wx, wy, wz, tireWidth, s, s, '#18181b', 0, wheelSpin, 0, 0));
    const hubOffset = wx < 0 ? -tireWidth * 0.52 : tireWidth * 0.52;
    parts.push(part(wx + hubOffset, wy, wz, 0.08, hubS, hubS * 0.45, rimColor, 0.05, wheelSpin, 0, 0));
  }
}

function addLightsAndBumpers(parts, halfW, bodyY, halfL, bumperColor = '#cbd5e1') {
  // Front & rear bumpers
  parts.push(part(0, bodyY - 0.18, halfL + 0.08, halfW * 1.92, 0.28, 0.24, bumperColor, 0));
  parts.push(part(0, bodyY - 0.18, -halfL - 0.08, halfW * 1.92, 0.28, 0.24, bumperColor, 0));
  // Headlights (+Z)
  parts.push(part(-halfW * 0.66, bodyY + 0.08, halfL + 0.06, 0.42, 0.26, 0.14, '#fef9c3', 0.9));
  parts.push(part(halfW * 0.66, bodyY + 0.08, halfL + 0.06, 0.42, 0.26, 0.14, '#fef9c3', 0.9));
  // Taillights (-Z)
  parts.push(part(-halfW * 0.68, bodyY + 0.08, -halfL - 0.06, 0.44, 0.24, 0.14, '#ef4444', 0.78));
  parts.push(part(halfW * 0.68, bodyY + 0.08, -halfL - 0.06, 0.44, 0.24, 0.14, '#ef4444', 0.78));
}

const VEHICLE_ROOF_Y = {
  sedan: 1.95,
  muscle: 1.88,
  kart: 1.25,
  supercar: 1.68,
  monster: 2.68,
  convertible: 1.42,
  van: 2.55,
  pickup: 2.15,
  f1: 1.28,
  mini: 1.85,
  dozer: 2.62,
  gold: 1.92,
  cop_cruiser: 1.85,
  cop_swat: 2.42,
  cop_heli: 2.22,
  cop_tank: 2.35,
};

// Flat horizontal hood decal coordinates (z >= 1.38; omitted on narrow f1/kart/dozer noses)
export const VEHICLE_HOOD_POS = {
  sedan: { y: 1.095, z: 1.46, size: 0.94 },
  muscle: { y: 1.165, z: 1.78, size: 0.64 },
  supercar: { y: 1.035, z: 1.52, size: 0.88 },
  monster: { y: 2.035, z: 1.52, size: 1.02 },
  convertible: { y: 1.045, z: 1.48, size: 0.94 },
  van: { y: 1.69, povY: 1.535, z: 1.88, size: 0.64 },
  pickup: { y: 1.295, povY: 1.395, z: 1.58, size: 0.76 },
  mini: { y: 1.105, z: 1.38, size: 0.48 },
  gold: { y: 1.165, z: 1.58, size: 0.88 },
};

const POV_FENDER_RPG_MOUNT = {
  sedan: { y: 1.26, z: 1.48 },
  muscle: { y: 1.30, z: 1.52 },
  kart: { y: 0.92, z: 1.46 },
  supercar: { y: 1.24, z: 1.48 },
  monster: { y: 2.16, z: 1.54 },
  convertible: { y: 1.22, z: 1.48 },
  van: { y: 1.66, z: 1.86 },
  pickup: { y: 1.50, z: 1.52 },
  f1: { y: 0.96, z: 1.56 },
  mini: { y: 1.26, z: 1.44 },
  dozer: { y: 1.64, z: 1.52 },
  gold: { y: 1.30, z: 1.54 },
  cop_cruiser: { y: 1.28, z: 1.50 },
  cop_swat: { y: 1.78, z: 1.68 },
  cop_heli: { y: 0.95, z: 1.48 },
  cop_tank: { y: 1.52, z: 1.68 },
  photo_car: { y: 1.28, z: 1.48 },
};

function normalizeCopVehicleId(copVehicleId) {
  switch (copVehicleId) {
    case 'cop_cruiser':
    case 'cruiser':
      return 'cop_cruiser';
    case 'cop_swat':
    case 'swat':
      return 'cop_swat';
    case 'cop_tank':
    case 'tank':
      return 'cop_tank';
    case 'cop_heli':
    case 'heli':
    default:
      return 'cop_heli';
  }
}

function isCopVehicleKey(vehicleId) {
  return (
    vehicleId === 'cop_cruiser' ||
    vehicleId === 'cop_swat' ||
    vehicleId === 'cop_heli' ||
    vehicleId === 'cop_tank'
  );
}

function addPovFrontWheels(parts, wheelX, frontZ, tireRadius, tireWidth, wheelSpin, rimColor = '#e2e8f0', steerYaw = 0) {
  const s = tireRadius * 2;
  const hubS = s * 0.52;
  // Guarantee rotated cube corners (tireRadius * sqrt(2)) stay strictly >= 0.73 in front of nearClip
  const safeZ = Math.max(frontZ, 0.73 + tireRadius * 1.42);
  for (const wx of [-wheelX, wheelX]) {
    parts.push(part(wx, tireRadius, safeZ, tireWidth, s, s, '#18181b', 0, wheelSpin, steerYaw, 0));
    const hubOffset = wx < 0 ? -tireWidth * 0.52 : tireWidth * 0.52;
    parts.push(part(wx + hubOffset, tireRadius, safeZ, 0.08, hubS, hubS * 0.45, rimColor, 0.05, wheelSpin, steerYaw, 0));
  }
}

function addPovSteeringRim(parts, hubY, hubZ, radius, steerVal = 0, rimCol = '#111827', accentCol = '#ef4444', isYoke = false) {
  const safeZ = Math.max(0.78, hubZ);
  const turn = clamp(-steerVal * 0.52, -0.55, 0.55);
  const ct = Math.cos(turn);
  const st = Math.sin(turn);
  const place = (dx, dy, sx, sy, col, em = 0, localRz = 0) => {
    const px = dx * ct - dy * st;
    const py = hubY + dx * st + dy * ct;
    parts.push(part(px, py, safeZ, sx, sy, 0.07, col, em, 0, 0, localRz + turn));
  };

  // Center steering boss
  parts.push(part(0, hubY, safeZ, 0.14, 0.14, 0.09, '#27272a'));

  if (isYoke) {
    // Formula 1 rectangular carbon yoke + glowing green/yellow/red RPM shift LEDs!
    place(0, radius * 0.72, radius * 1.85, 0.06, rimCol, 0);
    place(-0.08, radius * 0.74, 0.045, 0.035, '#22c55e', 0.95);
    place(0, radius * 0.74, 0.045, 0.035, '#facc15', 0.95);
    place(0.08, radius * 0.74, 0.045, 0.035, '#ef4444', 0.95);
    place(-radius * 0.92, radius * 0.28, 0.07, radius * 0.95, accentCol, 0.15);
    place(radius * 0.92, radius * 0.28, 0.07, radius * 0.95, accentCol, 0.15);
    place(-radius * 0.45, 0.02, radius * 0.85, 0.06, '#334155', 0);
    place(radius * 0.45, 0.02, radius * 0.85, 0.06, '#334155', 0);
  } else {
    // Sporty arched steering wheel top rim + 12-o'clock racing marker + spokes
    place(0, radius, radius * 1.02, 0.065, rimCol, 0);
    place(0, radius + 0.005, 0.06, 0.072, accentCol, 0.35);
    place(-radius * 0.76, radius * 0.64, radius * 0.72, 0.06, rimCol, 0, 0.66);
    place(radius * 0.76, radius * 0.64, radius * 0.72, 0.06, rimCol, 0, -0.66);
    place(-radius * 0.46, 0.06, radius * 0.88, 0.055, '#334155', 0, 0.14);
    place(radius * 0.46, 0.06, radius * 0.88, 0.055, '#334155', 0, -0.14);
  }
}

function buildPovVehicleParts(vehicleId, pCol, aCol, wheelSpin, opts = {}) {
  const parts = [];
  const darkMetal = '#27272a';
  const chrome = '#e2e8f0';
  const steerVal = Number(opts.steer) || 0;
  const steerYaw = clamp(-steerVal * 0.32, -0.34, 0.34);
  const time = Number(opts.time) || 0;

  switch (vehicleId) {
    case 'muscle': {
      addPovFrontWheels(parts, 1.08, 1.38, 0.44, 0.42, wheelSpin, chrome, steerYaw * 0.45);
      // Cockpit bulkhead & dash cowl (strictly z >= 0.73)
      parts.push(part(0, 0.64, 0.86, 2.08, 0.92, 0.24, '#111827'));
      parts.push(part(0, 1.16, 0.80, 2.02, 0.09, 0.14, darkMetal));
      // Brawny long hood + twin racing stripes + sculpted outer fenders
      parts.push(part(0, 0.86, 1.46, 2.14, 0.52, 1.40, pCol));
      parts.push(part(-0.36, 1.135, 1.48, 0.26, 0.03, 1.34, aCol));
      parts.push(part(0.36, 1.135, 1.48, 0.26, 0.03, 1.34, aCol));
      parts.push(part(-0.95, 1.04, 1.46, 0.28, 0.26, 1.34, pCol));
      parts.push(part(0.95, 1.04, 1.46, 0.28, 0.26, 1.34, pCol));
      // Gleaming chrome V8 supercharger blower & red butterfly scoop vibrating with V8 idle!
      const v8VibX = Math.sin(time * 58) * 0.012;
      const v8VibRoll = Math.sin(time * 64) * 0.024;
      parts.push(part(v8VibX, 1.24, 1.16, 0.58, 0.28, 0.56, chrome, 0.1, 0, 0, v8VibRoll));
      parts.push(part(v8VibX, 1.38, 1.36, 0.50, 0.14, 0.16, '#dc2626', 0.25, 0, 0, v8VibRoll));
      parts.push(part(v8VibX, 1.25, 1.45, 0.34, 0.18, 0.06, '#94a3b8', 0.05, 0, 0, v8VibRoll));
      // Front bumper & warm headlights
      parts.push(part(0, 0.56, 2.20, 2.10, 0.28, 0.20, darkMetal));
      parts.push(part(-0.78, 1.04, 2.15, 0.40, 0.18, 0.14, '#fef9c3', 0.92));
      parts.push(part(0.78, 1.04, 2.15, 0.40, 0.18, 0.14, '#fef9c3', 0.92));
      break;
    }

    case 'kart': {
      // Exposed spinning & turning front kart slicks!
      addPovFrontWheels(parts, 1.02, 1.28, 0.38, 0.44, wheelSpin, aCol, steerYaw);
      parts.push(part(0, 0.38, 1.28, 1.88, 0.10, 0.12, darkMetal));
      parts.push(part(0, 0.44, 0.92, 1.22, 0.62, 0.32, '#111827'));
      parts.push(part(-0.56, 0.46, 1.28, 0.14, 0.14, 0.96, pCol));
      parts.push(part(0.56, 0.46, 1.28, 0.14, 0.14, 0.96, pCol));
      // Sloped kart nosecone & accent number plate + front lights
      parts.push(part(0, 0.56, 1.38, 1.12, 0.32, 0.92, pCol, 0, 0.08));
      parts.push(part(0, 0.73, 1.40, 0.72, 0.05, 0.58, aCol, 0, 0.08));
      parts.push(part(-0.44, 0.56, 1.82, 0.26, 0.18, 0.12, '#fef9c3', 0.92));
      parts.push(part(0.44, 0.56, 1.82, 0.26, 0.18, 0.12, '#fef9c3', 0.92));
      // Sporty turning steering wheel top arc at bottom of view (z >= 0.745)
      addPovSteeringRim(parts, 0.82, 0.78, 0.23, steerVal, '#111827', aCol, false);
      break;
    }

    case 'supercar': {
      addPovFrontWheels(parts, 1.08, 1.32, 0.40, 0.44, wheelSpin, aCol, steerYaw * 0.45);
      // Alcantara cockpit dash cowl & 12-o'clock marker
      parts.push(part(0, 0.58, 0.86, 2.02, 0.84, 0.24, '#111827'));
      parts.push(part(0, 1.02, 0.80, 1.94, 0.08, 0.12, darkMetal));
      parts.push(part(0, 1.065, 0.80, 0.16, 0.03, 0.10, aCol));
      // Low exotic V-shaped wedge nose + sharp sculpted left/right aero fender crests
      parts.push(part(0, 0.85, 1.44, 1.86, 0.32, 1.36, pCol));
      parts.push(part(-0.34, 1.02, 1.48, 0.10, 0.03, 1.16, aCol, 0, 0, -0.14));
      parts.push(part(0.34, 1.02, 1.48, 0.10, 0.03, 1.16, aCol, 0, 0, 0.14));
      parts.push(part(-0.92, 0.96, 1.42, 0.36, 0.34, 1.30, pCol));
      parts.push(part(0.92, 0.96, 1.42, 0.36, 0.34, 1.30, pCol));
      // Razor blade LED headlights & front aero splitter
      parts.push(part(-0.90, 1.06, 2.05, 0.32, 0.10, 0.16, '#fef9c3', 0.95));
      parts.push(part(0.90, 1.06, 2.05, 0.32, 0.10, 0.16, '#fef9c3', 0.95));
      parts.push(part(0, 0.48, 2.16, 2.16, 0.14, 0.22, aCol));
      break;
    }

    case 'monster': {
      addPovFrontWheels(parts, 1.38, 1.70, 0.68, 0.64, wheelSpin, aCol, steerYaw * 0.55);
      parts.push(part(0, 0.72, 1.70, 2.35, 0.24, 0.24, darkMetal));
      // Towering lifted 4x4 hood & wide muscular off-road fenders (zero cab/rollbar clipping!)
      parts.push(part(0, 1.32, 0.94, 2.08, 1.36, 0.32, '#18181b'));
      parts.push(part(0, 2.02, 0.86, 2.02, 0.10, 0.14, darkMetal));
      parts.push(part(0, 1.68, 1.48, 2.14, 0.64, 1.30, pCol));
      parts.push(part(0, 2.01, 1.50, 0.54, 0.04, 1.22, aCol));
      parts.push(part(-1.12, 1.88, 1.48, 0.36, 0.36, 1.26, pCol));
      parts.push(part(1.12, 1.88, 1.48, 0.36, 0.36, 1.26, pCol));
      parts.push(part(-1.20, 1.72, 1.48, 0.26, 0.14, 1.24, aCol));
      parts.push(part(1.20, 1.72, 1.48, 0.26, 0.14, 1.24, aCol));
      parts.push(part(0, 1.52, 2.18, 2.10, 0.28, 0.20, chrome));
      parts.push(part(-0.82, 1.86, 2.14, 0.42, 0.22, 0.14, '#fef9c3', 0.92));
      parts.push(part(0.82, 1.86, 2.14, 0.42, 0.22, 0.14, '#fef9c3', 0.92));
      break;
    }

    case 'convertible': {
      addPovFrontWheels(parts, 1.02, 1.30, 0.40, 0.38, wheelSpin, chrome, steerYaw * 0.45);
      // Clean open-top roadster stitched dash cowl & sporty wheel arc (ZERO floating chrome header!)
      parts.push(part(0, 0.62, 0.86, 1.98, 0.88, 0.24, '#1f2937'));
      parts.push(part(0, 1.08, 0.82, 1.90, 0.08, 0.14, '#111827'));
      parts.push(part(0, 1.13, 0.82, 1.82, 0.04, 0.10, aCol));
      addPovSteeringRim(parts, 1.29, 0.78, 0.23, steerVal, '#111827', aCol, false);
      // Roadster hood + twin accent spears + fender crowns
      parts.push(part(0, 0.80, 1.44, 2.02, 0.40, 1.32, pCol));
      parts.push(part(-0.48, 1.015, 1.46, 0.14, 0.03, 1.24, aCol));
      parts.push(part(0.48, 1.015, 1.46, 0.14, 0.03, 1.24, aCol));
      parts.push(part(-0.90, 0.96, 1.44, 0.26, 0.22, 1.26, pCol));
      parts.push(part(0.90, 0.96, 1.44, 0.26, 0.22, 1.26, pCol));
      parts.push(part(0, 0.52, 2.14, 1.98, 0.26, 0.20, chrome));
      parts.push(part(-0.76, 0.98, 2.08, 0.38, 0.18, 0.14, '#fef9c3', 0.92));
      parts.push(part(0.76, 0.98, 2.08, 0.38, 0.18, 0.14, '#fef9c3', 0.92));
      break;
    }

    case 'van': {
      // Cab-forward panoramic view (z >= 1.29, strictly ahead of van fwdZ + nearClip!)
      addPovFrontWheels(parts, 1.08, 1.92, 0.44, 0.38, wheelSpin, '#ffffff', steerYaw * 0.35);
      parts.push(part(0, 0.94, 1.77, 2.18, 1.12, 0.90, pCol));
      parts.push(part(0, 1.48, 1.46, 2.10, 0.10, 0.34, '#ffffff'));
      parts.push(part(0, 1.505, 1.88, 2.22, 0.05, 0.68, aCol));
      // Mini retro ice-cream dash bobble tucked cleanly on right corner
      parts.push(part(0.74, 1.58, 1.48, 0.14, 0.14, 0.14, '#d97706'));
      parts.push(part(0.74, 1.70, 1.48, 0.18, 0.14, 0.18, aCol, 0.2));
      parts.push(part(0.74, 1.80, 1.48, 0.08, 0.08, 0.08, '#ef4444', 0.5));
      parts.push(part(0, 0.62, 2.26, 2.16, 0.26, 0.20, chrome));
      parts.push(part(-0.78, 1.34, 2.22, 0.36, 0.24, 0.14, '#fef9c3', 0.92));
      parts.push(part(0.78, 1.34, 2.22, 0.36, 0.24, 0.14, '#fef9c3', 0.92));
      break;
    }

    case 'pickup': {
      addPovFrontWheels(parts, 1.14, 1.44, 0.48, 0.44, wheelSpin, aCol, steerYaw * 0.45);
      // Muscular Baja power-dome hood + wide flared fenders (NO overhead lightbar!)
      parts.push(part(0, 0.82, 0.90, 2.12, 1.08, 0.28, '#18181b'));
      parts.push(part(0, 1.36, 0.84, 2.04, 0.10, 0.14, darkMetal));
      parts.push(part(0, 0.98, 1.44, 2.16, 0.58, 1.28, pCol));
      parts.push(part(0, 1.32, 1.44, 0.96, 0.10, 1.12, aCol));
      parts.push(part(-1.10, 1.20, 1.44, 0.34, 0.32, 1.24, pCol));
      parts.push(part(1.10, 1.20, 1.44, 0.34, 0.32, 1.24, pCol));
      parts.push(part(0, 0.68, 2.14, 2.12, 0.30, 0.22, darkMetal));
      parts.push(part(-0.82, 1.20, 2.08, 0.42, 0.22, 0.14, '#fef9c3', 0.92));
      parts.push(part(0.82, 1.20, 2.08, 0.42, 0.22, 0.14, '#fef9c3', 0.92));
      break;
    }

    case 'f1': {
      // True Formula 1 cockpit view: exposed wide front slicks, wishbones, pointed nosecone, multi-element wing & shift-LED yoke!
      addPovFrontWheels(parts, 1.16, 1.52, 0.42, 0.48, wheelSpin, aCol, steerYaw);
      parts.push(part(-0.68, 0.52, 1.52, 0.86, 0.06, 0.10, darkMetal));
      parts.push(part(0.68, 0.52, 1.52, 0.86, 0.06, 0.10, darkMetal));
      parts.push(part(0, 0.54, 0.90, 0.92, 0.72, 0.28, '#111827'));
      addPovSteeringRim(parts, 0.96, 0.78, 0.20, steerVal, '#111827', aCol, true);
      parts.push(part(0, 0.62, 1.42, 0.74, 0.34, 0.84, pCol));
      parts.push(part(0, 0.50, 2.04, 0.50, 0.26, 0.62, pCol));
      parts.push(part(0, 0.80, 1.42, 0.22, 0.03, 0.80, aCol));
      parts.push(part(0, 0.34, 2.32, 2.32, 0.10, 0.52, aCol));
      parts.push(part(-1.16, 0.48, 2.32, 0.08, 0.34, 0.56, pCol));
      parts.push(part(1.16, 0.48, 2.32, 0.08, 0.34, 0.56, pCol));
      break;
    }

    case 'mini': {
      addPovFrontWheels(parts, 0.94, 1.30, 0.40, 0.38, wheelSpin, aCol, steerYaw * 0.55);
      // Rounded compact hood + iconic bug-eye round headlight pods peeking up on fenders!
      parts.push(part(0, 0.58, 0.86, 1.74, 0.86, 0.24, '#18181b'));
      parts.push(part(0, 1.04, 0.80, 1.66, 0.08, 0.12, aCol));
      parts.push(part(0, 0.82, 1.24, 1.76, 0.52, 0.96, pCol));
      parts.push(part(0, 1.09, 1.26, 0.40, 0.03, 0.88, aCol));
      parts.push(part(-0.66, 1.12, 1.54, 0.34, 0.28, 0.34, pCol));
      parts.push(part(0.66, 1.12, 1.54, 0.34, 0.28, 0.34, pCol));
      parts.push(part(-0.66, 1.14, 1.70, 0.28, 0.24, 0.10, '#fef9c3', 0.95));
      parts.push(part(0.66, 1.14, 1.70, 0.28, 0.24, 0.10, '#fef9c3', 0.95));
      parts.push(part(0, 0.52, 1.76, 1.72, 0.22, 0.18, chrome));
      break;
    }

    case 'dozer': {
      // Heavy industrial armored nose + twin hydraulic arms + massive steel bulldozer plow blade (NO tall stack!)
      parts.push(part(-1.18, 0.64, 1.38, 0.56, 0.92, 1.16, '#27272a'));
      parts.push(part(1.18, 0.64, 1.38, 0.56, 0.92, 1.16, '#27272a'));
      addPovFrontWheels(parts, 1.22, 1.40, 0.46, 0.56, wheelSpin, '#f59e0b', 0);
      parts.push(part(0, 0.94, 0.94, 1.92, 1.16, 0.28, '#18181b'));
      parts.push(part(0, 1.14, 1.35, 1.94, 0.68, 1.02, pCol));
      parts.push(part(0, 1.495, 1.38, 0.88, 0.04, 0.72, '#18181b'));
      parts.push(part(-0.74, 1.36, 1.84, 0.32, 0.20, 0.12, '#fef08a', 0.9));
      parts.push(part(0.74, 1.36, 1.84, 0.32, 0.20, 0.12, '#fef08a', 0.9));
      parts.push(part(-0.78, 0.82, 1.96, 0.24, 0.26, 0.92, aCol));
      parts.push(part(0.78, 0.82, 1.96, 0.24, 0.26, 0.92, aCol));
      parts.push(part(-0.78, 0.92, 2.16, 0.14, 0.14, 0.52, chrome));
      parts.push(part(0.78, 0.92, 2.16, 0.14, 0.14, 0.52, chrome));
      parts.push(part(0, 0.90, 2.38, 2.86, 1.24, 0.32, '#94a3b8'));
      parts.push(part(0, 1.54, 2.40, 2.88, 0.10, 0.24, aCol));
      parts.push(part(0, 0.30, 2.50, 2.90, 0.24, 0.36, aCol));
      break;
    }

    case 'gold': {
      addPovFrontWheels(parts, 1.06, 1.38, 0.42, 0.38, wheelSpin, '#fef3c7', steerYaw * 0.45);
      // Long gleaming 24K hood + center gold spine + glowing golden crown hood ornament at z = 2.12!
      parts.push(part(0, 0.66, 0.88, 2.04, 0.92, 0.24, '#1c1917'));
      parts.push(part(0, 1.14, 0.82, 1.96, 0.08, 0.12, aCol, 0.45));
      parts.push(part(0, 0.82, 1.51, 2.12, 0.56, 1.46, pCol, 0.24));
      parts.push(part(0, 1.12, 1.52, 0.18, 0.05, 1.40, aCol, 0.48));
      parts.push(part(-0.94, 1.02, 1.50, 0.28, 0.26, 1.38, pCol, 0.26));
      parts.push(part(0.94, 1.02, 1.50, 0.28, 0.26, 1.38, pCol, 0.26));
      // Crown ornament
      parts.push(part(0, 1.23, 2.12, 0.22, 0.20, 0.20, '#fde047', 0.82));
      parts.push(part(-0.08, 1.37, 2.12, 0.06, 0.12, 0.06, '#fef08a', 0.95));
      parts.push(part(0, 1.40, 2.12, 0.07, 0.15, 0.07, '#fef08a', 0.98));
      parts.push(part(0.08, 1.37, 2.12, 0.06, 0.12, 0.06, '#fef08a', 0.95));
      parts.push(part(0, 0.82, 2.28, 1.18, 0.54, 0.12, aCol, 0.45));
      parts.push(part(0, 0.54, 2.30, 2.08, 0.24, 0.18, aCol, 0.35));
      parts.push(part(-0.78, 1.02, 2.22, 0.38, 0.20, 0.14, '#fef9c3', 0.92));
      parts.push(part(0.78, 1.02, 2.22, 0.38, 0.20, 0.14, '#fef9c3', 0.92));
      break;
    }

    case 'sedan':
    default: {
      addPovFrontWheels(parts, 1.02, 1.32, 0.40, 0.38, wheelSpin, chrome, steerYaw * 0.45);
      // Sleek sculpted hood + center accent racing spear + raised fender ridges + dark dash cowl
      parts.push(part(0, 0.62, 0.86, 1.98, 0.88, 0.24, '#111827'));
      parts.push(part(0, 1.10, 0.80, 1.92, 0.09, 0.14, darkMetal));
      parts.push(part(0, 0.84, 1.40, 1.98, 0.44, 1.28, pCol));
      parts.push(part(0, 1.07, 1.44, 0.36, 0.03, 1.18, aCol));
      parts.push(part(-0.88, 1.02, 1.40, 0.30, 0.24, 1.24, pCol));
      parts.push(part(0.88, 1.02, 1.40, 0.30, 0.24, 1.24, pCol));
      parts.push(part(0, 0.54, 2.08, 1.96, 0.26, 0.20, chrome));
      parts.push(part(-0.76, 1.02, 2.02, 0.38, 0.18, 0.14, '#fef9c3', 0.92));
      parts.push(part(0.76, 1.02, 2.02, 0.38, 0.18, 0.14, '#fef9c3', 0.92));
      break;
    }
  }

  return parts;
}

export function buildCopPovParts(copVehicleId = 'cop_heli', wheelSpin = 0, opts = {}) {
  const unitId = normalizeCopVehicleId(copVehicleId);
  const parts = [];
  const steerVal = Number(opts.steer) || 0;
  const steerYaw = clamp(-steerVal * 0.32, -0.34, 0.34);
  const time = Number(opts.time) || 0;
  const redActive = Math.floor(time * 9.5) % 2 === 0;

  switch (unitId) {
    case 'cop_cruiser': {
      // Zero-clipping Police Interceptor POV (partBackZ >= 0.79 >= 0.78):
      // Black-and-white pursuit hood + heavy PIT push-bar + alternating red/blue strobe glow tips!
      addPovFrontWheels(parts, 1.02, 1.38, 0.40, 0.38, wheelSpin, '#cbd5e1', steerYaw * 0.45);
      parts.push(part(0, 0.62, 0.92, 1.98, 0.88, 0.24, '#0f172a'));
      parts.push(part(0, 1.10, 0.86, 1.92, 0.09, 0.14, '#1e293b'));
      // Black hood + crisp white pursuit center shield + gold precinct crest
      parts.push(part(0, 0.84, 1.46, 1.98, 0.44, 1.32, '#0f172a'));
      parts.push(part(0, 1.07, 1.48, 0.92, 0.035, 1.24, '#ffffff'));
      parts.push(part(0, 1.09, 1.72, 0.26, 0.03, 0.26, '#facc15', 0.55));
      parts.push(part(-0.88, 1.02, 1.46, 0.30, 0.24, 1.28, '#0f172a'));
      parts.push(part(0.88, 1.02, 1.46, 0.30, 0.24, 1.28, '#0f172a'));
      // Red & blue strobe glow pods on hood edge
      parts.push(part(-0.56, 1.11, 2.02, 0.34, 0.11, 0.18, redActive ? '#ef4444' : '#7f1d1d', redActive ? 1.0 : 0.25));
      parts.push(part(0.56, 1.11, 2.02, 0.34, 0.11, 0.18, !redActive ? '#3b82f6' : '#1e3a8a', !redActive ? 1.0 : 0.25));
      // Heavy steel PIT push-bar + headlights
      parts.push(part(0, 0.56, 2.14, 1.98, 0.26, 0.20, '#334155'));
      parts.push(part(-0.44, 0.92, 2.24, 0.14, 0.76, 0.18, '#18181b'));
      parts.push(part(0.44, 0.92, 2.24, 0.14, 0.76, 0.18, '#18181b'));
      parts.push(part(0, 1.18, 2.24, 1.12, 0.12, 0.16, '#27272a'));
      parts.push(part(0, 0.86, 2.26, 1.18, 0.14, 0.18, '#18181b'));
      parts.push(part(-0.78, 1.02, 2.10, 0.36, 0.18, 0.14, '#fef9c3', 0.92));
      parts.push(part(0.78, 1.02, 2.10, 0.36, 0.18, 0.14, '#fef9c3', 0.92));
      break;
    }

    case 'cop_swat': {
      // Zero-clipping Armored SWAT Truck POV (partBackZ >= 0.87 >= 0.86):
      // Heavy armored navy hood + tactical white stripes + massive steel battering-ram bullbar!
      addPovFrontWheels(parts, 1.14, 1.62, 0.48, 0.44, wheelSpin, '#475569', steerYaw * 0.38);
      parts.push(part(0, 1.08, 1.02, 2.22, 1.16, 0.28, '#0f172a'));
      parts.push(part(0, 1.68, 0.96, 2.14, 0.10, 0.18, '#334155'));
      parts.push(part(0, 1.28, 1.62, 2.28, 0.68, 1.44, '#1e293b'));
      parts.push(part(0, 1.64, 1.64, 1.18, 0.10, 1.32, '#0f172a'));
      parts.push(part(-1.04, 1.52, 1.62, 0.28, 0.30, 1.38, '#1e293b'));
      parts.push(part(1.04, 1.52, 1.62, 0.28, 0.30, 1.38, '#1e293b'));
      parts.push(part(-0.72, 1.63, 1.64, 0.12, 0.03, 1.28, '#f8fafc'));
      parts.push(part(0.72, 1.63, 1.64, 0.12, 0.03, 1.28, '#f8fafc'));
      // Red/blue tactical strobe beacons on armored nose
      parts.push(part(-0.64, 1.68, 2.24, 0.38, 0.12, 0.18, redActive ? '#ef4444' : '#7f1d1d', redActive ? 1.0 : 0.25));
      parts.push(part(0.64, 1.68, 2.24, 0.38, 0.12, 0.18, !redActive ? '#3b82f6' : '#1e3a8a', !redActive ? 1.0 : 0.25));
      // Heavy steel battering-ram bullbar + ribs + floodlights
      parts.push(part(0, 1.04, 2.48, 2.36, 0.82, 0.32, '#09090b'));
      parts.push(part(0, 1.66, 2.48, 2.24, 0.16, 0.22, '#334155'));
      parts.push(part(-0.82, 1.36, 2.50, 0.16, 0.68, 0.24, '#27272a'));
      parts.push(part(0, 1.36, 2.52, 0.20, 0.68, 0.26, '#27272a'));
      parts.push(part(0.82, 1.36, 2.50, 0.16, 0.68, 0.24, '#27272a'));
      parts.push(part(-0.88, 1.48, 2.36, 0.38, 0.22, 0.14, '#fef9c3', 0.92));
      parts.push(part(0.88, 1.48, 2.36, 0.38, 0.22, 0.14, '#fef9c3', 0.92));
      break;
    }

    case 'cop_tank': {
      // Zero-clipping Tank Gunner / Turret POV (partBackZ >= 0.92 >= 0.90):
      // Sloped olive/navy armored glacis + long high-velocity tank cannon barrel straight down center-bottom!
      parts.push(part(-1.34, 0.68, 1.69, 0.66, 0.96, 1.54, '#1c1917'));
      parts.push(part(1.34, 0.68, 1.69, 0.66, 0.96, 1.54, '#1c1917'));
      parts.push(part(0, 1.06, 1.62, 2.36, 0.72, 1.40, '#4d5d3b'));
      parts.push(part(0, 1.24, 1.98, 2.24, 0.36, 0.84, '#5c6f47', 0, 0.18));
      parts.push(part(-1.02, 1.32, 1.66, 0.28, 0.16, 1.36, '#0f172a'));
      parts.push(part(1.02, 1.32, 1.66, 0.28, 0.16, 1.36, '#0f172a'));
      parts.push(part(-1.02, 1.44, 2.22, 0.26, 0.12, 0.18, redActive ? '#ef4444' : '#7f1d1d', redActive ? 1.0 : 0.25));
      parts.push(part(1.02, 1.44, 2.22, 0.26, 0.12, 0.18, !redActive ? '#3b82f6' : '#1e3a8a', !redActive ? 1.0 : 0.25));
      parts.push(part(-0.82, 1.24, 2.34, 0.36, 0.20, 0.14, '#fef9c3', 0.9));
      parts.push(part(0.82, 1.24, 2.34, 0.36, 0.20, 0.14, '#fef9c3', 0.9));
      // Gun mantlet collar + long high-velocity cannon barrel (z = 0.92..3.75+, y = 1.62) + bore evacuator + muzzle brake!
      parts.push(part(0, 1.62, 1.20, 0.58, 0.44, 0.56, '#3f4f30'));
      parts.push(part(0, 1.62, 2.27, 0.32, 0.32, 2.70, '#27272a'));
      parts.push(part(0, 1.62, 2.35, 0.42, 0.42, 0.56, '#3f4f30'));
      parts.push(part(0, 1.62, 3.12, 0.35, 0.35, 0.14, '#facc15', 0.35));
      parts.push(part(0, 1.62, 3.59, 0.48, 0.46, 0.32, '#18181b'));
      break;
    }

    case 'cop_heli':
    default: {
      // Zero-clipping Attack Helicopter Nose Cockpit POV (partBackZ >= 0.88):
      // Lower avionics console lip + twin side-mounted missile pod tips at x = ±1.05, z = 0.88..1.65, y = 0.62
      // ZERO overhead rotor, mast, or bubble-glass clipping!
      parts.push(part(0, 0.56, 1.18, 1.62, 0.34, 0.56, '#0f172a'));
      parts.push(part(0, 0.76, 1.04, 1.36, 0.10, 0.30, '#1e293b'));
      parts.push(part(0, 0.82, 1.06, 0.38, 0.08, 0.18, '#22d3ee', 0.88));
      parts.push(part(-0.34, 0.82, 1.06, 0.14, 0.06, 0.12, redActive ? '#ef4444' : '#facc15', 0.92));
      parts.push(part(0.34, 0.82, 1.06, 0.14, 0.06, 0.12, !redActive ? '#3b82f6' : '#22c55e', 0.92));
      // Landing skid forward toe tips
      parts.push(part(-0.82, 0.26, 1.48, 0.12, 0.12, 0.68, '#334155'));
      parts.push(part(0.82, 0.26, 1.48, 0.12, 0.12, 0.68, '#334155'));
      // Left & right stub weapon pylons + twin missile launcher pods (x = ±1.05, z = 0.88..1.65, y = 0.62)
      parts.push(part(-0.82, 0.64, 1.12, 0.52, 0.10, 0.44, '#1e293b'));
      parts.push(part(0.82, 0.64, 1.12, 0.52, 0.10, 0.44, '#1e293b'));
      parts.push(part(-1.05, 0.62, 1.18, 0.38, 0.32, 0.60, '#334155'));
      parts.push(part(1.05, 0.62, 1.18, 0.38, 0.32, 0.60, '#334155'));
      parts.push(part(-1.05, 0.62, 1.38, 0.40, 0.34, 0.12, '#facc15', 0.3));
      parts.push(part(1.05, 0.62, 1.38, 0.40, 0.34, 0.12, '#facc15', 0.3));
      // Twin red/white tactical missile tips peeking out of each side pod!
      for (const mx of [-1.13, -0.97, 0.97, 1.13]) {
        parts.push(part(mx, 0.62, 1.48, 0.13, 0.13, 0.20, '#f8fafc', 0.22));
        parts.push(part(mx, 0.62, 1.59, 0.11, 0.11, 0.12, '#ef4444', 0.9));
      }
      break;
    }
  }

  return parts;
}

function buildCopTankHullParts(wheelSpin = 0) {
  return [
    // Left & right armored treads + 6 spinning road wheels
    part(-1.34, 0.56, 0, 0.66, 1.04, 4.95, '#1c1917'),
    part(1.34, 0.56, 0, 0.66, 1.04, 4.95, '#1c1917'),
    part(-1.38, 0.52, 1.5, 0.72, 0.62, 0.62, '#44403c', 0, wheelSpin),
    part(-1.38, 0.52, 0, 0.72, 0.62, 0.62, '#44403c', 0, wheelSpin),
    part(-1.38, 0.52, -1.5, 0.72, 0.62, 0.62, '#44403c', 0, wheelSpin),
    part(1.38, 0.52, 1.5, 0.72, 0.62, 0.62, '#44403c', 0, wheelSpin),
    part(1.38, 0.52, 0, 0.72, 0.62, 0.62, '#44403c', 0, wheelSpin),
    part(1.38, 0.52, -1.5, 0.72, 0.62, 0.62, '#44403c', 0, wheelSpin),
    // Sloped olive-drab & navy tactical police armored hull
    part(0, 1.02, 0, 2.38, 0.92, 4.65, '#4d5d3b'),
    part(0, 1.08, -0.05, 2.44, 0.26, 3.85, '#0f172a'),
    part(0, 1.10, -0.05, 2.46, 0.09, 2.25, '#f8fafc'),
    part(0, 1.18, 1.95, 2.26, 0.52, 0.95, '#5c6f47', 0, 0.25),
    part(-0.82, 1.24, 2.28, 0.36, 0.22, 0.16, '#fef9c3', 0.88),
    part(0.82, 1.24, 2.28, 0.36, 0.22, 0.16, '#fef9c3', 0.88),
    part(-0.82, 1.18, -2.34, 0.36, 0.20, 0.14, '#ef4444', 0.82),
    part(0.82, 1.18, -2.34, 0.36, 0.20, 0.14, '#ef4444', 0.82),
  ];
}

function buildCopTankTurretParts() {
  return [
    part(0, 1.82, -0.15, 1.88, 0.78, 2.18, '#3f4f30'),
    part(0, 1.84, -0.15, 1.94, 0.22, 1.42, '#0f172a'),
    part(0, 2.28, -0.45, 0.78, 0.26, 0.78, '#29351f'),
    part(0, 1.86, 2.15, 0.34, 0.34, 3.15, '#27272a'),
    part(0, 1.86, 2.28, 0.44, 0.44, 0.58, '#3f4f30'),
    part(0, 1.86, 3.72, 0.48, 0.48, 0.46, '#18181b'),
  ];
}

export function buildCopVehicleParts(copVehicleId = 'cop_heli', wheelSpin = 0, opts = {}) {
  if (opts && opts.povSelf === true) {
    return buildCopPovParts(copVehicleId, wheelSpin, opts);
  }
  const unitId = normalizeCopVehicleId(copVehicleId);
  const parts = [];

  switch (unitId) {
    case 'cop_cruiser': {
      addWheels(parts, 1.02, 1.24, -1.24, 0.4, 0.38, wheelSpin, '#cbd5e1');
      parts.push(part(0, 0.72, 0, 2.04, 0.68, 4.12, '#0f172a'));
      parts.push(part(0, 0.74, -0.05, 2.08, 0.64, 1.78, '#ffffff'));
      parts.push(part(0, 1.4, -0.1, 1.76, 0.68, 1.98, '#ffffff'));
      parts.push(part(0, 1.38, -0.08, 1.8, 0.48, 1.58, '#1e293b'));
      // Heavy front PIT push-bar + uprights
      parts.push(part(0, 0.68, 2.18, 1.38, 0.54, 0.22, '#18181b'));
      parts.push(part(-0.44, 0.84, 2.24, 0.14, 0.68, 0.18, '#27272a'));
      parts.push(part(0.44, 0.84, 2.24, 0.14, 0.68, 0.18, '#27272a'));
      addLightsAndBumpers(parts, 1.0, 0.68, 2.06, '#334155');
      break;
    }

    case 'cop_swat': {
      addWheels(parts, 1.14, 1.48, -1.48, 0.48, 0.44, wheelSpin, '#475569');
      parts.push(part(0, 1.18, 0, 2.32, 1.46, 4.75, '#1e293b'));
      parts.push(part(0, 1.38, 0, 2.36, 0.18, 4.55, '#f8fafc'));
      parts.push(part(0, 1.98, -0.15, 2.22, 0.78, 4.25, '#0f172a'));
      parts.push(part(0, 1.92, 1.98, 1.92, 0.48, 0.16, '#38bdf8', 0.25));
      // Heavy steel battering-ram bullbar
      parts.push(part(0, 0.76, 2.50, 2.32, 0.74, 0.34, '#09090b'));
      parts.push(part(0, 1.22, 2.50, 2.18, 0.16, 0.24, '#334155'));
      addLightsAndBumpers(parts, 1.12, 0.76, 2.38, '#334155');
      break;
    }

    case 'cop_tank': {
      parts.push(...buildCopTankHullParts(wheelSpin), ...buildCopTankTurretParts());
      break;
    }

    case 'cop_heli':
    default: {
      // Landing skids & struts
      parts.push(
        part(-0.95, 0.15, 0, 0.14, 0.14, 3.6, '#334155'),
        part(0.95, 0.15, 0, 0.14, 0.14, 3.6, '#334155'),
        part(-0.72, 0.5, 0.8, 0.12, 0.65, 0.14, '#475569'),
        part(0.72, 0.5, 0.8, 0.12, 0.65, 0.14, '#475569'),
        part(-0.72, 0.5, -0.8, 0.12, 0.65, 0.14, '#475569'),
        part(0.72, 0.5, -0.8, 0.12, 0.65, 0.14, '#475569'),
        // Fuselage + white police stripe + cyan bubble glass cockpit nose
        part(0, 1.35, 0.15, 2.05, 1.55, 3.55, '#0f172a'),
        part(0, 1.35, -0.1, 2.12, 0.48, 1.85, '#f8fafc'),
        part(0, 1.38, 1.42, 1.88, 1.25, 1.25, '#38bdf8', 0.28),
        // Stub weapon wings + twin side-mounted missile launcher pods with red/white missile tips!
        part(-1.32, 0.96, 0.28, 0.86, 0.14, 0.68, '#1e293b'),
        part(1.32, 0.96, 0.28, 0.86, 0.14, 0.68, '#1e293b'),
        part(-1.58, 0.80, 0.34, 0.46, 0.38, 1.38, '#334155'),
        part(1.58, 0.80, 0.34, 0.46, 0.38, 1.38, '#334155'),
        part(-1.58, 0.80, 0.66, 0.48, 0.40, 0.14, '#facc15', 0.3),
        part(1.58, 0.80, 0.66, 0.48, 0.40, 0.14, '#facc15', 0.3),
        part(-1.48, 0.80, 1.08, 0.15, 0.15, 0.26, '#f8fafc', 0.25),
        part(-1.68, 0.80, 1.08, 0.15, 0.15, 0.26, '#f8fafc', 0.25),
        part(1.48, 0.80, 1.08, 0.15, 0.15, 0.26, '#f8fafc', 0.25),
        part(1.68, 0.80, 1.08, 0.15, 0.15, 0.26, '#f8fafc', 0.25),
        part(-1.48, 0.80, 1.24, 0.13, 0.13, 0.16, '#ef4444', 0.88),
        part(-1.68, 0.80, 1.24, 0.13, 0.13, 0.16, '#ef4444', 0.88),
        part(1.48, 0.80, 1.24, 0.13, 0.13, 0.16, '#ef4444', 0.88),
        part(1.68, 0.80, 1.24, 0.13, 0.13, 0.16, '#ef4444', 0.88),
        // Tail boom + vertical stabilizer fin + belly searchlight pod + rotor mast
        part(0, 1.48, -2.95, 0.58, 0.58, 3.2, '#0f172a'),
        part(0, 2.05, -4.35, 0.18, 1.15, 0.78, '#f8fafc'),
        part(0, 0.48, 1.15, 0.48, 0.36, 0.48, '#fef08a', 0.98),
        part(0, 2.35, 0.1, 0.28, 0.56, 0.28, '#94a3b8')
      );
      break;
    }
  }

  return parts;
}

export function buildVehicleParts(vehicleId = 'sedan', primaryColor = '#ef4444', accentColor = '#fef08a', wheelSpin = 0, opts = {}) {
  if (isCopVehicleKey(vehicleId)) {
    return buildCopVehicleParts(vehicleId, wheelSpin, opts);
  }
  const pCol = primaryColor || '#ef4444';
  const aCol = accentColor || '#fef08a';
  if (opts && opts.povSelf === true) {
    return buildPovVehicleParts(vehicleId, pCol, aCol, wheelSpin, opts);
  }
  const parts = [];
  const glass = '#1e293b';
  const darkMetal = '#27272a';
  const chrome = '#e2e8f0';

  switch (vehicleId) {
    case 'muscle': {
      addWheels(parts, 1.08, 1.32, -1.32, 0.44, 0.42, wheelSpin, chrome);
      parts.push(part(0, 0.76, 0, 2.16, 0.72, 4.25, pCol));
      // Twin racing stripes
      parts.push(part(-0.34, 1.13, 0.05, 0.26, 0.05, 4.18, aCol));
      parts.push(part(0.34, 1.13, 0.05, 0.26, 0.05, 4.18, aCol));
      // Fastback cabin
      parts.push(part(0, 1.44, -0.22, 1.78, 0.68, 2.05, pCol));
      parts.push(part(0, 1.44, -0.18, 1.82, 0.48, 1.65, glass));
      // Chrome V8 supercharger blower sticking out of hood!
      parts.push(part(0, 1.32, 1.15, 0.62, 0.42, 0.68, chrome, 0.08));
      parts.push(part(0, 1.52, 1.42, 0.54, 0.2, 0.18, '#dc2626', 0.2));
      // Ducktail rear spoiler & quad exhausts
      parts.push(part(0, 1.24, -2.02, 2.08, 0.26, 0.24, aCol));
      parts.push(part(-0.55, 0.42, -2.18, 0.22, 0.16, 0.28, chrome));
      parts.push(part(0.55, 0.42, -2.18, 0.22, 0.16, 0.28, chrome));
      addLightsAndBumpers(parts, 1.08, 0.72, 2.12, darkMetal);
      break;
    }

    case 'kart': {
      addWheels(parts, 1.02, 1.08, -1.08, 0.38, 0.44, wheelSpin, aCol);
      // Low open tubular frame pan
      parts.push(part(0, 0.42, 0, 1.55, 0.24, 3.25, pCol));
      // Side pods
      parts.push(part(-0.82, 0.52, -0.05, 0.34, 0.32, 1.65, pCol));
      parts.push(part(0.82, 0.52, -0.05, 0.34, 0.32, 1.65, pCol));
      // Front nosecone & number plate
      parts.push(part(0, 0.62, 1.25, 1.15, 0.34, 0.85, pCol));
      parts.push(part(0, 0.8, 1.25, 0.72, 0.06, 0.55, aCol));
      // Bucket seat + steering column
      parts.push(part(0, 0.86, -0.25, 0.86, 0.68, 0.32, '#111827'));
      parts.push(part(0, 0.88, 0.55, 0.16, 0.52, 0.16, darkMetal, 0, -0.45));
      parts.push(part(0, 1.12, 0.42, 0.48, 0.48, 0.08, '#111827', 0, -0.45));
      // Rear engine block + twin angled exhaust megaphones
      parts.push(part(0, 0.82, -1.18, 0.78, 0.62, 0.68, '#64748b'));
      parts.push(part(-0.34, 1.12, -1.52, 0.2, 0.2, 0.68, chrome, 0, 0.35));
      parts.push(part(0.34, 1.12, -1.52, 0.2, 0.2, 0.68, chrome, 0, 0.35));
      parts.push(part(-0.46, 0.58, 1.66, 0.28, 0.22, 0.14, '#fef9c3', 0.9));
      parts.push(part(0.46, 0.58, 1.66, 0.28, 0.22, 0.14, '#fef9c3', 0.9));
      break;
    }

    case 'supercar': {
      addWheels(parts, 1.08, 1.28, -1.28, 0.4, 0.44, wheelSpin, aCol);
      // Sleek wedge body
      parts.push(part(0, 0.64, 0, 2.22, 0.56, 4.35, pCol));
      parts.push(part(0, 0.88, 1.25, 2.05, 0.26, 1.55, pCol));
      // Side intakes
      parts.push(part(-1.08, 0.68, -0.25, 0.16, 0.38, 1.25, aCol));
      parts.push(part(1.08, 0.68, -0.25, 0.16, 0.38, 1.25, aCol));
      // Teardrop canopy
      parts.push(part(0, 1.22, -0.1, 1.62, 0.58, 1.95, glass));
      parts.push(part(0, 1.52, -0.15, 1.38, 0.1, 1.45, pCol));
      // High GT rear wing on twin struts
      parts.push(part(-0.68, 1.18, -1.95, 0.12, 0.55, 0.32, aCol));
      parts.push(part(0.68, 1.18, -1.95, 0.12, 0.55, 0.32, aCol));
      parts.push(part(0, 1.46, -2.02, 2.24, 0.12, 0.48, aCol));
      addLightsAndBumpers(parts, 1.08, 0.58, 2.15, aCol);
      break;
    }

    case 'monster': {
      // Giant 1.36m off-road crusher tires!
      addWheels(parts, 1.38, 1.38, -1.38, 0.68, 0.64, wheelSpin, aCol);
      // Lifted suspension struts & axles
      parts.push(part(0, 0.72, 1.38, 2.35, 0.24, 0.24, darkMetal));
      parts.push(part(0, 0.72, -1.38, 2.35, 0.24, 0.24, darkMetal));
      parts.push(part(0, 1.08, 0, 1.45, 0.36, 3.35, '#3f3f46'));
      // High-riding 4x4 truck body
      parts.push(part(0, 1.62, 0.1, 2.18, 0.76, 4.15, pCol));
      parts.push(part(0, 1.66, 0.1, 2.22, 0.18, 4.1, aCol));
      // Cab
      parts.push(part(0, 2.28, 0.15, 1.82, 0.72, 1.85, pCol));
      parts.push(part(0, 2.28, 0.18, 1.86, 0.5, 1.48, glass));
      // Rollbar light rack with 4 glowing floodlights
      parts.push(part(0, 2.38, -0.95, 1.76, 0.82, 0.18, darkMetal));
      for (const lx of [-0.6, -0.2, 0.2, 0.6]) {
        parts.push(part(lx, 2.86, -0.9, 0.24, 0.22, 0.2, '#fef08a', 0.92));
      }
      addLightsAndBumpers(parts, 1.06, 1.48, 2.08, chrome);
      break;
    }

    case 'convertible': {
      addWheels(parts, 1.02, 1.25, -1.25, 0.4, 0.38, wheelSpin, chrome);
      parts.push(part(0, 0.68, 0, 2.04, 0.64, 4.18, pCol));
      // Crisp side trim stripe
      parts.push(part(0, 0.74, 0, 2.08, 0.14, 4.12, aCol));
      // Open-top cockpit tub + seats + raked windshield!
      parts.push(part(0, 0.92, -0.15, 1.64, 0.34, 1.75, '#1f2937'));
      parts.push(part(-0.44, 1.12, -0.45, 0.58, 0.52, 0.32, aCol));
      parts.push(part(0.44, 1.12, -0.45, 0.58, 0.52, 0.32, aCol));
      parts.push(part(0, 1.26, 0.68, 1.78, 0.52, 0.14, glass, 0, -0.35));
      parts.push(part(0, 1.5, 0.6, 1.82, 0.08, 0.12, chrome));
      addLightsAndBumpers(parts, 1.0, 0.64, 2.08, chrome);
      break;
    }

    case 'van': {
      addWheels(parts, 1.08, 1.38, -1.38, 0.44, 0.38, wheelSpin, '#ffffff');
      // Tall boxy retro ice-cream van body
      parts.push(part(0, 1.05, 0, 2.22, 1.22, 4.45, pCol));
      parts.push(part(0, 1.92, -0.12, 2.12, 0.95, 3.95, '#ffffff'));
      parts.push(part(0, 1.42, 0, 2.26, 0.24, 4.48, aCol));
      // Front windshield & side serving window
      parts.push(part(0, 1.92, 1.88, 1.86, 0.66, 0.12, glass));
      parts.push(part(1.08, 1.92, -0.25, 0.12, 0.58, 1.55, '#38bdf8', 0.25));
      // Giant 3D roof ice-cream cone topper!
      parts.push(part(0, 2.68, -0.35, 0.68, 0.56, 0.68, '#d97706', 0, 0.22));
      parts.push(part(0, 3.12, -0.25, 0.88, 0.55, 0.88, aCol, 0.15));
      parts.push(part(0, 3.48, -0.22, 0.58, 0.42, 0.58, '#fdf2f8', 0.15));
      parts.push(part(0, 3.76, -0.2, 0.26, 0.26, 0.26, '#ef4444', 0.45));
      addLightsAndBumpers(parts, 1.08, 0.68, 2.22, chrome);
      break;
    }

    case 'pickup': {
      addWheels(parts, 1.14, 1.38, -1.38, 0.48, 0.44, wheelSpin, aCol);
      // Lower body + open rear bed walls
      parts.push(part(0, 0.88, 0.55, 2.2, 0.78, 2.95, pCol));
      parts.push(part(0, 0.72, -1.45, 2.18, 0.42, 1.65, pCol));
      parts.push(part(-0.98, 1.12, -1.45, 0.22, 0.48, 1.62, pCol));
      parts.push(part(0.98, 1.12, -1.45, 0.22, 0.48, 1.62, pCol));
      parts.push(part(0, 1.12, -2.18, 2.18, 0.48, 0.2, aCol));
      // Tilted Baja spare tire in truck bed!
      parts.push(part(0, 1.24, -1.38, 0.92, 0.36, 0.92, '#18181b', 0, 0.48));
      // Cab + lightbar
      parts.push(part(0, 1.64, 0.35, 1.88, 0.78, 1.72, pCol));
      parts.push(part(0, 1.64, 0.38, 1.92, 0.52, 1.34, glass));
      parts.push(part(0, 2.1, 0.95, 1.48, 0.18, 0.22, aCol, 0.75));
      addLightsAndBumpers(parts, 1.08, 0.76, 2.06, darkMetal);
      break;
    }

    case 'f1': {
      // Exposed wide open-wheel formula slicks
      addWheels(parts, 1.16, 1.42, -1.38, 0.42, 0.48, wheelSpin, aCol);
      // Narrow central monocoque + pointed nosecone
      parts.push(part(0, 0.56, 0.15, 0.86, 0.48, 3.85, pCol));
      parts.push(part(0, 0.48, 1.85, 0.56, 0.32, 0.95, pCol));
      // Wide multi-element front wing
      parts.push(part(0, 0.34, 2.25, 2.28, 0.12, 0.56, aCol));
      parts.push(part(-1.12, 0.46, 2.25, 0.08, 0.32, 0.58, pCol));
      parts.push(part(1.12, 0.46, 2.25, 0.08, 0.32, 0.58, pCol));
      // Sidepods
      parts.push(part(-0.74, 0.58, -0.25, 0.64, 0.44, 1.75, pCol));
      parts.push(part(0.74, 0.58, -0.25, 0.64, 0.44, 1.75, pCol));
      // Cockpit halo & tall airbox intake
      parts.push(part(0, 1.05, -0.58, 0.52, 0.58, 0.95, pCol));
      parts.push(part(0, 0.92, 0.08, 0.68, 0.24, 0.78, '#111827'));
      // High formula rear wing
      parts.push(part(0, 1.02, -1.85, 0.16, 0.68, 0.36, darkMetal));
      parts.push(part(0, 1.34, -1.92, 1.96, 0.12, 0.52, aCol));
      parts.push(part(0, 0.52, -2.02, 0.22, 0.22, 0.12, '#ef4444', 0.9));
      break;
    }

    case 'mini': {
      addWheels(parts, 0.94, 0.98, -0.95, 0.42, 0.38, wheelSpin, aCol);
      // Cute compact pocket buggy body
      parts.push(part(0, 0.74, 0.08, 1.82, 0.68, 3.12, pCol));
      parts.push(part(0, 1.38, -0.08, 1.56, 0.66, 1.82, aCol));
      parts.push(part(0, 1.36, -0.06, 1.6, 0.46, 1.46, glass));
      // Bug-eye round headlights & RC spring antenna!
      parts.push(part(-0.58, 0.92, 1.64, 0.38, 0.38, 0.2, '#fef9c3', 0.92));
      parts.push(part(0.58, 0.92, 1.64, 0.38, 0.38, 0.2, '#fef9c3', 0.92));
      parts.push(part(-0.55, 1.65, -1.25, 0.08, 0.95, 0.08, chrome));
      parts.push(part(-0.55, 2.16, -1.25, 0.22, 0.22, 0.22, '#ef4444', 0.85));
      parts.push(part(-0.58, 0.78, -1.5, 0.34, 0.24, 0.14, '#ef4444', 0.8));
      parts.push(part(0.58, 0.78, -1.5, 0.34, 0.24, 0.14, '#ef4444', 0.8));
      break;
    }

    case 'dozer': {
      // Heavy caterpillar track housings + wheels
      parts.push(part(-1.18, 0.56, -0.15, 0.58, 0.96, 3.65, '#27272a'));
      parts.push(part(1.18, 0.56, -0.15, 0.58, 0.96, 3.65, '#27272a'));
      addWheels(parts, 1.22, 1.15, -1.35, 0.46, 0.56, wheelSpin, '#f59e0b');
      // Industrial engine & armored cab
      parts.push(part(0, 1.15, -0.1, 1.98, 0.92, 3.45, pCol));
      parts.push(part(0, 2.02, -0.45, 1.72, 0.96, 1.85, pCol));
      parts.push(part(0, 2.04, -0.42, 1.76, 0.62, 1.45, glass));
      // Tall vertical diesel exhaust stack
      parts.push(part(0.76, 2.08, 0.85, 0.22, 1.25, 0.22, '#18181b'));
      // Massive front steel bulldozer plow blade + hydraulic arms!
      parts.push(part(-0.78, 0.68, 1.85, 0.24, 0.26, 0.95, aCol));
      parts.push(part(0.78, 0.68, 1.85, 0.24, 0.26, 0.95, aCol));
      parts.push(part(0, 0.82, 2.38, 2.86, 1.28, 0.34, '#94a3b8'));
      parts.push(part(0, 0.28, 2.52, 2.9, 0.26, 0.38, aCol));
      parts.push(part(-0.62, 2.56, 0.38, 0.32, 0.24, 0.24, '#fef08a', 0.9));
      parts.push(part(0.62, 2.56, 0.38, 0.32, 0.24, 0.24, '#fef08a', 0.9));
      break;
    }

    case 'gold': {
      addWheels(parts, 1.06, 1.38, -1.38, 0.42, 0.38, wheelSpin, '#fef3c7');
      // Gleaming 24K long-hood luxury cruiser with emissive gold sheen!
      parts.push(part(0, 0.74, 0, 2.14, 0.72, 4.55, pCol, 0.22));
      parts.push(part(0, 0.82, 0, 2.2, 0.16, 4.52, aCol, 0.35));
      parts.push(part(0, 1.42, -0.22, 1.82, 0.68, 2.05, pCol, 0.22));
      parts.push(part(0, 1.42, -0.2, 1.86, 0.48, 1.68, glass));
      // Golden grille + crown hood ornament + rear continental spare tire
      parts.push(part(0, 0.82, 2.3, 1.18, 0.56, 0.14, aCol, 0.42));
      parts.push(part(0, 1.24, 2.12, 0.24, 0.28, 0.24, '#fde047', 0.75));
      parts.push(part(0, 0.92, -2.36, 0.88, 0.88, 0.32, pCol, 0.28));
      addLightsAndBumpers(parts, 1.05, 0.68, 2.28, aCol);
      break;
    }

    case 'sedan':
    default: {
      addWheels(parts, 1.02, 1.24, -1.24, 0.4, 0.38, wheelSpin, chrome);
      parts.push(part(0, 0.72, 0, 2.04, 0.68, 4.05, pCol));
      parts.push(part(0, 0.76, 0, 2.08, 0.14, 3.98, aCol));
      parts.push(part(0, 1.4, -0.12, 1.76, 0.68, 1.98, pCol));
      parts.push(part(0, 1.4, -0.1, 1.8, 0.48, 1.58, glass));
      addLightsAndBumpers(parts, 1.0, 0.68, 2.02, chrome);
      break;
    }
  }

  return parts;
}

function getBuffTimers(entity) {
  const items = entity.items || {};
  const buffs = entity.activeBuffs || {};
  return {
    starTimer: entity.starTimer ?? items.starTimer ?? (buffs.star ? 1 : 0),
    megaTimer: entity.megaTimer ?? items.megaTimer ?? (buffs.mega ? 1 : 0),
    shrunkTimer: entity.shrunkTimer ?? items.shrunkTimer ?? (buffs.shrunk ? 1 : 0),
    boostTimer: entity.boostTimer ?? items.boostTimer ?? (buffs.boost ? 1 : 0),
    sugarTimer: entity.sugarTimer ?? items.sugarTimer ?? (entity.sugarActive || buffs.sugar ? 0.5 : 0),
    shockwaveTimer: entity.shockwaveVisualTimer ?? items.shockwaveVisualTimer ?? 0,
  };
}

function emitNitroFlames(batcher, x, y, z, yaw, pitch, roll, scale, backZ, time) {
  const flicker1 = 0.75 + Math.sin(time * 48) * 0.32;
  const flicker2 = 0.75 + Math.cos(time * 53) * 0.32;
  for (const side of [-0.52, 0.52]) {
    const f = side < 0 ? flicker1 : flicker2;
    const pOuter = transformLocalOffset(side * scale, 0.56 * scale, (backZ - 0.55 * f) * scale, yaw, pitch, roll);
    const pCore = transformLocalOffset(side * scale, 0.56 * scale, (backZ - 0.25 * f) * scale, yaw, pitch, roll);
    batcher.addBox(
      x + pOuter.x,
      y + pOuter.y,
      z + pOuter.z,
      0.34 * scale,
      0.32 * scale,
      0.95 * f * scale,
      '#f97316',
      yaw,
      pitch,
      roll,
      0.95
    );
    batcher.addBox(
      x + pCore.x,
      y + pCore.y,
      z + pCore.z,
      0.2 * scale,
      0.2 * scale,
      0.55 * f * scale,
      '#38bdf8',
      yaw,
      pitch,
      roll,
      1.0
    );
  }
}

function emitSugarHyperFlames(batcher, x, y, z, yaw, pitch, roll, scale, backZ, time) {
  // Blazing Quad Cotton-Candy Pink & Electric Cyan 3x Hyper-Flames + Trailing Electric Speed-Streak Blocks!
  const offsets = [-0.78, -0.28, 0.28, 0.78];
  for (let i = 0; i < offsets.length; i++) {
    const ox = offsets[i];
    const f = 0.85 + Math.sin(time * 62 + i * 1.7) * 0.38;
    const outerCol = i % 2 === 0 ? '#f472b6' : '#22d3ee';
    const coreCol = i % 2 === 0 ? '#fef08a' : '#ffffff';
    const pOuter = transformLocalOffset(ox * scale, 0.62 * scale, (backZ - 0.88 * f) * scale, yaw, pitch, roll);
    const pCore = transformLocalOffset(ox * scale, 0.62 * scale, (backZ - 0.36 * f) * scale, yaw, pitch, roll);

    batcher.addBox(
      x + pOuter.x,
      y + pOuter.y,
      z + pOuter.z,
      0.38 * scale,
      0.36 * scale,
      1.68 * f * scale,
      outerCol,
      yaw,
      pitch,
      roll,
      1.0
    );
    batcher.addBox(
      x + pCore.x,
      y + pCore.y,
      z + pCore.z,
      0.22 * scale,
      0.22 * scale,
      0.78 * f * scale,
      coreCol,
      yaw,
      pitch,
      roll,
      1.0
    );
  }

  // Electric speed-streak blocks whipping past the flanks & tail!
  const streakColors = ['#f472b6', '#22d3ee', '#fde047', '#ec4899'];
  for (let s = 0; s < 6; s++) {
    const side = s % 2 === 0 ? -1 : 1;
    const prog = (time * 18.0 + s * 0.27) % 1;
    const sxLocal = side * (1.36 + (s % 3) * 0.18) * scale;
    const syLocal = (0.55 + (s % 3) * 0.38) * scale;
    const szLocal = (0.85 - prog * 4.4) * scale;
    const sp = transformLocalOffset(sxLocal, syLocal, szLocal, yaw, pitch, roll);
    batcher.addBox(
      x + sp.x,
      y + sp.y,
      z + sp.z,
      0.16 * scale,
      0.16 * scale,
      1.35 * scale,
      streakColors[s % streakColors.length],
      yaw,
      pitch,
      roll,
      1.0
    );
  }
}

function emitDriftSparks(batcher, x, y, z, yaw, pitch, roll, scale, tier, time) {
  // Mario Kart Rear-Tire Drift Sparks: Tier 1 = Electric Blue (#38bdf8), Tier 2 = Super-Orange (#fb923c)!
  const mainCol = tier >= 2 ? '#fb923c' : '#38bdf8';
  const hotCol = tier >= 2 ? '#fde047' : '#e0f2fe';
  const sparksPerWheel = tier >= 2 ? 4 : 3;

  for (const side of [-1, 1]) {
    const tireX = side * 1.08;
    const tireZ = -1.32;
    const contact = transformLocalOffset(tireX * scale, 0.24 * scale, tireZ * scale, yaw, pitch, roll);
    batcher.addBox(
      x + contact.x,
      y + contact.y,
      z + contact.z,
      0.34 * scale,
      0.22 * scale,
      0.38 * scale,
      hotCol,
      yaw + time * 14,
      pitch,
      roll,
      1.0
    );

    for (let k = 0; k < sparksPerWheel; k++) {
      const u = (time * 13.5 + k * (1 / sparksPerWheel) + (side > 0 ? 0.19 : 0)) % 1;
      const ox = (tireX + side * u * (tier >= 2 ? 1.05 : 0.72)) * scale;
      const oy = (0.24 + Math.sin(u * Math.PI) * (tier >= 2 ? 0.72 : 0.46)) * scale;
      const oz = (tireZ - u * (tier >= 2 ? 1.95 : 1.38)) * scale;
      const sp = transformLocalOffset(ox, oy, oz, yaw, pitch, roll);
      const cubeS = (tier >= 2 ? 0.32 : 0.25) * (1.0 - u * 0.42) * scale;
      batcher.addBox(
        x + sp.x,
        y + sp.y,
        z + sp.z,
        cubeS,
        cubeS,
        cubeS * 1.35,
        k % 2 === 0 ? mainCol : hotCol,
        yaw + u * 6.0,
        pitch + u * 4.0,
        roll,
        1.0
      );
    }
  }
}

function emitTwinRpgLauncher(batcher, x, y, z, yaw, pitch, roll, scale, mountY, isRunner, isPovSelf, vehicleKey = 'sedan') {
  // Chunky 3D Voxel Olive-Green Twin-Barrel RPG Launcher with Dual Red-Gold Warhead Tips!
  // In POV self-view, mounted cleanly on the right front fender/shoulder (strictly z >= 0.74) so center stays 100% unobstructed!
  if (isPovSelf) {
    const fenderMount = POV_FENDER_RPG_MOUNT[vehicleKey] || POV_FENDER_RPG_MOUNT.sedan;
    const baseX = isRunner ? 0.94 : 1.06;
    const baseY = isRunner ? 1.92 : fenderMount.y;
    const baseZ = isRunner ? 1.38 : fenderMount.z;
    const povRpgParts = [
      part(baseX, baseY - 0.14, baseZ, 0.54, 0.18, 0.64, '#27272a'),
      part(baseX, baseY + 0.05, baseZ - 0.58, 0.72, 0.32, 0.12, '#18181b'),
      part(baseX - 0.18, baseY + 0.06, baseZ, 0.30, 0.30, 1.24, '#4d5d3b'),
      part(baseX + 0.18, baseY + 0.06, baseZ, 0.30, 0.30, 1.24, '#3f4f30'),
      part(baseX, baseY + 0.06, baseZ + 0.32, 0.68, 0.33, 0.16, '#facc15', 0.25),
      part(baseX - 0.18, baseY + 0.06, baseZ + 0.76, 0.36, 0.36, 0.42, '#ef4444', 0.72),
      part(baseX + 0.18, baseY + 0.06, baseZ + 0.76, 0.36, 0.36, 0.42, '#ef4444', 0.72),
      part(baseX - 0.18, baseY + 0.06, baseZ + 1.02, 0.17, 0.17, 0.20, '#fef08a', 0.95),
      part(baseX + 0.18, baseY + 0.06, baseZ + 1.02, 0.17, 0.17, 0.20, '#fef08a', 0.95),
    ];
    emitPartList(batcher, povRpgParts, x, y, z, yaw, pitch, roll, scale);
    return;
  }

  const baseX = isRunner ? 0.92 : 0.84;
  const baseY = mountY;
  const baseZ = 0.18;

  const rpgParts = [
    // Steel side/roof mounting bracket & blast collar
    part(baseX, baseY - 0.16, baseZ, 0.56, 0.2, 0.72, '#27272a'),
    part(baseX, baseY + 0.04, baseZ - 0.86, 0.74, 0.34, 0.18, '#18181b'),
    // Twin parallel Olive-Drab RPG launch tubes
    part(baseX - 0.19, baseY + 0.06, baseZ, 0.32, 0.32, 1.88, '#4d5d3b'),
    part(baseX + 0.19, baseY + 0.06, baseZ, 0.32, 0.32, 1.88, '#3f4f30'),
    // Yellow military hazard band across both barrels
    part(baseX, baseY + 0.06, baseZ + 0.48, 0.72, 0.35, 0.18, '#facc15', 0.25),
    // Protruding twin crimson RPG warheads + golden fuse tips!
    part(baseX - 0.19, baseY + 0.06, baseZ + 1.08, 0.38, 0.38, 0.44, '#ef4444', 0.72),
    part(baseX + 0.19, baseY + 0.06, baseZ + 1.08, 0.38, 0.38, 0.44, '#ef4444', 0.72),
    part(baseX - 0.19, baseY + 0.06, baseZ + 1.36, 0.18, 0.18, 0.22, '#fef08a', 0.95),
    part(baseX + 0.19, baseY + 0.06, baseZ + 1.36, 0.18, 0.18, 0.22, '#fef08a', 0.95),
  ];

  emitPartList(batcher, rpgParts, x, y, z, yaw, pitch, roll, scale);
}

function emitStarAura(batcher, x, y, z, scale, time) {
  for (let i = 0; i < 5; i++) {
    const a = time * 5.2 + (i * Math.PI * 2) / 5;
    const rad = 2.35 * scale;
    const sx = x + Math.cos(a) * rad;
    const sz = z + Math.sin(a) * rad;
    const sy = y + (1.1 + Math.sin(time * 8 + i * 1.4) * 0.55) * scale;
    const col = hslToHex((time * 2.2 + i * 0.2) % 1, 0.98, 0.6);
    batcher.addBox(sx, sy, sz, 0.42 * scale, 0.42 * scale, 0.42 * scale, col, a * 2, time * 4, 0, 0.98);
  }
}

export function emitPlayerVisuals(batcher, player, time = 0) {
  if (!player || player.alive === false) return;

  const x = player.x || 0;
  const y = player.y || 0;
  const z = player.z || 0;
  const spinExtra = (player.spinoutTimer || player.spinOutTimer || 0) > 0 ? (player.spinoutTimer || player.spinOutTimer || 0) * 14.0 : 0;
  const yaw = (player.angle || 0) + spinExtra;
  const vx = player.vx || 0;
  const vz = player.vz || 0;
  const vy = player.vy || 0;
  const speed = player.speed ?? Math.hypot(vx, vz);

  const { starTimer, megaTimer, shrunkTimer, boostTimer, sugarTimer, shockwaveTimer } = getBuffTimers(player);
  const heldItemId = player.heldItemId ?? player.items?.heldItem ?? null;
  const driftSparkTier = player.driftSparkTier || 0;

  const isPovSelf = Boolean(
    (batcher.povFocusId && player.id && player.id === batcher.povFocusId) ||
      (batcher.povFocusEntity && player === batcher.povFocusEntity) ||
      (batcher.povFocusId === '__local__' && !player.id && player.isLocal !== false)
  );

  let scale =
    player.isLocal === false && player.scale
      ? player.scale
      : player.scaleMult || player.scale || 1.0;
  if (player.isLocal !== false) {
    if (megaTimer > 0) scale *= 2.3;
    if (shrunkTimer > 0) scale *= 0.52;
  }

  const steerVal = player.steer ?? player.steerInput ?? 0;
  const driftRoll = isPovSelf
    ? clamp(-steerVal * (player.drifting ? 0.11 : 0.065), -0.13, 0.13)
    : clamp(-steerVal * (player.drifting ? 0.2 : 0.11), -0.24, 0.24);
  const airPitch = y > 0.25 ? clamp(-vy * 0.024, -0.38, 0.38) : 0;

  const isStar = starTimer > 0;
  const isSugar = sugarTimer > 0;
  const rainbowPrimary = isStar ? hslToHex((time * 3.4) % 1, 0.95, 0.56) : null;
  const rainbowAccent = isStar ? hslToHex((time * 3.4 + 0.38) % 1, 0.95, 0.68) : null;
  const starEmissive = isStar ? 0.42 : isSugar ? 0.24 : 0;

  const pColor = rainbowPrimary || player.primaryColor || '#ef4444';
  const aColor = rainbowAccent || player.accentColor || '#fef08a';
  const avatarId = player.avatarId || 'default_hero';
  const wheelSpin = player.wheelSpin ?? time * speed * 0.65;
  const mode = player.characterMode || 'car_driver';
  const seedOff = (player.id ? String(player.id).charCodeAt(0) : 0) * 0.37;

  if (player.playerRole === 'cop') {
    // PLAYABLE POLICE TEAM: Police Interceptor, Armored SWAT, Flying Attack Helicopter, or Heavy Police Tank!
    const copUnitId = normalizeCopVehicleId(player.copVehicleId);

    if (isPovSelf) {
      const povPitch = copUnitId === 'cop_heli' ? clamp(-vy * 0.012, -0.18, 0.18) : airPitch;
      const povParts = buildCopPovParts(copUnitId, wheelSpin, {
        steer: steerVal,
        time,
      });
      emitPartList(batcher, povParts, x, y, z, yaw, povPitch, driftRoll, scale, rainbowPrimary, starEmissive);

      if (copUnitId === 'cop_heli') {
        const groundSpotY = player.groundY ?? 0.08;
        const spotRadius = 5.4 * scale;
        if (typeof batcher.addTranslucentBox === 'function') {
          batcher.addTranslucentBox(x, groundSpotY, z, spotRadius * 1.55, 0.06, spotRadius * 1.55, '#fef9c3', 0.22, time * 0.6);
          emitTranslucentRing(batcher, x, groundSpotY + 0.03, z, spotRadius, 12, '#fde047', 0.44);
        } else {
          emitRingSegments(batcher, x, groundSpotY + 0.04, z, spotRadius, 12, '#fef08a', 0.82);
        }
      } else if ((copUnitId === 'cop_cruiser' || copUnitId === 'cop_swat') && heldItemId === 'homing_rocket') {
        emitTwinRpgLauncher(batcher, x, y, z, yaw, povPitch, driftRoll, scale, 2.0, false, true, copUnitId);
      }
    } else if (copUnitId === 'cop_heli') {
      const bobY = y + Math.sin(time * 3.8 + seedOff) * 0.28 * scale;
      const heliPitch = clamp(speed * 0.0035, 0.04, 0.16) + clamp(-vy * 0.01, -0.16, 0.16);
      const hParts = buildCopVehicleParts('cop_heli', wheelSpin, { time });
      emitPartList(batcher, hParts, x, bobY, z, yaw, heliPitch, driftRoll, scale, rainbowPrimary, starEmissive);

      // Fast-spinning 4-blade main rotor + spinning tail rotor!
      const rotorYaw = time * 24.0 + seedOff;
      const mastW = transformLocalOffset(0, 2.62 * scale, 0.1 * scale, yaw, heliPitch, driftRoll);
      batcher.addBox(x + mastW.x, bobY + mastW.y, z + mastW.z, 7.8 * scale, 0.08 * scale, 0.42 * scale, '#cbd5e1', rotorYaw, 0, 0, 0.18 + starEmissive);
      batcher.addBox(x + mastW.x, bobY + mastW.y, z + mastW.z, 0.42 * scale, 0.08 * scale, 7.8 * scale, '#cbd5e1', rotorYaw, 0, 0, 0.18 + starEmissive);

      const tailSpin = time * 28.0 + seedOff;
      const tailW = transformLocalOffset(0.16 * scale, 2.05 * scale, -4.35 * scale, yaw, heliPitch, driftRoll);
      batcher.addBox(x + tailW.x, bobY + tailW.y, z + tailW.z, 0.08 * scale, 1.48 * scale, 0.20 * scale, '#e2e8f0', yaw, tailSpin, 0, 0.22 + starEmissive);
      batcher.addBox(x + tailW.x, bobY + tailW.y, z + tailW.z, 0.08 * scale, 0.20 * scale, 1.48 * scale, '#ef4444', yaw, tailSpin, 0, 0.45 + starEmissive);

      // Upper cowling & belly flashing police siren bars + custom face cutout with 3D Police Cap & Gold Badge!
      emitPoliceSirenBar(batcher, x, bobY, z, yaw, heliPitch, driftRoll, scale, 2.16, 0.92, 1.32, time, seedOff);
      emitPoliceSirenBar(batcher, x, bobY, z, yaw, heliPitch, driftRoll, scale, 0.52, -0.4, 1.4, time, seedOff);
      emitCopFriendCutout(batcher, { avatarId }, x, bobY, z, yaw, heliPitch, driftRoll, scale, 2.22, {
        width: 2.28,
        tint: isStar ? rainbowAccent : '#ffffff',
        extraEmissive: starEmissive,
      });

      // Translucent ground searchlight disc + ring projected onto street/rooftop below!
      const groundSpotY = player.groundY ?? 0.08;
      const spotRadius = 5.4 * scale;
      if (typeof batcher.addTranslucentBox === 'function') {
        batcher.addTranslucentBox(x, groundSpotY, z, spotRadius * 1.55, 0.06, spotRadius * 1.55, '#fef9c3', 0.24, time * 0.6);
        emitTranslucentRing(batcher, x, groundSpotY + 0.03, z, spotRadius, 12, '#fde047', 0.48);
      } else {
        emitRingSegments(batcher, x, groundSpotY + 0.04, z, spotRadius, 12, '#fef08a', 0.85);
      }

      if (isSugar) {
        emitSugarHyperFlames(batcher, x, bobY, z, yaw, heliPitch, driftRoll, scale, -1.85, time);
      } else if (boostTimer > 0) {
        emitNitroFlames(batcher, x, bobY, z, yaw, heliPitch, driftRoll, scale, -1.85, time);
      }
    } else if (copUnitId === 'cop_tank') {
      const hullParts = buildCopTankHullParts(wheelSpin);
      emitPartList(batcher, hullParts, x, y, z, yaw, airPitch, driftRoll, scale, rainbowPrimary, starEmissive);

      const turretYaw = player.turretAngle ?? yaw;
      const turretParts = buildCopTankTurretParts();
      emitPartList(batcher, turretParts, x, y, z, turretYaw, airPitch, driftRoll, scale, rainbowPrimary, starEmissive);

      emitPoliceSirenBar(batcher, x, y, z, turretYaw, airPitch, driftRoll, scale, 2.32, 0.42, 1.12, time, seedOff);
      emitCopFriendCutout(batcher, { avatarId }, x, y, z, turretYaw, airPitch, driftRoll, scale, 2.35, {
        width: 2.32,
        tint: isStar ? rainbowAccent : '#ffffff',
        extraEmissive: starEmissive,
      });

      if (isSugar) {
        emitSugarHyperFlames(batcher, x, y, z, yaw, airPitch, driftRoll, scale, -2.45, time);
      } else if (boostTimer > 0) {
        emitNitroFlames(batcher, x, y, z, yaw, airPitch, driftRoll, scale, -2.45, time);
      }
      if (driftSparkTier >= 1) {
        emitDriftSparks(batcher, x, y, z, yaw, airPitch, driftRoll, scale, driftSparkTier, time);
      }
    } else {
      // 'cop_cruiser' or 'cop_swat'
      const isSwat = copUnitId === 'cop_swat';
      const cParts = buildCopVehicleParts(copUnitId, wheelSpin, { time });
      emitPartList(batcher, cParts, x, y, z, yaw, airPitch, driftRoll, scale, rainbowPrimary, starEmissive);

      const sirenY = isSwat ? 2.45 : 1.80;
      const sirenZ = isSwat ? 1.25 : -0.05;
      const sirenW = isSwat ? 1.72 : 1.48;
      const mountY = isSwat ? 2.42 : 1.85;
      emitPoliceSirenBar(batcher, x, y, z, yaw, airPitch, driftRoll, scale, sirenY, sirenZ, sirenW, time, seedOff);
      emitCopFriendCutout(batcher, { avatarId }, x, y, z, yaw, airPitch, driftRoll, scale, mountY, {
        width: 2.34,
        tint: isStar ? rainbowAccent : '#ffffff',
        extraEmissive: starEmissive,
      });

      if (heldItemId === 'homing_rocket') {
        emitTwinRpgLauncher(batcher, x, y, z, yaw, airPitch, driftRoll, scale, mountY + 0.34, false, false, copUnitId);
      }
      const backZ = isSwat ? -2.42 : -2.12;
      if (isSugar) {
        emitSugarHyperFlames(batcher, x, y, z, yaw, airPitch, driftRoll, scale, backZ, time);
      } else if (boostTimer > 0) {
        emitNitroFlames(batcher, x, y, z, yaw, airPitch, driftRoll, scale, backZ, time);
      }
      if (driftSparkTier >= 1) {
        emitDriftSparks(batcher, x, y, z, yaw, airPitch, driftRoll, scale, driftSparkTier, time);
      }
    }

    if (isStar) {
      emitStarAura(batcher, x, y, z, scale, time);
    }
    if (shockwaveTimer > 0) {
      const prog = 1 - clamp(shockwaveTimer / 0.55, 0, 1);
      const ringR = (3.0 + prog * 14.0) * scale;
      emitRingSegments(batcher, x, y + 0.6, z, ringR, 16, '#a855f7', 0.9);
    }
    return;
  }

  if (mode === 'runner') {
    // MODE 3: "Just Myself (On Foot)" — sprinting 3D blocky character with custom photo head & torso!
    const moving = speed > 1.2;
    const stride = moving ? time * Math.max(9.0, speed * 0.42) : time * 2.0;
    const swing = moving ? Math.sin(stride) * 0.85 : Math.sin(stride) * 0.06;
    const bounce = moving ? Math.abs(Math.sin(stride)) * 0.24 * scale : 0;
    const leanPitch = (isPovSelf ? 0 : clamp(speed * 0.0065, 0, 0.28)) + airPitch;

    const baseY = y + (isPovSelf ? bounce * 0.35 : bounce);

    if (!isPovSelf) {
      // Left & Right pumping legs + oversized chunky sneakers!
      for (const side of [-1, 1]) {
        const legSwing = side * swing;
        const hipX = side * 0.34;
        const legPos = transformLocalOffset(hipX * scale, 0.62 * scale, Math.sin(legSwing) * 0.25 * scale, yaw, leanPitch, driftRoll);
        batcher.addBox(
          x + legPos.x,
          baseY + legPos.y,
          z + legPos.z,
          0.42 * scale,
          0.78 * scale,
          0.44 * scale,
          '#1e3a8a',
          yaw,
          leanPitch + legSwing * 0.75,
          driftRoll,
          starEmissive
        );
        const shoePos = transformLocalOffset(
          hipX * scale,
          0.22 * scale,
          (0.14 + Math.sin(legSwing) * 0.42) * scale,
          yaw,
          0,
          driftRoll
        );
        batcher.addBox(
          x + shoePos.x,
          baseY + shoePos.y,
          z + shoePos.z,
          0.5 * scale,
          0.32 * scale,
          0.74 * scale,
          pColor,
          yaw,
          legSwing * 0.45,
          driftRoll,
          starEmissive
        );
        batcher.addBox(
          x + shoePos.x,
          baseY + shoePos.y - 0.13 * scale,
          z + shoePos.z,
          0.52 * scale,
          0.1 * scale,
          0.78 * scale,
          '#ffffff',
          yaw,
          legSwing * 0.45,
          driftRoll,
          starEmissive
        );
      }

      // Custom photo 3D torso box!
      const torsoPos = transformLocalOffset(0, 1.46 * scale, 0, yaw, leanPitch, driftRoll);
      batcher.addTexturedBox({
        avatarId,
        x: x + torsoPos.x,
        y: baseY + torsoPos.y,
        z: z + torsoPos.z,
        sx: 1.16 * scale,
        sy: 1.18 * scale,
        sz: 0.66 * scale,
        yaw,
        pitch: leanPitch,
        roll: driftRoll,
        tint: isStar ? rainbowPrimary : '#ffffff',
        emissive: 0.14 + starEmissive,
      });

      // Fluttering hero cape behind runner!
      const capeWave = Math.sin(time * 16) * 0.12;
      const capePos = transformLocalOffset(0, 1.42 * scale, -0.52 * scale, yaw, leanPitch, driftRoll);
      batcher.addBox(
        x + capePos.x,
        baseY + capePos.y,
        z + capePos.z,
        1.08 * scale,
        1.05 * scale,
        0.1 * scale,
        aColor,
        yaw,
        0.48 + clamp(speed * 0.012, 0, 0.45) + capeWave,
        driftRoll,
        starEmissive
      );

      // Large prominent custom photo cutout head
      const headPos = transformLocalOffset(0, 2.86 * scale, 0.08 * scale, yaw, leanPitch, driftRoll);
      batcher.addTexturedCard({
        avatarId,
        x: x + headPos.x,
        y: baseY + headPos.y,
        z: z + headPos.z,
        width: 2.15 * scale,
        height: 2.15 * scale,
        yaw,
        pitch: leanPitch * 0.35,
        roll: driftRoll * 1.15,
        billboard: 'y_blend',
        tint: isStar ? rainbowAccent : '#ffffff',
        emissive: 0.2 + starEmissive,
      });
    }

    // Pumping arms (strictly z >= 0.82 in POV self so blocky fists pump cleanly at bottom corners with zero elbow clipping!)
    for (const side of [-1, 1]) {
      const armSwing = -side * swing;
      if (isPovSelf) {
        const sVal = Math.sin(armSwing);
        const armPos = transformLocalOffset(
          side * 0.68 * scale,
          (1.66 + Math.max(0, sVal) * 0.16) * scale,
          (1.12 + sVal * 0.18) * scale,
          yaw,
          leanPitch,
          driftRoll
        );
        batcher.addBox(
          x + armPos.x,
          baseY + armPos.y,
          z + armPos.z,
          0.32 * scale,
          0.32 * scale,
          0.56 * scale,
          pColor,
          yaw,
          -0.25 + sVal * 0.28,
          driftRoll,
          starEmissive
        );
        const handPos = transformLocalOffset(
          side * 0.66 * scale,
          (1.76 + sVal * 0.20) * scale,
          (1.44 + sVal * 0.22) * scale,
          yaw,
          leanPitch,
          driftRoll
        );
        batcher.addBox(
          x + handPos.x,
          baseY + handPos.y,
          z + handPos.z,
          0.36 * scale,
          0.34 * scale,
          0.36 * scale,
          aColor,
          yaw,
          sVal * 0.35,
          driftRoll,
          starEmissive + 0.1
        );
      } else {
        const armPos = transformLocalOffset(
          side * 0.8 * scale,
          1.44 * scale,
          Math.sin(armSwing) * 0.28 * scale,
          yaw,
          leanPitch,
          driftRoll
        );
        batcher.addBox(
          x + armPos.x,
          baseY + armPos.y,
          z + armPos.z,
          0.34 * scale,
          0.82 * scale,
          0.34 * scale,
          pColor,
          yaw,
          leanPitch + armSwing * 0.75,
          driftRoll,
          starEmissive
        );
        const handPos = transformLocalOffset(
          side * 0.8 * scale,
          (1.44 - 0.44) * scale,
          (0.08 + Math.sin(armSwing) * 0.38) * scale,
          yaw,
          leanPitch,
          driftRoll
        );
        batcher.addBox(
          x + handPos.x,
          baseY + handPos.y,
          z + handPos.z,
          0.36 * scale,
          0.32 * scale,
          0.36 * scale,
          aColor,
          yaw,
          armSwing * 0.6,
          driftRoll,
          starEmissive + 0.1
        );
      }
    }

    if (heldItemId === 'homing_rocket') {
      emitTwinRpgLauncher(batcher, x, baseY, z, yaw, leanPitch, driftRoll, scale, 2.05, true, isPovSelf, 'runner');
    }
    if (isSugar) {
      emitSugarHyperFlames(batcher, x, baseY, z, yaw, 0, driftRoll, scale, -0.52, time);
    } else if (boostTimer > 0) {
      emitNitroFlames(batcher, x, baseY, z, yaw, 0, driftRoll, scale, -0.45, time);
    }
  } else if (mode === 'photo_car') {
    // MODE 2: "Look Like a Car" — rolling 3D photo-car chassis where player's photo IS the sculpted body!
    if (isPovSelf) {
      // POV Self: suppress upper cabPos box (y = 1.72), crest card, and rear geometry; emit clean custom-photo front hood (z = 0.74..2.08)!
      const povChassis = [];
      addPovFrontWheels(povChassis, 1.12, 1.38, 0.45, 0.44, wheelSpin, aColor, clamp(-steerVal * 0.18, -0.2, 0.2));
      povChassis.push(part(0, 0.62, 0.86, 2.06, 0.88, 0.24, '#18181b'));
      povChassis.push(part(0, 1.12, 0.80, 1.98, 0.08, 0.12, aColor));
      povChassis.push(part(-1.02, 1.02, 1.42, 0.24, 0.24, 1.30, aColor));
      povChassis.push(part(1.02, 1.02, 1.42, 0.24, 0.24, 1.30, aColor));
      povChassis.push(part(0, 0.54, 2.12, 2.08, 0.26, 0.20, aColor));
      povChassis.push(part(-0.78, 1.02, 2.08, 0.40, 0.20, 0.14, '#fef9c3', 0.92));
      povChassis.push(part(0.78, 1.02, 2.08, 0.40, 0.20, 0.14, '#fef9c3', 0.92));
      emitPartList(batcher, povChassis, x, y, z, yaw, airPitch, driftRoll, scale, rainbowPrimary, starEmissive);

      const povHoodPos = transformLocalOffset(0, 0.84 * scale, 1.41 * scale, yaw, airPitch, driftRoll);
      batcher.addTexturedBox({
        avatarId,
        x: x + povHoodPos.x,
        y: y + povHoodPos.y,
        z: z + povHoodPos.z,
        sx: 2.04 * scale,
        sy: 0.52 * scale,
        sz: 1.34 * scale,
        yaw,
        pitch: airPitch,
        roll: driftRoll,
        tint: isStar ? rainbowPrimary : '#ffffff',
        emissive: 0.18 + starEmissive,
      });
    } else {
      const chassisParts = [];
      addWheels(chassisParts, 1.12, 1.28, -1.28, 0.45, 0.44, wheelSpin, aColor);
      // Undercarriage frame, bumpers, lights, twin exhausts & rear wing
      chassisParts.push(part(0, 0.44, 0, 2.14, 0.26, 4.15, '#18181b'));
      addLightsAndBumpers(chassisParts, 1.08, 0.64, 2.08, aColor);
      chassisParts.push(part(-0.56, 0.42, -2.16, 0.22, 0.2, 0.32, '#e2e8f0'));
      chassisParts.push(part(0.56, 0.42, -2.16, 0.22, 0.2, 0.32, '#e2e8f0'));
      // Sporty rear spoiler wing
      chassisParts.push(part(-0.72, 1.38, -1.86, 0.14, 0.52, 0.28, pColor));
      chassisParts.push(part(0.72, 1.38, -1.86, 0.14, 0.52, 0.28, pColor));
      chassisParts.push(part(0, 1.66, -1.94, 2.22, 0.14, 0.48, aColor));

      emitPartList(batcher, chassisParts, x, y, z, yaw, airPitch, driftRoll, scale, rainbowPrimary, starEmissive);

      // Sculpted lower 3D photo-car body!
      const lowerPos = transformLocalOffset(0, 0.96 * scale, 0.04 * scale, yaw, airPitch, driftRoll);
      batcher.addTexturedBox({
        avatarId,
        x: x + lowerPos.x,
        y: y + lowerPos.y,
        z: z + lowerPos.z,
        sx: 2.18 * scale,
        sy: 0.86 * scale,
        sz: 4.02 * scale,
        yaw,
        pitch: airPitch,
        roll: driftRoll,
        tint: isStar ? rainbowPrimary : '#ffffff',
        emissive: 0.16 + starEmissive,
      });

      // Sculpted upper 3D photo-car cab!
      const cabPos = transformLocalOffset(0, 1.72 * scale, -0.15 * scale, yaw, airPitch, driftRoll);
      batcher.addTexturedBox({
        avatarId,
        x: x + cabPos.x,
        y: y + cabPos.y,
        z: z + cabPos.z,
        sx: 1.82 * scale,
        sy: 0.82 * scale,
        sz: 2.15 * scale,
        yaw,
        pitch: airPitch,
        roll: driftRoll,
        tint: isStar ? rainbowAccent : '#ffffff',
        emissive: 0.18 + starEmissive,
      });

      // Roof photo crest topper
      const crestPos = transformLocalOffset(0, 2.55 * scale, -0.1 * scale, yaw, airPitch, driftRoll);
      batcher.addTexturedCard({
        avatarId,
        x: x + crestPos.x,
        y: y + crestPos.y,
        z: z + crestPos.z,
        width: 1.65 * scale,
        height: 1.45 * scale,
        yaw,
        pitch: airPitch,
        roll: driftRoll * 1.2,
        billboard: 'y_blend',
        tint: '#ffffff',
        emissive: 0.2 + starEmissive,
      });
    }

    if (heldItemId === 'homing_rocket') {
      emitTwinRpgLauncher(batcher, x, y, z, yaw, airPitch, driftRoll, scale, 2.25, false, isPovSelf, 'photo_car');
    }
    if (isSugar) {
      emitSugarHyperFlames(batcher, x, y, z, yaw, airPitch, driftRoll, scale, -2.18, time);
    } else if (boostTimer > 0) {
      emitNitroFlames(batcher, x, y, z, yaw, airPitch, driftRoll, scale, -2.18, time);
    }
    if (driftSparkTier >= 1) {
      emitDriftSparks(batcher, x, y, z, yaw, airPitch, driftRoll, scale, driftSparkTier, time);
    }
  } else {
    // MODE 1: "car_driver" ("People on Car") — 3D voxel vehicle + big roof cutout + flat hood photo decal!
    const vehicleId = player.vehicleId || 'sedan';
    const vParts = buildVehicleParts(vehicleId, pColor, aColor, wheelSpin, {
      povSelf: isPovSelf,
      steer: steerVal,
      time,
    });
    emitPartList(batcher, vParts, x, y, z, yaw, airPitch, driftRoll, scale, rainbowPrimary, starEmissive);

    const roofY = VEHICLE_ROOF_Y[vehicleId] ?? 1.92;
    if (!isPovSelf) {
      // Cockpit sunroof collar rim + large prominent custom photo cutout sticking proudly out of the roof!
      const collarPos = transformLocalOffset(0, (roofY - 0.06) * scale, -0.12 * scale, yaw, airPitch, driftRoll);
      batcher.addBox(
        x + collarPos.x,
        y + collarPos.y,
        z + collarPos.z,
        1.15 * scale,
        0.22 * scale,
        1.15 * scale,
        '#111827',
        yaw,
        airPitch,
        driftRoll,
        0
      );

      const cutoutPos = transformLocalOffset(0, (roofY + 1.05) * scale, -0.12 * scale, yaw, airPitch, driftRoll);
      batcher.addTexturedCard({
        avatarId,
        x: x + cutoutPos.x,
        y: y + cutoutPos.y,
        z: z + cutoutPos.z,
        width: 2.38 * scale,
        height: 2.38 * scale,
        yaw,
        pitch: airPitch * 0.5,
        roll: driftRoll * 1.45, // playful tilt when drifting!
        billboard: 'y_blend',
        tint: isStar ? rainbowAccent : '#ffffff',
        emissive: 0.22 + starEmissive,
      });
    }

    // Flat horizontal custom photo hood badge (z >= 1.38; omitted on narrow f1/kart/dozer noses so no card edge clips!)
    const hoodMeta = VEHICLE_HOOD_POS[vehicleId] || null;
    if (hoodMeta) {
      const decalY = isPovSelf && hoodMeta.povY !== undefined ? hoodMeta.povY : hoodMeta.y;
      const decalSize = hoodMeta.size ?? 0.94;
      const hoodPos = transformLocalOffset(0, decalY * scale, hoodMeta.z * scale, yaw, airPitch, driftRoll);
      batcher.addTexturedCard({
        avatarId,
        x: x + hoodPos.x,
        y: y + hoodPos.y,
        z: z + hoodPos.z,
        width: decalSize * scale,
        height: decalSize * scale,
        yaw,
        pitch: -Math.PI * 0.5 + airPitch,
        roll: driftRoll,
        billboard: 'none',
        tint: '#ffffff',
        emissive: 0.16 + starEmissive,
      });
    }

    if (heldItemId === 'homing_rocket') {
      emitTwinRpgLauncher(batcher, x, y, z, yaw, airPitch, driftRoll, scale, roofY + 0.34, false, isPovSelf, vehicleId);
    }
    if (isSugar) {
      emitSugarHyperFlames(batcher, x, y, z, yaw, airPitch, driftRoll, scale, -2.15, time);
    } else if (boostTimer > 0) {
      emitNitroFlames(batcher, x, y, z, yaw, airPitch, driftRoll, scale, -2.15, time);
    }
    if (driftSparkTier >= 1) {
      emitDriftSparks(batcher, x, y, z, yaw, airPitch, driftRoll, scale, driftSparkTier, time);
    }
  }

  if (isStar) {
    emitStarAura(batcher, x, y, z, scale, time);
  }

  if (shockwaveTimer > 0) {
    const prog = 1 - clamp(shockwaveTimer / 0.55, 0, 1);
    const ringR = (3.0 + prog * 14.0) * scale;
    emitRingSegments(batcher, x, y + 0.6, z, ringR, 16, '#a855f7', 0.9);
  }
}

function emitPoliceSirenBar(batcher, x, y, z, yaw, pitch, roll, scale, barY, barZ, barWidth, time, seedOffset = 0) {
  const redActive = Math.floor(time * 9.5 + seedOffset) % 2 === 0;
  const basePos = transformLocalOffset(0, barY * scale, barZ * scale, yaw, pitch, roll);
  batcher.addBox(x + basePos.x, y + basePos.y, z + basePos.z, barWidth * scale, 0.14 * scale, 0.34 * scale, '#e2e8f0', yaw, pitch, roll, 0.1);

  const leftPos = transformLocalOffset(-barWidth * 0.28 * scale, (barY + 0.12) * scale, barZ * scale, yaw, pitch, roll);
  const rightPos = transformLocalOffset(barWidth * 0.28 * scale, (barY + 0.12) * scale, barZ * scale, yaw, pitch, roll);

  batcher.addBox(
    x + leftPos.x,
    y + leftPos.y,
    z + leftPos.z,
    barWidth * 0.42 * scale,
    0.22 * scale,
    0.32 * scale,
    redActive ? '#ef4444' : '#7f1d1d',
    yaw,
    pitch,
    roll,
    redActive ? 1.0 : 0.15
  );
  batcher.addBox(
    x + rightPos.x,
    y + rightPos.y,
    z + rightPos.z,
    barWidth * 0.42 * scale,
    0.22 * scale,
    0.32 * scale,
    !redActive ? '#3b82f6' : '#1e3a8a',
    yaw,
    pitch,
    roll,
    !redActive ? 1.0 : 0.15
  );
}

function emitCopFriendCutout(batcher, cop, x, y, z, yaw, pitch, roll, scale, mountY, styleOpts = null) {
  if (!cop.avatarId) return;
  const cardSize = (styleOpts?.width ?? 2.1) * scale;
  const extraEm = styleOpts?.extraEmissive ?? 0;
  const tint = styleOpts?.tint || '#ffffff';
  const cutPos = transformLocalOffset(0, (mountY + 0.98) * scale, -0.05 * scale, yaw, pitch, roll);
  batcher.addTexturedCard({
    avatarId: cop.avatarId,
    x: x + cutPos.x,
    y: y + cutPos.y,
    z: z + cutPos.z,
    width: cardSize,
    height: cardSize,
    yaw,
    pitch: pitch * 0.4,
    roll: roll * 1.25,
    billboard: 'y_blend',
    tint,
    emissive: 0.2 + extraEm,
  });
  // Cute 3D voxel police cap + visor peak + gleaming gold badge perched on top of officer's cutout!
  const capLift = (cardSize / scale - 2.1) * 0.46;
  const capPos = transformLocalOffset(0, (mountY + 2.08 + capLift) * scale, -0.05 * scale, yaw, pitch, roll);
  batcher.addBox(x + capPos.x, y + capPos.y, z + capPos.z, 1.02 * scale, 0.28 * scale, 0.92 * scale, '#1e3a8a', yaw, pitch, roll, 0.12 + extraEm);
  const brimPos = transformLocalOffset(0, (mountY + 1.96 + capLift) * scale, 0.34 * scale, yaw, pitch, roll);
  batcher.addBox(x + brimPos.x, y + brimPos.y, z + brimPos.z, 0.94 * scale, 0.10 * scale, 0.34 * scale, '#0f172a', yaw, pitch, roll, 0.08 + extraEm);
  const badgePos = transformLocalOffset(0, (mountY + 2.14 + capLift) * scale, 0.42 * scale, yaw, pitch, roll);
  batcher.addBox(x + badgePos.x, y + badgePos.y, z + badgePos.z, 0.28 * scale, 0.26 * scale, 0.12 * scale, '#facc15', yaw, pitch, roll, 0.72 + extraEm);
}

export function emitCopVisuals(batcher, cop, time = 0) {
  if (!cop || cop.wrecked) return;
  const x = cop.x || 0;
  const y = cop.y ?? (cop.type === 'heli' ? 18 : 0);
  const z = cop.z || 0;
  const yaw = cop.angle || 0;
  const pitch = cop.pitch || 0;
  const roll = cop.roll || 0;
  const scale = (cop.shrunkTimer || 0) > 0 ? 0.52 : cop.scale || 1.0;
  const wheelSpin = cop.wheelSpin ?? time * (cop.speed || 26) * 0.65;
  const seedOff = (cop.id ? String(cop.id).charCodeAt(0) : 0) * 0.37;
  const type = cop.type || 'cruiser';

  if (type === 'heli') {
    // 4-5 Star Police Helicopter at y = 18 with spinning rotor + translucent ground spotlight!
    const bobY = y + Math.sin(time * 3.8 + seedOff) * 0.45;
    const heliTilt = 0.12;
    const hParts = [
      // Skids
      part(-0.95, 0.15, 0, 0.14, 0.14, 3.6, '#334155'),
      part(0.95, 0.15, 0, 0.14, 0.14, 3.6, '#334155'),
      part(-0.72, 0.5, 0.8, 0.12, 0.65, 0.14, '#475569'),
      part(0.72, 0.5, 0.8, 0.12, 0.65, 0.14, '#475569'),
      part(-0.72, 0.5, -0.8, 0.12, 0.65, 0.14, '#475569'),
      part(0.72, 0.5, -0.8, 0.12, 0.65, 0.14, '#475569'),
      // Fuselage + white police band + bubble glass nose
      part(0, 1.35, 0.15, 2.05, 1.55, 3.55, '#0f172a'),
      part(0, 1.35, -0.1, 2.1, 0.48, 1.85, '#f8fafc'),
      part(0, 1.38, 1.42, 1.88, 1.25, 1.25, '#38bdf8', 0.25),
      // Tail boom + vertical fin + spinning tail rotor
      part(0, 1.48, -2.95, 0.58, 0.58, 3.2, '#0f172a'),
      part(0, 2.05, -4.35, 0.18, 1.15, 0.78, '#f8fafc'),
      // Belly spotlight pod
      part(0, 0.48, 1.15, 0.48, 0.36, 0.48, '#fef08a', 0.98),
      // Rotor mast
      part(0, 2.35, 0.1, 0.28, 0.56, 0.28, '#94a3b8'),
    ];
    emitPartList(batcher, hParts, x, bobY, z, yaw, heliTilt, roll, scale);

    // Fast-spinning 4-blade main rotor
    const rotorYaw = time * 24.0 + seedOff;
    const mastW = transformLocalOffset(0, 2.62 * scale, 0.1 * scale, yaw, heliTilt, roll);
    batcher.addBox(x + mastW.x, bobY + mastW.y, z + mastW.z, 7.8 * scale, 0.08 * scale, 0.42 * scale, '#cbd5e1', rotorYaw, 0, 0, 0.15);
    batcher.addBox(x + mastW.x, bobY + mastW.y, z + mastW.z, 0.42 * scale, 0.08 * scale, 7.8 * scale, '#cbd5e1', rotorYaw, 0, 0, 0.15);

    emitPoliceSirenBar(batcher, x, bobY, z, yaw, heliTilt, roll, scale, 0.52, -0.4, 1.4, time, seedOff);
    emitCopFriendCutout(batcher, cop, x, bobY, z, yaw, heliTilt, roll, scale, 2.15);

    // Translucent ground spotlight ring + inner disc right beneath helicopter!
    const groundSpotY = cop.groundY ?? 0.08;
    const spotRadius = 5.4;
    if (typeof batcher.addTranslucentBox === 'function') {
      batcher.addTranslucentBox(x, groundSpotY, z, spotRadius * 1.55, 0.06, spotRadius * 1.55, '#fef9c3', 0.24, time * 0.6);
      emitTranslucentRing(batcher, x, groundSpotY + 0.03, z, spotRadius, 12, '#fde047', 0.48);
    } else {
      emitRingSegments(batcher, x, groundSpotY + 0.04, z, spotRadius, 12, '#fef08a', 0.85);
    }
    return;
  }

  if (type === 'tank') {
    // 5-Star Military Tank: olive-drab armored hull, dual treads, rotating turret & cannon!
    const hullParts = [
      // Left & right armored treads + road wheels
      part(-1.34, 0.56, 0, 0.66, 1.04, 4.95, '#1c1917'),
      part(1.34, 0.56, 0, 0.66, 1.04, 4.95, '#1c1917'),
      part(-1.38, 0.52, 1.5, 0.72, 0.62, 0.62, '#44403c', 0, wheelSpin),
      part(-1.38, 0.52, 0, 0.72, 0.62, 0.62, '#44403c', 0, wheelSpin),
      part(-1.38, 0.52, -1.5, 0.72, 0.62, 0.62, '#44403c', 0, wheelSpin),
      part(1.38, 0.52, 1.5, 0.72, 0.62, 0.62, '#44403c', 0, wheelSpin),
      part(1.38, 0.52, 0, 0.72, 0.62, 0.62, '#44403c', 0, wheelSpin),
      part(1.38, 0.52, -1.5, 0.72, 0.62, 0.62, '#44403c', 0, wheelSpin),
      // Sloped olive-drab armored glacis & hull
      part(0, 1.02, 0, 2.38, 0.92, 4.65, '#4d5d3b'),
      part(0, 1.18, 1.95, 2.26, 0.52, 0.95, '#5c6f47', 0, 0.25),
      part(-0.82, 1.24, 2.28, 0.36, 0.22, 0.16, '#fef9c3', 0.85),
      part(0.82, 1.24, 2.28, 0.36, 0.22, 0.16, '#fef9c3', 0.85),
    ];
    emitPartList(batcher, hullParts, x, y, z, yaw, pitch, roll, scale);

    // Independently rotating turret + long high-velocity cannon barrel!
    const turretYaw = cop.turretAngle ?? yaw;
    const turretParts = [
      part(0, 1.82, -0.15, 1.86, 0.78, 2.15, '#3f4f30'),
      part(0, 2.28, -0.45, 0.78, 0.26, 0.78, '#29351f'),
      part(0, 1.86, 2.15, 0.34, 0.34, 3.15, '#27272a'),
      part(0, 1.86, 3.72, 0.48, 0.48, 0.46, '#18181b'),
    ];
    emitPartList(batcher, turretParts, x, y, z, turretYaw, pitch, roll, scale);
    emitPoliceSirenBar(batcher, x, y, z, turretYaw, pitch, roll, scale, 2.32, 0.42, 1.05, time, seedOff);
    emitCopFriendCutout(batcher, cop, x, y, z, turretYaw, pitch, roll, scale, 2.35);
    return;
  }

  if (type === 'swat') {
    const parts = [];
    addWheels(parts, 1.14, 1.48, -1.48, 0.48, 0.44, wheelSpin, '#475569');
    parts.push(part(0, 1.18, 0, 2.32, 1.46, 4.75, '#1e293b'));
    parts.push(part(0, 1.98, -0.15, 2.22, 0.78, 4.25, '#0f172a'));
    parts.push(part(0, 1.92, 1.98, 1.92, 0.48, 0.16, '#38bdf8', 0.2));
    // Heavy front battering ram
    parts.push(part(0, 0.72, 2.48, 2.28, 0.68, 0.32, '#09090b'));
    addLightsAndBumpers(parts, 1.12, 0.76, 2.38, '#334155');
    emitPartList(batcher, parts, x, y, z, yaw, pitch, roll, scale);
    emitPoliceSirenBar(batcher, x, y, z, yaw, pitch, roll, scale, 2.45, 1.25, 1.72, time, seedOff);
    emitCopFriendCutout(batcher, cop, x, y, z, yaw, pitch, roll, scale, 2.42);
    return;
  }

  if (type === 'army') {
    const parts = [];
    addWheels(parts, 1.16, 1.42, -1.42, 0.5, 0.46, wheelSpin, '#3f4f30');
    parts.push(part(0, 1.02, 0, 2.28, 0.92, 4.55, '#4d5d3b'));
    parts.push(part(0, 1.78, 0.55, 2.02, 0.82, 1.75, '#3f4f30'));
    parts.push(part(0, 1.78, 0.58, 2.06, 0.5, 1.32, '#1e293b'));
    parts.push(part(0, 1.72, -1.25, 2.12, 0.95, 1.85, '#65754e'));
    addLightsAndBumpers(parts, 1.1, 0.78, 2.28, '#27272a');
    emitPartList(batcher, parts, x, y, z, yaw, pitch, roll, scale);
    emitPoliceSirenBar(batcher, x, y, z, yaw, pitch, roll, scale, 2.26, 0.75, 1.45, time, seedOff);
    emitCopFriendCutout(batcher, cop, x, y, z, yaw, pitch, roll, scale, 2.28);
    return;
  }

  if (type === 'suv') {
    const parts = [];
    addWheels(parts, 1.1, 1.35, -1.35, 0.45, 0.42, wheelSpin, '#cbd5e1');
    parts.push(part(0, 0.86, 0, 2.18, 0.82, 4.38, '#0f172a'));
    parts.push(part(0, 0.88, 0, 2.22, 0.74, 1.85, '#f8fafc')); // white sheriff doors
    parts.push(part(0, 1.62, -0.22, 1.92, 0.78, 2.75, '#0f172a'));
    parts.push(part(0, 1.62, -0.2, 1.96, 0.52, 2.35, '#1e293b'));
    parts.push(part(0, 0.74, 2.28, 1.56, 0.58, 0.24, '#18181b')); // push bullbar
    addLightsAndBumpers(parts, 1.06, 0.72, 2.18, '#334155');
    emitPartList(batcher, parts, x, y, z, yaw, pitch, roll, scale);
    emitPoliceSirenBar(batcher, x, y, z, yaw, pitch, roll, scale, 2.08, 0.25, 1.58, time, seedOff);
    emitCopFriendCutout(batcher, cop, x, y, z, yaw, pitch, roll, scale, 2.08);
    return;
  }

  // Default 1-2 Star 'cruiser': iconic black-and-white Police Interceptor!
  const parts = [];
  addWheels(parts, 1.02, 1.24, -1.24, 0.4, 0.38, wheelSpin, '#cbd5e1');
  parts.push(part(0, 0.72, 0, 2.04, 0.68, 4.12, '#0f172a'));
  parts.push(part(0, 0.74, -0.05, 2.08, 0.64, 1.78, '#ffffff')); // white side doors
  parts.push(part(0, 1.4, -0.1, 1.76, 0.68, 1.98, '#ffffff')); // white roof
  parts.push(part(0, 1.38, -0.08, 1.8, 0.48, 1.58, '#1e293b'));
  parts.push(part(0, 0.68, 2.16, 1.35, 0.52, 0.22, '#18181b')); // front push bar
  addLightsAndBumpers(parts, 1.0, 0.68, 2.06, '#334155');
  emitPartList(batcher, parts, x, y, z, yaw, pitch, roll, scale);
  emitPoliceSirenBar(batcher, x, y, z, yaw, pitch, roll, scale, 1.8, -0.05, 1.48, time, seedOff);
  emitCopFriendCutout(batcher, cop, x, y, z, yaw, pitch, roll, scale, 1.85);
}

export function emitTrafficVisuals(batcher, car, time = 0) {
  if (!car) return;
  const x = car.x || 0;
  const y = car.y || 0;
  const z = car.z || 0;
  const yaw = car.angle || 0;
  const pitch = car.pitch || 0;
  const roll = car.roll || 0;
  const scale = car.scale || 1.0;
  const wheelSpin = car.wheelSpin ?? time * (car.speed || 16) * 0.6;
  const col = car.color || '#38bdf8';
  const type = car.type || 'sedan';

  if (type === 'bus') {
    const parts = [];
    addWheels(parts, 1.14, 2.35, -2.35, 0.48, 0.42, wheelSpin, '#cbd5e1');
    parts.push(part(0, 1.45, 0, 2.36, 2.05, 6.85, col));
    parts.push(part(0, 2.52, 0, 2.22, 0.18, 6.65, '#f8fafc'));
    parts.push(part(0, 1.72, 0.1, 2.4, 0.68, 5.95, '#1e293b'));
    addLightsAndBumpers(parts, 1.14, 0.68, 3.42, '#94a3b8');
    emitPartList(batcher, parts, x, y, z, yaw, pitch, roll, scale);
    return;
  }

  if (type === 'truck') {
    const parts = [];
    addWheels(parts, 1.12, 1.65, -1.65, 0.46, 0.42, wheelSpin, '#cbd5e1');
    // Cab + tall white cargo box
    parts.push(part(0, 1.18, 1.55, 2.16, 1.45, 1.75, col));
    parts.push(part(0, 1.45, 1.62, 2.2, 0.56, 1.25, '#1e293b'));
    parts.push(part(0, 1.58, -0.85, 2.34, 2.18, 3.35, '#f8fafc'));
    addLightsAndBumpers(parts, 1.06, 0.66, 2.44, '#64748b');
    emitPartList(batcher, parts, x, y, z, yaw, pitch, roll, scale);
    return;
  }

  if (type === 'taxi') {
    const parts = buildVehicleParts('sedan', '#facc15', '#18181b', wheelSpin);
    parts.push(part(0, 1.86, -0.05, 0.72, 0.26, 0.34, '#fef9c3', 0.85));
    emitPartList(batcher, parts, x, y, z, yaw, pitch, roll, scale);
    return;
  }

  const isOutlaw = Boolean(car.isOutlaw || car.isStreetRacer || car.outlaw || type === 'outlaw' || type === 'street_racer');
  if (isOutlaw || type === 'supercar' || type === 'muscle') {
    const baseVeh = type === 'muscle' ? 'muscle' : 'supercar';
    const accent = isOutlaw ? '#fde047' : (car.accentColor || '#f8fafc');
    const parts = buildVehicleParts(baseVeh, col, accent, wheelSpin);
    emitPartList(batcher, parts, x, y, z, yaw, pitch, roll, scale);
    if (isOutlaw) {
      // Pulsing crimson-gold outlaw target diamond above street racer so Solo Police Helis/Tanks spot them easily!
      const bob = Math.sin(time * 7.0 + x * 0.2) * 0.22;
      batcher.addBox(x, y + (2.75 + bob) * scale, z, 0.46 * scale, 0.46 * scale, 0.46 * scale, '#ef4444', time * 3.8, 0.65, 0.65, 0.95);
      emitNitroFlames(batcher, x, y, z, yaw, pitch, roll, scale, -2.12, time);
    }
    return;
  }

  const parts = buildVehicleParts(type === 'pickup' ? 'pickup' : 'sedan', col, '#f8fafc', wheelSpin);
  emitPartList(batcher, parts, x, y, z, yaw, pitch, roll, scale);
}

export function emitPropVisuals(batcher, prop, biomeId = 'city', time = 0) {
  if (!prop || prop.smashed) return;
  const x = prop.x;
  const y = prop.y || 0;
  const z = prop.z;
  const s = prop.scale || 1.0;
  const ry = prop.angle || 0;

  switch (prop.type) {
    case 'tree': {
      if (biomeId === 'snow') {
        // Snow-dusted alpine pine tree!
        batcher.addBox(x, y + 0.75 * s, z, 0.68 * s, 1.5 * s, 0.68 * s, '#78350f', ry);
        batcher.addBox(x, y + 2.1 * s, z, 2.65 * s, 1.35 * s, 2.65 * s, '#166534', ry);
        batcher.addBox(x, y + 2.82 * s, z, 2.7 * s, 0.22 * s, 2.7 * s, '#f8fafc', ry);
        batcher.addBox(x, y + 3.45 * s, z, 1.95 * s, 1.25 * s, 1.95 * s, '#15803d', ry);
        batcher.addBox(x, y + 4.12 * s, z, 2.0 * s, 0.2 * s, 2.0 * s, '#ffffff', ry);
        batcher.addBox(x, y + 4.65 * s, z, 1.15 * s, 1.05 * s, 1.15 * s, '#166534', ry);
        batcher.addBox(x, y + 5.22 * s, z, 1.2 * s, 0.22 * s, 1.2 * s, '#ffffff', ry);
      } else {
        // Vibrant Smashy Road stacked voxel leafy tree!
        batcher.addBox(x, y + 1.05 * s, z, 0.72 * s, 2.1 * s, 0.72 * s, '#854d0e', ry);
        batcher.addBox(x, y + 2.95 * s, z, 2.65 * s, 1.95 * s, 2.65 * s, '#22c55e', ry);
        batcher.addBox(x, y + 4.25 * s, z, 1.85 * s, 1.25 * s, 1.85 * s, '#4ade80', ry);
      }
      break;
    }

    case 'cactus': {
      batcher.addBox(x, y + 2.05 * s, z, 0.82 * s, 4.1 * s, 0.82 * s, '#16a34a', ry);
      const armL = transformLocalOffset(-0.75 * s, 2.25 * s, 0, ry);
      const armLUp = transformLocalOffset(-1.05 * s, 2.85 * s, 0, ry);
      const armR = transformLocalOffset(0.75 * s, 1.75 * s, 0, ry);
      const armRUp = transformLocalOffset(1.05 * s, 2.45 * s, 0, ry);
      batcher.addBox(x + armL.x, y + armL.y, z + armL.z, 0.85 * s, 0.52 * s, 0.52 * s, '#15803d', ry);
      batcher.addBox(x + armLUp.x, y + armLUp.y, z + armLUp.z, 0.52 * s, 1.25 * s, 0.52 * s, '#22c55e', ry);
      batcher.addBox(x + armR.x, y + armR.y, z + armR.z, 0.85 * s, 0.52 * s, 0.52 * s, '#15803d', ry);
      batcher.addBox(x + armRUp.x, y + armRUp.y, z + armRUp.z, 0.52 * s, 1.35 * s, 0.52 * s, '#22c55e', ry);
      break;
    }

    case 'snowman': {
      batcher.addBox(x, y + 0.65 * s, z, 1.45 * s, 1.3 * s, 1.45 * s, '#ffffff', ry);
      batcher.addBox(x, y + 1.72 * s, z, 1.08 * s, 0.98 * s, 1.08 * s, '#f8fafc', ry);
      batcher.addBox(x, y + 2.55 * s, z, 0.78 * s, 0.76 * s, 0.78 * s, '#ffffff', ry);
      const nose = transformLocalOffset(0, 2.55 * s, 0.52 * s, ry);
      batcher.addBox(x + nose.x, y + nose.y, z + nose.z, 0.18 * s, 0.18 * s, 0.45 * s, '#f97316', ry);
      batcher.addBox(x, y + 3.02 * s, z, 0.92 * s, 0.14 * s, 0.92 * s, '#18181b', ry);
      batcher.addBox(x, y + 3.35 * s, z, 0.62 * s, 0.56 * s, 0.62 * s, '#18181b', ry);
      break;
    }

    case 'fence': {
      const p1 = transformLocalOffset(-1.6 * s, 0.65 * s, 0, ry);
      const p2 = transformLocalOffset(1.6 * s, 0.65 * s, 0, ry);
      batcher.addBox(x + p1.x, y + p1.y, z + p1.z, 0.28 * s, 1.3 * s, 0.28 * s, '#ffffff', ry);
      batcher.addBox(x + p2.x, y + p2.y, z + p2.z, 0.28 * s, 1.3 * s, 0.28 * s, '#ffffff', ry);
      batcher.addBox(x, y + 0.45 * s, z, 3.65 * s, 0.22 * s, 0.18 * s, '#f8fafc', ry);
      batcher.addBox(x, y + 0.96 * s, z, 3.65 * s, 0.22 * s, 0.18 * s, '#f8fafc', ry);
      break;
    }

    case 'hydrant': {
      batcher.addBox(x, y + 0.52 * s, z, 0.56 * s, 1.04 * s, 0.56 * s, '#ef4444', ry);
      batcher.addBox(x, y + 1.12 * s, z, 0.42 * s, 0.22 * s, 0.42 * s, '#cbd5e1', ry);
      batcher.addBox(x, y + 0.72 * s, z, 0.86 * s, 0.22 * s, 0.22 * s, '#cbd5e1', ry);
      break;
    }

    case 'streetlight': {
      batcher.addBox(x, y + 3.0 * s, z, 0.26 * s, 6.0 * s, 0.26 * s, '#334155', ry);
      const arm = transformLocalOffset(0, 5.95 * s, 0.95 * s, ry);
      const bulb = transformLocalOffset(0, 5.75 * s, 1.65 * s, ry);
      batcher.addBox(x + arm.x, y + arm.y, z + arm.z, 0.22 * s, 0.22 * s, 1.95 * s, '#475569', ry);
      batcher.addBox(x + bulb.x, y + bulb.y, z + bulb.z, 0.56 * s, 0.28 * s, 0.56 * s, '#fef08a', ry, 0, 0, 0.88);
      break;
    }

    case 'crate': {
      batcher.addBox(x, y + 0.72 * s, z, 1.44 * s, 1.44 * s, 1.44 * s, '#d97706', ry);
      batcher.addBox(x, y + 0.72 * s, z, 1.5 * s, 0.22 * s, 1.5 * s, '#92400e', ry);
      break;
    }

    case 'cone': {
      batcher.addBox(x, y + 0.08 * s, z, 0.82 * s, 0.16 * s, 0.82 * s, '#ea580c', ry);
      batcher.addBox(x, y + 0.42 * s, z, 0.52 * s, 0.56 * s, 0.52 * s, '#f97316', ry);
      batcher.addBox(x, y + 0.62 * s, z, 0.54 * s, 0.18 * s, 0.54 * s, '#ffffff', ry);
      batcher.addBox(x, y + 0.86 * s, z, 0.28 * s, 0.34 * s, 0.28 * s, '#f97316', ry);
      break;
    }

    case 'gas_pump': {
      // Explosive red/white fuel pump island unit!
      batcher.addBox(x, y + 0.12, z, 1.95, 0.24, 1.35, '#94a3b8', ry);
      batcher.addBox(x, y + 1.25, z, 1.15, 2.05, 0.78, '#dc2626', ry);
      batcher.addBox(x, y + 1.55, z, 0.88, 0.62, 0.84, '#f8fafc', ry, 0, 0, 0.25);
      const pulse = 0.55 + Math.sin(time * 5) * 0.25;
      batcher.addBox(x, y + 2.52, z, 0.72, 0.46, 0.32, '#fde047', ry, 0, 0, pulse);
      break;
    }

    case 'bench': {
      batcher.addBox(x, y + 0.42 * s, z, 1.9 * s, 0.16 * s, 0.65 * s, '#92400e', ry);
      batcher.addBox(x, y + 0.75 * s, z - 0.24 * s, 1.9 * s, 0.5 * s, 0.14 * s, '#b45309', ry);
      break;
    }

    case 'ramp': {
      const rw = prop.w || 7.6;
      const rlen = prop.length || 12.5;
      const rh = prop.height || 3.6;
      const slope = Math.atan2(rh, rlen);
      batcher.addBox(x, y + rh * 0.5, z, rw, 0.36, Math.hypot(rlen, rh), '#334155', ry, -slope, 0);
      batcher.addBox(x, y + rh * 0.55, z, rw * 0.72, 0.06, 1.2, '#facc15', ry, -slope, 0, 0.45);
      break;
    }

    case 'gas_station': {
      batcher.addBox(x, y + 5.45, z, 18.0, 0.65, 11.0, '#dc2626', ry);
      batcher.addBox(x, y + 5.83, z, 18.3, 0.22, 11.3, '#ffffff', ry, 0, 0, 0.3);
      break;
    }

    case 'stunt_jet': {
      // Blocky Colorful 3D Voxel Stunt Jet parked on Airport Runways!
      const jCol = prop.color || '#ef4444';
      const jetParts = [
        // Landing gear struts & tires
        part(0, 0.35, 1.85, 0.28, 0.52, 0.36, '#18181b'),
        part(-1.05, 0.35, -0.65, 0.32, 0.52, 0.42, '#18181b'),
        part(1.05, 0.35, -0.65, 0.32, 0.52, 0.42, '#18181b'),
        // Sleek fuselage + white racing stripe + pointed nosecone
        part(0, 1.18, 0, 1.38, 1.08, 5.45, jCol),
        part(0, 1.24, 0.1, 1.44, 0.24, 5.2, '#ffffff', 0.15),
        part(0, 1.14, 3.15, 0.86, 0.72, 1.15, '#f8fafc'),
        part(0, 1.12, 3.88, 0.44, 0.44, 0.55, '#fde047', 0.55),
        // Swept delta wings + wingtip stunt smoke pods
        part(0, 1.12, -0.35, 6.25, 0.18, 1.85, jCol),
        part(-3.18, 1.14, -0.25, 0.28, 0.28, 2.25, '#facc15', 0.45),
        part(3.18, 1.14, -0.25, 0.28, 0.28, 2.25, '#facc15', 0.45),
        // Glowing cyan bubble canopy
        part(0, 1.88, 0.95, 0.98, 0.62, 1.95, '#38bdf8', 0.38),
        // Twin angled vertical tail fins + afterburner glow
        part(-0.56, 2.08, -2.25, 0.18, 1.15, 1.08, '#ffffff', 0.1, 0, 0, -0.18),
        part(0.56, 2.08, -2.25, 0.18, 1.15, 1.08, '#ffffff', 0.1, 0, 0, 0.18),
        part(0, 1.18, -2.85, 0.82, 0.72, 0.42, '#fb923c', 0.88),
      ];
      emitPartList(batcher, jetParts, x, y, z, ry, 0, 0, s);
      break;
    }

    default: {
      batcher.addBox(x, y + 0.75, z, 1.2, 1.5, 1.2, prop.color || '#94a3b8', ry);
      break;
    }
  }
}

export function emitItemBoxVisuals(batcher, box, time = 0) {
  if (!box || box.collected) return;

  const phase = box.phase || 0;
  const baseY = box.y || 0;

  if (box.boxType === 'sugar') {
    // Dedicated 3x Sugar Mystery Box: Cotton-Candy Pink (#f472b6) & Electric Cyan (#22d3ee) fast-spinning cube + orbiting sparkles!
    const spin = box.spinAngle ?? time * 3.1 + phase;
    const bob = box.bobOffset ?? Math.sin(time * 4.4 + phase) * 0.34;
    const cy = baseY + 1.72 + bob;
    const pulsePink = Math.sin(time * 7.5 + phase) >= 0;
    const glowPrimary = '#f472b6';
    const glowSecondary = '#22d3ee';

    if (typeof batcher.addTranslucentBox === 'function') {
      batcher.addTranslucentBox(box.x, baseY + 0.05, box.z, 2.15, 0.07, 2.15, glowPrimary, 0.52, spin);
      batcher.addTranslucentBox(box.x, baseY + 0.08, box.z, 1.38, 0.06, 1.38, glowSecondary, 0.56, -spin * 1.3);
    } else {
      batcher.addBox(box.x, baseY + 0.05, box.z, 1.75, 0.06, 1.75, glowPrimary, spin, 0, 0, 0.85);
    }

    batcher.addTexturedBox({
      avatarId: '__item_sugar__',
      x: box.x,
      y: cy,
      z: box.z,
      sx: 1.78,
      sy: 1.78,
      sz: 1.78,
      yaw: spin,
      pitch: 0.58,
      roll: 0.58,
      tint: pulsePink ? '#fbcfe8' : '#a5f3fc',
      emissive: 0.78,
    });

    // Orbiting mini candy-cube sparkles!
    const sparkleCols = ['#f472b6', '#22d3ee', '#fde047', '#ffffff'];
    for (let i = 0; i < 4; i++) {
      const a = time * 4.8 + phase + (i * Math.PI * 0.5);
      const sx = box.x + Math.cos(a) * 1.55;
      const sz = box.z + Math.sin(a) * 1.55;
      const sy = cy + Math.sin(time * 7.2 + i * 1.6) * 0.42;
      batcher.addBox(sx, sy, sz, 0.32, 0.32, 0.32, sparkleCols[i], a * 2, time * 5, 0, 1.0);
    }
    return;
  }

  const spin = box.spinAngle ?? time * 1.9 + phase;
  const bob = box.bobOffset ?? Math.sin(time * 3.4 + phase) * 0.32;
  const cy = baseY + 1.65 + bob;
  const rainbowTint = hslToHex((time * 0.55 + phase * 0.18) % 1, 0.9, 0.68);

  // Glowing rainbow shadow pad on road/ramp below box
  if (typeof batcher.addTranslucentBox === 'function') {
    batcher.addTranslucentBox(box.x, baseY + 0.05, box.z, 1.75, 0.06, 1.75, rainbowTint, 0.42, spin);
  } else {
    batcher.addBox(box.x, baseY + 0.05, box.z, 1.45, 0.06, 1.45, rainbowTint, spin, 0, 0, 0.65);
  }

  // Spinning tilted diamond Mario Kart ? block using generated '__item_question__' texture!
  batcher.addTexturedBox({
    avatarId: '__item_question__',
    x: box.x,
    y: cy,
    z: box.z,
    sx: 1.68,
    sy: 1.68,
    sz: 1.68,
    yaw: spin,
    pitch: 0.52,
    roll: 0.52,
    tint: rainbowTint,
    emissive: 0.62,
  });
}

function emitRingSegments(batcher, cx, cy, cz, radius, segments, color, emissive = 0.8) {
  const segLen = ((Math.PI * 2 * radius) / segments) * 1.06;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const rx = cx + Math.sin(a) * radius;
    const rz = cz + Math.cos(a) * radius;
    batcher.addBox(rx, cy, rz, segLen, 0.32, 0.36, color, a, 0, 0, emissive);
  }
}

function emitTranslucentRing(batcher, cx, cy, cz, radius, segments, color, alpha = 0.45) {
  const segLen = ((Math.PI * 2 * radius) / segments) * 1.08;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const rx = cx + Math.sin(a) * radius;
    const rz = cz + Math.cos(a) * radius;
    batcher.addTranslucentBox(rx, cy, rz, segLen, 0.08, 0.42, color, alpha, a);
  }
}

export function emitProjectileVisuals(batcher, proj, time = 0) {
  if (!proj) return;
  const x = proj.x || 0;
  const y = proj.y ?? 0.6;
  const z = proj.z || 0;
  const yaw = proj.angle || 0;
  const type = proj.type || 'homing_rocket';

  switch (type) {
    case 'tactical_nuke': {
      // Heavy Sky-Drop Tactical Nuclear Warhead with Yellow/Black Hazard Stripes, Glowing Lime Core & Ground Target Ring!
      const spin = time * 8.0;
      const ny = Math.max(0.8, y);
      const groundY = proj.targetY ?? 0;
      const pulse = 0.72 + Math.sin(time * 22) * 0.28;
      // Pulsing ground impact warning bullseye
      emitTranslucentRing(batcher, x, groundY + 0.1, z, 11.5 * pulse, 20, '#84cc16', 0.48);
      emitTranslucentRing(batcher, x, groundY + 0.14, z, 5.2, 14, '#ef4444', 0.62);
      // Falling 3D nuclear bomb casing (vertical orientation, nose pointing down)
      batcher.addBox(x, ny, z, 1.65, 3.4, 1.65, '#18181b', spin, 0, 0, 0.12);
      batcher.addBox(x, ny + 0.6, z, 1.74, 0.52, 1.74, '#facc15', spin, 0, 0, 0.55);
      batcher.addBox(x, ny - 0.55, z, 1.74, 0.46, 1.74, '#84cc16', spin, 0, 0, 0.95);
      // Red warhead nosecone pointing downward
      batcher.addBox(x, ny - 2.05, z, 1.15, 0.95, 1.15, '#ef4444', spin, 0, 0, 0.85);
      batcher.addBox(x, ny - 2.65, z, 0.55, 0.45, 0.55, '#fef08a', spin, 0, 0, 1.0);
      // 4 Stabilizer tail fins at top
      batcher.addBox(x, ny + 1.85, z, 3.1, 1.05, 0.24, '#334155', spin, 0, 0, 0.2);
      batcher.addBox(x, ny + 1.85, z, 0.24, 1.05, 3.1, '#334155', spin, 0, 0, 0.2);
      // Glowing radioactive exhaust trail above bomb
      batcher.addBox(x, ny + 3.2, z, 0.85, 2.2, 0.85, '#bef264', spin, 0, 0, 1.0);
      break;
    }

    case 'nuke_cloud': {
      // Towering Animated 3D Voxel Mushroom Cloud + Expanding Nuclear Shockwave Ring!
      const maxTtl = proj.maxTtl || 4.4;
      const ttl = Math.max(0, proj.ttl ?? 2.2);
      const prog = Math.max(0, Math.min(1, 1 - ttl / maxTtl));
      const grow = Math.min(1, prog * 2.4);
      const fade = ttl < 1.1 ? Math.max(0.15, ttl / 1.1) : 1.0;
      const baseY = proj.y ?? 0;
      const stemH = (8 + grow * 26) * (0.65 + fade * 0.35);
      const stemW = (4.8 + grow * 3.4) * (0.7 + fade * 0.3);
      const capY = baseY + stemH;
      const capW = (10 + grow * 19) * (0.7 + fade * 0.3);
      const capH = (6 + grow * 8.5) * (0.7 + fade * 0.3);
      const rot = time * 0.7;

      // Blinding fiery base skirt
      batcher.addBox(x, baseY + 2.4, z, stemW * 2.25, 4.8, stemW * 2.25, '#fb923c', rot, 0, 0, 0.92 * fade);
      // Rising glowing nuclear stem
      batcher.addBox(x, baseY + stemH * 0.45, z, stemW, stemH * 0.9, stemW, '#fde047', -rot * 0.6, 0, 0, 0.96 * fade);
      batcher.addBox(x, baseY + stemH * 0.52, z, stemW * 1.25, stemH * 0.34, stemW * 1.25, '#f97316', rot * 1.1, 0, 0, 0.85 * fade);
      // Massive billowing mushroom cap (multi-tier voxel dome + radioactive lime halo)
      batcher.addBox(x, capY, z, capW, capH * 0.78, capW, '#f97316', rot * 0.5, 0, 0, 0.92 * fade);
      batcher.addBox(x, capY + capH * 0.44, z, capW * 0.78, capH * 0.62, capW * 0.78, '#fef08a', -rot * 0.4, 0, 0, 1.0 * fade);
      batcher.addBox(x, capY + capH * 0.82, z, capW * 0.46, capH * 0.36, capW * 0.46, '#ffffff', rot * 0.3, 0, 0, 1.0 * fade);
      batcher.addBox(x, capY - capH * 0.32, z, capW * 1.12, capH * 0.28, capW * 1.12, '#84cc16', -rot * 0.8, 0, 0, 0.95 * fade);
      // Condensation ring around stem
      emitRingSegments(batcher, x, baseY + stemH * 0.62, z, stemW * 1.65, 16, '#fef08a', 0.9 * fade);
      // Huge expanding ground nuclear shockwave ring!
      const shockR = proj.radius ?? Math.min(65, 6 + prog * 68);
      if (prog < 0.78) {
        emitRingSegments(batcher, x, baseY + 1.1, z, shockR, 24, '#f97316', 0.98 * fade);
        emitTranslucentRing(batcher, x, baseY + 0.16, z, shockR, 24, '#84cc16', 0.55 * fade);
      }
      break;
    }

    case 'cop_missile': {
      // Sleek Tactical White/Crimson Finned Police Missile (Heli Air-to-Ground & Tank Cannon) + Glowing Cyan/Amber Exhaust!
      const rollSpin = time * 18.0;
      const flicker = 0.85 + Math.sin(time * 70) * 0.32;
      const horizSpd = Math.hypot(proj.vx || 0, proj.vz || 0) || proj.speed || 64;
      const mPitch = proj.pitch ?? (proj.vy ? clamp(-Math.atan2(proj.vy, horizSpd), -0.65, 0.65) : 0);
      const my = Math.max(0.45, y);
      const missileParts = [
        // Crisp white tactical missile fuselage + crimson & navy police markings
        part(0, 0, 0, 0.34, 0.34, 1.86, '#f8fafc', 0.28, 0, 0, rollSpin),
        part(0, 0, 0.52, 0.37, 0.37, 0.24, '#dc2626', 0.55, 0, 0, rollSpin),
        part(0, 0, -0.18, 0.36, 0.36, 0.22, '#1e3a8a', 0.32, 0, 0, rollSpin),
        // Forward guidance canards + 4 cruciform crimson tail stabilizer fins
        part(0, 0, 0.38, 0.72, 0.08, 0.26, '#ef4444', 0.48, 0, 0, rollSpin),
        part(0, 0, 0.38, 0.08, 0.72, 0.26, '#ef4444', 0.48, 0, 0, rollSpin),
        part(0, 0, -0.78, 1.12, 0.09, 0.46, '#dc2626', 0.42, 0, 0, rollSpin),
        part(0, 0, -0.78, 0.09, 1.12, 0.46, '#dc2626', 0.42, 0, 0, rollSpin),
        // Crimson warhead nosecone + glowing cyan optical seeker tip
        part(0, 0, 1.08, 0.42, 0.42, 0.54, '#ef4444', 0.84, 0, 0, rollSpin),
        part(0, 0, 1.42, 0.22, 0.22, 0.30, '#22d3ee', 1.0, 0, 0, rollSpin),
        // Glowing electric-cyan inner Mach core + blazing golden-amber rocket exhaust plume!
        part(0, 0, -1.16, 0.30, 0.30, 0.72 * flicker, '#22d3ee', 1.0),
        part(0, 0, -1.68 * flicker, 0.46, 0.46, 1.32 * flicker, '#f59e0b', 0.98),
      ];
      emitPartList(batcher, missileParts, x, my, z, yaw, mPitch, 0, 1.0);
      break;
    }

    case 'rpg_rocket':
    case 'homing_rocket': {
      // Sleek 3D Olive/Steel RPG Rocket Tube, Stabilizer Fins, Glowing Red-Gold Warhead & Twin-Stage Thruster Plume!
      const rollSpin = time * 16.0;
      const flicker = 0.85 + Math.sin(time * 64) * 0.3;
      const ry = Math.max(0.45, y + 0.35);
      const rocketParts = [
        // Olive-drab & gunmetal steel rocket motor body
        part(0, 0, 0, 0.42, 0.42, 1.72, '#4d5d3b', 0.12, 0, 0, rollSpin),
        part(0, 0, 0.32, 0.46, 0.46, 0.24, '#facc15', 0.35, 0, 0, rollSpin),
        part(0, 0, -0.58, 0.45, 0.45, 0.34, '#334155', 0.1, 0, 0, rollSpin),
        // 4 Cruciform tail stabilizer fins
        part(0, 0, -0.78, 1.18, 0.1, 0.48, '#94a3b8', 0.15, 0, 0, rollSpin),
        part(0, 0, -0.78, 0.1, 1.18, 0.48, '#94a3b8', 0.15, 0, 0, rollSpin),
        // Shaped-charge crimson RPG warhead + glowing gold nose tip!
        part(0, 0, 1.02, 0.6, 0.6, 0.68, '#ef4444', 0.68, 0, 0, rollSpin),
        part(0, 0, 1.46, 0.28, 0.28, 0.38, '#fef08a', 1.0, 0, 0, rollSpin),
        // Roaring twin-stage white-yellow inner core & blazing orange outer thruster plume!
        part(0, 0, -1.16, 0.34, 0.34, 0.68 * flicker, '#fef08a', 1.0),
        part(0, 0, -1.68 * flicker, 0.52, 0.52, 1.25 * flicker, '#f97316', 0.98),
      ];
      emitPartList(batcher, rocketParts, x, ry, z, yaw, 0, 0, 1.0);
      break;
    }

    case 'shell': {
      // Classic spinning Red Shell fallback
      const spin = time * 15.0;
      batcher.addBox(x, y + 0.12, z, 1.56, 0.26, 1.56, '#f8fafc', spin, 0, 0, 0.25);
      batcher.addBox(x, y + 0.48, z, 1.38, 0.68, 1.38, '#ef4444', spin, 0, 0, 0.48);
      batcher.addBox(x, y + 0.88, z, 0.92, 0.24, 0.92, '#dc2626', spin, 0, 0, 0.48);
      const flame = transformLocalOffset(0, 0.35, -1.05, yaw);
      batcher.addBox(x + flame.x, y + flame.y, z + flame.z, 0.45, 0.45, 0.85, '#fb923c', yaw, 0, 0, 0.98);
      break;
    }

    case 'banana':
    case 'banana_bunch': {
      // Giant bright yellow 3D splayed Banana Peel!
      const by = Math.max(0.05, proj.y || 0);
      batcher.addBox(x, by + 0.55, z, 0.52, 0.95, 0.52, '#facc15', yaw, 0.18, 0, 0.22);
      batcher.addBox(x, by + 1.08, z, 0.32, 0.24, 0.32, '#78350f', yaw, 0, 0, 0);
      for (let i = 0; i < 3; i++) {
        const pa = yaw + (i * Math.PI * 2) / 3;
        const px = x + Math.sin(pa) * 0.58;
        const pz = z + Math.cos(pa) * 0.58;
        batcher.addBox(px, by + 0.14, pz, 0.42, 0.18, 0.95, '#eab308', pa, 0.22, 0, 0.2);
      }
      break;
    }

    case 'bomb':
    case 'bomb_toss':
    case 'bobomb': {
      // Ticking Bob-omb with wind-up golden key & sparking fuse!
      const urgent = (proj.ttl ?? 2.0) < 0.75 && Math.floor(time * 18) % 2 === 0;
      const bodyCol = urgent ? '#ef4444' : '#18181b';
      const by = Math.max(0.55, y);
      batcher.addBox(x, by + 0.45, z, 1.45, 1.38, 1.45, bodyCol, yaw, 0, 0, urgent ? 0.7 : 0.08);
      // White eyes
      const eyeL = transformLocalOffset(-0.32, 0.55, 0.72, yaw);
      const eyeR = transformLocalOffset(0.32, 0.55, 0.72, yaw);
      batcher.addBox(x + eyeL.x, by + eyeL.y, z + eyeL.z, 0.22, 0.42, 0.1, '#ffffff', yaw, 0, 0, 0.5);
      batcher.addBox(x + eyeR.x, by + eyeR.y, z + eyeR.z, 0.22, 0.42, 0.1, '#ffffff', yaw, 0, 0, 0.5);
      // Wind-up golden key on back
      const keyPos = transformLocalOffset(0, 0.48, -0.92, yaw);
      batcher.addBox(x + keyPos.x, by + keyPos.y, z + keyPos.z, 0.16, 0.78, 0.52, '#facc15', yaw, time * 8, 0, 0.35);
      // Sparking fuse on top
      batcher.addBox(x, by + 1.32, z, 0.22, 0.48, 0.22, '#e2e8f0', yaw);
      const sparkScale = 0.36 + Math.sin(time * 40) * 0.16;
      batcher.addBox(x, by + 1.68, z, sparkScale, sparkScale, sparkScale, '#fef08a', time * 12, time * 9, 0, 1.0);
      break;
    }

    case 'tank_shell': {
      batcher.addBox(x, y, z, 0.48, 0.48, 1.28, '#f59e0b', yaw, 0, 0, 0.85);
      const tail = transformLocalOffset(0, 0, -0.95, yaw);
      batcher.addBox(x + tail.x, y + tail.y, z + tail.z, 0.36, 0.36, 0.95, '#ef4444', yaw, 0, 0, 1.0);
      break;
    }

    case 'heli_bomb': {
      const pulse = Math.floor(time * 16) % 2 === 0;
      batcher.addBox(x, Math.max(0.4, y), z, 1.05, 1.35, 1.05, pulse ? '#ef4444' : '#facc15', time * 6, 0.3, 0, 0.75);
      emitTranslucentRing(batcher, x, 0.08, z, proj.blastRadius ? Math.min(8.5, proj.blastRadius * 0.75) : 5.5, 14, '#ef4444', 0.42);
      break;
    }

    case 'target_ring': {
      const r = Math.max(1.8, proj.radius ?? 5.5);
      emitTranslucentRing(batcher, x, 0.09, z, r, 16, proj.color || '#ef4444', 0.52);
      break;
    }

    case 'shockwave':
    case 'super_horn': {
      const r = proj.radius ?? 9.5;
      emitRingSegments(batcher, x, Math.max(0.5, y), z, r, 18, '#a855f7', 0.95);
      emitRingSegments(batcher, x, Math.max(0.9, y + 0.4), z, r * 0.78, 14, '#38bdf8', 0.95);
      break;
    }

    case 'lightning':
    case 'lightning_zap': {
      // Towering jagged 3D electric lightning bolt from sky to ground!
      const baseY = proj.targetY ?? 0;
      for (let seg = 0; seg < 7; seg++) {
        const sy = baseY + 1.2 + seg * 2.4;
        const jagX = (seg % 2 === 0 ? -0.55 : 0.55) * (1 - seg * 0.08);
        batcher.addBox(x + jagX, sy, z, 0.52, 2.85, 0.52, seg % 2 === 0 ? '#fef08a' : '#38bdf8', 0, 0, seg % 2 === 0 ? 0.36 : -0.36, 1.0);
      }
      emitRingSegments(batcher, x, baseY + 0.25, z, 3.4, 10, '#38bdf8', 1.0);
      break;
    }

    default: {
      batcher.addBox(x, y, z, 0.9, 0.9, 0.9, proj.color || '#ef4444', yaw, 0, 0, 0.75);
      break;
    }
  }
}
