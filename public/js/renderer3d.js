// Self-contained WebGL2 (with WebGL1 fallback) 3D Voxel & Custom Photo Renderer for Smashy Kart
// Features:
// - 2048x2048 Directional Sun Shadow Map FBO with texel-snapping & 3x3 PCF soft-crisp shadows
// - High-speed Instanced Voxel Box Batcher + Static Chunk Geometry Caching (20,000+ blocks @ 60fps)
// - 3-tone Crossy/Smashy voxel lighting + edge bevel highlights + biome sky gradient & distance fog
// - Textured 3D Cards & Sculpted Photo-Boxes with clean alpha cutouts + built-in default_hero & ? textures
// - Persistent tire skid ribbons, tumbling 3D bounce debris, rising voxel smoke, and fiery shockwave bursts

import { BIOMES, WORLD_CONFIG } from './config.js';
import {
  emitPlayerVisuals,
  emitCopVisuals,
  emitTrafficVisuals,
  emitPropVisuals,
  emitItemBoxVisuals,
  emitProjectileVisuals,
} from './models.js';

const FLOATS_PER_INSTANCE = 13; // pos(3), scale(3), rot(3), color+emissive/alpha(4)
const MAX_INSTANCES = 45000;
const SHADOW_MAP_SIZE = 2048;
const SHADOW_ORTHO_HALF = 96.0;

// Sun direction chosen for classic 3-tone Smashy/Crossy isometric contrast:
// Top (+Y) bright, South (-Z) warm sunlit, West (-X) cool sky-shaded, diagonal street shadows!
const SUN_DIR = (() => {
  const x = 0.52;
  const y = 0.80;
  const z = -0.38;
  const len = Math.hypot(x, y, z);
  return [x / len, y / len, z / len];
})();

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

const COLOR_CACHE = new Map();
function parseColorRgb(color) {
  if (Array.isArray(color)) return color;
  if (typeof color !== 'string') return [0.85, 0.85, 0.85];
  let cached = COLOR_CACHE.get(color);
  if (cached) return cached;

  let hex = color.trim();
  if (hex.startsWith('#')) hex = hex.slice(1);
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  const num = parseInt(hex, 16);
  if (Number.isNaN(num)) {
    cached = [0.85, 0.85, 0.85];
  } else {
    cached = [
      ((num >> 16) & 255) / 255,
      ((num >> 8) & 255) / 255,
      (num & 255) / 255,
    ];
  }
  COLOR_CACHE.set(color, cached);
  return cached;
}

// ==================== Minimal 4x4 Column-Major Matrix Math ====================

function mat4Identity(out = new Float32Array(16)) {
  out.fill(0);
  out[0] = 1;
  out[5] = 1;
  out[10] = 1;
  out[15] = 1;
  return out;
}

function mat4Perspective(out, fovY, aspect, near, far) {
  const f = 1.0 / Math.tan(fovY * 0.5);
  const nf = 1.0 / (near - far);
  out.fill(0);
  out[0] = f / Math.max(0.1, aspect);
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

function mat4Ortho(out, left, right, bottom, top, near, far) {
  const lr = 1 / (left - right);
  const bt = 1 / (bottom - top);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = -2 * lr;
  out[5] = -2 * bt;
  out[10] = 2 * nf;
  out[12] = (left + right) * lr;
  out[13] = (top + bottom) * bt;
  out[14] = (far + near) * nf;
  out[15] = 1;
  return out;
}

function mat4LookAt(out, eye, center, up) {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz);
  if (len < 1e-6) {
    zz = 1;
  } else {
    zx /= len;
    zy /= len;
    zz /= len;
  }

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz);
  if (len < 1e-6) {
    xx = 1;
    xy = 0;
    xz = 0;
  } else {
    xx /= len;
    xy /= len;
    xz /= len;
  }

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  out[0] = xx;
  out[1] = yx;
  out[2] = zx;
  out[3] = 0;
  out[4] = xy;
  out[5] = yy;
  out[6] = zy;
  out[7] = 0;
  out[8] = xz;
  out[9] = yz;
  out[10] = zz;
  out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
  return out;
}

function mat4Multiply(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

  for (let i = 0; i < 4; i++) {
    const idx = i * 4;
    const b0 = b[idx], b1 = b[idx + 1], b2 = b[idx + 2], b3 = b[idx + 3];
    out[idx] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[idx + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[idx + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[idx + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

// Unit cube geometry: 36 vertices, 8 floats/vert: px, py, pz, nx, ny, nz, u, v
// v = 1 at top (+0.5 Y) so textures uploaded with UNPACK_FLIP_Y_WEBGL=true sit right-side up!
function createUnitCubeVertices() {
  // prettier-ignore
  return new Float32Array([
    // +Z Front face
    -0.5, -0.5,  0.5,   0,  0,  1,  0, 0,
     0.5, -0.5,  0.5,   0,  0,  1,  1, 0,
     0.5,  0.5,  0.5,   0,  0,  1,  1, 1,
    -0.5, -0.5,  0.5,   0,  0,  1,  0, 0,
     0.5,  0.5,  0.5,   0,  0,  1,  1, 1,
    -0.5,  0.5,  0.5,   0,  0,  1,  0, 1,

    // -Z Back face
     0.5, -0.5, -0.5,   0,  0, -1,  0, 0,
    -0.5, -0.5, -0.5,   0,  0, -1,  1, 0,
    -0.5,  0.5, -0.5,   0,  0, -1,  1, 1,
     0.5, -0.5, -0.5,   0,  0, -1,  0, 0,
    -0.5,  0.5, -0.5,   0,  0, -1,  1, 1,
     0.5,  0.5, -0.5,   0,  0, -1,  0, 1,

    // +Y Top face
    -0.5,  0.5,  0.5,   0,  1,  0,  0, 0,
     0.5,  0.5,  0.5,   0,  1,  0,  1, 0,
     0.5,  0.5, -0.5,   0,  1,  0,  1, 1,
    -0.5,  0.5,  0.5,   0,  1,  0,  0, 0,
     0.5,  0.5, -0.5,   0,  1,  0,  1, 1,
    -0.5,  0.5, -0.5,   0,  1,  0,  0, 1,

    // -Y Bottom face
    -0.5, -0.5, -0.5,   0, -1,  0,  0, 0,
     0.5, -0.5, -0.5,   0, -1,  0,  1, 0,
     0.5, -0.5,  0.5,   0, -1,  0,  1, 1,
    -0.5, -0.5, -0.5,   0, -1,  0,  0, 0,
     0.5, -0.5,  0.5,   0, -1,  0,  1, 1,
    -0.5, -0.5,  0.5,   0, -1,  0,  0, 1,

    // +X Right face
     0.5, -0.5,  0.5,   1,  0,  0,  0, 0,
     0.5, -0.5, -0.5,   1,  0,  0,  1, 0,
     0.5,  0.5, -0.5,   1,  0,  0,  1, 1,
     0.5, -0.5,  0.5,   1,  0,  0,  0, 0,
     0.5,  0.5, -0.5,   1,  0,  0,  1, 1,
     0.5,  0.5,  0.5,   1,  0,  0,  0, 1,

    // -X Left face
    -0.5, -0.5, -0.5,  -1,  0,  0,  0, 0,
    -0.5, -0.5,  0.5,  -1,  0,  0,  1, 0,
    -0.5,  0.5,  0.5,  -1,  0,  0,  1, 1,
    -0.5, -0.5, -0.5,  -1,  0,  0,  0, 0,
    -0.5,  0.5,  0.5,  -1,  0,  0,  1, 1,
    -0.5,  0.5, -0.5,  -1,  0,  0,  0, 1,
  ]);
}

// Unit vertical quad on XY plane (6 vertices, 8 floats/vert) for crisp custom photo cutouts
function createUnitCardVertices() {
  // prettier-ignore
  return new Float32Array([
    -0.5, -0.5, 0.0,   0, 0, 1,   0, 0,
     0.5, -0.5, 0.0,   0, 0, 1,   1, 0,
     0.5,  0.5, 0.0,   0, 0, 1,   1, 1,
    -0.5, -0.5, 0.0,   0, 0, 1,   0, 0,
     0.5,  0.5, 0.0,   0, 0, 1,   1, 1,
    -0.5,  0.5, 0.0,   0, 0, 1,   0, 1,
  ]);
}

// ==================== Shaders (GLSL 300 es & GLSL 100 Fallback) ====================

const ROTATE_GLSL_FN = `
vec3 applyInstanceRotation(vec3 p, vec3 rot) {
  // 1. Roll around Z (rot.z)
  float cr = cos(rot.z);
  float sr = sin(rot.z);
  vec3 p1 = vec3(p.x * cr - p.y * sr, p.x * sr + p.y * cr, p.z);
  // 2. Pitch around X (rot.y)
  float cp = cos(rot.y);
  float sp = sin(rot.y);
  vec3 p2 = vec3(p1.x, p1.y * cp - p1.z * sp, p1.y * sp + p1.z * cp);
  // 3. Yaw around Y (rot.x)
  float cy = cos(rot.x);
  float sy = sin(rot.x);
  return vec3(p2.x * cy + p2.z * sy, p2.y, -p2.x * sy + p2.z * cy);
}
`;

function buildShaders(isWebGL2) {
  if (isWebGL2) {
    return {
      skyVS: `#version 300 es
        const vec2 POS[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
        out vec2 v_uv;
        void main() {
          vec2 p = POS[gl_VertexID];
          v_uv = p * 0.5 + 0.5;
          gl_Position = vec4(p, 0.9999, 1.0);
        }`,
      skyFS: `#version 300 es
        precision mediump float;
        in vec2 v_uv;
        uniform vec3 u_skyTop;
        uniform vec3 u_skyBottom;
        out vec4 outColor;
        void main() {
          float t = clamp(pow(clamp(v_uv.y, 0.0, 1.0), 0.78), 0.0, 1.0);
          vec3 col = mix(u_skyBottom, u_skyTop, t);
          outColor = vec4(col, 1.0);
        }`,
      shadowVS: `#version 300 es
        layout(location = 0) in vec3 a_position;
        layout(location = 2) in vec2 a_uv;
        layout(location = 3) in vec3 i_pos;
        layout(location = 4) in vec3 i_scale;
        layout(location = 5) in vec3 i_rot;
        uniform mat4 u_lightVP;
        out vec2 v_uv;
        ${ROTATE_GLSL_FN}
        void main() {
          vec3 worldPos = applyInstanceRotation(a_position * i_scale, i_rot) + i_pos;
          v_uv = a_uv;
          gl_Position = u_lightVP * vec4(worldPos, 1.0);
        }`,
      shadowFS: `#version 300 es
        precision mediump float;
        in vec2 v_uv;
        uniform int u_useAlphaTex;
        uniform sampler2D u_tex;
        void main() {
          if (u_useAlphaTex == 1) {
            if (texture(u_tex, v_uv).a < 0.18) discard;
          }
        }`,
      voxelVS: `#version 300 es
        layout(location = 0) in vec3 a_position;
        layout(location = 1) in vec3 a_normal;
        layout(location = 2) in vec2 a_uv;
        layout(location = 3) in vec3 i_pos;
        layout(location = 4) in vec3 i_scale;
        layout(location = 5) in vec3 i_rot;
        layout(location = 6) in vec4 i_color;

        uniform mat4 u_viewProj;
        uniform mat4 u_lightVP;

        out vec3 v_worldPos;
        out vec3 v_normal;
        out vec2 v_uv;
        out vec4 v_color;
        out vec4 v_shadowCoord;

        ${ROTATE_GLSL_FN}
        void main() {
          vec3 worldPos = applyInstanceRotation(a_position * i_scale, i_rot) + i_pos;
          vec3 worldNormal = normalize(applyInstanceRotation(a_normal, i_rot));
          v_worldPos = worldPos;
          v_normal = worldNormal;
          v_uv = a_uv;
          v_color = i_color;
          // Slight normal offset prevents shadow acne on crisp voxel faces
          v_shadowCoord = u_lightVP * vec4(worldPos + worldNormal * 0.08, 1.0);
          gl_Position = u_viewProj * vec4(worldPos, 1.0);
        }`,
      voxelFS: `#version 300 es
        precision highp float;
        in vec3 v_worldPos;
        in vec3 v_normal;
        in vec2 v_uv;
        in vec4 v_color;
        in vec4 v_shadowCoord;

        uniform vec3 u_sunDir;
        uniform vec3 u_sunColor;
        uniform vec3 u_ambientColor;
        uniform vec3 u_fogColor;
        uniform vec3 u_camPos;
        uniform float u_fogNear;
        uniform float u_fogFar;
        uniform int u_translucentMode;
        uniform int u_texturedMode;
        uniform int u_shadowsEnabled;
        uniform sampler2D u_shadowMap;
        uniform sampler2D u_tex;

        out vec4 outColor;

        float sampleShadowPCF(vec4 sc, float ndotl) {
          if (u_shadowsEnabled == 0) return 1.0;
          vec3 proj = sc.xyz / sc.w * 0.5 + 0.5;
          if (proj.x <= 0.002 || proj.x >= 0.998 || proj.y <= 0.002 || proj.y >= 0.998 || proj.z >= 0.999) {
            return 1.0;
          }
          float bias = max(0.0018 * (1.0 - ndotl), 0.00065);
          float texel = 1.0 / ${SHADOW_MAP_SIZE.toFixed(1)};
          float lit = 0.0;
          for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
              float d = texture(u_shadowMap, proj.xy + vec2(float(x), float(y)) * texel).r;
              lit += (proj.z - bias <= d) ? 1.0 : 0.0;
            }
          }
          // Soft distance fade near edge of shadow frustum
          vec2 edge = abs(proj.xy - 0.5) * 2.0;
          float fade = smoothstep(0.86, 0.99, max(edge.x, edge.y));
          return mix(lit / 9.0, 1.0, fade);
        }

        void main() {
          vec3 baseRgb = v_color.rgb;
          float alpha = 1.0;
          float emissive = v_color.a;

          if (u_translucentMode == 1) {
            alpha = v_color.a;
            emissive = 0.55;
          }

          if (u_texturedMode == 1) {
            vec4 texel = texture(u_tex, v_uv);
            if (texel.a < 0.14) discard;
            baseRgb *= texel.rgb;
            alpha *= texel.a;
          }

          vec3 N = normalize(v_normal);
          // Double-sided normal flip for textured cutout cards
          if (u_texturedMode == 1 && !gl_FrontFacing) {
            N = -N;
          }

          float ndotl = max(dot(N, u_sunDir), 0.0);
          float shadow = sampleShadowPCF(v_shadowCoord, ndotl);

          // Sky-to-ground hemisphere ambient + crisp top-face lift
          float hemi = N.y * 0.5 + 0.5;
          vec3 ambient = u_ambientColor * mix(0.68, 1.16, hemi);
          vec3 direct = u_sunColor * (ndotl * (0.30 + 0.70 * shadow));

          // Tactile Crossy/Smashy voxel block edge bevel accent
          float edgeX = min(v_uv.x, 1.0 - v_uv.x);
          float edgeY = min(v_uv.y, 1.0 - v_uv.y);
          float bevel = (u_texturedMode == 0 && min(edgeX, edgeY) < 0.038) ? 0.045 : 0.0;

          vec3 litColor = baseRgb * (ambient + direct) + vec3(bevel);
          vec3 finalColor = mix(litColor, baseRgb * 1.18, clamp(emissive, 0.0, 1.0));

          float dist = length(v_worldPos - u_camPos);
          float fogFactor = smoothstep(u_fogNear, u_fogFar, dist);
          finalColor = mix(finalColor, u_fogColor, fogFactor);

          outColor = vec4(finalColor, alpha);
        }`,
      ribbonVS: `#version 300 es
        layout(location = 0) in vec3 a_pos;
        layout(location = 1) in vec4 a_col;
        uniform mat4 u_viewProj;
        out vec4 v_col;
        void main() {
          v_col = a_col;
          gl_Position = u_viewProj * vec4(a_pos, 1.0);
        }`,
      ribbonFS: `#version 300 es
        precision mediump float;
        in vec4 v_col;
        out vec4 outColor;
        void main() {
          outColor = v_col;
        }`,
    };
  }

  // WebGL1 Fallback Shaders
  return {
    skyVS: `
      attribute vec2 a_skyPos;
      varying vec2 v_uv;
      void main() {
        v_uv = a_skyPos * 0.5 + 0.5;
        gl_Position = vec4(a_skyPos, 0.9999, 1.0);
      }`,
    skyFS: `
      precision mediump float;
      varying vec2 v_uv;
      uniform vec3 u_skyTop;
      uniform vec3 u_skyBottom;
      void main() {
        float t = clamp(v_uv.y, 0.0, 1.0);
        gl_FragColor = vec4(mix(u_skyBottom, u_skyTop, t), 1.0);
      }`,
    voxelVS: `
      attribute vec3 a_position;
      attribute vec3 a_normal;
      attribute vec2 a_uv;
      attribute vec3 i_pos;
      attribute vec3 i_scale;
      attribute vec3 i_rot;
      attribute vec4 i_color;
      uniform mat4 u_viewProj;
      varying vec3 v_worldPos;
      varying vec3 v_normal;
      varying vec2 v_uv;
      varying vec4 v_color;
      ${ROTATE_GLSL_FN}
      void main() {
        vec3 worldPos = applyInstanceRotation(a_position * i_scale, i_rot) + i_pos;
        v_worldPos = worldPos;
        v_normal = normalize(applyInstanceRotation(a_normal, i_rot));
        v_uv = a_uv;
        v_color = i_color;
        gl_Position = u_viewProj * vec4(worldPos, 1.0);
      }`,
    voxelFS: `
      precision highp float;
      varying vec3 v_worldPos;
      varying vec3 v_normal;
      varying vec2 v_uv;
      varying vec4 v_color;
      uniform vec3 u_sunDir;
      uniform vec3 u_sunColor;
      uniform vec3 u_ambientColor;
      uniform vec3 u_fogColor;
      uniform vec3 u_camPos;
      uniform float u_fogNear;
      uniform float u_fogFar;
      uniform int u_translucentMode;
      uniform int u_texturedMode;
      uniform sampler2D u_tex;
      void main() {
        vec3 baseRgb = v_color.rgb;
        float alpha = 1.0;
        float emissive = v_color.a;
        if (u_translucentMode == 1) { alpha = v_color.a; emissive = 0.55; }
        if (u_texturedMode == 1) {
          vec4 texel = texture2D(u_tex, v_uv);
          if (texel.a < 0.14) discard;
          baseRgb *= texel.rgb;
          alpha *= texel.a;
        }
        vec3 N = normalize(v_normal);
        float ndotl = max(dot(N, u_sunDir), 0.0);
        vec3 lit = baseRgb * (u_ambientColor * (N.y * 0.3 + 0.85) + u_sunColor * ndotl);
        vec3 col = mix(lit, baseRgb * 1.18, clamp(emissive, 0.0, 1.0));
        float fog = smoothstep(u_fogNear, u_fogFar, length(v_worldPos - u_camPos));
        gl_FragColor = vec4(mix(col, u_fogColor, fog), alpha);
      }`,
    ribbonVS: `
      attribute vec3 a_pos;
      attribute vec4 a_col;
      uniform mat4 u_viewProj;
      varying vec4 v_col;
      void main() {
        v_col = a_col;
        gl_Position = u_viewProj * vec4(a_pos, 1.0);
      }`,
    ribbonFS: `
      precision mediump float;
      varying vec4 v_col;
      void main() {
        gl_FragColor = v_col;
      }`,
  };
}

function compileProgram(gl, vsSource, fsSource, attribBindings = null) {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, vsSource);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(vs);
    gl.deleteShader(vs);
    throw new Error(`Vertex shader compile error: ${log}`);
  }

  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, fsSource);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error(`Fragment shader compile error: ${log}`);
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  if (attribBindings) {
    for (const [name, loc] of Object.entries(attribBindings)) {
      gl.bindAttribLocation(prog, loc, name);
    }
  }
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Shader link error: ${log}`);
  }
  return prog;
}

// ==================== Static Chunk Voxel Builder ====================

class StaticBoxCollector {
  constructor() {
    this.list = [];
  }

  addBox(x, y, z, sx, sy, sz, color, ry = 0, pitch = 0, roll = 0, emissive = 0) {
    const [r, g, b] = parseColorRgb(color);
    this.list.push(x, y, z, sx, sy, sz, ry, pitch, roll, r, g, b, emissive);
  }

  toFloat32Array() {
    return new Float32Array(this.list);
  }
}

function buildChunkStaticInstanceData(chunk, world, biome) {
  const col = new StaticBoxCollector();
  const { cx, cz, x0, z0, x1, z1, district, lotBounds } = chunk;
  const cs = WORLD_CONFIG.CHUNK_SIZE;
  const centerX = x0 + cs * 0.5;
  const centerZ = z0 + cs * 0.5;

  const westHalf = world.getNSRoadHalfWidth(cx);
  const eastHalf = world.getNSRoadHalfWidth(cx + 1);
  const southHalf = world.getEWRoadHalfWidth(cz);
  const northHalf = world.getEWRoadHalfWidth(cz + 1);

  if (district === 'river') {
    // Winding river channel with sunken sparkling water & terraced banks!
    const slices = 10;
    const sliceW = cs / slices;
    const riverHalf = world.getRiverHalfWidth();

    for (let i = 0; i < slices; i++) {
      const sx = x0 + (i + 0.5) * sliceW;
      const rc = world.getRiverCenterZ(sx, cz);
      const waterMinZ = rc - riverHalf;
      const waterMaxZ = rc + riverHalf;

      // Water bed & surface
      col.addBox(sx, WORLD_CONFIG.WATER_Y - 0.35, rc, sliceW + 0.08, 0.7, riverHalf * 2 + 1.2, biome.water, 0, 0, 0, 0.14);

      // South dry bank (z0 .. waterMinZ)
      const southDepth = Math.max(1.0, waterMinZ - z0);
      col.addBox(sx, -0.35, z0 + southDepth * 0.5, sliceW + 0.06, 0.7, southDepth, i % 2 === 0 ? biome.grassA : biome.grassB);
      col.addBox(sx, -0.65, waterMinZ - 0.5, sliceW + 0.06, 1.3, 1.2, '#d6c7a9');

      // North dry bank (waterMaxZ .. z1)
      const northDepth = Math.max(1.0, z1 - waterMaxZ);
      col.addBox(sx, -0.35, waterMaxZ + northDepth * 0.5, sliceW + 0.06, 0.7, northDepth, i % 2 === 0 ? biome.grassB : biome.grassA);
      col.addBox(sx, -0.65, waterMaxZ + 0.5, sliceW + 0.06, 1.3, 1.2, '#d6c7a9');
    }

    // Riverside EW road strips at z0 and z1
    col.addBox(centerX, -0.11, z0 + southHalf * 0.5, cs, 0.26, southHalf, biome.road);
    col.addBox(centerX, -0.11, z1 - northHalf * 0.5, cs, 0.26, northHalf, biome.road);

    // Bridges spanning across the river!
    for (const br of chunk.bridges) {
      const rampLen = br.flatStart - br.zStart;
      const flatLen = br.flatEnd - br.flatStart;
      const rampAngle = Math.atan2(br.height, rampLen);
      const hypLen = Math.hypot(rampLen, br.height);

      // South & North bridge approach ramps
      col.addBox(br.x, br.height * 0.5 - 0.18, br.zStart + rampLen * 0.5, br.w, 0.45, hypLen + 0.4, biome.road, 0, -rampAngle, 0);
      col.addBox(br.x, br.height * 0.5 - 0.18, br.zEnd - rampLen * 0.5, br.w, 0.45, hypLen + 0.4, biome.road, 0, rampAngle, 0);

      // Flat elevated bridge deck + yellow center dashes + red suspension curbs + concrete water piers!
      col.addBox(br.x, br.height - 0.22, (br.flatStart + br.flatEnd) * 0.5, br.w, 0.48, flatLen + 0.5, biome.road);
      col.addBox(br.x - br.w * 0.5 + 0.35, br.height + 0.22, centerZ, 0.7, 0.48, br.zEnd - br.zStart, '#dc2626');
      col.addBox(br.x + br.w * 0.5 - 0.35, br.height + 0.22, centerZ, 0.7, 0.48, br.zEnd - br.zStart, '#dc2626');

      for (let dz = br.flatStart + 3; dz <= br.flatEnd - 3; dz += 6.5) {
        col.addBox(br.x, br.height + 0.04, dz, 0.35, 0.05, 3.2, '#facc15');
      }
      // Bridge piers down into water
      for (const pz of [br.flatStart + 2.5, br.flatEnd - 2.5]) {
        col.addBox(br.x - br.w * 0.34, 0.0, pz, 1.35, 3.6, 1.35, '#94a3b8');
        col.addBox(br.x + br.w * 0.34, 0.0, pz, 1.35, 3.6, 1.35, '#94a3b8');
      }
    }
  } else {
    // Standard dry land chunk: road slab + checkerboard grass/paved lot + raised sidewalks!
    col.addBox(centerX, -0.25, centerZ, cs, 0.5, cs, biome.road);

    const lotW = lotBounds.maxX - lotBounds.minX;
    const lotD = lotBounds.maxZ - lotBounds.minZ;
    const lotCX = (lotBounds.minX + lotBounds.maxX) * 0.5;
    const lotCZ = (lotBounds.minZ + lotBounds.maxZ) * 0.5;

    if (district === 'plaza') {
      // Corner grass plaza outside the wide central starting boulevard
      const cornerMinX = cx === -1 ? lotBounds.minX : Math.max(lotBounds.minX, 18.8);
      const cornerMaxX = cx === -1 ? Math.min(lotBounds.maxX, -18.8) : lotBounds.maxX;
      const cornerMinZ = cz === -1 ? lotBounds.minZ : Math.max(lotBounds.minZ, 16.5);
      const cornerMaxZ = cz === -1 ? Math.min(lotBounds.maxZ, -16.5) : lotBounds.maxZ;
      if (cornerMaxX > cornerMinX + 2 && cornerMaxZ > cornerMinZ + 2) {
        const cw = cornerMaxX - cornerMinX;
        const cd = cornerMaxZ - cornerMinZ;
        col.addBox((cornerMinX + cornerMaxX) * 0.5, 0.08, (cornerMinZ + cornerMaxZ) * 0.5, cw + 2.4, 0.18, cd + 2.4, biome.sidewalk);
        col.addBox((cornerMinX + cornerMaxX) * 0.5, 0.14, (cornerMinZ + cornerMaxZ) * 0.5, cw, 0.12, cd, biome.grassA);
      }

      // Mario Kart black-and-white checkered starting line across central road (owned by cx=0, cz=-1)
      if (cx === 0 && cz === -1) {
        for (let i = -9; i < 9; i++) {
          for (let r = 0; r < 2; r++) {
            const isWhite = (i + r) % 2 === 0;
            col.addBox(i * 1.9 + 0.95, 0.025, -2.2 + r * 1.6, 1.88, 0.04, 1.56, isWhite ? '#ffffff' : '#111827');
          }
        }
      }
    } else if (lotW > 2 && lotD > 2) {
      // Raised sidewalk slab
      col.addBox(lotCX, 0.08, lotCZ, lotW + 4.4, 0.16, lotD + 4.4, biome.sidewalk);

      if (district === 'stunt_park' || district === 'gas_station') {
        col.addBox(lotCX, 0.13, lotCZ, lotW, 0.1, lotD, '#64748b');
      } else {
        // 2x2 subtle checkerboard grass/sand/snow sub-quadrants for crisp visual texture
        const qw = lotW * 0.5;
        const qd = lotD * 0.5;
        for (let ix = 0; ix < 2; ix++) {
          for (let iz = 0; iz < 2; iz++) {
            const gCol = (ix + iz) % 2 === 0 ? biome.grassA : biome.grassB;
            col.addBox(
              lotBounds.minX + (ix + 0.5) * qw,
              0.13,
              lotBounds.minZ + (iz + 0.5) * qd,
              qw,
              0.1,
              qd,
              gCol
            );
          }
        }
      }
    }

    // Road center yellow dashes & highway white lane markings (owned along x0 and z0 seams without duplication)
    const isWestHwy = world.isHighwayGrid(cx);
    const isSouthHwy = world.isHighwayGrid(cz);
    for (let s = z0 + 14; s <= z1 - 14; s += 8.0) {
      col.addBox(x0, 0.025, s, 0.34, 0.04, 3.6, '#facc15');
      if (isWestHwy) {
        col.addBox(x0 - 5.2, 0.025, s, 0.24, 0.04, 2.8, '#f8fafc');
        col.addBox(x0 + 5.2, 0.025, s, 0.24, 0.04, 2.8, '#f8fafc');
      }
    }
    for (let s = x0 + 14; s <= x1 - 14; s += 8.0) {
      col.addBox(s, 0.025, z0, 3.6, 0.04, 0.34, '#facc15');
      if (isSouthHwy) {
        col.addBox(s, 0.025, z0 - 5.2, 2.8, 0.04, 0.24, '#f8fafc');
        col.addBox(s, 0.025, z0 + 5.2, 2.8, 0.04, 0.24, '#f8fafc');
      }
    }
  }

  // Ramps with bright yellow boost chevrons!
  for (const ramp of chunk.ramps) {
    const slopeAngle = Math.atan2(ramp.height, ramp.length);
    const hyp = Math.hypot(ramp.length, ramp.height);
    col.addBox(ramp.x, ramp.height * 0.5 - 0.16, ramp.z, ramp.w, 0.36, hyp, '#334155', ramp.angle, -slopeAngle, 0);
    // Support wedge base under high end
    const backX = ramp.x + ramp.dirX * (ramp.length * 0.35);
    const backZ = ramp.z + ramp.dirZ * (ramp.length * 0.35);
    col.addBox(backX, ramp.height * 0.42, backZ, ramp.w * 0.94, ramp.height * 0.84, ramp.length * 0.28, '#475569', ramp.angle);
    // Yellow chevron stripes along ramp surface
    for (const u of [-0.25, 0.05, 0.32]) {
      const sy = ramp.height * (u + 0.5) + 0.05;
      const sx = ramp.x + ramp.dirX * (ramp.length * u);
      const sz = ramp.z + ramp.dirZ * (ramp.length * u);
      col.addBox(sx, sy, sz, ramp.w * 0.72, 0.06, 1.15, '#facc15', ramp.angle, -slopeAngle, 0, 0.45);
    }
  }

  // Gas station overhead canopies
  for (const gs of chunk.gasStations) {
    const canopyY = 5.45;
    col.addBox(gs.x, canopyY, gs.z, gs.w, 0.65, gs.d, '#dc2626');
    col.addBox(gs.x, canopyY + 0.38, gs.z, gs.w + 0.3, 0.22, gs.d + 0.3, '#ffffff', 0, 0, 0, 0.3);
    // Outer support columns
    for (const px of [-gs.w * 0.42, gs.w * 0.42]) {
      col.addBox(gs.x + px, canopyY * 0.5, gs.z, 0.55, canopyY, 0.55, '#cbd5e1');
    }
  }

  // Buildings (Skyscrapers, Houses, Desert Mesas, Diners, Snow Cabins)
  for (const b of chunk.buildings) {
    emitBuildingStaticBoxes(col, b);
  }

  return col.toFloat32Array();
}

function emitBuildingStaticBoxes(col, b) {
  if (b.style === 'mesa') {
    // Terraced Desert Sandstone Mesa!
    const h1 = b.height * 0.48;
    const h2 = b.height * 0.32;
    const h3 = b.height * 0.2;
    col.addBox(b.x, h1 * 0.5, b.z, b.w, h1, b.d, b.color);
    col.addBox(b.x, h1 + 0.2, b.z, b.w * 1.01, 0.4, b.d * 1.01, b.accentColor);
    col.addBox(b.x, h1 + h2 * 0.5, b.z, b.w * 0.78, h2, b.d * 0.78, b.roofColor);
    col.addBox(b.x, h1 + h2 + h3 * 0.5, b.z, b.w * 0.54, h3, b.d * 0.54, b.color);
    return;
  }

  if (b.style === 'house' || b.style === 'cabin' || b.style === 'chalet') {
    const wallH = b.height * 0.68;
    col.addBox(b.x, wallH * 0.5, b.z, b.w, wallH, b.d, b.color);
    // Pitched stepped voxel gable roof
    const steps = 3;
    const roofH = b.height * 0.36;
    for (let s = 0; s < steps; s++) {
      const frac = 1.06 - s * 0.26;
      const sh = roofH / steps;
      col.addBox(b.x, wallH + (s + 0.5) * sh, b.z, b.w * frac, sh + 0.05, b.d * frac, b.roofColor);
    }
    // Warm glowing front/back windows & door
    col.addBox(b.x - b.w * 0.24, wallH * 0.55, b.z - b.d * 0.5 - 0.05, 1.4, 1.3, 0.12, '#fef08a', 0, 0, 0, 0.45);
    col.addBox(b.x + b.w * 0.24, wallH * 0.55, b.z - b.d * 0.5 - 0.05, 1.4, 1.3, 0.12, '#fef08a', 0, 0, 0, 0.45);
    col.addBox(b.x, 1.15, b.z - b.d * 0.5 - 0.06, 1.25, 2.1, 0.14, '#78350f');
    // Chimney
    col.addBox(b.x + b.w * 0.28, b.height + 0.45, b.z + b.d * 0.2, 1.05, 1.4, 1.05, '#7f1d1d');
    return;
  }

  // Skyscraper / Gas Store / Diner / Monument
  if (b.tiers >= 2 && b.height > 16) {
    const lowerH = b.height * 0.68;
    const upperH = b.height - lowerH;
    col.addBox(b.x, lowerH * 0.5, b.z, b.w, lowerH, b.d, b.color);
    col.addBox(b.x, lowerH, b.z, b.w + 0.5, 0.45, b.d + 0.5, b.accentColor);
    col.addBox(b.x, lowerH + upperH * 0.5, b.z, b.w * 0.76, upperH, b.d * 0.76, b.color);
    col.addBox(b.x, b.height + 0.22, b.z, b.w * 0.8, 0.45, b.d * 0.8, b.roofColor);
    // Rooftop AC unit & spire
    col.addBox(b.x - 1.5, b.height + 0.9, b.z + 1.2, 2.1, 1.1, 2.1, '#94a3b8');
    if (b.tiers >= 3) {
      col.addBox(b.x, b.height + 2.4, b.z, 0.45, 3.8, 0.45, '#e2e8f0');
      col.addBox(b.x, b.height + 4.4, b.z, 0.65, 0.65, 0.65, '#ef4444', 0, 0, 0, 0.9);
    }
  } else {
    col.addBox(b.x, b.height * 0.5, b.z, b.w, b.height, b.d, b.color);
    col.addBox(b.x, b.height + 0.24, b.z, b.w + 0.45, 0.48, b.d + 0.45, b.roofColor);
    if (b.height > 10) {
      col.addBox(b.x + 1.6, b.height + 0.95, b.z - 1.2, 2.2, 1.1, 1.8, '#94a3b8');
    }
  }

  // Crisp architectural window bands along visible facades!
  if (b.hasWindows && b.height >= 6) {
    const maxWinY = (b.tiers >= 2 && b.height > 16 ? b.height * 0.64 : b.height - 1.8);
    for (let wy = 3.2; wy <= maxWinY; wy += 3.2) {
      const lit = ((b.seed + Math.round(wy * 7)) % 5) === 0;
      const winCol = lit ? '#fef08a' : '#1e293b';
      const winEm = lit ? 0.5 : 0.05;
      // Front (-Z) & Back (+Z) window strips
      col.addBox(b.x, wy, b.z - b.d * 0.5 - 0.05, b.w * 0.78, 1.25, 0.1, winCol, 0, 0, 0, winEm);
      col.addBox(b.x, wy, b.z + b.d * 0.5 + 0.05, b.w * 0.78, 1.25, 0.1, winCol, 0, 0, 0, winEm);
      // West (-X) & East (+X) window strips
      col.addBox(b.x - b.w * 0.5 - 0.05, wy, b.z, 0.1, 1.25, b.d * 0.78, winCol, 0, 0, 0, winEm);
      col.addBox(b.x + b.w * 0.5 + 0.05, wy, b.z, 0.1, 1.25, b.d * 0.78, winCol, 0, 0, 0, winEm);
    }
  }
}

// ==================== Renderer3D Class ====================

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.cssWidth = (canvas && canvas.clientWidth) || 1280;
    this.cssHeight = (canvas && canvas.clientHeight) || 720;
    this.dpr = 1;

    const ctxAttrs = {
      alpha: false,
      antialias: true,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
    };

    let gl = canvas ? canvas.getContext('webgl2', ctxAttrs) : null;
    this.isWebGL2 = !!gl;
    if (!gl && canvas) {
      gl = canvas.getContext('webgl', ctxAttrs) || canvas.getContext('experimental-webgl', ctxAttrs);
      this.instancedExt = gl ? gl.getExtension('ANGLE_instanced_arrays') : null;
    }
    this.gl = gl;

    // Camera & matrices
    this.camEye = [0, 44, -36];
    this.camTarget = [0, 0, 0];
    this.camFov = (42 * Math.PI) / 180;
    this.cameraInitialized = false;
    this.shakePhase = 0;

    this.viewMatrix = mat4Identity();
    this.projMatrix = mat4Identity();
    this.viewProjMatrix = mat4Identity();
    this.lightViewMatrix = mat4Identity();
    this.lightProjMatrix = mat4Identity();
    this.lightVPMatrix = mat4Identity();

    // Batch storage (pre-allocated typed arrays for zero-GC 60fps rendering!)
    this.opaqueData = new Float32Array(MAX_INSTANCES * FLOATS_PER_INSTANCE);
    this.opaqueCount = 0;

    this.translucentData = new Float32Array(4096 * FLOATS_PER_INSTANCE);
    this.translucentCount = 0;

    this.texturedBoxesById = new Map();
    this.texturedCardsById = new Map();
    this.textures = new Map();
    this.pendingImageLoads = new Set();

    // Particles & decals
    this.debris = [];
    this.smoke = [];
    this.explosions = [];
    this.skidVerts = new Float32Array(1400 * 6 * 7); // up to 1400 quad segments, 6 verts, 7 floats (xyz + rgba)
    this.skidQuadCount = 0;
    this.skidWriteCursor = 0;

    // Chunk static cache keyed by `${seed}:${biomeId}:${chunk.key}`
    this.chunkStaticCache = new Map();
    this.cachedSeedKey = '';

    if (gl) {
      this._initGL();
      this._createBuiltInTextures();
      this.resize(this.cssWidth, this.cssHeight, (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1);
    }
  }

  _initGL() {
    const gl = this.gl;
    const shaders = buildShaders(this.isWebGL2);

    const voxelAttribs = {
      a_position: 0,
      a_normal: 1,
      a_uv: 2,
      i_pos: 3,
      i_scale: 4,
      i_rot: 5,
      i_color: 6,
    };

    this.skyProg = compileProgram(gl, shaders.skyVS, shaders.skyFS, this.isWebGL2 ? null : { a_skyPos: 0 });
    this.voxelProg = compileProgram(gl, shaders.voxelVS, shaders.voxelFS, voxelAttribs);
    this.ribbonProg = compileProgram(gl, shaders.ribbonVS, shaders.ribbonFS, { a_pos: 0, a_col: 1 });

    if (this.isWebGL2) {
      this.shadowProg = compileProgram(gl, shaders.shadowVS, shaders.shadowFS, voxelAttribs);
    }

    // Cache uniform locations
    this.skyUniforms = {
      skyTop: gl.getUniformLocation(this.skyProg, 'u_skyTop'),
      skyBottom: gl.getUniformLocation(this.skyProg, 'u_skyBottom'),
    };

    this.voxelUniforms = {
      viewProj: gl.getUniformLocation(this.voxelProg, 'u_viewProj'),
      lightVP: gl.getUniformLocation(this.voxelProg, 'u_lightVP'),
      sunDir: gl.getUniformLocation(this.voxelProg, 'u_sunDir'),
      sunColor: gl.getUniformLocation(this.voxelProg, 'u_sunColor'),
      ambientColor: gl.getUniformLocation(this.voxelProg, 'u_ambientColor'),
      fogColor: gl.getUniformLocation(this.voxelProg, 'u_fogColor'),
      camPos: gl.getUniformLocation(this.voxelProg, 'u_camPos'),
      fogNear: gl.getUniformLocation(this.voxelProg, 'u_fogNear'),
      fogFar: gl.getUniformLocation(this.voxelProg, 'u_fogFar'),
      translucentMode: gl.getUniformLocation(this.voxelProg, 'u_translucentMode'),
      texturedMode: gl.getUniformLocation(this.voxelProg, 'u_texturedMode'),
      shadowsEnabled: gl.getUniformLocation(this.voxelProg, 'u_shadowsEnabled'),
      shadowMap: gl.getUniformLocation(this.voxelProg, 'u_shadowMap'),
      tex: gl.getUniformLocation(this.voxelProg, 'u_tex'),
    };

    if (this.isWebGL2) {
      this.shadowUniforms = {
        lightVP: gl.getUniformLocation(this.shadowProg, 'u_lightVP'),
        useAlphaTex: gl.getUniformLocation(this.shadowProg, 'u_useAlphaTex'),
        tex: gl.getUniformLocation(this.shadowProg, 'u_tex'),
      };
    }

    this.ribbonUniforms = {
      viewProj: gl.getUniformLocation(this.ribbonProg, 'u_viewProj'),
    };

    // Geometry buffers
    this.cubeVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cubeVBO);
    gl.bufferData(gl.ARRAY_BUFFER, createUnitCubeVertices(), gl.STATIC_DRAW);

    this.cardVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cardVBO);
    gl.bufferData(gl.ARRAY_BUFFER, createUnitCardVertices(), gl.STATIC_DRAW);

    this.instanceVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
    gl.bufferData(gl.ARRAY_BUFFER, MAX_INSTANCES * FLOATS_PER_INSTANCE * 4, gl.DYNAMIC_DRAW);

    this.ribbonVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.skidVerts.byteLength, gl.DYNAMIC_DRAW);

    if (!this.isWebGL2) {
      this.skyVBO = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.skyVBO);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    } else {
      this.skyVAO = gl.createVertexArray();
      this.cubeVAO = this._createInstancedVAO(this.cubeVBO);
      this.cardVAO = this._createInstancedVAO(this.cardVBO);

      this.ribbonVAO = gl.createVertexArray();
      gl.bindVertexArray(this.ribbonVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonVBO);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
      gl.bindVertexArray(null);

      this._initShadowMapFBO();
    }
  }

  _createInstancedVAO(meshVBO) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, meshVBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);

    const stride = FLOATS_PER_INSTANCE * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(3, 1);

    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 3, gl.FLOAT, false, stride, 12);
    gl.vertexAttribDivisor(4, 1);

    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 3, gl.FLOAT, false, stride, 24);
    gl.vertexAttribDivisor(5, 1);

    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 4, gl.FLOAT, false, stride, 36);
    gl.vertexAttribDivisor(6, 1);

    gl.bindVertexArray(null);
    return vao;
  }

  _bindWebGL1InstancedState(meshVBO) {
    const gl = this.gl;
    const ext = this.instancedExt;
    gl.bindBuffer(gl.ARRAY_BUFFER, meshVBO);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);

    const stride = FLOATS_PER_INSTANCE * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(5);
    gl.vertexAttribPointer(5, 3, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(6);
    gl.vertexAttribPointer(6, 4, gl.FLOAT, false, stride, 36);
    if (ext) {
      ext.vertexAttribDivisorANGLE(3, 1);
      ext.vertexAttribDivisorANGLE(4, 1);
      ext.vertexAttribDivisorANGLE(5, 1);
      ext.vertexAttribDivisorANGLE(6, 1);
    }
  }

  _initShadowMapFBO() {
    const gl = this.gl;
    this.shadowDepthTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowDepthTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT24,
      SHADOW_MAP_SIZE,
      SHADOW_MAP_SIZE,
      0,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
      null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.shadowFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowDepthTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    this.shadowsReady = status === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  _createBuiltInTextures() {
    if (typeof document === 'undefined') return;

    // 1. Crisp illustrated 'default_hero' alpha-cutout driver character!
    const heroCanvas = document.createElement('canvas');
    heroCanvas.width = 128;
    heroCanvas.height = 128;
    const hctx = heroCanvas.getContext('2d');
    if (hctx) {
      hctx.clearRect(0, 0, 128, 128);
      // Shoulders
      hctx.fillStyle = '#ef4444';
      hctx.beginPath();
      hctx.roundRect(22, 86, 84, 38, 18);
      hctx.fill();
      hctx.lineWidth = 4;
      hctx.strokeStyle = '#ffffff';
      hctx.stroke();

      // Head circle
      hctx.fillStyle = '#fde68a';
      hctx.beginPath();
      hctx.arc(64, 56, 36, 0, Math.PI * 2);
      hctx.fill();
      hctx.strokeStyle = '#1e293b';
      hctx.lineWidth = 4;
      hctx.stroke();

      // Racing helmet / cap
      hctx.fillStyle = '#2563eb';
      hctx.beginPath();
      hctx.arc(64, 46, 36, Math.PI, Math.PI * 2);
      hctx.fill();
      hctx.fillStyle = '#facc15';
      hctx.fillRect(57, 12, 14, 24);

      // Cool shades
      hctx.fillStyle = '#0f172a';
      hctx.fillRect(36, 46, 24, 14);
      hctx.fillRect(68, 46, 24, 14);
      hctx.fillRect(58, 49, 12, 5);
      hctx.fillStyle = '#38bdf8';
      hctx.fillRect(40, 49, 8, 5);
      hctx.fillRect(72, 49, 8, 5);

      // Big grin
      hctx.fillStyle = '#ffffff';
      hctx.beginPath();
      hctx.arc(64, 68, 14, 0, Math.PI);
      hctx.fill();
      hctx.stroke();
    }
    this.registerPhotoTexture('default_hero', heroCanvas);

    // 2. Iconic rainbow Mario Kart '?' Item Box texture!
    const qCanvas = document.createElement('canvas');
    qCanvas.width = 128;
    qCanvas.height = 128;
    const qctx = qCanvas.getContext('2d');
    if (qctx) {
      const grad = qctx.createLinearGradient(0, 0, 128, 128);
      grad.addColorStop(0.0, '#ff4d6d');
      grad.addColorStop(0.28, '#ffbe0b');
      grad.addColorStop(0.56, '#38efc3');
      grad.addColorStop(0.82, '#3a86ff');
      grad.addColorStop(1.0, '#c77dff');
      qctx.fillStyle = grad;
      qctx.fillRect(0, 0, 128, 128);

      // Glossy inner border
      qctx.strokeStyle = 'rgba(255,255,255,0.9)';
      qctx.lineWidth = 8;
      qctx.strokeRect(8, 8, 112, 112);

      // Bold '?' emblem
      qctx.font = '900 88px system-ui, -apple-system, sans-serif';
      qctx.textAlign = 'center';
      qctx.textBaseline = 'middle';
      qctx.lineWidth = 10;
      qctx.strokeStyle = '#1e1b4b';
      qctx.strokeText('?', 64, 68);
      qctx.fillStyle = '#ffffff';
      qctx.fillText('?', 64, 68);
    }
    this.registerPhotoTexture('__item_question__', qCanvas);
  }

  _ensureFallbackAvatarTexture(avatarId) {
    if (this.textures.has(avatarId)) return this.textures.get(avatarId);
    if (typeof document === 'undefined') return this.textures.get('default_hero');

    let hash = 0;
    const str = String(avatarId);
    for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
    const hue = Math.abs(hash) % 360;

    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 96;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = `hsl(${hue}, 82%, 56%)`;
      ctx.beginPath();
      ctx.arc(48, 48, 42, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.arc(34, 40, 6, 0, Math.PI * 2);
      ctx.arc(62, 40, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(48, 52, 15, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
    this._uploadGLTexture(avatarId, c);
    return this.textures.get(avatarId);
  }

  _uploadGLTexture(avatarId, source) {
    const gl = this.gl;
    if (!gl || !source) return;

    let tex = this.textures.get(avatarId);
    if (!tex) {
      tex = gl.createTexture();
      this.textures.set(avatarId, tex);
    }

    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    if (source.data && source.width && source.height) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        source.width,
        source.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source.data
      );
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  registerPhotoTexture(avatarId, imageOrCanvasOrDataUrl) {
    if (!avatarId || !imageOrCanvasOrDataUrl || !this.gl) return;

    if (typeof imageOrCanvasOrDataUrl === 'string') {
      // Async dataURL / image URL load with instant fallback until ready
      if (!this.textures.has(avatarId)) {
        this._ensureFallbackAvatarTexture(avatarId);
      }
      if (typeof Image !== 'undefined') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        this.pendingImageLoads.add(img);
        img.onload = () => {
          this.pendingImageLoads.delete(img);
          this._uploadGLTexture(avatarId, img);
        };
        img.onerror = () => {
          this.pendingImageLoads.delete(img);
        };
        img.src = imageOrCanvasOrDataUrl;
      }
      return;
    }

    if (
      typeof HTMLImageElement !== 'undefined' &&
      imageOrCanvasOrDataUrl instanceof HTMLImageElement &&
      !imageOrCanvasOrDataUrl.complete
    ) {
      imageOrCanvasOrDataUrl.addEventListener(
        'load',
        () => this._uploadGLTexture(avatarId, imageOrCanvasOrDataUrl),
        { once: true }
      );
      return;
    }

    this._uploadGLTexture(avatarId, imageOrCanvasOrDataUrl);
  }

  hasTexture(avatarId) {
    return this.textures.has(avatarId);
  }

  resize(width, height, dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1) {
    this.cssWidth = Math.max(1, width || 1280);
    this.cssHeight = Math.max(1, height || 720);
    this.dpr = clamp(dpr || 1, 1, 2);

    if (this.canvas) {
      const bw = Math.round(this.cssWidth * this.dpr);
      const bh = Math.round(this.cssHeight * this.dpr);
      if (this.canvas.width !== bw || this.canvas.height !== bh) {
        this.canvas.width = bw;
        this.canvas.height = bh;
      }
    }
    this._updateCameraMatrices();
  }

  setCamera(focusEntity, cameraMode = 'smashy', shakeAmount = 0, dt = 0.016) {
    const fx = focusEntity?.x || 0;
    const fy = focusEntity?.y || 0;
    const fz = focusEntity?.z || 0;
    const vx = focusEntity?.vx || 0;
    const vz = focusEntity?.vz || 0;
    const speed = Math.hypot(vx, vz);
    const angle = focusEntity?.angle || 0;

    const isMega =
      (focusEntity?.megaTimer ?? focusEntity?.items?.megaTimer ?? (focusEntity?.activeBuffs?.mega ? 1 : 0)) > 0;
    const isBoost =
      (focusEntity?.boostTimer ?? focusEntity?.items?.boostTimer ?? (focusEntity?.activeBuffs?.boost ? 1 : 0)) > 0;

    const zoom =
      1.0 +
      clamp(speed / 160, 0, 0.28) +
      clamp(fy / 45, 0, 0.28) +
      (isMega ? 0.34 : 0) +
      (isBoost ? 0.08 : 0);

    let desiredEyeX;
    let desiredEyeY;
    let desiredEyeZ;
    let desiredTargetX;
    let desiredTargetY;
    let desiredTargetZ;

    if (cameraMode === 'chase') {
      // Dynamic Mario Kart 3D behind-the-car chase camera!
      const backX = -Math.sin(angle);
      const backZ = -Math.cos(angle);
      const dist = 17.5 * zoom;
      const height = 9.2 * zoom;
      desiredEyeX = fx + backX * dist;
      desiredEyeY = Math.max(2.5, fy + height);
      desiredEyeZ = fz + backZ * dist;

      desiredTargetX = fx - backX * 8.5;
      desiredTargetY = fy + 2.2;
      desiredTargetZ = fz - backZ * 8.5;
      this.camFov = ((isBoost ? 56 : 50) * Math.PI) / 180;
    } else {
      // Authentic Smashy Road angled isometric-perspective overhead camera!
      const rawLeadX = clamp(vx * 0.22, -10, 10);
      const rawLeadZ = clamp(vz * 0.22, -10, 10);
      const leadBlend = 1.0 - Math.exp(-Math.max(0.001, dt) * 7.0);
      this.smoothLeadX = (this.smoothLeadX || 0) + (rawLeadX - (this.smoothLeadX || 0)) * leadBlend;
      this.smoothLeadZ = (this.smoothLeadZ || 0) + (rawLeadZ - (this.smoothLeadZ || 0)) * leadBlend;
      desiredTargetX = fx + this.smoothLeadX;
      desiredTargetY = fy * 0.45;
      desiredTargetZ = fz + this.smoothLeadZ;

      desiredEyeX = desiredTargetX - 21.0 * zoom;
      desiredEyeY = desiredTargetY + 46.0 * zoom;
      desiredEyeZ = desiredTargetZ - 36.0 * zoom;
      this.camFov = (40 * Math.PI) / 180;
    }

    const alpha = !this.cameraInitialized ? 1.0 : 1.0 - Math.exp(-Math.max(0.001, dt) * 8.5);
    this.cameraInitialized = true;

    this.camEye[0] += (desiredEyeX - this.camEye[0]) * alpha;
    this.camEye[1] += (desiredEyeY - this.camEye[1]) * alpha;
    this.camEye[2] += (desiredEyeZ - this.camEye[2]) * alpha;

    this.camTarget[0] += (desiredTargetX - this.camTarget[0]) * alpha;
    this.camTarget[1] += (desiredTargetY - this.camTarget[1]) * alpha;
    this.camTarget[2] += (desiredTargetZ - this.camTarget[2]) * alpha;

    // Screen shake impulse
    if (shakeAmount > 0.001) {
      this.shakePhase += Math.max(0.01, dt) * 52.0;
      const mag = clamp(shakeAmount, 0, 3.5);
      this.shakeOffset = [
        Math.sin(this.shakePhase * 1.7) * mag * 0.65,
        Math.cos(this.shakePhase * 2.3) * mag * 0.45,
        Math.sin(this.shakePhase * 1.3 + 1.1) * mag * 0.65,
      ];
    } else {
      this.shakeOffset = [0, 0, 0];
    }

    this._updateCameraMatrices();
  }

  _updateCameraMatrices() {
    const sx = this.shakeOffset ? this.shakeOffset[0] : 0;
    const sy = this.shakeOffset ? this.shakeOffset[1] : 0;
    const sz = this.shakeOffset ? this.shakeOffset[2] : 0;

    const eye = [this.camEye[0] + sx, this.camEye[1] + sy, this.camEye[2] + sz];
    const target = [this.camTarget[0] + sx, this.camTarget[1] + sy, this.camTarget[2] + sz];

    mat4LookAt(this.viewMatrix, eye, target, [0, 1, 0]);
    mat4Perspective(this.projMatrix, this.camFov, this.cssWidth / this.cssHeight, 1.5, 650.0);
    mat4Multiply(this.viewProjMatrix, this.projMatrix, this.viewMatrix);
  }

  _updateLightMatrices(focusX, focusZ) {
    // Texel-snap light target in light-space so shadow edges never shimmer while driving!
    const dist = 140.0;
    const rawTarget = [focusX, 0, focusZ];
    const rawEye = [
      rawTarget[0] + SUN_DIR[0] * dist,
      rawTarget[1] + SUN_DIR[1] * dist,
      rawTarget[2] + SUN_DIR[2] * dist,
    ];
    mat4LookAt(this.lightViewMatrix, rawEye, rawTarget, [0, 1, 0]);

    const texelWorld = (SHADOW_ORTHO_HALF * 2.0) / SHADOW_MAP_SIZE;
    this.lightViewMatrix[12] = Math.round(this.lightViewMatrix[12] / texelWorld) * texelWorld;
    this.lightViewMatrix[13] = Math.round(this.lightViewMatrix[13] / texelWorld) * texelWorld;

    mat4Ortho(
      this.lightProjMatrix,
      -SHADOW_ORTHO_HALF,
      SHADOW_ORTHO_HALF,
      -SHADOW_ORTHO_HALF,
      SHADOW_ORTHO_HALF,
      1.0,
      310.0
    );
    mat4Multiply(this.lightVPMatrix, this.lightProjMatrix, this.lightViewMatrix);
  }

  projectToScreen(x, y, z) {
    const m = this.viewProjMatrix;
    const clipX = m[0] * x + m[4] * y + m[8] * z + m[12];
    const clipY = m[1] * x + m[5] * y + m[9] * z + m[13];
    const clipZ = m[2] * x + m[6] * y + m[10] * z + m[14];
    const clipW = m[3] * x + m[7] * y + m[11] * z + m[15];

    if (clipW <= 0.05) {
      return { x: -9999, y: -9999, visible: false };
    }

    const ndcX = clipX / clipW;
    const ndcY = clipY / clipW;
    const ndcZ = clipZ / clipW;

    const screenX = (ndcX * 0.5 + 0.5) * this.cssWidth;
    const screenY = (1.0 - (ndcY * 0.5 + 0.5)) * this.cssHeight;
    const visible = ndcX >= -1.15 && ndcX <= 1.15 && ndcY >= -1.15 && ndcY <= 1.15 && ndcZ <= 1.0;

    return { x: screenX, y: screenY, visible };
  }

  projectWaypoint(x, y, z, pad = {}) {
    const w = this.cssWidth || 390;
    const h = this.cssHeight || 844;
    const minX = pad.left ?? 10;
    const maxX = Math.max(minX + 20, w - (pad.right ?? 10));
    const minY = pad.top ?? 76;
    const maxY = Math.max(minY + 20, h - (pad.bottom ?? 12));

    const direct = this.projectToScreen(x, y, z);
    if (
      direct.visible &&
      direct.x >= 18 &&
      direct.x <= w - 18 &&
      direct.y >= 54 &&
      direct.y <= h - 18
    ) {
      return { x: direct.x, y: direct.y, onScreen: true, angleRad: 0, rx: 0.5, ry: 1.0 };
    }

    // Off-screen or behind camera: cast a guaranteed-front ray from camTarget toward (x, y, z)
    const fx = this.camTarget[0];
    const fy = this.camTarget[1];
    const fz = this.camTarget[2];
    const centerProj = this.projectToScreen(fx, fy, fz);
    const cx = clamp(centerProj.visible ? centerProj.x : w * 0.5, minX + 8, maxX - 8);
    const cy = clamp(centerProj.visible ? centerProj.y : h * 0.5, minY + 8, maxY - 8);

    const dx = x - fx;
    const dy = (y - fy) * 0.25;
    const dz = z - fz;
    const dist = Math.hypot(dx, dy, dz) || 1;
    const step = 3.0;
    const nearProj = this.projectToScreen(
      fx + (dx / dist) * step,
      fy + (dy / dist) * step,
      fz + (dz / dist) * step
    );

    let vx = (nearProj.visible ? nearProj.x : w * 0.5) - cx;
    let vy = (nearProj.visible ? nearProj.y : h * 0.8) - cy;
    if (Math.hypot(vx, vy) < 0.001) {
      vx = 0;
      vy = 1;
    }

    const tx = vx > 0.0001 ? (maxX - cx) / vx : vx < -0.0001 ? (minX - cx) / vx : Infinity;
    const ty = vy > 0.0001 ? (maxY - cy) / vy : vy < -0.0001 ? (minY - cy) / vy : Infinity;
    const t = Math.min(tx, ty);

    const edgeX = clamp(cx + vx * t, minX, maxX);
    const edgeY = clamp(cy + vy * t, minY, maxY);
    const angleRad = Math.atan2(vy, vx);
    const rx = clamp((edgeX - minX) / Math.max(1, maxX - minX), 0, 1);
    const ry = clamp((edgeY - minY) / Math.max(1, maxY - minY), 0, 1);

    return { x: edgeX, y: edgeY, onScreen: false, angleRad, rx, ry };
  }

  // ==================== Particle & Skid FX ====================

  spawnDebris(x, y, z, color = '#f8fafc', count = 8, speed = 14, scale = 0.45) {
    const rgb = parseColorRgb(color);
    const n = clamp(Math.floor(count), 1, 40);
    for (let i = 0; i < n; i++) {
      if (this.debris.length >= 650) this.debris.shift();
      const theta = Math.random() * Math.PI * 2;
      const spd = speed * (0.45 + Math.random() * 0.75);
      this.debris.push({
        x: x + (Math.random() - 0.5) * 0.8,
        y: Math.max(0.3, y + Math.random() * 0.9),
        z: z + (Math.random() - 0.5) * 0.8,
        vx: Math.cos(theta) * spd,
        vy: speed * (0.42 + Math.random() * 0.65),
        vz: Math.sin(theta) * spd,
        rx: Math.random() * 6.28,
        ry: Math.random() * 6.28,
        rz: Math.random() * 6.28,
        vrx: (Math.random() - 0.5) * 14,
        vry: (Math.random() - 0.5) * 14,
        scale: scale * (0.7 + Math.random() * 0.6),
        rgb,
        emissive: 0,
        ttl: 1.4 + Math.random() * 0.9,
        maxTtl: 2.3,
      });
    }
  }

  spawnSmoke(x, y, z, color = '#e2e8f0', count = 2, size = 0.7) {
    const rgb = parseColorRgb(color);
    const n = clamp(Math.floor(count), 1, 18);
    for (let i = 0; i < n; i++) {
      if (this.smoke.length >= 420) this.smoke.shift();
      this.smoke.push({
        x: x + (Math.random() - 0.5) * 0.65,
        y: y + Math.random() * 0.4,
        z: z + (Math.random() - 0.5) * 0.65,
        vx: (Math.random() - 0.5) * 2.2,
        vy: 2.6 + Math.random() * 3.4,
        vz: (Math.random() - 0.5) * 2.2,
        ry: Math.random() * 6.28,
        size: size * (0.8 + Math.random() * 0.45),
        rgb,
        ttl: 0.65 + Math.random() * 0.45,
        maxTtl: 1.0,
      });
    }
  }

  addSkidMark(x1, z1, x2, z2, width = 0.42, alpha = 0.45) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.05 || len > 8.0) return;

    const nx = (-dz / len) * (width * 0.5);
    const nz = (dx / len) * (width * 0.5);
    const y = 0.04;
    const a = clamp(alpha, 0.05, 0.85);

    const maxQuads = 1400;
    const slot = this.skidWriteCursor % maxQuads;
    this.skidWriteCursor++;
    if (this.skidQuadCount < maxQuads) this.skidQuadCount++;

    const base = slot * 42; // 6 vertices * 7 floats
    const r = 0.08, g = 0.09, b = 0.11;

    const p0x = x1 - nx, p0z = z1 - nz;
    const p1x = x1 + nx, p1z = z1 + nz;
    const p2x = x2 + nx, p2z = z2 + nz;
    const p3x = x2 - nx, p3z = z2 - nz;

    const v = this.skidVerts;
    // Tri 1: p0, p1, p2
    v[base + 0] = p0x; v[base + 1] = y; v[base + 2] = p0z; v[base + 3] = r; v[base + 4] = g; v[base + 5] = b; v[base + 6] = a;
    v[base + 7] = p1x; v[base + 8] = y; v[base + 9] = p1z; v[base + 10] = r; v[base + 11] = g; v[base + 12] = b; v[base + 13] = a;
    v[base + 14] = p2x; v[base + 15] = y; v[base + 16] = p2z; v[base + 17] = r; v[base + 18] = g; v[base + 19] = b; v[base + 20] = a;
    // Tri 2: p0, p2, p3
    v[base + 21] = p0x; v[base + 22] = y; v[base + 23] = p0z; v[base + 24] = r; v[base + 25] = g; v[base + 26] = b; v[base + 27] = a;
    v[base + 28] = p2x; v[base + 29] = y; v[base + 30] = p2z; v[base + 31] = r; v[base + 32] = g; v[base + 33] = b; v[base + 34] = a;
    v[base + 35] = p3x; v[base + 36] = y; v[base + 37] = p3z; v[base + 38] = r; v[base + 39] = g; v[base + 40] = b; v[base + 41] = a;
    this.skidDirty = true;
  }

  spawnExplosionVisual(x, y, z, radius = 7) {
    this.explosions.push({
      x,
      y: Math.max(0.5, y),
      z,
      maxRadius: Math.max(4, radius),
      ttl: 0.55,
      maxTtl: 0.55,
    });

    // Fiery orange/gold/charcoal voxel burst!
    const firePalette = ['#fef08a', '#f97316', '#ef4444', '#27272a'];
    for (let i = 0; i < 24; i++) {
      const col = firePalette[i % firePalette.length];
      this.spawnDebris(x, y + 0.8, z, col, 1, 16 + radius * 1.4, 0.52);
      const last = this.debris[this.debris.length - 1];
      if (last && i % 4 < 3) last.emissive = 0.92;
    }

    this.spawnSmoke(x, y + 1.2, z, '#334155', 10, 1.45);
    this.spawnSmoke(x, y + 0.8, z, '#fb923c', 6, 1.15);

    // Persistent scorch patch on ground
    this.addSkidMark(x - radius * 0.45, z, x + radius * 0.45, z, radius * 0.85, 0.65);
  }

  _updateParticles(dt) {
    const safeDt = clamp(dt || 0.016, 0, 0.1);

    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      d.ttl -= safeDt;
      if (d.ttl <= 0) {
        this.debris.splice(i, 1);
        continue;
      }
      d.vy -= 36.0 * safeDt;
      d.x += d.vx * safeDt;
      d.y += d.vy * safeDt;
      d.z += d.vz * safeDt;
      d.rx += d.vrx * safeDt;
      d.ry += d.vry * safeDt;

      const floorY = d.scale * 0.5;
      if (d.y < floorY) {
        d.y = floorY;
        d.vy = Math.abs(d.vy) * 0.46;
        d.vx *= 0.78;
        d.vz *= 0.78;
      }
    }

    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const s = this.smoke[i];
      s.ttl -= safeDt;
      if (s.ttl <= 0) {
        this.smoke.splice(i, 1);
        continue;
      }
      s.x += s.vx * safeDt;
      s.y += s.vy * safeDt;
      s.z += s.vz * safeDt;
      s.size += safeDt * 1.45;
    }

    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.ttl -= safeDt;
      if (e.ttl <= 0) {
        this.explosions.splice(i, 1);
      }
    }
  }

  // ==================== Batcher Interface for models.js ====================

  _resetFrameBatches() {
    this.opaqueCount = 0;
    this.translucentCount = 0;
    for (const arr of this.texturedBoxesById.values()) arr.length = 0;
    for (const arr of this.texturedCardsById.values()) arr.length = 0;
  }

  addBox(x, y, z, sx, sy, sz, color, ry = 0, pitch = 0, roll = 0, emissive = 0) {
    if (this.opaqueCount >= MAX_INSTANCES) return;
    const [r, g, b] = parseColorRgb(color);
    const o = this.opaqueCount * FLOATS_PER_INSTANCE;
    const d = this.opaqueData;
    d[o + 0] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = sx;
    d[o + 4] = sy;
    d[o + 5] = sz;
    d[o + 6] = ry;
    d[o + 7] = pitch;
    d[o + 8] = roll;
    d[o + 9] = r;
    d[o + 10] = g;
    d[o + 11] = b;
    d[o + 12] = emissive;
    this.opaqueCount++;
  }

  addTranslucentBox(x, y, z, sx, sy, sz, color, alpha = 0.4, ry = 0, pitch = 0, roll = 0) {
    if (this.translucentCount >= 4096) return;
    const [r, g, b] = parseColorRgb(color);
    const o = this.translucentCount * FLOATS_PER_INSTANCE;
    const d = this.translucentData;
    d[o + 0] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = sx;
    d[o + 4] = sy;
    d[o + 5] = sz;
    d[o + 6] = ry;
    d[o + 7] = pitch;
    d[o + 8] = roll;
    d[o + 9] = r;
    d[o + 10] = g;
    d[o + 11] = b;
    d[o + 12] = clamp(alpha, 0.04, 0.95);
    this.translucentCount++;
  }

  addTexturedBox(opts) {
    if (!opts) return;
    const avatarId = opts.avatarId || 'default_hero';
    let list = this.texturedBoxesById.get(avatarId);
    if (!list) {
      list = [];
      this.texturedBoxesById.set(avatarId, list);
    }
    const [r, g, b] = parseColorRgb(opts.tint || '#ffffff');
    list.push(
      opts.x || 0,
      opts.y || 0,
      opts.z || 0,
      opts.sx ?? 1,
      opts.sy ?? 1,
      opts.sz ?? 1,
      opts.yaw || 0,
      opts.pitch || 0,
      opts.roll || 0,
      r,
      g,
      b,
      opts.emissive ?? 0.15
    );
  }

  addTexturedCard(opts) {
    if (!opts) return;
    const avatarId = opts.avatarId || 'default_hero';
    let list = this.texturedCardsById.get(avatarId);
    if (!list) {
      list = [];
      this.texturedCardsById.set(avatarId, list);
    }

    const x = opts.x || 0;
    const y = opts.y || 0;
    const z = opts.z || 0;
    let yaw = opts.yaw || 0;
    let pitch = opts.pitch || 0;

    if (opts.billboard === 'y_blend' || opts.billboard === true) {
      // Faces camera horizontally so custom photo cutouts are ALWAYS big, front-facing, and readable!
      const camYaw = Math.atan2(this.camEye[0] - x, this.camEye[2] - z);
      const twist = Math.sin((opts.yaw || 0) - camYaw) * 0.22;
      yaw = camYaw + twist;
      pitch = -0.18 + (opts.pitch || 0) * 0.35;
    }

    const [r, g, b] = parseColorRgb(opts.tint || '#ffffff');
    list.push(
      x,
      y,
      z,
      opts.width ?? 2.0,
      opts.height ?? 2.0,
      1.0,
      yaw,
      pitch,
      opts.roll || 0,
      r,
      g,
      b,
      opts.emissive ?? 0.2
    );
  }

  _appendCachedStaticChunk(staticFloats) {
    const count = staticFloats.length / FLOATS_PER_INSTANCE;
    if (this.opaqueCount + count > MAX_INSTANCES) return;
    this.opaqueData.set(staticFloats, this.opaqueCount * FLOATS_PER_INSTANCE);
    this.opaqueCount += count;
  }

  // ==================== Main Render Entrypoint ====================

  render(sceneState, dt = 0.016, time = 0) {
    const gl = this.gl;
    if (!gl || !sceneState) return;

    this._updateParticles(dt);
    this._resetFrameBatches();

    const world = sceneState.world;
    const biomeId = sceneState.biomeId || (world && world.biomeId) || 'city';
    const biome = BIOMES[biomeId] || BIOMES.city;

    const focusX =
      sceneState.focusX ??
      sceneState.localPlayer?.x ??
      this.camTarget[0] ??
      0;
    const focusZ =
      sceneState.focusZ ??
      sceneState.localPlayer?.z ??
      this.camTarget[2] ??
      0;

    // 1. Assemble visible world chunks (cached static geometry + dynamic props, ? boxes, water foam & geysers)
    if (world) {
      const seedKey = `${world.seed}:${biomeId}`;
      if (this.cachedSeedKey !== seedKey) {
        this.chunkStaticCache.clear();
        this.cachedSeedKey = seedKey;
      }

      const chunks = world.getVisibleChunks(focusX, focusZ);
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        let staticArr = this.chunkStaticCache.get(chunk.key);
        if (!staticArr) {
          staticArr = buildChunkStaticInstanceData(chunk, world, biome);
          this.chunkStaticCache.set(chunk.key, staticArr);
        }
        this._appendCachedStaticChunk(staticArr);

        // Animated sparkling river foam streaks
        if (chunk.district === 'river') {
          for (let f = 0; f < 4; f++) {
            const flowX = chunk.x0 + ((f * 15 + time * 9.5) % WORLD_CONFIG.CHUNK_SIZE);
            const rz = world.getRiverCenterZ(flowX, chunk.cz) + (f % 2 === 0 ? -4.8 : 4.8);
            this.addBox(flowX, WORLD_CONFIG.WATER_Y + 0.04, rz, 3.4, 0.06, 0.55, '#e0f2fe', 0, 0, 0, 0.55);
          }
        }

        // Dynamic destructible props
        const props = chunk.props;
        for (let p = 0; p < props.length; p++) {
          if (!props[p].smashed) {
            emitPropVisuals(this, props[p], biomeId, time);
          }
        }

        // Floating spinning Mario Kart ? Item Boxes
        const boxes = chunk.itemBoxes;
        for (let b = 0; b < boxes.length; b++) {
          if (!boxes[b].collected) {
            emitItemBoxVisuals(this, boxes[b], time);
          }
        }
      }

      // Active hydrant water geysers & gas station fire plumes
      if (Array.isArray(world.geysers)) {
        for (let g = 0; g < world.geysers.length; g++) {
          const gy = world.geysers[g];
          const isFire = gy.type === 'fire';
          for (let s = 0; s < 4; s++) {
            const lift = ((time * 9 + s * 1.1) % 4.2);
            const spread = lift * 0.22 * (s % 2 === 0 ? 1 : -1);
            this.addBox(
              gy.x + spread,
              gy.y + 0.5 + lift,
              gy.z - spread,
              0.55,
              0.85,
              0.55,
              isFire ? (s % 2 === 0 ? '#f97316' : '#fef08a') : '#7dd3fc',
              time * 4,
              0,
              0,
              isFire ? 0.95 : 0.45
            );
          }
        }
      }
    }

    // 2. Local & Remote Multiplayer Players
    if (sceneState.localPlayer) {
      emitPlayerVisuals(this, sceneState.localPlayer, time);
    }

    const remotes = sceneState.remotePlayers;
    if (remotes) {
      if (Array.isArray(remotes)) {
        for (let i = 0; i < remotes.length; i++) {
          emitPlayerVisuals(this, remotes[i], time);
        }
      } else if (remotes instanceof Map) {
        for (const rp of remotes.values()) {
          emitPlayerVisuals(this, rp, time);
        }
      } else if (typeof remotes === 'object') {
        for (const rp of Object.values(remotes)) {
          emitPlayerVisuals(this, rp, time);
        }
      }
    }

    // 3. Police Units (Cruiser, SUV, SWAT, Heli, Army, Tank)
    if (Array.isArray(sceneState.cops)) {
      for (let i = 0; i < sceneState.cops.length; i++) {
        emitCopVisuals(this, sceneState.cops[i], time);
      }
    }

    // 4. Civilian Traffic
    if (Array.isArray(sceneState.traffic)) {
      for (let i = 0; i < sceneState.traffic.length; i++) {
        emitTrafficVisuals(this, sceneState.traffic[i], time);
      }
    }

    // 5. Mario Kart Projectiles (Homing Shells, Bananas, Bob-ombs, Tank Shells, Shockwaves, Lightning)
    if (Array.isArray(sceneState.projectiles)) {
      for (let i = 0; i < sceneState.projectiles.length; i++) {
        emitProjectileVisuals(this, sceneState.projectiles[i], time);
      }
    }

    // 6. Tumbling 3D Debris, Smoke & Explosion Flash Spheres/Rings
    for (let i = 0; i < this.debris.length; i++) {
      const d = this.debris[i];
      const s = d.scale * clamp(d.ttl * 1.4, 0.25, 1.0);
      this.addBox(d.x, d.y, d.z, s, s, s, d.rgb, d.ry, d.rx, 0, d.emissive);
    }

    for (let i = 0; i < this.smoke.length; i++) {
      const s = this.smoke[i];
      const alpha = clamp((s.ttl / s.maxTtl) * 0.55, 0.05, 0.6);
      this.addTranslucentBox(s.x, s.y, s.z, s.size, s.size, s.size, s.rgb, alpha, s.ry);
    }

    for (let i = 0; i < this.explosions.length; i++) {
      const e = this.explosions[i];
      const prog = 1.0 - e.ttl / e.maxTtl;
      const flashS = e.maxRadius * (0.45 + prog * 0.95) * (1.0 - prog * 0.5);
      this.addTranslucentBox(e.x, e.y + 1.1, e.z, flashS, flashS, flashS, '#fef08a', (1.0 - prog) * 0.78, prog * 3.0, prog * 2.0);
    }

    // ==================== GPU Pass 1: 2048x2048 Directional Sun Shadow Map ====================
    this._updateLightMatrices(focusX, focusZ);

    if (this.isWebGL2 && this.shadowsReady) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFBO);
      gl.viewport(0, 0, SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.clear(gl.DEPTH_BUFFER_BIT);

      gl.useProgram(this.shadowProg);
      gl.uniformMatrix4fv(this.shadowUniforms.lightVP, false, this.lightVPMatrix);
      gl.uniform1i(this.shadowUniforms.useAlphaTex, 0);

      if (this.opaqueCount > 0) {
        gl.bindVertexArray(this.cubeVAO);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.opaqueData.subarray(0, this.opaqueCount * FLOATS_PER_INSTANCE));
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, this.opaqueCount);
      }

      // Textured boxes & custom photo cards also cast real silhouettes into the shadow map!
      for (const [avatarId, arr] of this.texturedBoxesById.entries()) {
        if (arr.length === 0) continue;
        const count = arr.length / FLOATS_PER_INSTANCE;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(arr));
        gl.bindVertexArray(this.cubeVAO);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 36, count);
      }

      gl.disable(gl.CULL_FACE);
      gl.uniform1i(this.shadowUniforms.useAlphaTex, 1);
      gl.uniform1i(this.shadowUniforms.tex, 0);
      gl.activeTexture(gl.TEXTURE0);

      for (const [avatarId, arr] of this.texturedCardsById.entries()) {
        if (arr.length === 0) continue;
        const tex = this._ensureFallbackAvatarTexture(avatarId);
        if (!tex) continue;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        const count = arr.length / FLOATS_PER_INSTANCE;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new Float32Array(arr));
        gl.bindVertexArray(this.cardVAO);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
      }

      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // ==================== GPU Pass 2: Main Lit & Shadowed Viewport ====================
    const vpW = this.canvas ? this.canvas.width : this.cssWidth;
    const vpH = this.canvas ? this.canvas.height : this.cssHeight;
    gl.viewport(0, 0, vpW, vpH);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // 2A. Sky Gradient Background
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(this.skyProg);
    gl.uniform3fv(this.skyUniforms.skyTop, biome.skyTop);
    gl.uniform3fv(this.skyUniforms.skyBottom, biome.skyBottom);
    if (this.isWebGL2) {
      gl.bindVertexArray(this.skyVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.skyVBO);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // 2B. Opaque Instanced Voxel World + Vehicles + Buildings + Props
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    gl.useProgram(this.voxelProg);
    gl.uniformMatrix4fv(this.voxelUniforms.viewProj, false, this.viewProjMatrix);
    if (this.voxelUniforms.lightVP) {
      gl.uniformMatrix4fv(this.voxelUniforms.lightVP, false, this.lightVPMatrix);
    }
    gl.uniform3fv(this.voxelUniforms.sunDir, SUN_DIR);
    gl.uniform3fv(this.voxelUniforms.sunColor, biome.sunColor);
    gl.uniform3fv(this.voxelUniforms.ambientColor, biome.ambientColor);
    gl.uniform3fv(this.voxelUniforms.fogColor, biome.fogColor);
    gl.uniform3fv(this.voxelUniforms.camPos, this.camEye);
    gl.uniform1f(this.voxelUniforms.fogNear, 145.0);
    gl.uniform1f(this.voxelUniforms.fogFar, 315.0);
    gl.uniform1i(this.voxelUniforms.translucentMode, 0);
    gl.uniform1i(this.voxelUniforms.texturedMode, 0);

    if (this.isWebGL2 && this.shadowsReady) {
      gl.uniform1i(this.voxelUniforms.shadowsEnabled, 1);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.shadowDepthTex);
      gl.uniform1i(this.voxelUniforms.shadowMap, 1);
    } else if (this.voxelUniforms.shadowsEnabled) {
      gl.uniform1i(this.voxelUniforms.shadowsEnabled, 0);
    }

    if (this.opaqueCount > 0) {
      this._drawInstancedBatch(this.cubeVAO, this.cubeVBO, 36, this.opaqueData.subarray(0, this.opaqueCount * FLOATS_PER_INSTANCE), this.opaqueCount);
    }

    // 2C. Tire Skid Marks & Scorch Decals on Roads
    if (this.skidQuadCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(this.ribbonProg);
      gl.uniformMatrix4fv(this.ribbonUniforms.viewProj, false, this.viewProjMatrix);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.ribbonVBO);
      if (this.skidDirty) {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.skidVerts.subarray(0, this.skidQuadCount * 42));
        this.skidDirty = false;
      }
      if (this.isWebGL2) {
        gl.bindVertexArray(this.ribbonVAO);
        gl.drawArrays(gl.TRIANGLES, 0, this.skidQuadCount * 6);
        gl.bindVertexArray(null);
      } else {
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
        gl.drawArrays(gl.TRIANGLES, 0, this.skidQuadCount * 6);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // 2D. Textured 3D Boxes (Photo-Car Chassis, Runner Torso, Rainbow ? Item Boxes) & Custom Photo Cutout Cards
    gl.useProgram(this.voxelProg);
    gl.uniform1i(this.voxelUniforms.texturedMode, 1);
    gl.uniform1i(this.voxelUniforms.translucentMode, 0);
    gl.uniform1i(this.voxelUniforms.tex, 0);
    gl.activeTexture(gl.TEXTURE0);

    gl.enable(gl.CULL_FACE);
    for (const [avatarId, arr] of this.texturedBoxesById.entries()) {
      if (arr.length === 0) continue;
      const tex = this._ensureFallbackAvatarTexture(avatarId);
      if (!tex) continue;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const data = new Float32Array(arr);
      this._drawInstancedBatch(this.cubeVAO, this.cubeVBO, 36, data, arr.length / FLOATS_PER_INSTANCE);
    }

    gl.disable(gl.CULL_FACE);
    for (const [avatarId, arr] of this.texturedCardsById.entries()) {
      if (arr.length === 0) continue;
      const tex = this._ensureFallbackAvatarTexture(avatarId);
      if (!tex) continue;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const data = new Float32Array(arr);
      this._drawInstancedBatch(this.cardVAO, this.cardVBO, 6, data, arr.length / FLOATS_PER_INSTANCE);
    }

    // 2E. Translucent Effects (Helicopter Ground Spotlight, Rising Smoke, Item Box Pads, Explosion Flash)
    if (this.translucentCount > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.enable(gl.CULL_FACE);
      gl.uniform1i(this.voxelUniforms.texturedMode, 0);
      gl.uniform1i(this.voxelUniforms.translucentMode, 1);

      this._drawInstancedBatch(
        this.cubeVAO,
        this.cubeVBO,
        36,
        this.translucentData.subarray(0, this.translucentCount * FLOATS_PER_INSTANCE),
        this.translucentCount
      );

      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }

  _drawInstancedBatch(vao, meshVBO, vertCount, instanceSubArray, instanceCount) {
    const gl = this.gl;
    if (instanceCount <= 0) return;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceSubArray);

    if (this.isWebGL2) {
      gl.bindVertexArray(vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, vertCount, instanceCount);
      gl.bindVertexArray(null);
    } else if (this.instancedExt) {
      this._bindWebGL1InstancedState(meshVBO);
      this.instancedExt.drawArraysInstancedANGLE(gl.TRIANGLES, 0, vertCount, instanceCount);
    }
  }
}
