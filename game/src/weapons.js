import * as THREE from 'three';
import { clamp } from './util.js';

export const WEAPONS = [
  { name: 'PISTOL', damage: 34, rate: 5, spread: 0.012, range: 70, mag: 12, reload: 1.2, auto: false, pellets: 1 },
  { name: 'SMG', damage: 18, rate: 11, spread: 0.04, range: 55, mag: 30, reload: 1.6, auto: true, pellets: 1 },
  { name: 'SHOTGUN', damage: 12, rate: 1.1, spread: 0.09, range: 30, mag: 6, reload: 2.4, auto: false, pellets: 8 },
];

const metal = new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.35, metalness: 0.75 });
const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.8 });
const gripMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 });

// A proper weapon model: barrel, slide/receiver, grip, magazine, stock, sights.
export function buildWeaponModel(type) {
  const g = new THREE.Group();
  const box = (w, h, d, mat, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
  };
  const cyl = (r, len, mat, x, y, z, rx = Math.PI / 2) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
    m.rotation.x = rx; m.position.set(x, y, z); m.castShadow = true; g.add(m); return m;
  };
  if (type === 0) { // pistol
    box(0.05, 0.07, 0.24, metal, 0, 0.02, 0.06); // slide
    cyl(0.02, 0.1, metal, 0, 0.03, 0.2); // barrel
    const grip = box(0.05, 0.16, 0.07, gripMat, 0, -0.07, -0.05);
    grip.rotation.x = 0.25;
    box(0.012, 0.03, 0.02, metal, 0, 0.07, 0.16); // front sight
    box(0.03, 0.025, 0.02, metal, 0, 0.07, -0.04); // rear sight
  } else if (type === 1) { // smg
    box(0.06, 0.09, 0.5, metal, 0, 0, 0.05); // receiver
    cyl(0.025, 0.24, metal, 0, 0.01, 0.36); // barrel
    box(0.045, 0.2, 0.07, metal, 0, -0.13, 0.08); // magazine
    const grip = box(0.05, 0.14, 0.07, gripMat, 0, -0.09, -0.14);
    grip.rotation.x = 0.3;
    box(0.05, 0.08, 0.16, wood, 0, -0.01, -0.3); // stock
    box(0.012, 0.04, 0.02, metal, 0, 0.06, 0.3); // front sight
  } else { // shotgun
    cyl(0.035, 0.55, metal, 0, 0.02, 0.28); // barrel
    cyl(0.028, 0.4, wood, 0, -0.03, 0.3); // pump
    box(0.07, 0.1, 0.34, metal, 0, 0, -0.1); // receiver
    box(0.06, 0.12, 0.3, wood, 0, -0.03, -0.36); // stock
    const grip = box(0.05, 0.13, 0.07, gripMat, 0, -0.08, -0.2);
    grip.rotation.x = 0.3;
    box(0.012, 0.035, 0.02, metal, 0, 0.06, 0.52); // bead sight
  }
  return g;
}

export class Weapons {
  constructor(scene, game) {
    this.scene = scene;
    this.game = game;
    this.current = 0;
    this.owned = [true, false, false];
    this.ammo = [
      { mag: 12, reserve: 48 },
      { mag: 0, reserve: 0 },
      { mag: 0, reserve: 0 },
    ];
    this.fireT = 0;
    this.reloading = 0;
    this.models = WEAPONS.map((w, i) => buildWeaponModel(i));
    this.model = this.models[0];
    this.muzzle = new THREE.PointLight(0xffc860, 0, 9, 2);
    this.scene.add(this.muzzle);
    this.flashT = 0;
    this.recoil = 0;
    this.casings = [];
    this.casingGeo = new THREE.BoxGeometry(0.03, 0.03, 0.07);
    this.casingMat = new THREE.MeshStandardMaterial({ color: 0xd8b028, metalness: 0.8, roughness: 0.3 });
    this.crates = [];
    this.spawnCrates();
  }
  spawnCrates() {
    const spots = [
      { x: 40, z: 40, weapon: 1 }, // park
      { x: 160, z: -20, weapon: 2 }, // harbor
      { x: -28, z: -112, weapon: 1 }, // downtown
      { x: -140, z: 160, weapon: 2 }, // beach
    ];
    for (const s of spots) {
      const g = new THREE.Group();
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), new THREE.MeshStandardMaterial({ color: 0x4a5a2a, roughness: 0.8 }));
      crate.position.y = 0.25; crate.castShadow = true; g.add(crate);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.1, 0.72), new THREE.MeshStandardMaterial({ color: 0xd8b028 }));
      stripe.position.y = 0.45; g.add(stripe);
      const wm = buildWeaponModel(s.weapon);
      wm.position.y = 0.65; wm.rotation.y = 0.6; wm.scale.setScalar(1.4);
      g.add(wm);
      g.position.set(s.x, 0, s.z);
      this.scene.add(g);
      this.crates.push({ group: g, weapon: s.weapon, taken: false, x: s.x, z: s.z });
    }
  }
  switchTo(i) {
    if (!this.owned[i] || i === this.current) return false;
    this.current = i;
    this.model = this.models[i];
    this.reloading = 0;
    return true;
  }
  get def() { return WEAPONS[this.current]; }
  get mag() { return this.ammo[this.current].mag; }
  get reserve() { return this.ammo[this.current].reserve; }
  startReload() {
    const a = this.ammo[this.current], d = this.def;
    if (this.reloading > 0 || a.reserve <= 0 || a.mag >= d.mag) return false;
    this.reloading = d.reload;
    return true;
  }
  // Fire toward aimPoint from origin. Returns {hit, killed} or null when not ready.
  shoot(origin, aimPoint) {
    if (this.fireT > 0 || this.reloading > 0) return null;
    const a = this.ammo[this.current], d = this.def;
    if (a.mag <= 0) { this.startReload(); return null; }
    this.fireT = 1 / d.rate;
    a.mag--;
    let hit = null, killed = false;
    const dir = new THREE.Vector3().subVectors(aimPoint, origin).normalize();
    for (let p = 0; p < d.pellets; p++) {
      const dd = dir.clone();
      dd.x += (Math.random() - 0.5) * d.spread * 2;
      dd.y += (Math.random() - 0.5) * d.spread * 2;
      dd.z += (Math.random() - 0.5) * d.spread * 2;
      dd.normalize();
      const h = this.rayHit(origin, dd, d.range);
      if (h && (!hit || h.dist < hit.dist)) hit = h;
    }
    if (hit) {
      if (hit.kind === 'hostile') {
        killed = hit.target.damage(d.damage);
        if (killed) this.game.kills++;
      } else if (hit.kind === 'ped') {
        this.game.setWanted(this.game.wanted + 1);
      } else if (hit.kind === 'car') {
        hit.target.health -= d.damage;
      }
    }
    // muzzle flash + recoil + casing
    this.muzzle.position.copy(origin).addScaledVector(dir, 0.7);
    this.muzzle.intensity = 4;
    this.flashT = 0.06;
    this.recoil = Math.min(0.09, this.recoil + (this.current === 2 ? 0.07 : 0.035));
    this.ejectCasing(origin, dir);
    return { hit: !!hit, killed };
  }
  rayHit(origin, dir, range) {
    let best = null;
    const testSphere = (cx, cy, cz, r, kind, target) => {
      const ox = origin.x - cx, oy = origin.y - cy, oz = origin.z - cz;
      const b = ox * dir.x + oy * dir.y + oz * dir.z;
      const c = ox * ox + oy * oy + oz * oz - r * r;
      const disc = b * b - c;
      if (disc < 0) return;
      const t = -b - Math.sqrt(disc);
      if (t < 0 || t > range) return;
      if (!best || t < best.dist) best = { dist: t, kind, target };
    };
    for (const h of this.game.peds.hostiles) {
      if (h.state === 'fallen') continue;
      const p = h.h.group.position;
      testSphere(p.x, 1.2, p.z, 0.95, 'hostile', h);
    }
    for (const p of this.game.peds.list) {
      const q = p.h.group.position;
      testSphere(q.x, 1.2, q.z, 0.8, 'ped', p);
    }
    for (const c of this.game.cars) {
      if (c.dead) continue;
      const q = c.group.position;
      testSphere(q.x, 1.0, q.z, 2.2, 'car', c);
    }
    return best;
  }
  ejectCasing(origin, dir) {
    if (this.casings.length > 14) {
      const old = this.casings.shift();
      this.scene.remove(old.mesh);
    }
    const m = new THREE.Mesh(this.casingGeo, this.casingMat);
    m.position.copy(origin);
    const right = new THREE.Vector3(1, 0, 0).cross(dir).normalize();
    const vel = right.multiplyScalar(1.5 + Math.random()).add(new THREE.Vector3(0, 2 + Math.random(), 0));
    this.scene.add(m);
    this.casings.push({ mesh: m, vel, life: 1 });
  }
  update(dt) {
    this.fireT = Math.max(0, this.fireT - dt);
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) {
        this.reloading = 0;
        const a = this.ammo[this.current], d = this.def;
        const need = d.mag - a.mag;
        const take = Math.min(need, a.reserve);
        a.mag += take; a.reserve -= take;
      }
    }
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.muzzle.intensity = Math.max(0, (this.flashT / 0.06) * 4);
    } else this.muzzle.intensity = 0;
    this.recoil = Math.max(0, this.recoil - dt * 0.5);
    for (let i = this.casings.length - 1; i >= 0; i--) {
      const c = this.casings[i];
      c.life -= dt;
      c.vel.y -= 9.8 * dt;
      c.mesh.position.addScaledVector(c.vel, dt);
      c.mesh.rotation.x += dt * 8; c.mesh.rotation.z += dt * 6;
      if (c.mesh.position.y < 0.03) { c.mesh.position.y = 0.03; c.vel.set(0, 0, 0); }
      if (c.life <= 0) { this.scene.remove(c.mesh); this.casings.splice(i, 1); }
    }
    // crates: bob the weapon model, check pickup
    const p = this.game.player.pos;
    for (const c of this.crates) {
      if (c.taken) continue;
      c.group.children[1].rotation.y += dt;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < 2.2) {
        c.taken = true;
        this.scene.remove(c.group);
        this.owned[c.weapon] = true;
        const a = this.ammo[c.weapon], def = WEAPONS[c.weapon];
        a.mag = def.mag; a.reserve += def.mag * 3;
        this.game.hud.showMissionBanner(`Picked up ${def.name}`);
        this.game.audio.pickup();
      }
    }
  }
}
