import * as THREE from 'three';
import { pick, range, chance, clamp, mergeGeomsColored, mat4 } from './util.js';

const SKINS = [0xd9a986, 0xb98a62, 0x8a5a3a, 0xe8c09a, 0x6a4530];
const SHIRTS = [0xc03030, 0x2a5a8a, 0x3a7a3a, 0xd8b028, 0x6a4a8a, 0xe8e8e8, 0x303030, 0xc07030];
const PANTS = [0x2a3a5a, 0x3a3a3a, 0x5a4a3a, 0x4a5a6a, 0x2a2a2a];
const HAIRS = [0x1a1a1a, 0x4a2a1a, 0x8a6a3a, 0x6a6a6a, 0xd8c8a8];

// One smooth-shaded humanoid with articulated limbs. Faces local +Z.
export function buildHumanoid(opts = {}) {
  const rng = opts.rng || Math.random;
  const skin = opts.skin ?? pick(rng, SKINS);
  const shirt = opts.shirt ?? pick(rng, SHIRTS);
  const pants = opts.pants ?? pick(rng, PANTS);
  const hair = opts.hair ?? pick(rng, HAIRS);
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
  const bodyMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const g = new THREE.Group();
  const add = (mesh, parent = g) => { mesh.castShadow = true; parent.add(mesh); return mesh; };
  // pelvis + torso + head + hair merged into one vertex-colored mesh (static, 1 draw call)
  const bodyGeo = mergeGeomsColored([
    { geo: new THREE.SphereGeometry(0.19, 12, 10), m: mat4(0, 0.98, 0, 0, 1.15, 0.7, 0.85), color: new THREE.Color(pants) },
    { geo: new THREE.CylinderGeometry(0.17, 0.21, 0.55, 14), m: mat4(0, 1.28, 0), color: new THREE.Color(shirt) },
    { geo: new THREE.SphereGeometry(0.14, 16, 12), m: mat4(0, 1.72, 0), color: new THREE.Color(skin) },
    { geo: new THREE.SphereGeometry(0.145, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), m: mat4(0, 1.74, 0), color: new THREE.Color(hair) },
  ]);
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.castShadow = true;
  g.add(bodyMesh);
  // arms: shoulder pivot -> upper arm -> elbow pivot -> forearm -> hand
  const mkArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.26, 1.48, 0);
    g.add(shoulder);
    const upper = add(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.32, 10), shirtMat), shoulder);
    upper.position.y = -0.16;
    const elbow = new THREE.Group();
    elbow.position.y = -0.32;
    shoulder.add(elbow);
    const fore = add(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.3, 10), skinMat), elbow);
    fore.position.y = -0.15;
    return { shoulder, elbow };
  };
  // legs: hip pivot -> thigh -> knee pivot -> shin -> foot
  const mkLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, 0.95, 0);
    g.add(hip);
    const thigh = add(new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.42, 10), pantsMat), hip);
    thigh.position.y = -0.21;
    const knee = new THREE.Group();
    knee.position.y = -0.42;
    hip.add(knee);
    const shin = add(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.42, 10), pantsMat), knee);
    shin.position.y = -0.21;
    return { hip, knee };
  };
  const limbs = {
    armL: mkArm(-1), armR: mkArm(1),
    legL: mkLeg(-1), legR: mkLeg(1),
  };
  return { group: g, limbs };
}

// Walk/run cycle: swings limbs, bobs the body. phase advances with distance.
export function animateHumanoid(h, phase, speed01) {
  const s = Math.sin(phase), c = Math.sin(phase + Math.PI);
  const amp = 0.55 * speed01;
  h.limbs.legL.hip.rotation.x = s * amp;
  h.limbs.legR.hip.rotation.x = c * amp;
  h.limbs.legL.knee.rotation.x = Math.max(0, -s) * 0.9 * speed01;
  h.limbs.legR.knee.rotation.x = Math.max(0, -c) * 0.9 * speed01;
  h.limbs.armL.shoulder.rotation.x = c * amp * 0.8;
  h.limbs.armR.shoulder.rotation.x = s * amp * 0.8;
  h.limbs.armL.elbow.rotation.x = -0.35 - Math.max(0, s) * 0.3 * speed01;
  h.limbs.armR.elbow.rotation.x = -0.35 - Math.max(0, c) * 0.3 * speed01;
  h.group.position.y = Math.abs(Math.cos(phase)) * 0.04 * speed01;
}

export class Pedestrian {
  constructor(scene, rng, x, z) {
    this.h = buildHumanoid({ rng });
    this.group = this.h.group;
    this.h.group.position.set(x, 0, z);
    scene.add(this.h.group);
    this.axis = chance(rng, 0.5) ? 'x' : 'z';
    this.line = pick(rng, [-168, -112, -56, 0, 56, 112, 168]);
    this.dir = chance(rng, 0.5) ? 1 : -1;
    this.side = chance(rng, 0.5) ? 1 : -1;
    this.speed = range(rng, 1.1, 1.7);
    this.phase = rng() * 6;
    this.state = 'walk';
    this.idleT = 0;
    this.fleeT = 0;
    this.angle = this.axis === 'x' ? (this.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (this.dir > 0 ? 0 : Math.PI);
  }
  update(dt, ctx) {
    const pos = this.h.group.position;
    if (this.fleeT > 0) {
      this.fleeT -= dt;
      const dx = pos.x - ctx.playerPos.x, dz = pos.z - ctx.playerPos.z;
      const d = Math.hypot(dx, dz) || 1;
      this.angle = Math.atan2(dx / d, dz / d);
      pos.x += (dx / d) * 5 * dt;
      pos.z += (dz / d) * 5 * dt;
      this.phase += dt * 9;
      animateHumanoid(this.h, this.phase, 1);
      this.h.group.rotation.y = this.angle;
      return;
    }
    if (this.state === 'idle') {
      this.idleT -= dt;
      animateHumanoid(this.h, this.phase, 0);
      if (this.idleT <= 0) this.state = 'walk';
      return;
    }
    // walk along the sidewalk; turn at intersections, sometimes idle
    const along = this.axis === 'x' ? pos.x : pos.z;
    const cross = [-168, -112, -56, 0, 56, 112, 168].find((a) => Math.abs(along - a) < 2.5);
    if (cross !== undefined && Math.random() < 0.02) {
      if (Math.random() < 0.4) { this.axis = this.axis === 'x' ? 'z' : 'x'; this.line = cross; this.dir = Math.random() < 0.5 ? 1 : -1; }
      else if (Math.random() < 0.3) this.side *= -1;
    }
    if (Math.random() < 0.002) { this.state = 'idle'; this.idleT = range(Math.random, 2, 6); return; }
    const fx = Math.sin(this.angle), fz = Math.cos(this.angle);
    pos.x += fx * this.speed * dt;
    pos.z += fz * this.speed * dt;
    // steer back onto the sidewalk line
    const want = this.axis === 'x' ? Math.atan2(this.dir, 0) : Math.atan2(0, this.dir);
    let targetAngle = this.axis === 'x' ? (this.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (this.dir > 0 ? 0 : Math.PI);
    // nudge toward the sidewalk offset
    const lat = this.axis === 'x' ? pos.z - (this.line + this.side * 8) : pos.x - (this.line + this.side * 8);
    targetAngle += clamp(-lat * 0.08, -0.4, 0.4);
    let da = targetAngle - this.angle;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    this.angle += clamp(da, -2.4 * dt, 2.4 * dt);
    this.phase += dt * this.speed * 3.2;
    animateHumanoid(this.h, this.phase, 0.7);
    this.h.group.rotation.y = this.angle;
    if (Math.abs(pos.x) > 190 || Math.abs(pos.z) > 190) this.dir *= -1;
  }
}

export class Hostile {
  constructor(scene, rng, x, z) {
    this.h = buildHumanoid({ rng, shirt: 0x2a2a2e, pants: 0x1e1e22, hair: 0x141414 });
    this.group = this.h.group;
    this.h.group.position.set(x, 0, z);
    scene.add(this.h.group);
    this.health = 100;
    this.state = 'active';
    this.speed = 2.4;
    this.shootT = 1.5;
    this.fireT = 0;
    this.phase = rng() * 6;
    this.target = { x, z };
    this.angle = 0;
  }
  damage(amount) {
    if (this.state === 'fallen') return false;
    this.health -= amount;
    if (this.health <= 0) {
      this.state = 'fallen';
      this.h.group.rotation.x = -Math.PI / 2;
      this.h.group.position.y = 0.25;
      return true;
    }
    return false;
  }
  update(dt, ctx) {
    if (this.state === 'fallen') return;
    const pos = this.h.group.position;
    const dx = ctx.playerPos.x - pos.x, dz = ctx.playerPos.z - pos.z;
    const d = Math.hypot(dx, dz);
    this.target = { x: ctx.playerPos.x, z: ctx.playerPos.z };
    if (d > 6) {
      this.angle = Math.atan2(dx, dz);
      pos.x += Math.sin(this.angle) * this.speed * dt;
      pos.z += Math.cos(this.angle) * this.speed * dt;
      this.phase += dt * 7;
      animateHumanoid(this.h, this.phase, 0.9);
    } else {
      this.angle = Math.atan2(dx, dz);
      animateHumanoid(this.h, this.phase, 0);
    }
    this.h.group.rotation.y = this.angle;
    // shoot at the player when close enough
    this.shootT -= dt;
    if (this.shootT <= 0 && d < 42) {
      this.shootT = range(Math.random, 0.9, 1.6);
      if (ctx.onHostileShot) ctx.onHostileShot(this, d);
    }
  }
}

export class FootCop {
  constructor(scene, rng, x, z) {
    this.h = buildHumanoid({ rng, shirt: 0x1a2a4a, pants: 0x1a2030, hair: 0x1a1a1a });
    this.group = this.h.group;
    // police cap
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.06, 12), new THREE.MeshLambertMaterial({ color: 0x1a2a4a }));
    cap.position.y = 1.84;
    this.h.group.add(cap);
    this.h.group.position.set(x, 0, z);
    scene.add(this.h.group);
    this.speed = 4.6;
    this.arrestT = 0;
    this.phase = rng() * 6;
    this.angle = 0;
  }
  update(dt, ctx) {
    const pos = this.h.group.position;
    const dx = ctx.playerPos.x - pos.x, dz = ctx.playerPos.z - pos.z;
    const d = Math.hypot(dx, dz);
    this.angle = Math.atan2(dx, dz);
    if (d > 1.2) {
      pos.x += Math.sin(this.angle) * this.speed * dt;
      pos.z += Math.cos(this.angle) * this.speed * dt;
      this.phase += dt * 9;
      animateHumanoid(this.h, this.phase, 1);
    } else {
      animateHumanoid(this.h, this.phase, 0);
    }
    this.h.group.rotation.y = this.angle;
    if (d < 1.8) this.arrestT += dt;
    else this.arrestT = Math.max(0, this.arrestT - dt);
    if (this.arrestT >= 2 && ctx.onArrest) ctx.onArrest(this);
  }
}

export class Pedestrians {
  constructor(scene, rng) {
    this.list = [];
    this.hostiles = [];
    for (let i = 0; i < 36; i++) {
      const axis = chance(rng, 0.5) ? 'x' : 'z';
      const line = pick(rng, [-168, -112, -56, 0, 56, 112, 168]);
      const along = range(rng, -180, 180);
      const x = axis === 'x' ? along : line + (chance(rng, 0.5) ? 8 : -8);
      const z = axis === 'x' ? line + (chance(rng, 0.5) ? 8 : -8) : along;
      this.list.push(new Pedestrian(scene, rng, x, z));
    }
  }
  onGunshot(pos) {
    for (const p of this.list) {
      const d = Math.hypot(p.h.group.position.x - pos.x, p.h.group.position.z - pos.z);
      if (d < 32) p.fleeT = 3;
    }
  }
  update(dt, ctx) {
    for (const p of this.list) p.update(dt, ctx);
    for (const h of this.hostiles) h.update(dt, ctx);
  }
}
