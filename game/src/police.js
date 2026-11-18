import * as THREE from 'three';
import { clamp, pick, range, chance } from './util.js';
import { makeCar, stepCar, steerTo, CAR_MODELS } from './vehicles.js';
import { FootCop } from './people.js';
import { ROADS } from './world.js';

const POLICE_MODEL = CAR_MODELS[0]; // sedan
const SIGHT_CAR = 60, SIGHT_FOOT = 40;

export class Wanted {
  constructor(scene, rng, onArrest) {
    this.scene = scene;
    this.rng = rng;
    this.onArrest = onArrest;
    this.wanted = 0;
    this.policeCars = [];
    this.footCops = [];
    this.lastSeenT = 0;
    this.decayStep = 4;
    this.sirenOn = false;
  }
  get police() { return this.policeCars.length + this.footCops.length; }
  setWanted(n, playerPos) {
    n = clamp(Math.round(n), 0, 5);
    const prev = this.wanted;
    this.wanted = n;
    if (n === 0) { this.clear(); return; }
    // police cars: one per wanted star, capped at 4
    const want = Math.min(n, 4);
    while (this.policeCars.length < want) this.spawnPoliceCar(playerPos);
    while (this.policeCars.length > want) this.removePoliceCar();
    // foot cops from wanted 2 up
    const wantFoot = n >= 2 ? 2 : 0;
    while (this.footCops.length < wantFoot) this.spawnFootCop(playerPos);
    while (this.footCops.length > wantFoot) this.removeFootCop();
    if (prev === 0 && n > 0) this.lastSeenT = 0;
  }
  clear() {
    for (const c of this.policeCars) this.scene.remove(c.group);
    for (const c of this.footCops) this.scene.remove(c.h.group);
    this.policeCars = [];
    this.footCops = [];
    this.lastSeenT = 0;
  }
  spawnPoliceCar(playerPos) {
    const rng = this.rng;
    const car = makeCar(POLICE_MODEL, 0x14181e, 0, 0, 0);
    car.isPolice = true;
    // light bar: red + blue flashers on the roof
    const bar = new THREE.Group();
    const mk = (color, x) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.3), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2 }));
      m.position.set(x, 0, 0); bar.add(m); return m;
    };
    const red = mk(0xff2020, -0.3), blue = mk(0x2040ff, 0.3);
    bar.position.set(0, 1.55, 0);
    car.group.add(bar);
    car.lightBar = { red, blue, t: rng() * 2 };
    // place on a road 40-70m from the player
    const axis = chance(rng, 0.5) ? 'x' : 'z';
    const line = pick(rng, ROADS);
    const dir = chance(rng, 0.5) ? 1 : -1;
    const along = (axis === 'x' ? playerPos.x : playerPos.z) + dir * range(rng, 40, 70);
    const x = axis === 'x' ? clamp(along, -186, 186) : line;
    const z = axis === 'x' ? line : clamp(along, -186, 186);
    car.group.position.set(x, 0, z);
    car.axis = axis; car.line = line; car.dir = dir;
    car.angle = axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (dir > 0 ? 0 : Math.PI);
    car.group.rotation.y = car.angle;
    car.speed = 18;
    car._turnedAt = [];
    this.scene.add(car.group);
    this.policeCars.push(car);
    return car;
  }
  removePoliceCar() {
    const c = this.policeCars.pop();
    if (c) this.scene.remove(c.group);
  }
  spawnFootCop(playerPos) {
    const rng = this.rng;
    const a = rng() * Math.PI * 2;
    const x = clamp(playerPos.x + Math.sin(a) * range(rng, 18, 30), -190, 190);
    const z = clamp(playerPos.z + Math.cos(a) * range(rng, 18, 30), -190, 190);
    const cop = new FootCop(this.scene, rng, x, z);
    this.footCops.push(cop);
    return cop;
  }
  removeFootCop() {
    const c = this.footCops.pop();
    if (c) this.scene.remove(c.h.group);
  }
  placeOnRoad(car, coord) {
    if (car.axis === 'x') car.group.position.z = car.line;
    else car.group.position.x = car.line;
  }
  update(dt, ctx) {
    const playerPos = ctx.playerPos;
    // --- police cars: road-chase, ram when close ---
    for (const car of this.policeCars) {
      if (car.dead) continue;
      if (car.hold) {
        // staged roadblock: stay put, only flash the light bar
        if (car.lightBar) {
          car.lightBar.t += dt * 6;
          const on = Math.sin(car.lightBar.t) > 0;
          car.lightBar.red.material.emissiveIntensity = on ? 3 : 0.3;
          car.lightBar.blue.material.emissiveIntensity = on ? 0.3 : 3;
        }
        continue;
      }
      const pos = car.group.position;
      const dx = playerPos.x - pos.x, dz = playerPos.z - pos.z;
      const dist = Math.hypot(dx, dz);
      const ram = dist < 14;
      let throttle = 0.9, steer = 0;
      if (ram) {
        steer = steerTo(car, playerPos.x, playerPos.z);
        throttle = 1;
      } else {
        const cross = car.axis === 'x'
          ? ROADS.find((r) => Math.abs(pos.x - r) < 2.4)
          : ROADS.find((r) => Math.abs(pos.z - r) < 2.4);
        if (cross !== undefined && !car._turnedAt.includes(cross)) {
          car._turnedAt.push(cross);
          if (car._turnedAt.length > 3) car._turnedAt.shift();
          const options = [];
          const cur = { axis: car.axis, line: car.line, dir: car.dir };
          options.push(cur);
          const turnAxis = car.axis === 'x' ? 'z' : 'x';
          options.push({ axis: turnAxis, line: cross, dir: 1 });
          options.push({ axis: turnAxis, line: cross, dir: -1 });
          let best = cur, bd = 1e9;
          for (const o of options) {
            const px = o.axis === 'x' ? pos.x + o.dir * 30 : o.line;
            const pz = o.axis === 'z' ? pos.z + o.dir * 30 : o.line;
            const dd = Math.hypot(playerPos.x - px, playerPos.z - pz);
            if (dd < bd) { bd = dd; best = o; }
          }
          car.axis = best.axis; car.line = best.line; car.dir = best.dir;
          this.placeOnRoad(car, car.axis === 'x' ? pos.z : pos.x);
        }
        const edge = car.axis === 'x' ? pos.x : pos.z;
        if (Math.abs(edge) > 190) { car.dir *= -1; this.placeOnRoad(car, car.axis === 'x' ? pos.z : pos.x); }
        // keep the car aligned to its axis when cruising
        const wantAngle = car.axis === 'x' ? (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (car.dir > 0 ? 0 : Math.PI);
        let da = wantAngle - car.angle;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        steer = clamp(da * 2, -1, 1);
      }
      stepCar(car, dt, { throttle, steer, handbrake: false }, ctx);
      // flash the light bar
      if (car.lightBar) {
        car.lightBar.t += dt * 6;
        const on = Math.sin(car.lightBar.t) > 0;
        car.lightBar.red.material.emissiveIntensity = on ? 3 : 0.3;
        car.lightBar.blue.material.emissiveIntensity = on ? 0.3 : 3;
      }
      // unstuck: re-place on a road well away from the player
      if (Math.abs(car.speed) < 1 && throttle > 0) car.stuckT += dt; else car.stuckT = 0;
      if (car.stuckT > 3) {
        car.stuckT = 0;
        const a = this.rng() * Math.PI * 2;
        const nx = clamp(playerPos.x + Math.sin(a) * 90, -186, 186);
        const nz = clamp(playerPos.z + Math.cos(a) * 90, -186, 186);
        car.group.position.set(nx, 0, nz);
      }
    }
    // --- foot cops ---
    for (const cop of this.footCops) cop.update(dt, { playerPos, onArrest: this.onArrest });
    // --- seen / decay ---
    if (this.wanted > 0) {
      let seen = false;
      for (const c of this.policeCars) {
        const d2 = (c.group.position.x - playerPos.x) ** 2 + (c.group.position.z - playerPos.z) ** 2;
        if (d2 < SIGHT_CAR * SIGHT_CAR) { seen = true; break; }
      }
      if (!seen) for (const c of this.footCops) {
        const d2 = (c.h.group.position.x - playerPos.x) ** 2 + (c.h.group.position.z - playerPos.z) ** 2;
        if (d2 < SIGHT_FOOT * SIGHT_FOOT) { seen = true; break; }
      }
      if (seen) this.lastSeenT = 0;
      else {
        this.lastSeenT += dt;
        if (this.lastSeenT > this.decayStep) {
          this.lastSeenT = 0;
          this.setWanted(this.wanted - 1, playerPos);
        }
      }
    }
    this.sirenOn = this.wanted > 0;
  }
}
