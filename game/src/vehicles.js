import * as THREE from 'three';
import { clamp, normAngle, pick, range, chance, collideCircle, mergeGeoms, mergeGeomsColored, mat4 } from './util.js';

export const CAR_MODELS = [
  { name: 'Marlin', kind: 'sedan', top: 26, accel: 14, grip: 1.0, len: 4.4, wid: 1.9, colors: [0xb03030, 0x2a4a6a, 0x3a3a3a, 0xc8c8c8, 0x2a6a4a] },
  { name: 'Vortex', kind: 'coupe', top: 32, accel: 17, grip: 1.05, len: 4.2, wid: 1.85, colors: [0xd8a028, 0xb03030, 0x1a1a1a, 0x3a6ab0] },
  { name: 'Bison', kind: 'suv', top: 24, accel: 12, grip: 0.95, len: 4.8, wid: 2.0, colors: [0x2a4a3a, 0x5a5a5a, 0x8a6a3a, 0x303a4a] },
  { name: 'Rancher', kind: 'pickup', top: 25, accel: 13, grip: 0.95, len: 5.0, wid: 2.0, colors: [0x7a3a2a, 0x3a5a7a, 0x4a4a4a, 0xd8d0c0] },
  { name: 'Hauler', kind: 'van', top: 21, accel: 10, grip: 0.9, len: 5.2, wid: 2.1, colors: [0xc8c8c8, 0x3a6a8a, 0x8a8a8a, 0x6a3a3a] },
  { name: 'Metro', kind: 'bus', top: 18, accel: 8, grip: 0.85, len: 7.5, wid: 2.4, colors: [0x2a6ab0, 0xd8b028, 0x3a8a5a] },
  { name: 'Viper', kind: 'bike', top: 36, accel: 20, grip: 1.2, len: 2.2, wid: 0.8, colors: [0xc03028, 0x1a1a1a, 0x2a5ac0] },
  { name: 'WaveRunner', kind: 'boat', top: 20, accel: 9, grip: 1.0, len: 6, wid: 2.2, colors: [0xe8e8e8, 0x2a6ab0] },
];

const glassMat = new THREE.MeshStandardMaterial({ color: 0x16222e, roughness: 0.12, metalness: 0.6 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 });
const hubMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.35, metalness: 0.7 });
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.2, metalness: 0.85 });
const lightFrontMat = new THREE.MeshStandardMaterial({ color: 0xfff6c8, emissive: 0xffe9a0, emissiveIntensity: 1.6 });
const lightRearMat = new THREE.MeshStandardMaterial({ color: 0xa01818, emissive: 0xd02020, emissiveIntensity: 1.4 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.8 });
const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 });
const plateMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8 });

function roundedRect(w, l, r) {
  const s = new THREE.Shape();
  const hw = w / 2, hl = l / 2;
  s.moveTo(-hw + r, -hl);
  s.lineTo(hw - r, -hl); s.absarc(hw - r, -hl + r, r, -Math.PI / 2, 0);
  s.lineTo(hw, hl - r); s.absarc(hw - r, hl - r, r, 0, Math.PI / 2);
  s.lineTo(-hw + r, hl); s.absarc(-hw + r, hl - r, r, Math.PI / 2, Math.PI);
  s.lineTo(-hw, -hl + r); s.absarc(-hw + r, -hl + r, r, Math.PI, Math.PI * 1.5);
  return s;
}
function extrudeGeo(w, l, h) {
  const geo = new THREE.ExtrudeGeometry(roundedRect(w, l, Math.min(w, l) * 0.22), { depth: h, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 2, steps: 1 });
  geo.rotateX(Math.PI / 2);
  geo.center();
  return geo;
}
// Merge a list of {geo, m} parts into one mesh (castShadow on) and add it to parent.
function flushParts(parts, mat, parent) {
  if (!parts.length) return null;
  const mesh = new THREE.Mesh(mergeGeoms(parts), mat);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
// Merge a tire + hub into one vertex-colored wheel mesh (spins visibly, 1 draw call).
function makeWheelMesh(wr) {
  const tire = new THREE.CylinderGeometry(wr, wr, 0.26, 18);
  tire.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(wr * 0.55, wr * 0.55, 0.28, 12);
  hub.rotateZ(Math.PI / 2);
  const geo = mergeGeomsColored([
    { geo: tire, m: new THREE.Matrix4(), color: new THREE.Color(0x141414) },
    { geo: hub, m: new THREE.Matrix4(), color: new THREE.Color(0xb8bcc0) },
  ]);
  const mesh = new THREE.Mesh(geo, wheelMat);
  mesh.castShadow = true;
  return mesh;
}

// Build one detailed car. Returns {group, body, wheels:[{mesh,steer}], doors:{left,right}, doorT}.
export function buildCar(model, color) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  group.add(body);
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 0.45 });
  const L = model.len, W = model.wid;
  const wheels = [];
  const P = [], G = [], C = [], D = [], FL = [], RL = [], PL = [];
  const add = (arr, geo, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) => arr.push({ geo, m: mat4(x, y, z, ry, sx, sy, sz) });
  if (model.kind === 'bike') {
    add(P, extrudeGeo(0.55, L, 0.55), 0, 0.55, 0);
    add(P, new THREE.SphereGeometry(0.32, 12, 8), 0, 0.95, 0.45, 0, 1, 0.7, 1.6);
    add(D, new THREE.BoxGeometry(0.4, 0.12, 0.9), 0, 0.95, -0.3);
    const bar = new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8); bar.rotateZ(Math.PI / 2);
    add(C, bar, 0, 1.05, 0.85);
    add(FL, new THREE.SphereGeometry(0.14, 10, 8), 0, 0.75, L / 2);
    const wr = 0.35;
    for (const [wx, wz, steer] of [[0, L / 2 - 0.35, true], [0, -L / 2 + 0.35, false]]) {
      const sg = new THREE.Group(); sg.position.set(wx, wr, wz);
      const wm = makeWheelMesh(wr);
      sg.add(wm); group.add(sg);
      wheels.push({ mesh: wm, steer: steer ? sg : null });
    }
  } else if (model.kind === 'boat') {
    add(P, extrudeGeo(W, L, 0.9), 0, 0.6, 0);
    add(G, new THREE.BoxGeometry(W * 0.6, 0.9, L * 0.35), 0, 1.5, -0.4);
    add(C, new THREE.CylinderGeometry(0.06, 0.08, 2.2, 8), 0, 2.4, 0.6);
  } else {
    const isBus = model.kind === 'bus', isVan = model.kind === 'van', isPickup = model.kind === 'pickup';
    const bodyH = isBus || isVan ? 1.15 : 0.72;
    const cabLen = isBus || isVan ? L * 0.72 : L * 0.48;
    const cabZ = isBus || isVan ? 0 : -L * 0.06;
    const cabY = 0.42 + bodyH + 0.28;
    add(P, extrudeGeo(W, L, bodyH), 0, 0.42 + bodyH / 2, 0);
    add(P, extrudeGeo(W * 0.88, cabLen, 0.62), 0, cabY, cabZ);
    add(P, new THREE.BoxGeometry(W * 0.86, 0.08, cabLen * 0.9), 0, cabY + 0.32, cabZ);
    add(G, new THREE.BoxGeometry(W * 0.9, 0.42, cabLen * 0.92), 0, cabY - 0.04, cabZ);
    for (const sgn of [-1, 1]) {
      add(P, new THREE.BoxGeometry(0.16, 0.1, 0.24), sgn * (W / 2 + 0.08), 1.15, L * 0.18);
      add(FL, new THREE.BoxGeometry(0.42, 0.16, 0.08), sgn * W * 0.32, 0.78, L / 2 + 0.02);
      add(RL, new THREE.BoxGeometry(0.42, 0.14, 0.08), sgn * W * 0.32, 0.78, -L / 2 - 0.02);
    }
    if (isPickup) add(D, new THREE.BoxGeometry(W * 0.85, 0.3, L * 0.3), 0, 0.42 + bodyH + 0.1, -L * 0.3);
    add(D, new THREE.BoxGeometry(W * 0.5, 0.18, 0.06), 0, 0.62, L / 2 + 0.02);
    add(C, new THREE.BoxGeometry(W * 0.98, 0.18, 0.12), 0, 0.42, L / 2 + 0.04);
    add(C, new THREE.BoxGeometry(W * 0.98, 0.18, 0.12), 0, 0.42, -L / 2 - 0.04);
    add(PL, new THREE.BoxGeometry(0.5, 0.16, 0.03), 0, 0.55, -L / 2 - 0.1);
    const wr = model.kind === 'bus' ? 0.48 : 0.36;
    for (const [wx, wz, steer] of [[-W / 2 + 0.12, L / 2 - 0.95, true], [W / 2 - 0.12, L / 2 - 0.95, true], [-W / 2 + 0.12, -L / 2 + 0.95, false], [W / 2 - 0.12, -L / 2 + 0.95, false]]) {
      const sg = new THREE.Group(); sg.position.set(wx, wr, wz);
      const wm = makeWheelMesh(wr);
      sg.add(wm); group.add(sg);
      wheels.push({ mesh: wm, steer: steer ? sg : null });
    }
  }
  flushParts(P, paint, body);
  flushParts(G, glassMat, body);
  flushParts(C, chromeMat, body);
  flushParts(D, darkMat, body);
  flushParts(FL, lightFrontMat, body);
  flushParts(RL, lightRearMat, body);
  flushParts(PL, plateMat, body);
  // doors (side panels that swing open on enter/exit)
  const doors = {};
  if (model.kind !== 'bike' && model.kind !== 'boat') {
    for (const side of ['left', 'right']) {
      const s = side === 'left' ? -1 : 1;
      const pivot = new THREE.Group();
      pivot.position.set(s * (W / 2 - 0.02), 0.95, L * 0.22);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, L * 0.32), paint);
      panel.position.set(0, 0, -L * 0.16);
      panel.castShadow = true;
      pivot.add(panel);
      body.add(pivot);
      doors[side] = pivot;
    }
  }
  return { group, body, wheels, doors, doorT: 0, wheelR: model.kind === 'bus' ? 0.48 : 0.36, paintMat: paint };
}

export function makeCar(model, color, x, z, angle) {
  const built = buildCar(model, color);
  const car = {
    ...built, model, color, name: model.name,
    angle, speed: 0, steer: 0, health: 100, dead: false,
    isPlayer: false, isTraffic: false, isParked: false, isPolice: false,
    stuckT: 0, skid: false,
  };
  car.group.position.set(x, 0, z);
  car.group.rotation.y = angle;
  return car;
}

// Arcade car physics. ctl: {throttle -1..1, steer -1..1, handbrake bool}
export function stepCar(car, dt, ctl, ctx) {
  if (car.dead) return;
  const m = car.model;
  const fwd = Math.sin(car.angle), fwdZ = Math.cos(car.angle);
  if (ctl.throttle > 0) car.speed += ctl.throttle * m.accel * dt;
  else if (ctl.throttle < 0) {
    if (car.speed > 0.5) car.speed += ctl.throttle * m.accel * 1.6 * dt;
    else car.speed += ctl.throttle * m.accel * 0.55 * dt;
  }
  car.speed = clamp(car.speed, -13, m.top);
  car.speed -= car.speed * (ctl.handbrake ? 1.4 : 0.35) * dt;
  if (Math.abs(car.speed) < 0.05 && ctl.throttle === 0) car.speed = 0;
  const steerTarget = ctl.steer * (ctl.handbrake ? 1.35 : 1);
  car.steer += (steerTarget - car.steer) * Math.min(1, dt * 8);
  const spdF = Math.min(1, Math.abs(car.speed) / 9);
  car.angle += car.steer * m.grip * 0.42 * spdF * Math.sign(car.speed || 1) * dt * (ctl.handbrake ? 1.5 : 1);
  car.skid = ctl.handbrake && Math.abs(car.speed) > 8;
  const p = { x: car.group.position.x + fwd * car.speed * dt, z: car.group.position.z + fwdZ * car.speed * dt };
  const hitWall = collideCircle(p, 1.7, ctx.colliders);
  if (hitWall) {
    if (Math.abs(car.speed) > 6) { car.health -= Math.abs(car.speed) * 0.7; if (ctx.onCrash) ctx.onCrash(car, Math.abs(car.speed)); }
    car.speed *= 0.45;
  }
  for (const o of ctx.cars) {
    if (o === car || o.dead) continue;
    const dx = p.x - o.group.position.x, dz = p.z - o.group.position.z;
    const d2 = dx * dx + dz * dz, rr = 4.2;
    if (d2 < rr * rr && d2 > 1e-4) {
      const d = Math.sqrt(d2), push = (rr - d) / 2;
      p.x += (dx / d) * push; p.z += (dz / d) * push;
      const rel = Math.abs(car.speed - o.speed);
      if (rel > 5) { car.health -= rel * 0.5; o.health -= rel * 0.5; if (ctx.onCrash) ctx.onCrash(car, rel); }
      if (o.isTraffic || o.isParked) o.speed = car.speed * 0.4;
      car.speed *= 0.82;
    }
  }
  car.group.position.x = p.x; car.group.position.z = p.z;
  car.group.rotation.y = car.angle;
  const spin = (car.speed * dt) / (car.wheelR || 0.36);
  for (const w of car.wheels) { w.mesh.rotation.x += spin; if (w.steer) w.steer.rotation.y = car.steer * 0.42; }
  car.body.rotation.z = -car.steer * Math.min(1, Math.abs(car.speed) / 12) * 0.03;
  car.body.rotation.x = clamp(-car.speed * 0.0006, -0.02, 0.02);
  // door close timer
  if (car.doorT > 0) {
    car.doorT -= dt;
    const open = clamp(car.doorT / 0.25, 0, 1);
    for (const side of ['left', 'right']) {
      const d = car.doors[side];
      if (d) d.rotation.y = (side === 'left' ? -1 : 1) * open * 1.1;
    }
    if (car.doorT <= 0) for (const side of ['left', 'right']) { const d = car.doors[side]; if (d) d.rotation.y = 0; }
  }
  if (car.health <= 0 && !car.dead) { car.dead = true; if (ctx.onWreck) ctx.onWreck(car); }
}

// Steer value that turns a car toward (tx,tz): same math as the police ram controller.
export function steerTo(car, tx, tz) {
  const dx = tx - car.group.position.x, dz = tz - car.group.position.z;
  const want = Math.atan2(dx, dz);
  const d = normAngle(want - car.angle);
  return clamp(d * 1.6, -1, 1);
}

export function nearestCar(pos, maxDist, cars, pred = null) {
  let best = null, bd = maxDist;
  for (const c of cars) {
    if (c.dead || c.isPlayer) continue;
    if (pred && !pred(c)) continue;
    const dx = c.group.position.x - pos.x, dz = c.group.position.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

export class Traffic {
  constructor(scene, rng, colliders, world) {
    this.cars = []; this.rng = rng; this.colliders = colliders; this.world = world;
    this.spawn(scene);
  }
  spawn(scene) {
    const rng = this.rng;
    const driveModels = CAR_MODELS.filter((m) => m.kind !== 'boat');
    for (let i = 0; i < 22; i++) {
      const model = pick(rng, driveModels);
      const axis = chance(rng, 0.5) ? 'x' : 'z';
      const line = pick(rng, [-168, -112, -56, 0, 56, 112, 168]);
      const dir = chance(rng, 0.5) ? 1 : -1;
      const lane = line + (axis === 'x' ? 2.2 : -2.2) * (dir > 0 ? 1 : -1);
      const along = range(rng, -180, 180);
      const x = axis === 'x' ? along : lane;
      const z = axis === 'x' ? lane : along;
      const angle = axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
      const car = makeCar(model, pick(rng, model.colors), x, z, angle);
      car.isTraffic = true;
      car.speed = range(rng, 8, 13);
      car.axis = axis; car.line = line; car.dir = dir; car.cruise = range(rng, 9, 14);
      scene.add(car.group);
      this.cars.push(car);
    }
  }
  update(dt, ctx) {
    for (const car of this.cars) {
      if (car.dead) continue;
      const pos = car.group.position;
      // next intersection ahead on this axis
      const axes = [-168, -112, -56, 0, 56, 112, 168];
      const along = car.axis === 'x' ? pos.x : pos.z;
      let next = null;
      for (const a of axes) {
        const d = (a - along) * car.dir;
        if (d > 4 && (next === null || d < next.d)) next = { a, d };
      }
      let target = car.cruise;
      if (next) {
        const light = this.world.lightStateAt(car.axis === 'x' ? next.a : pos.x, car.axis === 'x' ? pos.z : next.a);
        if (light === 'red' && next.d < 16) target = 0;
        else if (light === 'yellow' && next.d < 10) target = Math.min(target, 4);
      }
      // car ahead in the same lane: match speed
      for (const o of ctx.cars) {
        if (o === car || o.dead) continue;
        const dx = o.group.position.x - pos.x, dz = o.group.position.z - pos.z;
        const ahead = car.axis === 'x' ? dx * car.dir : dz * car.dir;
        const lat = car.axis === 'x' ? Math.abs(dz) : Math.abs(dx);
        if (ahead > 0 && ahead < 9 && lat < 3) { target = Math.min(target, Math.max(0, o.speed - 1)); break; }
      }
      // turn at intersections sometimes
      if (next && next.d < 3 && Math.random() < 0.3) {
        const turnAxis = car.axis === 'x' ? 'z' : 'x';
        const ndir = Math.random() < 0.5 ? 1 : -1;
        car.axis = turnAxis; car.line = next.a; car.dir = ndir;
      }
      // steer toward a point ahead on the lane
      const laneOff = car.axis === 'x' ? 2.2 : -2.2;
      const tx = car.axis === 'x' ? pos.x + car.dir * 22 : car.line + laneOff;
      const tz = car.axis === 'x' ? car.line + laneOff : pos.z + car.dir * 22;
      const steer = steerTo(car, tx, tz);
      const throttle = clamp((target - car.speed) * 0.25, -1, 1);
      stepCar(car, dt, { throttle, steer, handbrake: false }, ctx);
      // keep inside the city: turn around at the edge
      if (Math.abs(pos.x) > 190 || Math.abs(pos.z) > 190) {
        car.dir *= -1;
        car.angle = car.axis === 'x' ? (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (car.dir > 0 ? 0 : Math.PI);
      }
    }
  }
}
