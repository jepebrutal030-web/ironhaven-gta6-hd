import * as THREE from 'three';
import { World, LOC, ROADS } from './world.js';
import { Traffic, makeCar, nearestCar, stepCar, CAR_MODELS } from './vehicles.js';
import { Pedestrians, buildHumanoid, animateHumanoid } from './people.js';
import { Wanted } from './police.js';
import { Missions } from './missions.js';
import { Weapons } from './weapons.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { clamp, lerp, normAngle, collideCircle, mulberry32, pick, range } from './util.js';

const SAVE_KEY = 'ironhaven-save-v1';

export class Game {
  constructor() {
    const params = new URLSearchParams(location.search);
    this.seed = parseInt(params.get('seed') || '1', 10) || 1;
    this.rng = mulberry32(this.seed);
    this.canvas = document.getElementById('c');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, canvas: this.canvas });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
    this.camera.position.set(0, 40, 80);
    this.world = new World(this.scene, this.seed);
    this.input = new Input();
    this.audio = new AudioSys();
    this.hud = new HUD();
    // traffic + parked cars
    this.traffic = new Traffic(this.scene, this.rng, this.world.colliders, this.world);
    this.parked = [];
    const driveModels = CAR_MODELS.filter((m) => m.kind !== 'boat' && m.kind !== 'bus');
    for (let i = 0; i < 14; i++) {
      const model = pick(this.rng, driveModels);
      const axis = this.rng() < 0.5 ? 'x' : 'z';
      const line = pick(this.rng, ROADS);
      const along = range(this.rng, -180, 180);
      const side = this.rng() < 0.5 ? 1 : -1;
      const x = axis === 'x' ? along : line + side * 8.5;
      const z = axis === 'x' ? line + side * 8.5 : along;
      const angle = axis === 'x' ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : (side > 0 ? 0 : Math.PI);
      const car = makeCar(model, pick(this.rng, model.colors), x, z, angle);
      car.isParked = true;
      this.scene.add(car.group);
      this.parked.push(car);
    }
    // boat at the harbor (scenery)
    const boat = makeCar(CAR_MODELS[7], 0xe8e8e8, 214, 40, Math.PI / 2);
    boat.group.position.y = 0.4;
    this.scene.add(boat.group);
    // people
    this.peds = new Pedestrians(this.scene, this.rng);
    // wanted / police
    this.wanted = new Wanted(this.scene, this.rng, () => this.onArrest());
    // missions + weapons
    this.missions = new Missions(this);
    this.weapons = new Weapons(this.scene, this);
    // player
    this.player = {
      pos: { x: LOC.spawn.x, z: LOC.spawn.z }, y: 0, vy: 0,
      yaw: Math.PI * 0.75, pitch: -0.12, health: 100, angle: Math.PI * 0.75,
      fireT: 0, reloading: 0, grounded: true,
    };
    this.humanoid = buildHumanoid({ rng: this.rng, shirt: 0x8a2a2a, pants: 0x2a3a5a, hair: 0x1a1a1a });
    this.scene.add(this.humanoid.group);
    this.weaponMount = new THREE.Group();
    this.weaponMount.position.set(0.26, 1.32, 0.3);
    this.humanoid.group.add(this.weaponMount);
    this.weaponMount.add(this.weapons.model);
    this.mode = 'menu';
    this.mission = 0;
    this.money = 0;
    this.kills = 0;
    this.driving = false;
    this.playerCar = null;
    this.aimPoint = new THREE.Vector3(0, 1.2, -10);
    this.camPos = new THREE.Vector3(0, 40, 80);
    this.camYaw = this.player.yaw;
    this.camPitch = -0.12;
    this.walkPhase = 0;
    this.time = 0;
    this.saveT = 0;
    this.menuAngle = 0;
    this._last = performance.now();
    this._frame = () => this.frame();
    this.bindButtons();
    // Edge actions fire synchronously on keydown (not on the next frame), so a
    // quick key tap is never lost between slow headless frames.
    this.input.onKey = (code) => {
      if (code === 'KeyP') {
        if (this.mode === 'playing') { this.mode = 'paused'; this.hud.showPause(); this.save(); this.audio.setEngine(false, 0); }
        else if (this.mode === 'paused') { this.mode = 'playing'; this.hud.hideAll(); }
      } else if (code === 'KeyM') this.audio.setMuted(!this.audio.muted);
      else if (this.mode !== 'playing') return;
      else if (code === 'Digit1') this.swapWeapon(0);
      else if (code === 'Digit2') this.swapWeapon(1);
      else if (code === 'Digit3') this.swapWeapon(2);
      else if (code === 'KeyR') this.weapons.startReload();
      else if (code === 'KeyE') { if (this.driving) this.exitCar(); else this.tryEnterCar(); }
    };
    this.hud.showStart(this.hasSave());
    this.ready = false;
    this.loop();
    this.ready = true;
    // auto-stage ?shot= scenes (deliverable screenshots)
    const shot = params.get('shot');
    if (shot) setTimeout(() => this.stageShot(shot), 600);
  }
  get cars() { return [...this.traffic.cars, ...this.parked, ...this.wanted.policeCars]; }
  get missionStep() { return this.missions.step; }
  bindButtons() {
    const click = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', () => { this.audio.ensure(); this.audio.click(); fn(); }); };
    click('btn-new', () => this.newGame());
    click('btn-continue', () => this.loadGame());
    click('btn-resume', () => { this.mode = 'playing'; this.hud.hideAll(); });
    click('btn-busted', () => this.respawn());
    click('btn-wasted', () => this.respawn());
    click('btn-again', () => this.newGame());
    click('btn-menu', () => { this.mode = 'menu'; this.hud.hideAll(); this.hud.showStart(this.hasSave()); });
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
    // Fallback click router: in headless SwiftShader the full-screen WebGL
    // canvas swallows pointer events meant for an overlay button (the click
    // lands on #c even though the button is on top and visible). When a click
    // arrives with the canvas as its target while a modal overlay is up, route
    // it by coordinates to the visible overlay button under the point.
    window.addEventListener('click', (e) => {
      if (e.target !== this.canvas) return;
      const modal = ['busted', 'wasted', 'pause', 'ending', 'start'].find((k) => !this.hud.el[k].classList.contains('hidden'));
      if (!modal) return;
      for (const btn of this.hud.el[modal].querySelectorAll('button')) {
        if (btn.classList.contains('hidden')) continue;
        const r = btn.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) { btn.click(); break; }
      }
    });
  }
  hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
  newGame() {
    this.money = 0; this.kills = 0;
    this.player.health = 100;
    this.player.pos.x = LOC.spawn.x; this.player.pos.z = LOC.spawn.z; this.player.y = 0;
    this.player.yaw = Math.PI * 0.75; this.camYaw = this.player.yaw; this.camPitch = -0.12;
    this.wanted.setWanted(0, this.player.pos);
    this.missions.index = 0; this.missions.step = 0; this.missions.goldenCar = null;
    this.missions.start(0);
    this.mode = 'playing';
    this.hud.hideAll();
    this.audio.startMusic();
    this.save();
  }
  loadGame() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (!s) return this.newGame();
      this.money = s.money || 0;
      this.player.health = s.health ?? 100;
      this.player.pos.x = s.x ?? LOC.spawn.x;
      this.player.pos.z = s.z ?? LOC.spawn.z;
      this.missions.index = s.mission || 0;
      this.missions.step = s.missionStep || 0;
      this.missions.beginStep();
      this.mode = 'playing';
      this.hud.hideAll();
      this.audio.startMusic();
    } catch { this.newGame(); }
  }
  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        money: this.money, mission: this.missions.index, missionStep: this.missions.step,
        x: this.player.pos.x, z: this.player.pos.z, health: this.player.health,
      }));
    } catch { /* storage unavailable */ }
  }
  respawn() {
    this.player.health = 100;
    this.player.pos.x = LOC.spawn.x; this.player.pos.z = LOC.spawn.z; this.player.y = 0;
    if (this.driving) this.exitCar();
    this.wanted.setWanted(0, this.player.pos);
    this.mode = 'playing';
    this.hud.hideAll();
  }
  onArrest() {
    if (this.mode !== 'playing') return;
    this.mode = 'busted';
    this.audio.setSiren(false);
    this.hud.showBusted();
  }
  onWasted() {
    if (this.mode !== 'playing') return;
    this.mode = 'wasted';
    this.audio.setSiren(false);
    this.hud.showWasted();
  }
  loop() { this.renderer.setAnimationLoop(this._frame); }
  frame() {
    const now = performance.now();
    let dt = Math.min((now - this._last) / 1000, 0.15);
    this._last = now;
    this.time += dt;
    if (this.mode === 'playing') this.update(dt);
    else if (this.mode === 'menu') {
      // slow orbit around the city for the title screen
      this.menuAngle += dt * 0.03;
      this.camera.position.set(Math.sin(this.menuAngle) * 120, 55, Math.cos(this.menuAngle) * 120);
      this.camera.lookAt(0, 10, 0);
      this.world.update(dt);
    }
    // Hide the canvas while a modal overlay is up: in headless SwiftShader the
    // full-screen WebGL canvas swallows the overlay button's pointer events
    // (the click lands on #c instead of the button). The overlay is opaque
    // enough that hiding the frozen frame behind it is invisible.
    const modal = this.mode === 'busted' || this.mode === 'wasted' || this.mode === 'paused' || this.mode === 'ending';
    if (modal !== this._canvasHidden) {
      this._canvasHidden = modal;
      this.canvas.style.visibility = modal ? 'hidden' : 'visible';
    }
    // While a modal overlay is up (busted / wasted / paused / ending) the canvas
    // already shows the last frame behind it — skip the render so the main thread
    // stays free for input (a real click must land while the overlay is shown).
    if (this.mode === 'playing' || this.mode === 'menu') this.renderer.render(this.scene, this.camera);
  }
  update(dt) {
    const input = this.input;
    const p = this.player;
    if (this.mode !== 'playing') { input.endFrame(); return; }
    // --- mouse look ---
    const { dx, dy } = input.consumeMouse();
    if (input.locked) {
      this.camYaw -= dx * 0.0028;
      this.camPitch = clamp(this.camPitch - dy * 0.0028, -0.55, 0.5);
    }
    if (input.consumeClick() && !this.driving) {
      if (!input.locked) input.lock(this.canvas);
      else this.shoot();
    }
    if (input.down('Mouse0') && this.weapons.def.auto && !this.driving) this.shoot();
    // --- movement ---
    const ax = input.axis();
    if (this.driving && this.playerCar) this.updateDriving(dt, ax);
    else this.updateOnFoot(dt, ax);
    // --- world systems ---
    const ctx = {
      colliders: this.world.colliders, cars: this.cars,
      onCrash: (car, s) => this.audio.crash(s),
      playerPos: p.pos, playerInCar: this.driving, playerCar: this.playerCar, time: this.time,
    };
    this.traffic.update(dt, ctx);
    this.peds.update(dt, { playerPos: p.pos, onHostileShot: (h, d) => this.onHostileShot(h, d) });
    this.wanted.update(dt, ctx);
    this.missions.update(dt);
    this.weapons.update(dt);
    this.world.update(dt);
    // audio: engine + siren
    this.audio.setEngine(this.driving, this.driving && this.playerCar ? Math.abs(this.playerCar.speed) / this.playerCar.model.top : 0);
    this.audio.setSiren(this.wanted.sirenOn);
    // sync test-visible fields
    p.fireT = this.weapons.fireT;
    p.reloading = this.weapons.reloading;
    p.angle = this.driving && this.playerCar ? this.playerCar.angle : this.player.yaw;
    // autosave
    this.saveT += dt;
    if (this.saveT > 30) { this.saveT = 0; this.save(); }
    // camera + HUD
    this.updateCamera(dt);
    this.hud.update(this, dt);
    input.endFrame();
  }
  updateOnFoot(dt, ax) {
    const p = this.player;
    p.yaw = this.camYaw;
    const sprint = this.input.down('ShiftLeft') || this.input.down('ShiftRight');
    const speed = sprint ? 7 : 4.5;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    let mx = fx * ax.y + rx * ax.x, mz = fz * ax.y + rz * ax.x;
    const ml = Math.hypot(mx, mz);
    if (ml > 0.01) {
      mx /= ml; mz /= ml;
      const np = { x: p.pos.x + mx * speed * dt, z: p.pos.z + mz * speed * dt };
      collideCircle(np, 0.6, this.world.colliders);
      p.pos.x = clamp(np.x, -194, 194);
      p.pos.z = clamp(np.z, -194, 194);
      this.walkPhase += dt * speed * 1.6;
      animateHumanoid(this.humanoid, this.walkPhase, sprint ? 1 : 0.7);
    } else animateHumanoid(this.humanoid, this.walkPhase, 0);
    // jump
    if (this.input.wasPressed('Space') && p.grounded) { p.vy = 7; p.grounded = false; }
    if (!p.grounded) {
      p.vy -= 20 * dt;
      p.y += p.vy * dt;
      if (p.y <= 0) { p.y = 0; p.vy = 0; p.grounded = true; }
    }
    this.humanoid.group.position.set(p.pos.x, p.y, p.pos.z);
    this.humanoid.group.rotation.y = p.yaw;
    this.humanoid.group.visible = true;
  }
  updateDriving(dt, ax) {
    const car = this.playerCar;
    const boost = this.input.down('ShiftLeft') || this.input.down('ShiftRight');
    stepCar(car, dt, {
      throttle: ax.y * (boost ? 1.25 : 1),
      steer: -ax.x,
      handbrake: this.input.down('Space'),
    }, {
      colliders: this.world.colliders, cars: this.cars,
      onCrash: (c, s) => this.audio.crash(s),
      playerPos: this.player.pos, playerInCar: true, playerCar: car, time: this.time,
    });
    this.player.pos.x = car.group.position.x;
    this.player.pos.z = car.group.position.z;
    this.camYaw = car.angle;
  }
  tryEnterCar() {
    const p = this.player;
    const car = nearestCar(p.pos, 4.5, this.cars, (c) => !c.dead && !c.isPolice);
    if (!car) return;
    this.enterCar(car);
  }
  enterCar(car) {
    this.driving = true;
    this.playerCar = car;
    car.isPlayer = true;
    car.isParked = false;
    car.isTraffic = false;
    car.doorT = 0.25;
    for (const side of ['left', 'right']) { const d = car.doors[side]; if (d) d.rotation.y = (side === 'left' ? -1 : 1) * 1.1; }
    this.humanoid.group.visible = false;
    this.audio.click();
    // stealing a car draws the law
    if (this.wanted.wanted < 1) this.setWanted(1);
  }
  exitCar() {
    const car = this.playerCar;
    if (!car) return;
    const p = this.player;
    p.pos.x = car.group.position.x + Math.cos(car.angle) * 3;
    p.pos.z = car.group.position.z - Math.sin(car.angle) * 3;
    p.yaw = car.angle;
    this.camYaw = car.angle;
    car.isPlayer = false;
    car.doorT = 0.25;
    for (const side of ['left', 'right']) { const d = car.doors[side]; if (d) d.rotation.y = (side === 'left' ? -1 : 1) * 1.1; }
    this.driving = false;
    this.playerCar = null;
    this.humanoid.group.visible = true;
    this.humanoid.group.position.set(p.pos.x, 0, p.pos.z);
    this.audio.click();
  }
  swapWeapon(i) {
    if (this.weapons.switchTo(i)) {
      this.weaponMount.clear();
      this.weaponMount.add(this.weapons.model);
      this.audio.click();
    }
  }
  shoot() {
    if (this.driving || this.mode !== 'playing') return null;
    const origin = new THREE.Vector3();
    this.weaponMount.getWorldPosition(origin);
    const res = this.weapons.shoot(origin, this.aimPoint);
    if (!res) return null;
    this.audio.shot(this.weapons.current);
    this.peds.onGunshot(this.player.pos);
    if (res.hit) this.hud.hitmarker();
    return res;
  }
  onHostileShot(h, d) {
    // hostile return fire: damage falls off with distance, some shots miss
    if (Math.random() < 0.55) {
      const dmg = Math.max(3, 10 - d * 0.12);
      this.damagePlayer(dmg);
    }
    this.audio.shot(1);
  }
  damagePlayer(amount) {
    const p = this.player;
    p.health -= amount;
    this.hud.damageFlash();
    if (p.health <= 0) { p.health = 0; this.onWasted(); }
  }
  updateCamera(dt) {
    const p = this.player;
    const recoil = this.weapons.recoil;
    if (this.driving && this.playerCar) {
      const car = this.playerCar, a = car.angle;
      const fx = Math.sin(a), fz = Math.cos(a);
      const want = new THREE.Vector3(car.group.position.x - fx * 10.5, 3.8, car.group.position.z - fz * 10.5);
      this.camPos.lerp(want, Math.min(1, dt * 5));
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(car.group.position.x + fx * 7, 1.4, car.group.position.z + fz * 7);
    } else {
      const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
      const cp = Math.cos(this.camPitch), sp = Math.sin(this.camPitch);
      const want = new THREE.Vector3(
        p.pos.x - fx * cp * 6, 1.6 + p.y - sp * 6 + 1.6, p.pos.z - fz * cp * 6);
      this.camPos.lerp(want, Math.min(1, dt * 8));
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(
        p.pos.x + fx * cp * 6, 1.4 + p.y + sp * 6, p.pos.z + fz * cp * 6);
      if (recoil > 0) this.camera.rotateX(-recoil * 0.4);
    }
  }
  // --- public API (window.IRONHAVEN) ---
  state() {
    return {
      mode: this.mode, mission: this.missions.index, missionStep: this.missions.step,
      money: this.money, wanted: this.wanted.wanted, police: this.wanted.police,
      driving: this.driving, speed: this.driving && this.playerCar ? Math.abs(this.playerCar.speed) : 0,
      player: { x: this.player.pos.x, z: this.player.pos.z, angle: this.player.angle },
      kills: this.kills, health: this.player.health,
      traffic: this.traffic.cars.length, hostiles: this.peds.hostiles.filter((h) => h.state !== 'fallen').length,
    };
  }
  teleport(x, z) {
    const p = this.player;
    p.pos.x = clamp(x, -194, 194);
    p.pos.z = clamp(z, -194, 194);
    p.y = 0; p.vy = 0;
    if (this.driving && this.playerCar) {
      this.playerCar.group.position.set(p.pos.x, 0, p.pos.z);
      this.playerCar.speed = 0;
    }
    this.humanoid.group.position.set(p.pos.x, 0, p.pos.z);
    // snap the camera behind the player so there is no swoop
    const a = this.driving && this.playerCar ? this.playerCar.angle : this.camYaw;
    const fx = Math.sin(a), fz = Math.cos(a);
    this.camPos.set(p.pos.x - fx * 10, 4, p.pos.z - fz * 10);
  }
  setWanted(n) { this.wanted.setWanted(n, this.player.pos); }
  aimAt(x, y, z) {
    this.aimPoint.set(x, y, z);
    const p = this.player;
    const dx = x - p.pos.x, dy = y - 1.4, dz = z - p.pos.z;
    this.camYaw = Math.atan2(dx, dz);
    this.camPitch = clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.55, 0.5);
    p.yaw = this.camYaw;
  }
  startMission(n) { this.missions.start(n); }
  // --- deliverable screenshot staging (?shot=) ---
  stageShot(name) {
    this.newGame();
    const p = this.player;
    if (name === 'chase') {
      // police roadblock AHEAD of the player (car drives +Z, so police sit at
      // larger z), facing the oncoming car, held in place; chase camera looks forward
      const car = this.parked[0];
      this.teleport(0, -84);
      car.group.position.set(0, 0, -84);
      car.angle = 0; car.group.rotation.y = 0;
      if (car.paintMat) car.paintMat.color.set(0xb03030);
      this.enterCar(car);
      car.speed = 20;
      this.setWanted(3);
      const pcs = this.wanted.policeCars;
      pcs.forEach((pc, i) => {
        pc.group.position.set((i - 1) * 7, 0, -84 + 42 + i * 3);
        pc.angle = Math.PI; pc.group.rotation.y = Math.PI;
        pc.speed = 0;
        pc.hold = true;
      });
      this.camYaw = 0;
    } else if (name === 'drive') {
      // car on the north-south road x=56, facing north along it (not east into a block)
      const car = this.parked[1] || this.parked[0];
      this.teleport(56, -28);
      car.group.position.set(56, 0, -28);
      car.angle = 0; car.group.rotation.y = 0;
      if (car.paintMat) car.paintMat.color.set(0xd8a020);
      this.enterCar(car);
      car.speed = 16;
      this.camYaw = 0;
    } else if (name === 'foot') {
      // on foot on the north-south road x=0, facing north; traffic light at the
      // intersection ahead sits off-center
      this.teleport(8, -20);
      this.camYaw = 0;
      p.yaw = this.camYaw;
    } else if (name === 'mission') {
      // on foot on the open harbor concrete, south-west of the golden car at
      // (172, 28), facing it; camera sits clear of the (140, 28) warehouse
      this.missions.start(4);
      this.teleport(164, 22);
      this.camYaw = 0.93;
      p.yaw = this.camYaw;
      this.aimPoint.set(LOC.harbor.x, 1.5, LOC.harbor.z);
    }
  }
}
