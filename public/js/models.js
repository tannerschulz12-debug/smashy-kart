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
};

const VEHICLE_HOOD_POS = {
  sedan: { y: 1.22, z: 1.38 },
  muscle: { y: 1.24, z: 1.55 },
  kart: { y: 0.78, z: 1.22 },
  supercar: { y: 1.02, z: 1.52 },
  monster: { y: 1.92, z: 1.48 },
  convertible: { y: 1.12, z: 1.42 },
  van: { y: 1.55, z: 1.92 },
  pickup: { y: 1.42, z: 1.55 },
  f1: { y: 0.74, z: 1.55 },
  mini: { y: 1.15, z: 1.05 },
  dozer: { y: 1.68, z: 1.15 },
  gold: { y: 1.24, z: 1.65 },
};

export function buildVehicleParts(vehicleId = 'sedan', primaryColor = '#ef4444', accentColor = '#fef08a', wheelSpin = 0) {
  const parts = [];
  const pCol = primaryColor || '#ef4444';
  const aCol = accentColor || '#fef08a';
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
      addWheels(parts, 0.94, 0.95, -0.95, 0.42, 0.38, wheelSpin, aCol);
      // Cute compact pocket buggy body
      parts.push(part(0, 0.74, 0, 1.82, 0.68, 2.95, pCol));
      parts.push(part(0, 1.38, -0.08, 1.56, 0.66, 1.82, aCol));
      parts.push(part(0, 1.36, -0.06, 1.6, 0.46, 1.46, glass));
      // Bug-eye round headlights & RC spring antenna!
      parts.push(part(-0.58, 0.92, 1.48, 0.38, 0.38, 0.2, '#fef9c3', 0.92));
      parts.push(part(0.58, 0.92, 1.48, 0.38, 0.38, 0.2, '#fef9c3', 0.92));
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
  const spinExtra = (player.spinoutTimer || 0) > 0 ? (player.spinoutTimer || 0) * 14.0 : 0;
  const yaw = (player.angle || 0) + spinExtra;
  const vx = player.vx || 0;
  const vz = player.vz || 0;
  const vy = player.vy || 0;
  const speed = player.speed ?? Math.hypot(vx, vz);

  const { starTimer, megaTimer, shrunkTimer, boostTimer, shockwaveTimer } = getBuffTimers(player);

  let scale =
    player.isLocal === false && player.scale
      ? player.scale
      : player.scaleMult || player.scale || 1.0;
  if (player.isLocal !== false) {
    if (megaTimer > 0) scale *= 2.3;
    if (shrunkTimer > 0) scale *= 0.52;
  }

  const steerVal = player.steer ?? player.steerInput ?? 0;
  const driftRoll = clamp(-steerVal * (player.drifting ? 0.2 : 0.11), -0.24, 0.24);
  const airPitch = y > 0.25 ? clamp(-vy * 0.024, -0.38, 0.38) : 0;

  const isStar = starTimer > 0;
  const rainbowPrimary = isStar ? hslToHex((time * 3.4) % 1, 0.95, 0.56) : null;
  const rainbowAccent = isStar ? hslToHex((time * 3.4 + 0.38) % 1, 0.95, 0.68) : null;
  const starEmissive = isStar ? 0.42 : 0;

  const pColor = rainbowPrimary || player.primaryColor || '#ef4444';
  const aColor = rainbowAccent || player.accentColor || '#fef08a';
  const avatarId = player.avatarId || 'default_hero';
  const wheelSpin = player.wheelSpin ?? time * speed * 0.65;
  const mode = player.characterMode || 'car_driver';

  if (mode === 'runner') {
    // MODE 3: "Just Myself (On Foot)" — sprinting 3D blocky character with custom photo head & torso!
    const moving = speed > 1.2;
    const stride = moving ? time * Math.max(9.0, speed * 0.42) : time * 2.0;
    const swing = moving ? Math.sin(stride) * 0.85 : Math.sin(stride) * 0.06;
    const bounce = moving ? Math.abs(Math.sin(stride)) * 0.24 * scale : 0;
    const leanPitch = clamp(speed * 0.0065, 0, 0.28) + airPitch;

    const baseY = y + bounce;

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

    // Pumping arms (opposite phase to legs)
    for (const side of [-1, 1]) {
      const armSwing = -side * swing;
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
        0.88 * scale,
        0.34 * scale,
        pColor,
        yaw,
        leanPitch + armSwing * 0.85,
        driftRoll,
        starEmissive
      );
    }

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

    // Large prominent custom photo cutout head!
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

    if (boostTimer > 0) {
      emitNitroFlames(batcher, x, baseY, z, yaw, 0, driftRoll, scale, -0.45, time);
    }
  } else if (mode === 'photo_car') {
    // MODE 2: "Look Like a Car" — rolling 3D photo-car chassis where player's photo IS the sculpted body!
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

    // Roof photo crest topper so face pops even from overhead angles!
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

    if (boostTimer > 0) {
      emitNitroFlames(batcher, x, y, z, yaw, airPitch, driftRoll, scale, -2.18, time);
    }
  } else {
    // MODE 1: "car_driver" ("People on Car") — 3D voxel vehicle + big roof cutout + hood photo decal!
    const vehicleId = player.vehicleId || 'sedan';
    const vParts = buildVehicleParts(vehicleId, pColor, aColor, wheelSpin);
    emitPartList(batcher, vParts, x, y, z, yaw, airPitch, driftRoll, scale, rainbowPrimary, starEmissive);

    // Cockpit sunroof collar rim
    const roofY = VEHICLE_ROOF_Y[vehicleId] ?? 1.92;
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

    // Large prominent custom photo cutout sticking proudly out of the roof/cockpit!
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

    // Custom photo hood badge on the front hood!
    const hoodMeta = VEHICLE_HOOD_POS[vehicleId] || VEHICLE_HOOD_POS.sedan;
    const hoodPos = transformLocalOffset(0, hoodMeta.y * scale, hoodMeta.z * scale, yaw, airPitch, driftRoll);
    batcher.addTexturedCard({
      avatarId,
      x: x + hoodPos.x,
      y: y + hoodPos.y,
      z: z + hoodPos.z,
      width: 1.05 * scale,
      height: 1.05 * scale,
      yaw,
      pitch: -Math.PI * 0.46 + airPitch,
      roll: driftRoll,
      billboard: 'none',
      tint: '#ffffff',
      emissive: 0.16 + starEmissive,
    });

    if (boostTimer > 0) {
      emitNitroFlames(batcher, x, y, z, yaw, airPitch, driftRoll, scale, -2.15, time);
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

function emitCopFriendCutout(batcher, cop, x, y, z, yaw, pitch, roll, scale, mountY) {
  if (!cop.avatarId) return;
  const cutPos = transformLocalOffset(0, (mountY + 0.98) * scale, -0.05 * scale, yaw, pitch, roll);
  batcher.addTexturedCard({
    avatarId: cop.avatarId,
    x: x + cutPos.x,
    y: y + cutPos.y,
    z: z + cutPos.z,
    width: 2.1 * scale,
    height: 2.1 * scale,
    yaw,
    pitch: pitch * 0.4,
    roll: roll * 1.2,
    billboard: 'y_blend',
    tint: '#ffffff',
    emissive: 0.2,
  });
  // Cute 3D voxel police cap + gold badge perched on top of friend's cutout!
  const capPos = transformLocalOffset(0, (mountY + 2.08) * scale, -0.05 * scale, yaw, pitch, roll);
  batcher.addBox(x + capPos.x, y + capPos.y, z + capPos.z, 0.95 * scale, 0.26 * scale, 0.85 * scale, '#1e3a8a', yaw, pitch, roll, 0.1);
  const badgePos = transformLocalOffset(0, (mountY + 2.12) * scale, 0.36 * scale, yaw, pitch, roll);
  batcher.addBox(x + badgePos.x, y + badgePos.y, z + badgePos.z, 0.26 * scale, 0.24 * scale, 0.12 * scale, '#facc15', yaw, pitch, roll, 0.65);
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

    default: {
      batcher.addBox(x, y + 0.75, z, 1.2, 1.5, 1.2, prop.color || '#94a3b8', ry);
      break;
    }
  }
}

export function emitItemBoxVisuals(batcher, box, time = 0) {
  if (!box || box.collected) return;

  const phase = box.phase || 0;
  const spin = box.spinAngle ?? time * 1.9 + phase;
  const bob = box.bobOffset ?? Math.sin(time * 3.4 + phase) * 0.32;
  const baseY = box.y || 0;
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
    case 'homing_rocket':
    case 'shell': {
      // Iconic spinning Red Homing Shell + thruster flame!
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
