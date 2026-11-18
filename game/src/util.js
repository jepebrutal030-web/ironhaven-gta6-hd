import * as THREE from 'three';

// Seeded RNG (mulberry32) so the city is identical on every load with the same seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
export const range = (rng, a, b) => a + rng() * (b - a);
export const chance = (rng, p) => rng() < p;
export const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };

// Canvas texture: draw with a callback, get a repeat-wrapped sRGB texture.
export function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Circle collision: pushes point p (radius r) out of {x,z,r} circles. Returns true on hit.
// A lateral slide component keeps cars sliding around obstacles instead of bouncing straight back.
export function collideCircle(p, r, colliders, bias = 0.35) {
  let hit = false;
  for (const c of colliders) {
    const dx = p.x - c.x, dz = p.z - c.z;
    const d2 = dx * dx + dz * dz, rr = r + c.r;
    if (d2 < rr * rr && d2 > 1e-6) {
      const d = Math.sqrt(d2);
      const overlap = rr - d;
      const nx = dx / d, nz = dz / d;
      p.x += nx * overlap + -nz * overlap * bias;
      p.z += nz * overlap + nx * overlap * bias;
      hit = true;
    }
  }
  return hit;
}

// Merge several transformed geometries into one BufferGeometry.
// parts: [{ geo, m: Matrix4 }] — all geoms need position/normal/uv and an index.
export function mergeGeoms(parts) {
  let vCount = 0, iCount = 0;
  for (const p of parts) {
    vCount += p.geo.attributes.position.count;
    iCount += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
  }
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint32Array(iCount);
  let vo = 0, io = 0;
  const nm = new THREE.Matrix3();
  for (const p of parts) {
    const g = p.geo;
    const m = p.m;
    nm.getNormalMatrix(m);
    const pa = g.attributes.position.array, na = g.attributes.normal.array, ua = g.attributes.uv.array;
    const n = g.attributes.position.count;
    const e = m.elements, ne = nm.elements;
    for (let i = 0; i < n; i++) {
      const x = pa[i * 3], y = pa[i * 3 + 1], z = pa[i * 3 + 2];
      pos[(vo + i) * 3]     = e[0] * x + e[4] * y + e[8] * z + e[12];
      pos[(vo + i) * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      pos[(vo + i) * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx = na[i * 3], ny = na[i * 3 + 1], nz = na[i * 3 + 2];
      nor[(vo + i) * 3]     = ne[0] * nx + ne[3] * ny + ne[6] * nz;
      nor[(vo + i) * 3 + 1] = ne[1] * nx + ne[4] * ny + ne[7] * nz;
      nor[(vo + i) * 3 + 2] = ne[2] * nx + ne[5] * ny + ne[8] * nz;
      uv[(vo + i) * 2] = ua[i * 2];
      uv[(vo + i) * 2 + 1] = ua[i * 2 + 1];
    }
    if (g.index) {
      const ia = g.index.array;
      for (let i = 0; i < ia.length; i++) idx[io + i] = ia[i] + vo;
      io += ia.length;
    } else {
      for (let i = 0; i < n; i++) idx[io + i] = vo + i;
      io += n;
    }
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// Merge geometries with a per-part flat color (writes a 'color' attribute; use with a
// material that has vertexColors: true). parts: [{ geo, m: Matrix4, color: THREE.Color }]
export function mergeGeomsColored(parts) {
  const g = mergeGeoms(parts);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  let vo = 0;
  for (const p of parts) {
    const cnt = p.geo.attributes.position.count;
    for (let i = 0; i < cnt; i++) {
      col[(vo + i) * 3] = p.color.r;
      col[(vo + i) * 3 + 1] = p.color.g;
      col[(vo + i) * 3 + 2] = p.color.b;
    }
    vo += cnt;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Compose a Matrix4 from position + Y rotation + optional non-uniform scale.
export function mat4(x, y, z, rotY = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0));
  m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
  return m;
}
