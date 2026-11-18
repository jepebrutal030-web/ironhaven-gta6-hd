import * as THREE from 'three';
import { mulberry32, pick, range, chance, canvasTex, clamp, mergeGeoms, mat4 } from './util.js';

export const CITY = 392, HALF = 196;
export const ROADS = [-168, -112, -56, 0, 56, 112, 168];
export const LOC = {
  hideout: { x: -166, z: -162, r: 12 },
  tower: { x: 28, z: -140, r: 10 },
  harbor: { x: 172, z: 28, r: 12 },
  beachHouse: { x: -112, z: 178, r: 12 },
  vultures: { x: 84, z: 84, r: 14 },
  garage: { x: -28, z: -28, r: 12 },
  plaza: { x: 28, z: 28 },
  spawn: { x: 8, z: -8 },
};

// Facade canvas textures (128px, drawn once, cloned per building with a repeat).
function facadeTex(kind) {
  return canvasTex(128, 128, (g) => {
    if (kind === 'glass') {
      g.fillStyle = '#3d5a74'; g.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const lit = Math.random() < 0.25;
        g.fillStyle = lit ? '#ffd98a' : (Math.random() < 0.5 ? '#2a4258' : '#54708a');
        g.fillRect(8 + x * 30, 10 + y * 30, 22, 20);
      }
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 0, 128, 6);
    } else if (kind === 'brick') {
      g.fillStyle = '#8a4a38'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = 'rgba(0,0,0,0.18)';
      for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) g.fillRect(x * 16 + (y % 2 ? 8 : 0), y * 8, 14, 2);
      for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) {
        g.fillStyle = '#2c2620'; g.fillRect(12 + x * 40, 18 + y * 56, 26, 34);
        g.fillStyle = '#ffd98a'; g.fillRect(14 + x * 40, 20 + y * 56, 22, 30);
      }
    } else if (kind === 'store') {
      g.fillStyle = '#7a6a58'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#20303c'; g.fillRect(0, 78, 128, 50);
      g.fillStyle = '#bfe3ea'; g.fillRect(8, 86, 50, 34); g.fillRect(70, 86, 50, 34);
      g.fillStyle = '#e8b23a'; g.fillRect(0, 66, 128, 12);
      g.fillStyle = '#1c1c1c'; g.font = 'bold 9px sans-serif'; g.fillText('SHOP', 48, 75);
      for (let y = 0; y < 2; y++) for (let x = 0; x < 4; x++) {
        g.fillStyle = Math.random() < 0.3 ? '#ffd98a' : '#3a4a58';
        g.fillRect(8 + x * 30, 10 + y * 26, 22, 18);
      }
    } else {
      g.fillStyle = '#9a8f80'; g.fillRect(0, 0, 128, 128);
      g.fillStyle = 'rgba(0,0,0,0.15)';
      for (let y = 0; y < 4; y++) g.fillRect(0, y * 32, 128, 2);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        g.fillStyle = Math.random() < 0.2 ? '#ffd98a' : '#4a5a68';
        g.fillRect(10 + x * 30, 8 + y * 30, 20, 18);
      }
    }
  });
}

export class World {
  constructor(scene, seed = 1) {
    this.scene = scene;
    this.rng = mulberry32(seed);
    this.colliders = [];
    this.lights = []; // traffic lights {x,z,state,timer,phase,meshes}
    this.waterTex = null;
    this.clouds = [];
    this.time = 0;
    this.groundY = 0;
    this.build();
  }
  addCollider(x, z, r) { this.colliders.push({ x, z, r }); }
  build() {
    const rng = this.rng, scene = this.scene;
    // --- lights: golden-hour sun + hemisphere + ambient ---
    const sun = new THREE.DirectionalLight(0xffd9a0, 2.6);
    sun.position.set(-140, 120, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(512, 512);
    const sc = sun.shadow.camera;
    sc.left = -220; sc.right = 220; sc.top = 220; sc.bottom = -220; sc.near = 10; sc.far = 520;
    sun.shadow.bias = -0.0004;
    scene.add(sun);
    this.sun = sun;
    scene.add(new THREE.HemisphereLight(0x9db8d6, 0x8a6a4a, 1.05));
    scene.add(new THREE.AmbientLight(0xfff2dd, 0.35));
    scene.fog = new THREE.Fog(0xe8c9a0, 180, 560);
    // --- sky dome, sun disc, clouds ---
    const skyTex = canvasTex(64, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#2a4a7a'); gr.addColorStop(0.45, '#7aa0c8');
      gr.addColorStop(0.72, '#f2c98a'); gr.addColorStop(1, '#f7b96a');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(700, 24, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }));
    scene.add(sky);
    const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(26, 24), new THREE.MeshBasicMaterial({ color: 0xfff2c0, fog: false }));
    sunDisc.position.set(-420, 200, 260); sunDisc.lookAt(0, 40, 0);
    scene.add(sunDisc);
    const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, fog: false });
    for (let i = 0; i < 12; i++) {
      const cl = new THREE.Group();
      const n = 3 + Math.floor(rng() * 3);
      for (let j = 0; j < n; j++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(range(rng, 10, 22), 10, 8), cloudMat);
        s.position.set(j * 14 - n * 7, range(rng, -2, 3), range(rng, -6, 6));
        s.scale.y = 0.45;
        cl.add(s);
      }
      cl.position.set(range(rng, -320, 320), range(rng, 120, 210), range(rng, -320, 320));
      scene.add(cl);
      this.clouds.push(cl);
    }
    this.buildGround();
    this.buildWater();
    this.buildCity();
    this.buildProps();
  }
  // --- ground: one 2048 canvas painting grass, roads, sidewalks, crosswalks, park, beach, harbor ---
  buildGround() {
    const m = (v) => ((v + HALF) / CITY) * 2048;
    const tex = canvasTex(2048, 2048, (g) => {
      g.fillStyle = '#5d8a48'; g.fillRect(0, 0, 2048, 2048); // grass base
      // park block (Founders Plaza): brighter lawn + paths
      g.fillStyle = '#6fa055'; g.fillRect(m(6), m(6), m(50) - m(6), m(50) - m(6));
      g.fillStyle = '#cbb98a';
      g.fillRect(m(24), m(6), 12, m(50) - m(6)); g.fillRect(m(6), m(24), m(50) - m(6), 12);
      g.beginPath(); g.arc(m(28), m(28), 26, 0, 7); g.fillStyle = '#7fb8c9'; g.fill();
      // harbor concrete
      g.fillStyle = '#8d8d88'; g.fillRect(m(150), m(-56), m(196) - m(150), m(112) - m(-56));
      // beach sand
      g.fillStyle = '#d9c08a'; g.fillRect(0, m(168), 2048, m(196) - m(168));
      // roads: sidewalks then asphalt
      for (const a of ROADS) {
        g.fillStyle = '#b8b4ac'; // sidewalks
        g.fillRect(0, m(a - 8), 2048, m(a + 8) - m(a - 8));
        g.fillRect(m(a - 8), 0, m(a + 8) - m(a - 8), 2048);
        g.fillStyle = '#33363b'; // asphalt
        g.fillRect(0, m(a - 6), 2048, m(a + 6) - m(a - 6));
        g.fillRect(m(a - 6), 0, m(a + 6) - m(a - 6), 2048);
      }
      // lane dashes + edge lines
      g.fillStyle = '#e8c33a';
      for (const a of ROADS) {
        for (let v = -196; v < 196; v += 12) {
          if (Math.abs(v - a) < 9) continue;
          g.fillRect(m(v), m(a) - 2, 26, 4);
          g.fillRect(m(a) - 2, m(v), 4, 26);
        }
      }
      g.fillStyle = '#e8e8e8';
      for (const a of ROADS) {
        g.fillRect(0, m(a - 5.4), 2048, 3); g.fillRect(0, m(a + 5.4), 2048, 3);
        g.fillRect(m(a - 5.4), 0, 3, 2048); g.fillRect(m(a + 5.4), 0, 3, 2048);
      }
      // crosswalks at intersections
      g.fillStyle = '#f2f2f2';
      for (const ax of ROADS) for (const az of ROADS) {
        for (let i = 0; i < 5; i++) {
          g.fillRect(m(ax - 5 + i * 2.2), m(az - 8), 8, 4);
          g.fillRect(m(ax - 5 + i * 2.2), m(az + 8) - 4, 8, 4);
          g.fillRect(m(ax - 8), m(az - 5 + i * 2.2), 4, 8);
          g.fillRect(m(ax + 8) - 4, m(az - 5 + i * 2.2), 4, 8);
        }
      }
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(CITY, CITY), new THREE.MeshLambertMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }
  buildWater() {
    const tex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#2a6a8a'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 2;
      for (let i = 0; i < 40; i++) {
        g.beginPath();
        const y = Math.random() * h;
        g.moveTo(Math.random() * w, y);
        g.lineTo(Math.random() * w + 30, y + 4);
        g.stroke();
      }
    }, [6, 6]);
    this.waterTex = tex;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.1, color: 0x9fc8dd });
    const east = new THREE.Mesh(new THREE.PlaneGeometry(110, 460), mat);
    east.rotation.x = -Math.PI / 2; east.position.set(196 + 55, 0.05, 0);
    this.scene.add(east);
    const south = new THREE.Mesh(new THREE.PlaneGeometry(460, 110), mat);
    south.rotation.x = -Math.PI / 2; south.position.set(0, 0.05, 196 + 55);
    this.scene.add(south);
  }
  // --- buildings by block + district ---
  buildCity() {
    const rng = this.rng, scene = this.scene;
    const facades = { glass: facadeTex('glass'), brick: facadeTex('brick'), concrete: facadeTex('concrete'), store: facadeTex('store') };
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const district = (cx, cz) => {
      if (cx >= 140 && cz >= -84 && cz <= 84) return 'harbor';
      if (cz >= 140) return 'beach';
      if (cx >= 6 && cx <= 50 && cz >= 6 && cz <= 50) return 'park';
      if (cz <= -56 && Math.abs(cx) <= 84) return 'downtown';
      if (cx <= -56 && cz <= 0) return 'residential';
      return 'mixed';
    };
    const addBuilding = (x, z, w, h, d, kind, opts = {}) => {
      const tex = facades[kind].clone();
      tex.needsUpdate = true;
      tex.repeat.set(Math.max(1, Math.round(w / 7)), Math.max(1, Math.round(h / 7)));
      const side = kind === 'glass'
        ? new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.25 })
        : new THREE.MeshLambertMaterial({ map: tex });
      const mesh = new THREE.Mesh(boxGeo, [side, side, roofMat, roofMat, side, side]);
      mesh.scale.set(w, h, d);
      mesh.position.set(x, h / 2, z);
      mesh.castShadow = false; mesh.receiveShadow = true;
      scene.add(mesh);
      this.addCollider(x, z, Math.max(w, d) * 0.62);
      if (opts.roof) {
        const r = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x555550 }));
        r.scale.set(w * 0.3, 1.2, d * 0.3); r.position.set(x - w * 0.2, h + 0.6, z);
        scene.add(r);
      }
      if (opts.antenna) {
        const a = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 12, 6), new THREE.MeshLambertMaterial({ color: 0x888888 }));
        a.position.set(x + w * 0.3, h + 6, z); scene.add(a);
      }
      return mesh;
    };
    let towerDone = false;
    for (let i = 0; i < ROADS.length - 1; i++) {
      for (let j = 0; j < ROADS.length - 1; j++) {
        const cx = (ROADS[i] + ROADS[i + 1]) / 2, cz = (ROADS[j] + ROADS[j + 1]) / 2;
        const kind = district(cx, cz);
        if (kind === 'park') continue;
        if (kind === 'harbor') {
          addBuilding(cx, cz, 30, 9, 16, 'concrete', { roof: true });
          // shipping containers
          for (let k = 0; k < 4; k++) {
            const c = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: pick(rng, [0xb03030, 0x2a5a8a, 0x3a7a3a, 0xc07828, 0x6a4a8a]) }));
            c.scale.set(12, 2.6, 2.6);
            c.position.set(cx - 14 + k * 3, 1.3 + (k % 2) * 2.7, cz + 14 + (k % 2) * 4);
            c.rotation.y = (rng() - 0.5) * 0.2;
            scene.add(c);
            this.addCollider(c.position.x, c.position.z, 6);
          }
          continue;
        }
        if (kind === 'beach') {
          addBuilding(cx - 8, cz, 10, 5, 8, 'store');
          addBuilding(cx + 10, cz, 9, 4.5, 8, 'brick');
          continue;
        }
        if (kind === 'downtown') {
          const h = range(rng, 38, 78);
          const isTower = !towerDone && cx === 28 && cz === -140;
          addBuilding(cx, cz, range(rng, 18, 24), h, range(rng, 18, 24), 'glass', { roof: true, antenna: true });
          if (isTower) {
            towerDone = true;
            const pad = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 0.6, 20), new THREE.MeshStandardMaterial({ color: 0x2a2a2a }));
            pad.position.set(cx, h + 0.3, cz); scene.add(pad);
            const hMark = new THREE.Mesh(new THREE.CircleGeometry(4.5, 20), new THREE.MeshBasicMaterial({ color: 0xe8b23a }));
            hMark.rotation.x = -Math.PI / 2; hMark.position.set(cx, h + 0.65, cz); scene.add(hMark);
          }
          continue;
        }
        if (kind === 'residential') {
          const n = 2 + Math.floor(rng() * 2);
          for (let k = 0; k < n; k++) {
            const hx = cx + (k % 2 === 0 ? -11 : 11), hz = cz + (k < 2 ? -11 : 11);
            addBuilding(hx, hz, range(rng, 9, 12), range(rng, 4.5, 7), range(rng, 8, 11), chance(rng, 0.6) ? 'brick' : 'concrete');
          }
          continue;
        }
        // mixed: two mid-rise
        addBuilding(cx - 11, cz, range(rng, 12, 16), range(rng, 12, 24), range(rng, 11, 14), 'concrete', { roof: chance(rng, 0.5) });
        addBuilding(cx + 11, cz + 2, range(rng, 12, 15), range(rng, 10, 20), range(rng, 11, 13), chance(rng, 0.5) ? 'store' : 'concrete');
      }
    }
    // harbor cranes + bridge + hideout garage + beach house
    const craneMat = new THREE.MeshLambertMaterial({ color: 0xc07828 });
    for (const [cx, cz] of [[168, -28], [168, 56]]) {
      const leg1 = new THREE.Mesh(boxGeo, craneMat); leg1.scale.set(2, 26, 2); leg1.position.set(cx, 13, cz - 6); scene.add(leg1);
      const leg2 = new THREE.Mesh(boxGeo, craneMat); leg2.scale.set(2, 26, 2); leg2.position.set(cx, 13, cz + 6); scene.add(leg2);
      const jib = new THREE.Mesh(boxGeo, craneMat); jib.scale.set(2, 2, 34); jib.position.set(cx, 26, cz); scene.add(jib);
      const cab = new THREE.Mesh(boxGeo, craneMat); cab.scale.set(4, 3, 4); cab.position.set(cx, 24, cz); scene.add(cab);
      this.addCollider(cx, cz, 8);
    }
    // bridge over the harbor water (east edge)
    const bridge = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x7a7a72 }));
    bridge.scale.set(60, 1.2, 10); bridge.position.set(210, 6, -84); scene.add(bridge);
    const bcol = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 6, 10), new THREE.MeshLambertMaterial({ color: 0x666660 }));
    bcol.position.set(210, 3, -84); scene.add(bcol);
    // hideout garage (NW corner)
    const hide = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x6a5a4a }));
    hide.scale.set(12, 5, 10); hide.position.set(-178, 2.5, -162); scene.add(hide);
    this.addCollider(-178, -162, 8);
    // beach house (Getaway target)
    const bh = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xd8c8a8 }));
    bh.scale.set(11, 5, 9); bh.position.set(-112, 2.5, 184); scene.add(bh);
    this.addCollider(-112, 184, 7);
  }
  // --- trees, lamps, traffic lights, hydrants, bus stops, signs, fountain ---
  buildProps() {
    const rng = this.rng, scene = this.scene;
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a3a22 });
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x3a7a34 });
    const leafMat2 = new THREE.MeshLambertMaterial({ color: 0x4a8a3a });
    const trunkParts = [], leafParts = [];
    const tree = (x, z, s = 1) => {
      trunkParts.push({ geo: new THREE.CylinderGeometry(0.35 * s, 0.5 * s, 3 * s, 8), m: mat4(x, 1.5 * s, z) });
      leafParts.push({ geo: new THREE.SphereGeometry(2.6 * s, 12, 10), m: mat4(x, 4.2 * s, z) });
      leafParts.push({ geo: new THREE.SphereGeometry(1.8 * s, 10, 8), m: mat4(x + 1.2 * s, 3.2 * s, z + 0.6 * s) });
      this.addCollider(x, z, 0.9 * s);
    };
    // park trees (inside the park block, well off the roads)
    for (let i = 0; i < 10; i++) tree(range(rng, 12, 46), range(rng, 12, 46), range(rng, 0.8, 1.3));
    // residential + mixed block trees
    for (let i = 0; i < 26; i++) {
      const bx = pick(rng, [-140, -84, -28, 84, 140]), bz = pick(rng, [-140, -84, -28, 84, 140]);
      tree(bx + range(rng, -14, 14), bz + range(rng, -14, 14), range(rng, 0.7, 1.1));
    }
    scene.add(new THREE.Mesh(mergeGeoms(trunkParts), trunkMat));
    scene.add(new THREE.Mesh(mergeGeoms(leafParts), leafMat));
    // plaza fountain (center of the park block)
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5, 1, 20), new THREE.MeshLambertMaterial({ color: 0x9a9a92 }));
    basin.position.set(28, 0.5, 28); scene.add(basin);
    const fwater = new THREE.Mesh(new THREE.CircleGeometry(4, 20), new THREE.MeshStandardMaterial({ color: 0x5aa8c8, roughness: 0.2, metalness: 0.2 }));
    fwater.rotation.x = -Math.PI / 2; fwater.position.set(28, 1.02, 28); scene.add(fwater);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 2.4, 10), new THREE.MeshLambertMaterial({ color: 0x8a8a82 }));
    col.position.set(28, 2, 28); scene.add(col);
    this.addCollider(28, 28, 5.5);
    // benches in the park
    for (const [bx, bz, ry] of [[16, 16, 0], [40, 16, Math.PI], [16, 40, Math.PI / 2], [40, 40, -Math.PI / 2]]) {
      const b = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x7a5230 }));
      b.scale.set(2.4, 0.5, 0.7); b.position.set(bx, 0.45, bz); b.rotation.y = ry; scene.add(b);
    }
    // street lamps along roads (offset 9m from axes so cars never hit them)
    const lampMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
    const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffd070, emissiveIntensity: 1.4 });
    const lampPoleParts = [], lampHeadParts = [];
    for (const a of ROADS) {
      for (let v = -168; v <= 168; v += 56) {
        for (const [lx, lz] of [[a + 9, v], [a - 9, v + 28]]) {
          if (Math.abs(lx) > 190 || Math.abs(lz) > 190) continue;
          lampPoleParts.push({ geo: new THREE.CylinderGeometry(0.12, 0.16, 6, 8), m: mat4(lx, 3, lz) });
          lampHeadParts.push({ geo: new THREE.SphereGeometry(0.35, 8, 6), m: mat4(lx, 6.1, lz) });
        }
      }
    }
    scene.add(new THREE.Mesh(mergeGeoms(lampPoleParts), lampMat));
    scene.add(new THREE.Mesh(mergeGeoms(lampHeadParts), lampHeadMat));
    // traffic lights at the 4 central intersections (working cycle, all in sync)
    const tlPoleParts = [], tlBoxParts = [], tlRedParts = [], tlYellowParts = [], tlGreenParts = [];
    for (const [lx, lz] of [[0, 0], [0, 56], [56, 0], [-56, 0]]) {
      const bx = lx + 8.5, bz = lz - 8.5;
      tlPoleParts.push({ geo: new THREE.CylinderGeometry(0.14, 0.18, 5.4, 8), m: mat4(bx, 2.7, bz) });
      tlBoxParts.push({ geo: boxGeo, m: mat4(bx, 5, bz, 0, 0.7, 1.9, 0.7) });
      tlRedParts.push({ geo: new THREE.SphereGeometry(0.24, 10, 8), m: mat4(bx, 5.55, bz + 0.36) });
      tlYellowParts.push({ geo: new THREE.SphereGeometry(0.24, 10, 8), m: mat4(bx, 5.0, bz + 0.36) });
      tlGreenParts.push({ geo: new THREE.SphereGeometry(0.24, 10, 8), m: mat4(bx, 4.45, bz + 0.36) });
      this.lights.push({ x: lx, z: lz, state: 'green', timer: 0 });
    }
    scene.add(new THREE.Mesh(mergeGeoms(tlPoleParts), lampMat));
    scene.add(new THREE.Mesh(mergeGeoms(tlBoxParts), new THREE.MeshLambertMaterial({ color: 0x1a1a1a })));
    this.lightMats = {
      red: new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff2a2a, emissiveIntensity: 0.15 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xffc82a, emissive: 0xffc82a, emissiveIntensity: 0.15 }),
      green: new THREE.MeshStandardMaterial({ color: 0x2aff5a, emissive: 0x2aff5a, emissiveIntensity: 2.2 }),
    };
    scene.add(new THREE.Mesh(mergeGeoms(tlRedParts), this.lightMats.red));
    scene.add(new THREE.Mesh(mergeGeoms(tlYellowParts), this.lightMats.yellow));
    scene.add(new THREE.Mesh(mergeGeoms(tlGreenParts), this.lightMats.green));
    // hydrants + bus stops + road signs
    const hydMat = new THREE.MeshLambertMaterial({ color: 0xc03028 });
    for (let i = 0; i < 10; i++) {
      const hx = pick(rng, ROADS) + 9, hz = pick(rng, ROADS) + range(rng, -20, 20);
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.9, 8), hydMat);
      h.position.set(hx, 0.45, hz); scene.add(h);
    }
    for (const [sx, sz] of [[56, -84], [-56, 84], [112, 28]]) {
      const post = new THREE.Mesh(boxGeo, lampMat); post.scale.set(0.25, 3, 0.25); post.position.set(sx, 1.5, sz); scene.add(post);
      const sign = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x2a6ab0 }));
      sign.scale.set(1.6, 1, 0.15); sign.position.set(sx, 3.1, sz); scene.add(sign);
    }
  }
  lightStateAt(x, z) {
    // nearest traffic light within 14m of the point, else green
    let best = null, bd = 1e9;
    for (const l of this.lights) {
      const d = Math.hypot(l.x - x, l.z - z);
      if (d < bd) { bd = d; best = l; }
    }
    return bd < 16 ? best.state : 'green';
  }
  update(dt) {
    this.time += dt;
    if (this.waterTex) { this.waterTex.offset.x += dt * 0.008; this.waterTex.offset.y += dt * 0.005; }
    for (const c of this.clouds) { c.position.x += dt * 1.2; if (c.position.x > 340) c.position.x = -340; }
    this.lightTimer = (this.lightTimer || 0) + dt;
    const cyc = this.lightTimer % 13.5;
    const s = cyc < 6 ? 'green' : cyc < 7.5 ? 'yellow' : 'red';
    if (s !== this.lightState) {
      this.lightState = s;
      this.lightMats.red.emissiveIntensity = s === 'red' ? 2.2 : 0.15;
      this.lightMats.yellow.emissiveIntensity = s === 'yellow' ? 2.2 : 0.15;
      this.lightMats.green.emissiveIntensity = s === 'green' ? 2.2 : 0.15;
      for (const l of this.lights) l.state = s;
    }
  }
}
