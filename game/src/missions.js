import { LOC } from './world.js';
import { Hostile } from './people.js';
import { makeCar, CAR_MODELS } from './vehicles.js';

const DEFS = [
  { name: 'Homecoming', reward: 300, steps: [
    { text: 'Steal a car — any car. Walk up to one and press E.', target: null },
    { text: 'Drive to the hideout.', target: LOC.hideout },
  ] },
  { name: 'Pickup', reward: 500, steps: [
    { text: 'Pick up Mara at the tower.', target: LOC.tower },
    { text: 'Drive Mara to the harbor.', target: LOC.harbor },
  ] },
  { name: 'Getaway', reward: 700, steps: [
    { text: 'Reach the beach house before time runs out.', target: LOC.beachHouse, timer: 90 },
  ] },
  { name: 'The Shakedown', reward: 1000, steps: [
    { text: 'Go to the Vultures\' block.', target: LOC.vultures },
    { text: 'Clear out the Vultures.', target: LOC.vultures, hostiles: 4 },
  ] },
  { name: 'Harbor Job', reward: 1500, steps: [
    { text: 'Go to the harbor.', target: LOC.harbor },
    { text: 'Get in the golden car.', target: LOC.harbor, golden: true },
    { text: 'Drive the golden car to the garage.', target: LOC.garage, golden: true },
  ] },
];

export class Missions {
  constructor(game) {
    this.game = game;
    this.index = 0;
    this.step = 0;
    this.timer = 0;
    this.goldenCar = null;
    this.failed = false;
  }
  get def() { return DEFS[this.index]; }
  get stepDef() { return DEFS[this.index].steps[this.step]; }
  start(n) {
    this.index = n;
    this.step = 0;
    this.timer = 0;
    this.failed = false;
    this.beginStep();
    this.game.hud.showMissionBanner(`Mission ${n + 1} — ${DEFS[n].name}`);
  }
  beginStep() {
    const g = this.game, sd = this.stepDef;
    if (!sd) return;
    this.timer = sd.timer || 0;
    if (sd.hostiles) {
      // clear old hostiles, spawn fresh ones at the Vultures' block
      for (const h of g.peds.hostiles) g.scene.remove(h.h.group);
      g.peds.hostiles = [];
      for (let i = 0; i < sd.hostiles; i++) {
        const a = (i / sd.hostiles) * Math.PI * 2;
        const h = new Hostile(g.scene, g.rng, LOC.vultures.x + Math.sin(a) * 9, LOC.vultures.z + Math.cos(a) * 9);
        g.peds.hostiles.push(h);
      }
    }
    if (this.index === 2 && this.step === 0) g.setWanted(2);
    if (this.index === 4 && !this.goldenCar) {
      const coupe = CAR_MODELS[1];
      const car = makeCar(coupe, 0xd8a028, LOC.harbor.x, LOC.harbor.z, Math.PI / 2);
      car.isParked = true;
      car.name = 'Golden Comet';
      g.scene.add(car.group);
      g.parked.push(car);
      this.goldenCar = car;
    }
  }
  advance() {
    const g = this.game;
    this.step++;
    if (this.step >= this.def.steps.length) this.complete();
    else this.beginStep();
  }
  complete() {
    const g = this.game;
    g.money += this.def.reward;
    g.hud.showPayout(this.def.reward);
    g.audio.mission();
    if (this.index >= DEFS.length - 1) {
      g.mode = 'ending';
      g.hud.showEnding(g.money);
      return;
    }
    this.start(this.index + 1);
  }
  fail() {
    const g = this.game;
    g.hud.showMissionBanner('Mission failed — try again');
    this.failed = true;
    this.step = 0;
    this.beginStep();
  }
  update(dt) {
    const g = this.game;
    if (g.mode !== 'playing') return;
    const sd = this.stepDef;
    if (!sd) return;
    if (this.timer > 0) {
      this.timer -= dt;
      if (this.timer <= 0) { this.fail(); return; }
    }
    const p = g.player.pos;
    // step 0 of mission 0: steal a car
    if (this.index === 0 && this.step === 0) {
      if (g.driving) { this.advance(); return; }
    }
    // golden car step: get in it
    if (sd.golden && this.index === 4 && this.step === 1) {
      if (g.driving && g.playerCar === this.goldenCar) { this.advance(); return; }
    }
    // hostiles step: all fallen
    if (sd.hostiles) {
      const alive = g.peds.hostiles.some((h) => h.state !== 'fallen');
      if (!alive && g.peds.hostiles.length > 0) { this.advance(); return; }
    }
    // reach-the-target steps
    if (sd.target) {
      const d = Math.hypot(p.x - sd.target.x, p.z - sd.target.z);
      if (d < sd.target.r) { this.advance(); return; }
    }
  }
  currentObjective() {
    const sd = this.stepDef;
    if (!sd) return { text: 'Story complete', target: null, dist: 0, timeLeft: 0 };
    const p = this.game.player.pos;
    const dist = sd.target ? Math.hypot(p.x - sd.target.x, p.z - sd.target.z) : 0;
    return { text: `MISSION ${this.index + 1} — ${this.def.name.toUpperCase()}\n${sd.text}`, target: sd.target, dist, timeLeft: this.timer };
  }
}
