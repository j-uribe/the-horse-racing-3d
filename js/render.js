// Escena 3D de la carrera (Three.js) sobre un óvalo. Misma interfaz que la escena
// 2D original: reset(race), updateCamera(...), updateParticles(...), draw(t, opts), resize().
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { buildHorse, poseHorse, disposeHorse, NOSE } from "./horse3d.js";
import { DISTANCE, posAt, speedAt } from "./race.js";
import { R, LOOP, CENTER, LANE, laneOffset, RAIL_OUT, railFrame, trackXZ, headingAngle } from "./track.js";
import { planLanes } from "./lanes.js";
import { mulberry32 } from "./rng.js";

const TAU = Math.PI * 2;
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerpK = (k, dt) => 1 - Math.exp(-k * dt);
const V3 = THREE.Vector3;
const FOV = 28;
const MAX_PARTICLES = 700;
const STAND_S0 = DISTANCE - 220, STAND_S1 = DISTANCE + 45;
const STAND_Z0 = RAIL_OUT + 28;
const PODIUM_S = DISTANCE + 14, PODIUM_OFF = -32;

export const HOURS = {
  day: {
    label: "Tarde", sky: ["#5f8fc4", "#b9d1e3", "#e9e2cf"], rainSky: ["#47515b", "#8a949a", "#a3aaa9"],
    fog: "#e2e0d2", rainFog: "#9aa3a8", hemi: ["#dfe9f2", "#4c5b2c", 1.15], sun: ["#fff1d8", 2.6],
    dir: [0.45, 0.75, 0.5], tint: "#ffffff", cloud: "#ffffff", lamps: 0, stars: false,
  },
  dusk: {
    label: "Atardecer", sky: ["#2b3768", "#c47a7c", "#ffc58f"], rainSky: ["#363546", "#776a6e", "#9a8a84"],
    fog: "#d8a487", rainFog: "#8d8282", hemi: ["#ffd2a8", "#3b3550", 0.85], sun: ["#ffad66", 2.5],
    dir: [-0.86, 0.2, 0.47], tint: "#ffb79c", cloud: "#ffb59a", lamps: 0.45, stars: false,
  },
  night: {
    label: "Noche", sky: ["#02050d", "#0a1530", "#1d2b46"], rainSky: ["#020409", "#0a0f1b", "#151c2a"],
    fog: "#0f1828", rainFog: "#111722", hemi: ["#7085b5", "#121624", 0.4], sun: ["#eef2ff", 2.1],
    dir: [0.12, 0.96, 0.25], tint: "#36415f", cloud: "#2b3447", lamps: 1, stars: true,
  },
};

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
const rng = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gradient = (stops) => canvasTex(4, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, stops[0]); gr.addColorStop(0.55, stops[1]); gr.addColorStop(1, stops[2]);
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const world = (s, off, y) => { const p = trackXZ(s, off); return new V3(p.x, y, p.z); };

// Franja que sigue el óvalo entre dos distancias a la baranda (pista, desgaste).
function stripGeometry(off0, off1, y, uLen) {
  const step = 2, n = Math.ceil(LOOP / step);
  const uScale = LOOP / Math.max(1, Math.round(LOOP / uLen));
  const pos = [], uv = [], nrm = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const s = Math.min(LOOP, i * step);
    for (const [k, off] of [[0, off0], [1, off1]]) {
      const p = trackXZ(s, off);
      pos.push(p.x, y, p.z); uv.push(s / uScale, k); nrm.push(0, 1, 0);
    }
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

// Objeto ubicado en coordenadas de pista: +x local hacia el avance, +z hacia afuera.
function placeOnTrack(obj, s, off = 0, y = 0) {
  const p = trackXZ(s, off);
  obj.position.set(p.x, y, p.z);
  obj.rotation.y = headingAngle(s);
  return obj;
}

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.view = "tv";
    this.labels = true;
    this.excitement = 0;
    this.cam = { s: 2, z: 1, off: 8, spread: 8 };
    this.cw = { s: 0, off: 30, y: 6 };
    this.cl = { s: 0, off: 8, y: 1 };
    this.camLook = new V3();
    this.particles = [];
    this.phases = [];
    this.lastPhase = [];
    this.horses = [];
    this.snap = false;
    this.gateK = 0;
    this.podiumT = 0;
    this.podiumShift = 0;
    this.podiumOn = false;
    this.time = 0;

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;

    this.overlay = document.createElement("canvas");
    this.overlay.className = "overlay";
    this.overlay.setAttribute("aria-hidden", "true");
    canvas.after(this.overlay);
    this.octx = this.overlay.getContext("2d");

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 4000);
    this.skies = new Map();

    this.buildLights();
    this.buildGround();
    this.buildRails();
    this.buildMarkers();
    this.buildStand();
    this.buildScenery();
    this.buildLamps();
    this.buildPodium();
    this.buildEffects();
    this.buildMiniMap();
    this.setEnvironment("day", false);
    this.resize();
  }

  // ---- mundo --------------------------------------------------------------------
  buildLights() {
    this.hemi = new THREE.HemisphereLight("#dfe9f2", "#4c5b2c", 1.15);
    this.sun = new THREE.DirectionalLight("#fff1d8", 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 160 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.hemi, this.sun, this.sun.target);
  }

  buildGround() {
    const s = this.scene;
    const rough = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = "#4b7130"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 4000; i++) {
        g.fillStyle = `rgba(${20 + Math.random() * 50},${50 + Math.random() * 60},${10 + Math.random() * 20},.3)`;
        g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
      }
    }, [200, 200]);
    this.groundMat = new THREE.MeshStandardMaterial({ map: rough, roughness: 1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), this.groundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.set(CENTER.x, 0, CENTER.z);
    ground.receiveShadow = true; s.add(ground);

    // pasto de la pista con franjas de corte de 7 m
    const turf = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = "#64923f"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#72a249"; g.fillRect(0, 0, w / 2, h);
      for (let i = 0; i < 3000; i++) {
        g.fillStyle = `rgba(${30 + Math.random() * 40},${70 + Math.random() * 60},${15 + Math.random() * 25},.22)`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    });
    turf.wrapS = turf.wrapT = THREE.RepeatWrapping;
    this.turfMat = new THREE.MeshStandardMaterial({ map: turf, roughness: 0.95, side: THREE.DoubleSide });
    const track = new THREE.Mesh(stripGeometry(-0.4, RAIL_OUT + 0.4, 0.01, 14), this.turfMat);
    track.receiveShadow = true; s.add(track);

    const wear = new THREE.Mesh(stripGeometry(0.4, 2.2, 0.015, 14),
      new THREE.MeshStandardMaterial({ color: "#8a7a4c", roughness: 1, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }));
    wear.receiveShadow = true; s.add(wear);

    // laguna del césped interior
    const sand = new THREE.Mesh(new THREE.CircleGeometry(1, 72), new THREE.MeshStandardMaterial({ color: "#b9a47a", roughness: 1 }));
    sand.rotation.x = -Math.PI / 2; sand.scale.set(66, 25, 1); sand.position.set(CENTER.x - 40, 0.02, CENTER.z); s.add(sand);
    const water = new THREE.Mesh(new THREE.CircleGeometry(1, 72), new THREE.MeshStandardMaterial({ color: "#3f6f8a", roughness: 0.12, metalness: 0.2 }));
    water.rotation.x = -Math.PI / 2; water.scale.set(62, 22, 1); water.position.set(CENTER.x - 40, 0.04, CENTER.z);
    water.receiveShadow = true; s.add(water);
  }

  buildRails() {
    const s = this.scene;
    const white = new THREE.MeshStandardMaterial({ color: "#f4f2ec", roughness: 0.5 });
    const gap = 2.5, per = Math.floor(LOOP / gap);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), white, per * 2);
    const bars = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 8), white, per * 2);
    const hedge = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#37552f", roughness: 1 }), per);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new V3(1, 1, 1), P = new V3(), E = new THREE.Euler();
    const UP = new V3(0, 1, 0), D = new V3();
    let k = 0;
    for (const off of [0, RAIL_OUT]) {
      for (let i = 0; i < per; i++) {
        const s0 = i * gap, s1 = (i + 1) * gap;
        const a = trackXZ(s0, off), b = trackXZ(s1, off);
        Q.setFromEuler(E.set(0, headingAngle(s0), 0));
        posts.setMatrixAt(k, M.compose(P.set(a.x, 0.5, a.z), Q, S.set(1, 1, 1)));
        D.set(b.x - a.x, 0, b.z - a.z);
        const len = D.length(); D.normalize();
        Q.setFromUnitVectors(UP, D);
        bars.setMatrixAt(k, M.compose(P.set((a.x + b.x) / 2, 1.02, (a.z + b.z) / 2), Q, S.set(1, len + 0.02, 1)));
        k++;
      }
    }
    for (let i = 0; i < per; i++) {
      const sm = (i + 0.5) * gap, p = trackXZ(sm, -2.2);
      Q.setFromEuler(E.set(0, headingAngle(sm), 0));
      hedge.setMatrixAt(i, M.compose(P.set(p.x, 0.5, p.z), Q, S.set(gap + 0.15, 1.0, 1.1)));
    }
    posts.castShadow = bars.castShadow = hedge.castShadow = true;
    hedge.receiveShadow = true;
    s.add(posts, bars, hedge);
  }

  buildMarkers() {
    const s = this.scene;
    const white = new THREE.MeshStandardMaterial({ color: "#f4f2ec", roughness: 0.5 });
    for (let d = 100; d < DISTANCE; d += 100) {
      const rem = DISTANCE - d;
      const g = placeOnTrack(new THREE.Group(), d, -0.5);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), white);
      pole.position.y = 1.3; pole.castShadow = true; g.add(pole);
      const tex = canvasTex(256, 196, (c, w, h) => {
        c.fillStyle = rem <= 200 ? "#b3201f" : "#1d3a6b"; c.fillRect(0, 0, w, h);
        c.strokeStyle = "#f4f2ec"; c.lineWidth = 10; c.strokeRect(6, 6, w - 12, h - 12);
        c.fillStyle = "#fff"; c.font = "bold 110px Georgia, serif"; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(String(rem), w / 2, h / 2 + 6);
      });
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.72, 0.06),
        [white, white, white, white, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), white]);
      sign.position.y = 2.95; sign.castShadow = true; g.add(sign);
      s.add(g);
    }
    // meta
    const fin = placeOnTrack(new THREE.Group(), DISTANCE, 0);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.24, RAIL_OUT), new THREE.MeshStandardMaterial({ color: "#fafaf5", roughness: 0.8 }));
    line.rotation.x = -Math.PI / 2; line.position.set(0, 0.02, RAIL_OUT / 2); line.receiveShadow = true; fin.add(line);
    const discTex = canvasTex(256, 256, (c, w) => {
      c.fillStyle = "#b3201f"; c.beginPath(); c.arc(w / 2, w / 2, w / 2 - 2, 0, TAU); c.fill();
      c.fillStyle = "#f4f2ea"; c.beginPath(); c.arc(w / 2, w / 2, w * 0.3, 0, TAU); c.fill();
      c.fillStyle = "#b3201f"; c.font = "bold 46px Georgia, serif"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("META", w / 2, w / 2 + 2);
    });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.2, 10), white);
    post.position.set(0, 2.1, -0.5); post.castShadow = true; fin.add(post);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.6, 40), new THREE.MeshStandardMaterial({ map: discTex, roughness: 0.5, transparent: true, side: THREE.DoubleSide }));
    disc.position.set(0, 4.75, -0.5); fin.add(disc);
    this.photoPlane = new THREE.Mesh(new THREE.PlaneGeometry(RAIL_OUT, 3.4),
      new THREE.MeshBasicMaterial({ color: "#e01e1e", transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
    this.photoPlane.rotation.y = Math.PI / 2; this.photoPlane.position.set(0, 1.7, RAIL_OUT / 2);
    this.photoPlane.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(RAIL_OUT, 3.4)), new THREE.LineBasicMaterial({ color: "#ff2b2b" })));
    this.photoPlane.visible = false; fin.add(this.photoPlane);
    s.add(fin);
  }

  buildStand() {
    // tribuna por fuera de la recta final, frente a la meta
    const g = placeOnTrack(new THREE.Group(), (STAND_S0 + STAND_S1) / 2, 0);
    const len = STAND_S1 - STAND_S0, z0 = STAND_Z0, TIERS = 9;
    const concrete = new THREE.MeshStandardMaterial({ color: "#e7e1d2", roughness: 0.9 });
    for (let k = 0; k < TIERS; k++) {
      const top = 0.9 * (k + 1);
      const step = new THREE.Mesh(new THREE.BoxGeometry(len, top, 1.4), concrete);
      step.position.set(0, top / 2, z0 + k * 1.4); step.castShadow = step.receiveShadow = true; g.add(step);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, 13, 0.6), concrete);
    back.position.set(0, 6.5, z0 + TIERS * 1.4); back.castShadow = true; g.add(back);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 4, 0.35, 17), new THREE.MeshStandardMaterial({ color: "#1f4a34", roughness: 0.7 }));
    roof.position.set(0, 13.4, z0 + 5.6); roof.rotation.x = 0.06; roof.castShadow = true; g.add(roof);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(len + 4, 0.7, 0.2), new THREE.MeshStandardMaterial({ color: "#c9a54b", roughness: 0.5 }));
    trim.position.set(0, 12.9, z0 - 2.9); g.add(trim);
    for (let x = -len / 2; x <= len / 2; x += 26) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 13, 10), concrete);
      col.position.set(x, 6.5, z0 - 2.2); col.castShadow = true; g.add(col);
    }
    // público: un cuerpo y una cabeza por persona, instanciados
    const r = rng(4242);
    const people = [];
    for (let k = 0; k < TIERS; k++) {
      for (let x = -len / 2 + 0.6; x < len / 2 - 0.6; x += 0.78 + r() * 0.25) {
        if (r() < 0.12) continue;
        people.push({ x, k, eager: 0.4 + r() * 0.6, ph: r() * TAU, sp: 7 + r() * 4 });
      }
    }
    const N = people.length;
    const shirts = ["#b0182a", "#f2efe6", "#1d4cb8", "#e8b923", "#2a2a2a", "#e35d12", "#3f6b3a", "#d9468f", "#8d877f", "#6b1f7a", "#24aaa8"];
    const skins = ["#e2b996", "#c68e63", "#8d5a3b", "#f1cfb0"];
    const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.42, 3, 8), new THREE.MeshStandardMaterial({ roughness: 0.9 }), N);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshStandardMaterial({ roughness: 0.8 }), N);
    const C = new THREE.Color();
    people.forEach((p, i) => {
      bodies.setColorAt(i, C.set(shirts[(r() * shirts.length) | 0]));
      heads.setColorAt(i, C.set(skins[(r() * skins.length) | 0]));
    });
    bodies.frustumCulled = heads.frustumCulled = false;
    g.add(bodies, heads);
    this.crowd = { people, bodies, heads, z0, lastE: 1 };
    this.scene.add(g);
    this.updateCrowd(0);
  }

  updateCrowd(time) {
    const { people, bodies, heads, z0 } = this.crowd;
    const e = this.excitement;
    if (e < 0.05 && this.crowd.lastE < 0.05) return;
    this.crowd.lastE = e;
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new V3(1, 1, 1), P = new V3();
    const standAll = smooth(0.3, 0.75, e);
    const jumpAll = smooth(0.55, 0.95, e);
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const seat = 0.9 * (p.k + 1);
      const stand = standAll * p.eager;
      const jump = jumpAll * p.eager * 0.28 * Math.max(0, Math.sin(time * p.sp + p.ph));
      const y = seat + 0.32 + stand * 0.28 + jump;
      const z = z0 + p.k * 1.4 - 0.25;
      bodies.setMatrixAt(i, M.compose(P.set(p.x, y, z), Q, S.set(1, 0.85 + stand * 0.3, 1)));
      heads.setMatrixAt(i, M.compose(P.set(p.x, y + 0.5 + stand * 0.08, z), Q, S.set(1, 1, 1)));
    }
    bodies.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = true;
  }

  buildScenery() {
    const s = this.scene;
    // árboles: por fuera del óvalo y algunos en el césped interior
    const rnd = rng(11);
    const N = 520;
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: "#2f5a2a", roughness: 1, flatShading: true }), N);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.25, 1, 6), new THREE.MeshStandardMaterial({ color: "#4a3626", roughness: 1 }), N);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new V3(), P = new V3();
    const lake = { x: CENTER.x - 40, z: CENTER.z };
    const podium = trackXZ(PODIUM_S, PODIUM_OFF);
    let i = 0, guard = 0;
    while (i < N && guard++ < 20000) {
      const sAt = rnd() * LOOP;
      const inside = rnd() < 0.18;
      const off = inside ? -8 - rnd() * 52 : RAIL_OUT + 26 + rnd() * 140;
      if (!inside && sAt > STAND_S0 - 30 && sAt < STAND_S1 + 30 && off < RAIL_OUT + 75) continue;
      const p = trackXZ(sAt, off);
      if (inside && ((p.x - lake.x) / 74) ** 2 + ((p.z - lake.z) / 32) ** 2 < 1) continue;
      if (inside && Math.hypot(p.x - podium.x, p.z - podium.z) < 30) continue;
      const sz = 1.6 + rnd() * 1.8;
      P.set(p.x, sz * 0.6, p.z); S.set(0.7, sz * 0.6, 0.7); trunks.setMatrixAt(i, M.compose(P, Q, S));
      P.set(p.x, sz * 1.4, p.z); S.set(sz * (0.8 + rnd() * 0.3), sz * (0.95 + rnd() * 0.35), sz * (0.8 + rnd() * 0.3));
      crowns.setMatrixAt(i, M.compose(P, Q, S));
      i++;
    }
    crowns.count = trunks.count = i;
    crowns.castShadow = true;
    s.add(crowns, trunks);

    // cordillera alrededor, lejos y sin niebla
    const mrnd = rng(48271);
    this.mountainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, fog: false });
    for (let k = 0; k < 44; k++) {
      const a = (k / 44) * TAU + mrnd() * 0.1;
      const big = Math.sin(a) > -0.35; // la cordillera alta detrás del césped interior y a los lados
      const h = big ? 230 + mrnd() * 260 : 90 + mrnd() * 120;
      const rad = 200 + mrnd() * 220;
      const geo = new THREE.ConeGeometry(rad, h, 7 + ((mrnd() * 4) | 0), 4);
      const pos = geo.attributes.position, colors = [];
      for (let v = 0; v < pos.count; v++) {
        const y = pos.getY(v) / h + 0.5;
        pos.setX(v, pos.getX(v) * (0.85 + mrnd() * 0.3)); pos.setZ(v, pos.getZ(v) * (0.85 + mrnd() * 0.3));
        const snow = big && y > 0.6;
        colors.push(...(snow ? [0.95, 0.96, 0.98] : [0.55 + y * 0.1, 0.63 + y * 0.1, 0.72 + y * 0.08]));
      }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, this.mountainMat);
      const dist = 1350 + mrnd() * 350;
      m.position.set(CENTER.x + Math.cos(a) * dist, h / 2 - 20, CENTER.z - Math.sin(a) * dist);
      s.add(m);
    }
    // nubes
    this.cloudMat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.8, fog: false });
    const crnd = rng(777);
    const blob = new THREE.SphereGeometry(1, 12, 8);
    for (let k = 0; k < 26; k++) {
      const c = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const b = new THREE.Mesh(blob, this.cloudMat);
        b.position.set(j * 26, (j % 2) * 5, 0); b.scale.set(30, 9, 10); c.add(b);
      }
      const a = crnd() * TAU, dist = 1900 + crnd() * 300;
      c.position.set(CENTER.x + Math.cos(a) * dist, 260 + crnd() * 140, CENTER.z + Math.sin(a) * dist);
      c.rotation.y = -a + Math.PI / 2;
      s.add(c);
    }
    // estrellas
    const sp = [];
    const srnd = rng(99);
    for (let k = 0; k < 1500; k++) {
      const a = srnd() * TAU, e = Math.asin(0.08 + srnd() * 0.92);
      sp.push(Math.cos(a) * Math.cos(e) * 3000, Math.sin(e) * 3000, Math.sin(a) * Math.cos(e) * 3000);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: "#ffffff", size: 2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
    this.stars.position.set(CENTER.x, 0, CENTER.z);
    s.add(this.stars);
  }

  buildLamps() {
    // torres de iluminación por fuera de la pista
    const glowTex = canvasTex(64, 64, (c, w) => {
      const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      g.addColorStop(0, "rgba(255,250,235,1)"); g.addColorStop(0.25, "rgba(255,240,200,0.55)"); g.addColorStop(1, "rgba(255,240,200,0)");
      c.fillStyle = g; c.fillRect(0, 0, w, w);
    });
    const poleMat = new THREE.MeshStandardMaterial({ color: "#5d625f", roughness: 0.6 });
    this.lampMat = new THREE.MeshStandardMaterial({ color: "#222", emissive: "#fff4d6", emissiveIntensity: 0, roughness: 0.4 });
    this.glows = [];
    for (let sAt = 30; sAt < LOOP; sAt += 75) {
      if (sAt > STAND_S0 - 10 && sAt < STAND_S1 + 10) continue;
      const g = placeOnTrack(new THREE.Group(), sAt, RAIL_OUT + 7);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 22, 8), poleMat);
      pole.position.y = 11; pole.castShadow = true; g.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.4, 0.5), this.lampMat);
      head.position.set(0, 22.4, -0.4); head.rotation.x = -0.35; g.add(head);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      glow.position.set(0, 22.2, -0.9); glow.scale.set(16, 10, 1); g.add(glow);
      this.glows.push(glow);
      this.scene.add(g);
    }
  }

  buildPodium() {
    const g = placeOnTrack(new THREE.Group(), PODIUM_S, PODIUM_OFF);
    const ivory = new THREE.MeshStandardMaterial({ color: "#f1ead6", roughness: 0.7 });
    this.podiumSpots = [];
    const blocks = [[-4.4, 1.15, 2], [0, 1.7, 1], [4.4, 0.8, 3]];
    for (const [x, h, place] of blocks) {
      const tex = canvasTex(256, 128, (c, w, hh) => {
        c.fillStyle = "#0e2a1f"; c.fillRect(0, 0, w, hh);
        c.fillStyle = "#c9a54b"; c.font = "bold 92px Georgia, serif"; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(`${place}°`, w / 2, hh / 2 + 4);
      });
      const face = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(4.1, h, 2.4), [ivory, ivory, ivory, ivory, face, face]);
      b.position.set(x, h / 2, 0); b.castShadow = b.receiveShadow = true; g.add(b);
      this.podiumSpots[place - 1] = { x, h };
    }
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(18, 9), new THREE.MeshStandardMaterial({ color: "#7b1e2b", roughness: 0.9 }));
    carpet.rotation.x = -Math.PI / 2; carpet.position.y = 0.03; carpet.receiveShadow = true; g.add(carpet);
    this.podium = g;
    this.scene.add(g);
    g.updateMatrixWorld(true);
  }

  buildEffects() {
    const s = this.scene;
    this.clods = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1 }), MAX_PARTICLES);
    this.clods.count = 0; this.clods.frustumCulled = false;
    this.clods.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    s.add(this.clods);
    // lluvia
    const N = 2200;
    this.rainData = Array.from({ length: N }, () => ({ x: (Math.random() - 0.5) * 80, y: Math.random() * 24, z: (Math.random() - 0.5) * 70 }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: "#d2dce6", transparent: true, opacity: 0.45 }));
    this.rain.frustumCulled = false; this.rain.visible = false; s.add(this.rain);
    // papel picado del podio
    const C = 500;
    this.confetti = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.12, 0.08), new THREE.MeshStandardMaterial({ roughness: 0.6, side: THREE.DoubleSide }), C);
    this.confetti.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(C * 3), 3);
    const cols = ["#c9a54b", "#f5efe0", "#b0182a", "#1c7f37", "#1d4cb8", "#e0c274"].map((c) => new THREE.Color(c));
    this.confData = Array.from({ length: C }, (_, i) => {
      this.confetti.setColorAt(i, cols[i % cols.length]);
      return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 0, w: 0 };
    });
    this.confetti.count = 0; this.confetti.frustumCulled = false;
    s.add(this.confetti);
  }

  buildGate(n) {
    if (this.gate) { this.scene.remove(this.gate); this.gate.traverse((o) => o.geometry && o.geometry.dispose()); }
    const g = placeOnTrack(new THREE.Group(), 0, 0);
    const frame = new THREE.MeshStandardMaterial({ color: "#2f5d3a", roughness: 0.6 });
    const door = new THREE.MeshStandardMaterial({ color: "#3b7448", roughness: 0.5 });
    const pad = new THREE.MeshStandardMaterial({ color: "#d9d4c2", roughness: 0.8 });
    const xf = 0.25, xb = -3.0, top = 2.9;
    const zA = laneOffset(0) - LANE / 2, zB = laneOffset(n - 1) + LANE / 2;
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
    for (let k = 0; k <= n; k++) {
      const z = zA + k * LANE;
      add(new THREE.BoxGeometry(0.12, top, 0.12), frame, xf, top / 2, z);
      add(new THREE.BoxGeometry(0.12, top, 0.12), frame, xb, top / 2, z);
      add(new THREE.BoxGeometry(xf - xb, 0.14, 0.14), frame, (xf + xb) / 2, top, z);
      add(new THREE.BoxGeometry(xf - xb - 0.4, 0.22, 0.1), pad, (xf + xb) / 2, 1.35, z);
    }
    for (const x of [xf, xb]) add(new THREE.BoxGeometry(0.16, 0.3, zB - zA + 0.2), frame, x, top + 0.1, (zA + zB) / 2);
    const banner = canvasTex(512, 64, (c, w, h) => {
      c.fillStyle = "#2f5d3a"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#e9e0c9"; c.font = "bold 34px Georgia, serif"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("THE HORSE RACING", w / 2, h / 2 + 2);
    });
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(8, zB - zA), 0.5), new THREE.MeshStandardMaterial({ map: banner, roughness: 0.6 }));
    ban.position.set(xf + 0.09, top + 0.1, (zA + zB) / 2); ban.rotation.y = Math.PI / 2; g.add(ban);
    this.doors = [];
    const leafW = LANE / 2 - 0.08;
    for (let l = 0; l < n; l++) {
      const z = laneOffset(l);
      for (const side of [-1, 1]) {
        const hinge = new THREE.Group(); hinge.position.set(xf + 0.06, 0, z + side * (LANE / 2 - 0.04));
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, leafW), door);
        leaf.position.set(0, 1.15, -side * leafW / 2); leaf.castShadow = true; hinge.add(leaf);
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, leafW), pad);
        stripe.position.set(0, 1.75, -side * leafW / 2); hinge.add(stripe);
        hinge.userData.side = side;
        g.add(hinge); this.doors.push(hinge);
      }
    }
    this.gate = g;
    this.scene.add(g);
  }

  setEnvironment(hour, rain) {
    const H = HOURS[hour] || HOURS.day;
    this.hour = hour; this.isRain = rain;
    const key = `${hour}-${rain}`;
    if (!this.skies.has(key)) this.skies.set(key, gradient(rain ? H.rainSky : H.sky));
    this.scene.background = this.skies.get(key);
    const night = hour === "night";
    this.scene.fog = new THREE.Fog(rain ? H.rainFog : H.fog, rain ? 80 : night ? 120 : 160, rain ? 600 : night ? 1000 : 1600);
    this.hemi.color.set(H.hemi[0]); this.hemi.groundColor.set(H.hemi[1]);
    this.hemi.intensity = H.hemi[2] * (rain ? 0.75 : 1);
    this.sun.color.set(H.sun[0]);
    this.sun.intensity = H.sun[1] * (rain ? (night ? 0.75 : 0.35) : 1);
    this.sunDir = new V3(...H.dir).normalize();
    this.turfMat.color.set(rain ? "#7d8466" : "#ffffff");
    this.groundMat.color.set(rain ? "#7f8a6c" : "#ffffff");
    this.mountainMat.color.set(H.tint);
    if (rain) this.mountainMat.color.multiplyScalar(0.7);
    this.cloudMat.color.set(rain ? (night ? "#1a2030" : "#7d868d") : H.cloud);
    this.stars.visible = H.stars && !rain;
    this.lampMat.emissiveIntensity = H.lamps * 3;
    for (const g of this.glows) { g.visible = H.lamps > 0; g.material.opacity = H.lamps; }
    this.rain.visible = rain;
    this.renderer.toneMappingExposure = night ? 1.15 : 1.05;
  }

  buildMiniMap() {
    const pts = [];
    for (let s = 0; s <= LOOP; s += 8) pts.push(trackXZ(s, RAIL_OUT / 2));
    const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
    this.mm = { pts, x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
  }

  // ---- tamaño ------------------------------------------------------------------
  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.W = Math.max(320, r.width);
    this.H = Math.max(200, r.height);
    this.renderer.setSize(this.W, this.H, false);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.overlay.width = Math.round(this.W * dpr);
    this.overlay.height = Math.round(this.H * dpr);
    this.camera.aspect = this.W / this.H;
    this.camera.fov = this.camera.aspect < 1.2 ? 40 : FOV;
    this.camera.updateProjectionMatrix();
  }

  // ---- carrera -------------------------------------------------------------------
  reset(race) {
    this.race = race;
    for (const H of this.horses) { this.scene.remove(H.root); disposeHorse(H); }
    this.horses = race.horses.map((h) => {
      const H = buildHorse(h);
      this.scene.add(H.root);
      return H;
    });
    this.lanes = planLanes(race);
    this.buildGate(race.n);
    this.gateK = 0;
    this.setEnvironment(resolveHour(race), !!race.rain);
    this.particles = [];
    this.phases = race.horses.map((h) => h.phase0);
    this.lastPhase = this.phases.slice();
    const mid = (laneOffset(0) + laneOffset(race.n - 1)) / 2;
    this.cam = { s: 2, z: 1, off: mid, spread: (race.n - 1) * LANE };
    this.stopPodium();
    this.snap = true;
  }

  offsetOf(i, t) { return this.lanes.at(i, t); }

  baseDist() {
    const hv = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect;
    return Math.max(30 / hv, 16 + this.cam.spread * 0.9);
  }

  frameFor(ha, hb, t, zMax = 1.85) {
    const oa = this.offsetOf(ha.idx, t), ob = this.offsetOf(hb.idx, t);
    const sep = Math.abs(oa - ob);
    const need = Math.max(11, 9 + sep * 1.3);
    return { zt: Math.max(1, Math.min(zMax, this.baseDist() / need)), off: (oa + ob) / 2 };
  }

  fieldStats(t, list) {
    let lo = Infinity, hi = -Infinity;
    for (const h of list) { const o = this.offsetOf(h.idx, t); lo = Math.min(lo, o); hi = Math.max(hi, o); }
    return { mid: (lo + hi) / 2, spread: hi - lo };
  }

  // mode: "pre" | "race" | "photo" | "focus" | "headon" | "podium"
  updateCamera(t, dtReal, dtRace, mode, focus) {
    const race = this.race;
    const c = this.cam;
    if (mode === "photo") return;
    if (mode === "podium") { this.podiumCamera(dtReal); return; }

    const alive = race.horses.filter((h) => !(h.collapse && t > h.collapse.t));
    let target, zt = 1, v = 0, lead = null, winnerDone = false;
    const field = this.fieldStats(t, alive.length ? alive : race.horses);
    let off = field.mid;

    if (mode === "pre") {
      target = 3; zt = 1.15;
    } else if (mode === "focus" || mode === "headon") {
      const a = focus[0], b = focus[1] || focus[0];
      const xa = posAt(a, t), xb = posAt(b, t);
      target = (xa + xb) / 2 + (focus.length === 1 ? -0.8 : 0.4);
      v = (speedAt(a, t) + speedAt(b, t)) / 2;
      ({ zt, off } = this.frameFor(a, b, t, focus.length === 1 ? 1.7 : 1.9));
    } else {
      const sorted = alive.map((h) => ({ h, x: posAt(h, t) })).sort((a, b) => b.x - a.x);
      lead = sorted[0];
      const second = sorted[1] || sorted[0];
      winnerDone = t >= race.horses[race.order[0]].finishT;
      if (winnerDone) {
        target = DISTANCE + 3; zt = 1.15;
      } else {
        const close = smooth(95, 15, DISTANCE - lead.x);
        const top = sorted.slice(0, Math.min(4, sorted.length));
        let pack = top.reduce((a, s) => a + s.x, 0) / top.length;
        pack = Math.max(pack, lead.x - 11);
        const duel = (lead.x + second.x) / 2 + 0.4;
        target = pack + (duel - pack) * close;
        v = speedAt(lead.h, t);
        const f = this.frameFor(lead.h, second.h, t);
        zt = 1 + (f.zt - 1) * close;
        off = off + (f.off - off) * close;
      }
    }

    if (this.snap) {
      c.s = target; c.z = zt; c.off = off; c.spread = field.spread;
    } else {
      c.s += v * dtRace;
      c.s += (target - c.s) * lerpK(3.2, dtReal);
      c.z += (zt - c.z) * lerpK(2.4, dtReal);
      c.off += (off - c.off) * lerpK(2.4, dtReal);
      c.spread += (field.spread - c.spread) * lerpK(1.5, dtReal);
    }

    const view = mode === "pre" ? "gate" : mode === "headon" ? "headon" : mode === "race" && !winnerDone ? this.view : "tv";
    let want, look;
    if (view === "gate") {
      const span = (race.n - 1) * LANE;
      want = { s: 10 + span * 0.45, off: c.off + 9 + span * 0.75, y: 2.6 + span * 0.12 };
      look = { s: -1.0, off: c.off - span * 0.1, y: 1.2 };
    } else if (view === "headon") {
      want = { s: DISTANCE + 13, off: c.off + 1.2, y: 1.9 };
      look = { s: DISTANCE - 10, off: c.off, y: 1.3 };
    } else if (view === "close" && lead) {
      const lo = this.offsetOf(lead.h.idx, t);
      want = { s: lead.x + 4.2, off: lo + 6.2, y: 1.75 };
      look = { s: lead.x - 1.6, off: lo, y: 1.25 };
    } else if (view === "back") {
      want = { s: c.s - 16, off: c.off + 9, y: 7 };
      look = { s: c.s + 4, off: c.off, y: 0.9 };
    } else {
      const d = this.baseDist() / c.z;
      const y = 1.2 + d * 0.21;
      want = { s: c.s + 1.2, off: c.off + d, y };
      look = { s: c.s + 0.3, off: c.off, y: y - d * 0.15 };
    }
    if (this.snap || view === "tv" || view === "gate" || view === "headon") {
      Object.assign(this.cw, want); Object.assign(this.cl, look);
      this.snap = false;
    } else {
      const k = lerpK(3.5, dtReal);
      for (const [cur, tg] of [[this.cw, want], [this.cl, look]]) {
        cur.s += v * dtRace;
        cur.s += (tg.s - cur.s) * k; cur.off += (tg.off - cur.off) * k; cur.y += (tg.y - cur.y) * k;
      }
    }
    this.camera.clearViewOffset();
    this.camera.position.copy(world(this.cw.s, this.cw.off, this.cw.y));
    this.camLook = world(this.cl.s, this.cl.off, this.cl.y);
    this.camera.lookAt(this.camLook);
  }

  podiumCamera(dt) {
    this.podiumT += dt;
    const P = this.podium.position;
    // frente del podio: hacia la recta (+z local)
    const base = this.podium.rotation.y;
    const ang = base + 0.5 * Math.sin(this.podiumT * 0.22) + 0.15;
    const r = 22 - Math.min(3, this.podiumT * 0.6);
    // +z local del podio en el mundo es (sin θ, cos θ)
    this.camera.position.set(P.x + Math.sin(ang) * r, 5.4, P.z + Math.cos(ang) * r);
    this.camLook = new V3(P.x, 2.2, P.z);
    this.camera.lookAt(this.camLook);
    if (this.podiumShift > 0) this.camera.setViewOffset(this.W, this.H, this.W * this.podiumShift, 0, this.W, this.H);
    else this.camera.clearViewOffset();
  }

  startPodium() {
    this.podiumOn = true;
    this.podiumT = 0;
    const P = this.podium.position;
    this.confData.forEach((d) => {
      d.x = P.x + (Math.random() - 0.5) * 12; d.y = 8 + Math.random() * 10; d.z = P.z + (Math.random() - 0.5) * 8;
      d.vx = (Math.random() - 0.5) * 0.6; d.vy = -(0.8 + Math.random() * 0.9); d.vz = (Math.random() - 0.5) * 0.6;
      d.r = Math.random() * TAU; d.w = 2 + Math.random() * 6;
    });
    this.confetti.count = this.confData.length;
  }

  stopPodium() {
    this.podiumOn = false; this.podiumShift = 0; this.confetti.count = 0;
    this.camera.clearViewOffset();
    for (const H of this.horses) H.root.visible = true;
  }

  // ---- partículas --------------------------------------------------------------
  updateParticles(t, dt, rain) {
    const race = this.race;
    race.horses.forEach((h, i) => {
      const v = speedAt(h, t);
      this.phases[i] += (dt * v) / 6.8;
      const prev = this.lastPhase[i], cur = this.phases[i];
      if (v > 6 && Math.floor(prev * 2) !== Math.floor(cur * 2) && this.particles.length < MAX_PARTICLES - 8) {
        const sAt = posAt(h, t) - 2.4;
        const p = trackXZ(sAt, this.offsetOf(i, t));
        const f = railFrame(sAt);
        const k = rain ? 5 : 3;
        for (let j = 0; j < k; j++) {
          const fw = v * (0.05 + Math.random() * 0.25) * (Math.random() < 0.5 ? 1 : 0.4);
          const lat = (Math.random() - 0.5) * 1.2;
          this.particles.push({
            x: p.x + f.nx * (Math.random() - 0.5) * 0.4, z: p.z + f.nz * (Math.random() - 0.5) * 0.4, y: 0.05,
            vx: f.hx * fw + f.nx * lat, vz: f.hz * fw + f.nz * lat, vy: 1.2 + Math.random() * 2.6, life: 1,
            c: rain ? (Math.random() < 0.7 ? "#3b2a1a" : "#5a4128") : (Math.random() < 0.6 ? "#3f5a22" : "#5b4a2c"),
            s: 0.05 + Math.random() * 0.07, r: Math.random() * TAU,
          });
        }
      }
      this.lastPhase[i] = cur;
    });
    for (const p of this.particles) {
      p.vy -= 9.8 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.r += dt * 6;
      if (p.y < 0.02) { p.y = 0.02; p.vy = 0; p.vz *= 0.8; p.life -= dt * 2.5; p.vx *= 0.8; }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  // ---- dibujo ------------------------------------------------------------------
  draw(t, opts) {
    const race = this.race;
    const pre = opts.mode === "pre";
    const dtReal = opts.dtReal || 0.016;
    this.time += dtReal;
    const podium = this.podiumOn;
    const top = podium ? race.order.slice(0, Math.min(3, race.n)) : [];

    race.horses.forEach((h, i) => {
      const H = this.horses[i];
      if (podium) {
        const place = top.indexOf(i);
        H.root.visible = place >= 0;
        if (place < 0) return;
        const spot = this.podiumSpots[place];
        H.root.position.copy(new V3(spot.x - 0.2, spot.h, 0).applyMatrix4(this.podium.matrixWorld));
        H.root.rotation.y = this.podium.rotation.y;
        poseHorse(H, {
          phase: 0, run: 0, headDrop: 0.06 * Math.sin(this.time * 1.4 + place),
          celebrate: place === 0 ? smooth(0.3, 1.2, this.podiumT) : 0,
        });
        return;
      }
      const x = pre ? 0 : posAt(h, t);
      const v = pre ? 0 : speedAt(h, t);
      let run = Math.min(1, v / 9);
      let pitch = 0, headDrop = 0, slump = 0;
      if (h.stumbleT != null) {
        const b = Math.exp(-(((t - h.stumbleT) / 0.28) ** 2));
        pitch = 0.16 * b; headDrop = 0.35 * b;
      }
      if (h.collapse && t > h.collapse.t) {
        const k = smooth(0, 1.4, t - h.collapse.t);
        headDrop = 0.55 * k; slump = k; pitch = -0.04 * k;
      }
      if (pre) { run = 0; headDrop = 0.06 * Math.sin(this.time * 1.4 + h.lane); }
      const drive = pre || h.collapse ? 0 : smooth(DISTANCE - 230, DISTANCE - 90, x) * (1 - smooth(DISTANCE + 2, DISTANCE + 25, x));
      const sBody = x - NOSE;
      const off = pre ? laneOffset(h.lane) : this.offsetOf(i, t);
      const p = trackXZ(sBody, off);
      H.root.position.set(p.x, 0, p.z);
      const yaw = pre ? 0 : Math.atan2(this.lanes.drift(i, t), Math.max(4, v)) * 0.9;
      H.root.rotation.y = headingAngle(sBody) - yaw;
      poseHorse(H, { phase: this.phases[i] ?? 0, run, pitch, headDrop, slump, drive });
    });

    // partidor
    this.gateK = pre ? 0 : Math.min(1, this.gateK + dtReal * 4);
    const open = 1 - (1 - this.gateK) ** 3;
    for (const d of this.doors) d.rotation.y = d.userData.side * -1.65 * open;

    // terrones
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new V3(), P = new V3(), C = new THREE.Color(), E = new THREE.Euler();
    const n = podium ? 0 : Math.min(MAX_PARTICLES, this.particles.length);
    for (let i = 0; i < n; i++) {
      const p = this.particles[i];
      const s = p.s * Math.min(1, p.life * 1.5);
      Q.setFromEuler(E.set(p.r, p.r * 0.7, 0));
      this.clods.setMatrixAt(i, M.compose(P.set(p.x, p.y, p.z), Q, S.set(s, s, s)));
      this.clods.setColorAt(i, C.set(p.c));
    }
    this.clods.count = n;
    this.clods.instanceMatrix.needsUpdate = true;
    if (this.clods.instanceColor) this.clods.instanceColor.needsUpdate = true;

    // papel picado
    if (podium) {
      for (let i = 0; i < this.confData.length; i++) {
        const d = this.confData[i];
        d.y += d.vy * dtReal; d.x += (d.vx + Math.sin(this.time * d.w + i) * 0.4) * dtReal; d.z += d.vz * dtReal; d.r += d.w * dtReal;
        if (d.y < 0.05) { d.y = 0.05; d.vy = 0; d.vx = d.vz = 0; d.w = 0; }
        Q.setFromEuler(E.set(d.r, d.r * 0.6, d.r * 0.3));
        this.confetti.setMatrixAt(i, M.compose(P.set(d.x, d.y, d.z), Q, S.set(1, 1, 1)));
      }
      this.confetti.instanceMatrix.needsUpdate = true;
    }

    // lluvia alrededor de la cámara
    if (this.isRain) {
      this.rain.visible = !opts.photo;
      if (!opts.photo) {
        const pos = this.rain.geometry.attributes.position;
        const cx = this.camLook.x, cz = this.camLook.z;
        this.rainData.forEach((r, i) => {
          r.y -= 22 * dtReal; r.x -= 5 * dtReal;
          if (r.y < 0) { r.y = 22 + Math.random() * 2; r.x = (Math.random() - 0.5) * 80; }
          const X = cx + r.x, Z = cz + r.z;
          pos.setXYZ(i * 2, X, r.y, Z);
          pos.setXYZ(i * 2 + 1, X + 0.12, r.y + 0.55, Z);
        });
        pos.needsUpdate = true;
      }
    }

    this.updateCrowd(this.time);
    this.photoPlane.visible = !!opts.photo;
    this.canvas.style.filter = opts.photo ? "grayscale(1) contrast(1.35) brightness(1.05)" : "";

    const L = this.camLook;
    this.sun.position.set(L.x + this.sunDir.x * 70, this.sunDir.y * 70, L.z + this.sunDir.z * 70);
    this.sun.target.position.set(L.x, 0, L.z);

    this.renderer.render(this.scene, this.camera);
    this.drawOverlay(t, opts);
  }

  drawOverlay(t, opts) {
    const ctx = this.octx, { W, H } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.8);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.26)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    if (this.podiumOn) { this.drawPodiumLabels(); return; }
    if (this.labels && !opts.photo && !opts.noLabels) this.drawLabels(t, opts);
    if (opts.photo) {
      ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, W - 6, H - 6);
    }
    if (opts.mode !== "pre" && !opts.photo && !opts.hideMap) this.drawMiniMap(t);
  }

  project(p) {
    const v = p.clone().project(this.camera);
    if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) return null;
    return { x: (v.x + 1) / 2 * this.W, y: (1 - v.y) / 2 * this.H };
  }

  pill(sx, sy, h, text, scale = 1) {
    const ctx = this.octx;
    const fs = Math.round(12 * scale);
    ctx.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    const tw = ctx.measureText(text).width;
    const r = fs * 0.78, pad = fs * 0.5;
    const w = r * 2 + pad * 2 + tw, hgt = r * 2 + 4;
    const x0 = sx - w / 2, y0 = sy - hgt;
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(10,25,18,0.8)";
    ctx.beginPath(); ctx.roundRect(x0, y0, w, hgt, hgt / 2); ctx.fill();
    ctx.fillStyle = h.cloth[0];
    ctx.beginPath(); ctx.arc(x0 + 2 + r, y0 + hgt / 2, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = h.cloth[1]; ctx.textAlign = "center";
    ctx.font = `700 ${Math.round(fs * 0.95)}px Georgia, serif`;
    ctx.fillText(String(h.num), x0 + 2 + r, y0 + hgt / 2 + 1);
    ctx.fillStyle = "#f5efe0"; ctx.textAlign = "left";
    ctx.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.fillText(text, x0 + 2 + r * 2 + pad * 0.7, y0 + hgt / 2 + 1);
  }

  drawLabels(t, opts) {
    const race = this.race;
    const items = [];
    race.horses.forEach((h, i) => {
      if (h.collapse && t > h.collapse.t + 2) return;
      const x = opts.mode === "pre" ? 0 : posAt(h, t);
      const off = opts.mode === "pre" ? laneOffset(h.lane) : this.offsetOf(i, t);
      const s = this.project(world(x - NOSE + 0.35, off, 2.75));
      if (!s) return;
      items.push({ h, ...s, dist: this.camera.position.distanceTo(this.horses[i].root.position) });
    });
    items.sort((a, b) => b.dist - a.dist);
    for (const it of items) this.pill(it.x, it.y, it.h, it.h.name, Math.max(0.75, Math.min(1.15, 22 / it.dist)));
  }

  drawPodiumLabels() {
    const race = this.race;
    race.order.slice(0, Math.min(3, race.n)).forEach((idx, place) => {
      const spot = this.podiumSpots[place];
      const s = this.project(new V3(spot.x, spot.h + 3.1, 0).applyMatrix4(this.podium.matrixWorld));
      if (s) this.pill(s.x, s.y, race.horses[idx], `${place + 1}° ${race.horses[idx].name}`, place === 0 ? 1.35 : 1.1);
    });
  }

  drawMiniMap(t) {
    const ctx = this.octx, { W } = this;
    const race = this.race, mm = this.mm;
    const bw = Math.min(190, W * 0.24), bh = bw * ((mm.z1 - mm.z0) / (mm.x1 - mm.x0)) + 4;
    const x0 = W - bw - 16, y0 = 12;
    const sx = (x) => x0 + 8 + ((x - mm.x0) / (mm.x1 - mm.x0)) * (bw - 16);
    const sy = (z) => y0 + 8 + ((z - mm.z0) / (mm.z1 - mm.z0)) * (bh - 16);
    ctx.fillStyle = "rgba(10,25,18,0.68)";
    ctx.beginPath(); ctx.roundRect(x0, y0, bw, bh, 10); ctx.fill();
    ctx.strokeStyle = "rgba(240,232,210,0.5)"; ctx.lineWidth = 5; ctx.lineJoin = "round";
    ctx.beginPath(); mm.pts.forEach((p, i) => (i ? ctx.lineTo(sx(p.x), sy(p.z)) : ctx.moveTo(sx(p.x), sy(p.z)))); ctx.closePath(); ctx.stroke();
    const f = trackXZ(DISTANCE, -2), f2 = trackXZ(DISTANCE, RAIL_OUT + 2);
    ctx.strokeStyle = "#c9a54b"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sx(f.x), sy(f.z)); ctx.lineTo(sx(f2.x), sy(f2.z)); ctx.stroke();
    const sorted = race.horses.slice().sort((a, b) => posAt(a, t) - posAt(b, t));
    for (const h of sorted) {
      const p = trackXZ(Math.min(posAt(h, t), DISTANCE + 60), RAIL_OUT / 2);
      ctx.beginPath(); ctx.arc(sx(p.x), sy(p.z), 4.5, 0, TAU);
      ctx.fillStyle = h.cloth[0]; ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.lineWidth = 1; ctx.stroke();
    }
  }
}

/** Hora del día de la carrera; "random" se decide con la semilla para que un enlace compartido se vea igual. */
export function resolveHour(race) {
  const h = race.cfg?.hour ?? "day";
  if (h !== "random") return HOURS[h] ? h : "day";
  const r = mulberry32((race.seed ^ 0x6a09e667) >>> 0)();
  return ["day", "day", "dusk", "night"][Math.floor(r * 4)];
}
