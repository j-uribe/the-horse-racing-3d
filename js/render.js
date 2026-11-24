// Escena 3D de la carrera (Three.js). Misma interfaz que la escena 2D original:
// reset(race), updateCamera(...), updateParticles(...), draw(t, opts), resize().
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { buildHorse, poseHorse, disposeHorse, NOSE } from "./horse3d.js";
import { DISTANCE, posAt, speedAt } from "./race.js";

const TAU = Math.PI * 2;
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerpK = (k, dt) => 1 - Math.exp(-k * dt);
const V3 = THREE.Vector3;

// Pista: el carril 0 va junto a la baranda interior (lejos de la cámara).
const LANE = 1.5, LANES = 12;
const laneZ = (lane) => -16.5 + lane * LANE;
const RAIL_FAR = laneZ(0) - 1.3, RAIL_NEAR = laneZ(LANES - 1) + 1.3;
const TRACK_W = RAIL_NEAR - RAIL_FAR;
const TRACK_MID = (RAIL_NEAR + RAIL_FAR) / 2;
const X0 = -70, X1 = DISTANCE + 140, LEN = X1 - X0, XMID = (X0 + X1) / 2;
const FOV = 28;
const MAX_PARTICLES = 700;

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

function skyTexture(rain) {
  return canvasTex(4, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    if (rain) { gr.addColorStop(0, "#47515b"); gr.addColorStop(0.6, "#8a949a"); gr.addColorStop(1, "#a3aaa9"); }
    else { gr.addColorStop(0, "#5f8fc4"); gr.addColorStop(0.55, "#b9d1e3"); gr.addColorStop(1, "#e9e2cf"); }
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.view = "tv";
    this.labels = true;
    this.cam = { x: 2, z: 1, zc: TRACK_MID };
    this.particles = [];
    this.phases = [];
    this.lastPhase = [];
    this.horses = [];
    this.snap = false;
    this.gateK = 0;

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;

    // capa 2D para nombres, minimapa y marco de fotografía
    this.overlay = document.createElement("canvas");
    this.overlay.className = "overlay";
    this.overlay.setAttribute("aria-hidden", "true");
    canvas.after(this.overlay);
    this.octx = this.overlay.getContext("2d");

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 2600);
    this.camPos = new V3(0, 8, 25);
    this.camLook = new V3(0, 1, TRACK_MID);
    this.skies = { dry: skyTexture(false), rain: skyTexture(true) };

    this.buildLights();
    this.buildGround();
    this.buildRails();
    this.buildMarkers();
    this.buildStand();
    this.buildScenery();
    this.buildEffects();
    this.setWeather(false);
    this.resize();
  }

  // ---- construcción del mundo -------------------------------------------------
  buildLights() {
    const s = this.scene;
    this.hemi = new THREE.HemisphereLight("#dfe9f2", "#4c5b2c", 1.15);
    this.sun = new THREE.DirectionalLight("#fff1d8", 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    s.add(this.hemi, this.sun, this.sun.target);
  }

  buildGround() {
    const s = this.scene;
    // pasto de la pista, con franjas de corte de 7 m como en la transmisión original
    const turf = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = "#64923f"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#72a249"; g.fillRect(0, 0, w / 2, h);
      for (let i = 0; i < 3000; i++) {
        g.fillStyle = `rgba(${30 + Math.random() * 40},${70 + Math.random() * 60},${15 + Math.random() * 25},.22)`;
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    }, [LEN / 14, 2]);
    this.turfMat = new THREE.MeshStandardMaterial({ map: turf, roughness: 0.95 });
    const track = new THREE.Mesh(new THREE.PlaneGeometry(LEN, TRACK_W), this.turfMat);
    track.rotation.x = -Math.PI / 2; track.position.set(XMID, 0.01, TRACK_MID);
    track.receiveShadow = true; s.add(track);

    const rough = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = "#4b7130"; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 4000; i++) {
        g.fillStyle = `rgba(${20 + Math.random() * 50},${50 + Math.random() * 60},${10 + Math.random() * 20},.3)`;
        g.fillRect(Math.random() * w, Math.random() * h, 3, 3);
      }
    }, [120, 80]);
    this.groundMat = new THREE.MeshStandardMaterial({ map: rough, roughness: 1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 2400), this.groundMat);
    ground.rotation.x = -Math.PI / 2; ground.position.set(XMID, 0, -500);
    ground.receiveShadow = true; s.add(ground);

    // desgaste junto a la baranda interior
    const wear = new THREE.Mesh(new THREE.PlaneGeometry(LEN, 1.6),
      new THREE.MeshStandardMaterial({ color: "#8a7a4c", roughness: 1, transparent: true, opacity: 0.22 }));
    wear.rotation.x = -Math.PI / 2; wear.position.set(XMID, 0.015, RAIL_FAR + 1.0); wear.receiveShadow = true; s.add(wear);
  }

  buildRails() {
    const s = this.scene;
    const white = new THREE.MeshStandardMaterial({ color: "#f4f2ec", roughness: 0.5 });
    const gap = 2.5, per = Math.ceil(LEN / gap);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1.0, 0.08), white, per * 2);
    const m = new THREE.Matrix4();
    for (let i = 0; i < per; i++) {
      const x = X0 + i * gap;
      posts.setMatrixAt(i, m.makeTranslation(x, 0.5, RAIL_FAR));
      posts.setMatrixAt(per + i, m.makeTranslation(x, 0.5, RAIL_NEAR));
    }
    posts.castShadow = true; s.add(posts);
    for (const z of [RAIL_FAR, RAIL_NEAR]) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, LEN, 8), white);
      bar.rotation.z = Math.PI / 2; bar.position.set(XMID, 1.02, z); bar.castShadow = true; s.add(bar);
    }
    // seto del césped interior
    const hedge = new THREE.Mesh(new THREE.BoxGeometry(LEN, 1.0, 1.1), new THREE.MeshStandardMaterial({ color: "#37552f", roughness: 1 }));
    hedge.position.set(XMID, 0.5, RAIL_FAR - 2.2); hedge.castShadow = hedge.receiveShadow = true; s.add(hedge);
  }

  buildMarkers() {
    const s = this.scene;
    const white = new THREE.MeshStandardMaterial({ color: "#f4f2ec", roughness: 0.5 });
    // postes de distancia: metros que faltan
    for (let x = 100; x < DISTANCE; x += 100) {
      const rem = DISTANCE - x;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), white);
      pole.position.set(x, 1.3, RAIL_FAR - 0.5); pole.castShadow = true; s.add(pole);
      const tex = canvasTex(256, 196, (g, w, h) => {
        g.fillStyle = rem <= 200 ? "#b3201f" : "#1d3a6b"; g.fillRect(0, 0, w, h);
        g.strokeStyle = "#f4f2ec"; g.lineWidth = 10; g.strokeRect(6, 6, w - 12, h - 12);
        g.fillStyle = "#fff"; g.font = "bold 110px Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(String(rem), w / 2, h / 2 + 6);
      });
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.72, 0.06),
        [white, white, white, white, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), white]);
      sign.position.set(x, 2.95, RAIL_FAR - 0.5); sign.castShadow = true; s.add(sign);
    }
    // línea y disco de meta
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.24, TRACK_W), new THREE.MeshStandardMaterial({ color: "#fafaf5", roughness: 0.8 }));
    line.rotation.x = -Math.PI / 2; line.position.set(DISTANCE, 0.02, TRACK_MID); line.receiveShadow = true; s.add(line);
    const discTex = canvasTex(256, 256, (g, w) => {
      g.fillStyle = "#b3201f"; g.beginPath(); g.arc(w / 2, w / 2, w / 2 - 2, 0, TAU); g.fill();
      g.fillStyle = "#f4f2ea"; g.beginPath(); g.arc(w / 2, w / 2, w * 0.3, 0, TAU); g.fill();
      g.fillStyle = "#b3201f"; g.font = "bold 46px Georgia, serif"; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("META", w / 2, w / 2 + 2);
    });
    const discMat = new THREE.MeshStandardMaterial({ map: discTex, roughness: 0.5, transparent: true, side: THREE.DoubleSide });
    for (const [z, hgt] of [[RAIL_FAR - 0.5, 4.2]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, hgt, 10), white);
      pole.position.set(DISTANCE, hgt / 2, z); pole.castShadow = true; s.add(pole);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.6, 40), discMat);
      disc.position.set(DISTANCE, hgt + 0.55, z); disc.castShadow = true; s.add(disc);
    }
    // plano de la fotografía
    this.photoPlane = new THREE.Mesh(new THREE.PlaneGeometry(TRACK_W, 3.4),
      new THREE.MeshBasicMaterial({ color: "#e01e1e", transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
    this.photoPlane.rotation.y = Math.PI / 2; this.photoPlane.position.set(DISTANCE, 1.7, TRACK_MID);
    this.photoPlane.visible = false; s.add(this.photoPlane);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(TRACK_W, 3.4)), new THREE.LineBasicMaterial({ color: "#ff2b2b" }));
    this.photoPlane.add(edges);
  }

  buildStand() {
    // tribuna al otro lado del césped, frente a la meta
    const s = this.scene;
    const g = new THREE.Group();
    const x0 = DISTANCE - 230, x1 = DISTANCE + 70, len = x1 - x0, xm = (x0 + x1) / 2, z0 = RAIL_FAR - 24;
    const concrete = new THREE.MeshStandardMaterial({ color: "#e7e1d2", roughness: 0.9 });
    const crowdTex = canvasTex(512, 64, (c, w, h) => {
      c.fillStyle = "#6b6256"; c.fillRect(0, 0, w, h);
      const cols = ["#b0182a", "#f2efe6", "#1d4cb8", "#e8b923", "#2a2a2a", "#e35d12", "#3f6b3a", "#d9468f", "#8d877f"];
      for (let i = 0; i < 2600; i++) { c.fillStyle = cols[(Math.random() * cols.length) | 0]; c.fillRect(Math.random() * w, Math.random() * h, 3, 4); }
    }, [len / 12, 1]);
    const crowd = new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 1 });
    for (let k = 0; k < 9; k++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, 1.4), [concrete, concrete, crowd, concrete, crowd, concrete]);
      step.position.set(xm, 0.45 + k * 0.9, z0 - k * 1.4);
      step.scale.y = 1; step.castShadow = step.receiveShadow = true; g.add(step);
      const base = new THREE.Mesh(new THREE.BoxGeometry(len, 0.45 + k * 0.9, 1.4), concrete);
      base.position.set(xm, (0.45 + k * 0.9) / 2, z0 - k * 1.4); g.add(base);
    }
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, 12, 0.6), concrete);
    back.position.set(xm, 6, z0 - 13.2); back.castShadow = true; g.add(back);
    const roofMat = new THREE.MeshStandardMaterial({ color: "#1f4a34", roughness: 0.7 });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 4, 0.35, 17), roofMat);
    roof.position.set(xm, 12.6, z0 - 5.5); roof.rotation.x = -0.06; roof.castShadow = true; g.add(roof);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(len + 4, 0.7, 0.2), new THREE.MeshStandardMaterial({ color: "#c9a54b", roughness: 0.5 }));
    trim.position.set(xm, 12.1, z0 + 3.0); g.add(trim);
    for (let x = x0; x <= x1; x += 25) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 12.4, 10), concrete);
      col.position.set(x, 6.2, z0 + 2.2); col.castShadow = true; g.add(col);
    }
    s.add(g);
  }

  buildScenery() {
    const s = this.scene;
    // árboles
    const rnd = rng(11);
    const N = 420;
    const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: "#2f5a2a", roughness: 1, flatShading: true }), N);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.25, 1, 6), new THREE.MeshStandardMaterial({ color: "#4a3626", roughness: 1 }), N);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new V3(), P = new V3();
    const standX0 = DISTANCE - 240, standX1 = DISTANCE + 80;
    let i = 0;
    while (i < N) {
      const x = X0 - 150 + rnd() * (LEN + 300), z = RAIL_FAR - 34 - rnd() * 160;
      if (x > standX0 && x < standX1 && z > RAIL_FAR - 55) continue;
      const sz = 1.5 + rnd() * 1.6;
      P.set(x, sz * 0.6, z); S.set(0.7, sz * 0.6, 0.7); trunks.setMatrixAt(i, M.compose(P, Q, S));
      P.set(x, sz * 1.4, z); S.set(sz * (0.8 + rnd() * 0.3), sz * (0.95 + rnd() * 0.35), sz * (0.8 + rnd() * 0.3));
      crowns.setMatrixAt(i, M.compose(P, Q, S));
      i++;
    }
    crowns.castShadow = true;
    s.add(crowns, trunks);
    // cordillera con nieve, lejos y sin niebla
    const mrnd = rng(48271);
    const mountainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, fog: false });
    for (let k = 0; k < 26; k++) {
      const h = 160 + mrnd() * 240, rad = 180 + mrnd() * 220;
      const geo = new THREE.ConeGeometry(rad, h, 7 + ((mrnd() * 4) | 0), 4);
      const pos = geo.attributes.position, colors = [];
      for (let v = 0; v < pos.count; v++) {
        const y = pos.getY(v) / h + 0.5;
        pos.setX(v, pos.getX(v) * (0.85 + mrnd() * 0.3)); pos.setZ(v, pos.getZ(v) * (0.85 + mrnd() * 0.3));
        const snow = y > 0.62 ? 1 : 0;
        colors.push(...(snow ? [0.95, 0.96, 0.98] : [0.55 + y * 0.1, 0.63 + y * 0.1, 0.72 + y * 0.08]));
      }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, mountainMat);
      m.position.set(-700 + k * 110 + mrnd() * 60, h / 2 - 20, -900 - mrnd() * 300);
      s.add(m);
    }
    // nubes
    const cloudMat = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.8, fog: false });
    this.cloudMat = cloudMat;
    const crnd = rng(777);
    for (let k = 0; k < 18; k++) {
      const c = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const b = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), cloudMat);
        b.position.set(j * 26, (j % 2) * 5, 0); b.scale.set(30, 9, 10); c.add(b);
      }
      c.position.set(-600 + k * 140 + crnd() * 80, 230 + crnd() * 120, -1300 - crnd() * 300);
      s.add(c);
    }
  }

  buildEffects() {
    const s = this.scene;
    // terrones de pasto
    this.clods = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1 }), MAX_PARTICLES);
    this.clods.count = 0; this.clods.frustumCulled = false;
    this.clods.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
    s.add(this.clods);
    // lluvia
    const N = 2200;
    this.rainData = Array.from({ length: N }, () => ({ x: (Math.random() - 0.5) * 80, y: Math.random() * 24, z: -32 + Math.random() * 50 }));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: "#d2dce6", transparent: true, opacity: 0.45 }));
    this.rain.frustumCulled = false; this.rain.visible = false; s.add(this.rain);
  }

  buildGate(n) {
    if (this.gate) { this.scene.remove(this.gate); this.gate.traverse((o) => o.geometry && o.geometry.dispose()); }
    const g = new THREE.Group();
    const frame = new THREE.MeshStandardMaterial({ color: "#2f5d3a", roughness: 0.6 });
    const door = new THREE.MeshStandardMaterial({ color: "#3b7448", roughness: 0.5 });
    const pad = new THREE.MeshStandardMaterial({ color: "#d9d4c2", roughness: 0.8 });
    const xf = 0.25, xb = -3.0, top = 2.9;
    const zA = laneZ(0) - LANE / 2, zB = laneZ(n - 1) + LANE / 2;
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
    ban.position.set(xb - 0.09, top + 0.1, (zA + zB) / 2); ban.rotation.y = -Math.PI / 2; g.add(ban);
    // puertas: dos hojas por carril
    this.doors = [];
    const leafW = LANE / 2 - 0.08;
    for (let l = 0; l < n; l++) {
      const z = laneZ(l);
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

  setWeather(rain) {
    this.isRain = rain;
    this.scene.background = rain ? this.skies.rain : this.skies.dry;
    this.scene.fog = new THREE.Fog(rain ? "#9aa3a8" : "#e2e0d2", rain ? 70 : 140, rain ? 520 : 1300);
    this.hemi.intensity = rain ? 0.85 : 1.15;
    this.sun.intensity = rain ? 0.7 : 2.6;
    this.sun.color.set(rain ? "#dfe6ee" : "#fff1d8");
    this.turfMat.color.set(rain ? "#7d8466" : "#ffffff");
    this.groundMat.color.set(rain ? "#7f8a6c" : "#ffffff");
    this.cloudMat.color.set(rain ? "#7d868d" : "#ffffff");
    this.rain.visible = rain;
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
      H.root.position.set(-NOSE, 0, laneZ(h.lane));
      this.scene.add(H.root);
      return H;
    });
    this.buildGate(race.n);
    this.gateK = 0;
    this.setWeather(!!race.rain);
    this.particles = [];
    this.phases = race.horses.map((h) => h.phase0);
    this.lastPhase = this.phases.slice();
    this.cam = { x: 2, z: 1, zc: this.fieldMid() };
    this.snap = true;
  }

  fieldMid() { return (laneZ(0) + laneZ(this.race.n - 1)) / 2; }

  // distancia de cámara que muestra ~24 m de pista a lo ancho
  baseDist() {
    const hv = 2 * Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect;
    const depth = (this.race.n - 1) * LANE;
    return Math.max(30 / hv, 16 + depth * 0.9);
  }

  frameFor(ha, hb, zMax = 1.85) {
    const za = laneZ(ha.lane), zb = laneZ(hb.lane);
    const sep = Math.abs(za - zb);
    const need = Math.max(11, 9 + sep * 1.3);
    return { zt: Math.max(1, Math.min(zMax, this.baseDist() / need)), zc: (za + zb) / 2 };
  }

  // mode: "pre" | "race" | "photo" (cámara quieta) | "focus" (sigue a focus = [caballo, caballo?])
  updateCamera(t, dtReal, dtRace, mode, focus) {
    const race = this.race;
    const c = this.cam;
    if (mode === "photo") return;
    let target, zt = 1, zc = this.fieldMid(), v = 0;
    let lead = null, winnerDone = false;

    if (mode === "pre") {
      target = 3; zt = 1.15;
    } else if (mode === "focus") {
      const a = focus[0], b = focus[1] || focus[0];
      const xa = posAt(a, t), xb = posAt(b, t);
      target = (xa + xb) / 2 + (focus.length === 1 ? -0.8 : 0.4);
      v = (speedAt(a, t) + speedAt(b, t)) / 2;
      ({ zt, zc } = this.frameFor(a, b, focus.length === 1 ? 1.7 : 1.9));
    } else {
      const alive = race.horses.filter((h) => !(h.collapse && t > h.collapse.t));
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
        pack = Math.max(pack, lead.x - 9);
        const duel = (lead.x + second.x) / 2 + 0.4;
        target = pack + (duel - pack) * close;
        v = speedAt(lead.h, t);
        const f = this.frameFor(lead.h, second.h);
        zt = 1 + (f.zt - 1) * close;
        zc = zc + (f.zc - zc) * close;
      }
    }

    if (this.snap) {
      c.x = target; c.z = zt; c.zc = zc;
    } else {
      c.x += v * dtRace;
      c.x += (target - c.x) * lerpK(3.2, dtReal);
      c.z += (zt - c.z) * lerpK(2.4, dtReal);
      c.zc += (zc - c.zc) * lerpK(2.4, dtReal);
    }

    // encuadre según la vista elegida (solo durante la carrera)
    const view = mode === "pre" ? "gate" : mode === "race" && !winnerDone ? this.view : "tv";
    const want = new V3(), look = new V3();
    if (view === "gate") {
      // tres cuartos de frente al partidor: se ven las cabezas asomando
      const span = (race.n - 1) * LANE;
      want.set(10 + span * 0.45, 2.6 + span * 0.12, c.zc + 9 + span * 0.75);
      look.set(-1.0, 1.2, c.zc - span * 0.1);
    } else if (view === "close" && lead) {
      const lz = laneZ(lead.h.lane);
      want.set(lead.x + 4.2, 1.75, lz + 6.2);
      look.set(lead.x - 1.6, 1.25, lz);
    } else if (view === "back") {
      want.set(c.x - 15, 6.5, c.zc + 8);
      look.set(c.x + 3, 0.9, c.zc);
    } else {
      // ángulo bajo de transmisión: se ve la cordillera arriba y los carriles abajo
      const d = this.baseDist() / c.z;
      const y = 1.2 + d * 0.21;
      want.set(c.x + 1.2, y, c.zc + d);
      look.set(c.x + 0.3, y - d * 0.15, c.zc);
    }
    if (this.snap || view === "tv" || view === "gate") {
      this.camPos.copy(want); this.camLook.copy(look);
      this.snap = false;
    } else {
      const k = lerpK(3.5, dtReal);
      this.camPos.x += v * dtRace; this.camLook.x += v * dtRace;
      this.camPos.lerp(want, k); this.camLook.lerp(look, k);
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  // ---- partículas --------------------------------------------------------------
  updateParticles(t, dt, rain) {
    const race = this.race;
    race.horses.forEach((h, i) => {
      const v = speedAt(h, t);
      this.phases[i] += (dt * v) / 6.8;
      const prev = this.lastPhase[i], cur = this.phases[i];
      if (v > 6 && Math.floor(prev * 2) !== Math.floor(cur * 2) && this.particles.length < MAX_PARTICLES - 8) {
        const x = posAt(h, t) - 2.4, z = laneZ(h.lane);
        const k = rain ? 5 : 3;
        for (let j = 0; j < k; j++) {
          this.particles.push({
            x, z: z + (Math.random() - 0.5) * 0.4, y: 0.05,
            vx: v * (0.05 + Math.random() * 0.25) * (Math.random() < 0.5 ? 1 : 0.4),
            vy: 1.2 + Math.random() * 2.6, vz: (Math.random() - 0.5) * 1.2, life: 1,
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

    // caballos
    race.horses.forEach((h, i) => {
      const H = this.horses[i];
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
      if (pre) { run = 0; headDrop = 0.06 * Math.sin(performance.now() / 700 + h.lane); }
      const drive = pre || h.collapse ? 0 : smooth(DISTANCE - 230, DISTANCE - 90, x) * (1 - smooth(DISTANCE + 2, DISTANCE + 25, x));
      H.root.position.x = x - NOSE;
      poseHorse(H, { phase: this.phases[i] ?? 0, run, pitch, headDrop, slump, drive });
    });

    // partidor
    this.gateK = pre ? 0 : Math.min(1, this.gateK + (opts.dtReal || 0.016) * 4);
    const open = 1 - (1 - this.gateK) ** 3;
    for (const d of this.doors) d.rotation.y = d.userData.side * -1.65 * open;

    // terrones
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new V3(), P = new V3(), C = new THREE.Color(), E = new THREE.Euler();
    const n = Math.min(MAX_PARTICLES, this.particles.length);
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

    // lluvia alrededor de la cámara
    if (this.isRain) {
      this.rain.visible = !opts.photo;
      if (!opts.photo) {
        const dt = opts.dtReal || 0.016;
        const pos = this.rain.geometry.attributes.position;
        const cx = this.camLook.x, cz = this.camLook.z;
        this.rainData.forEach((r, i) => {
          r.y -= 22 * dt; r.x -= 5 * dt;
          if (r.y < 0) { r.y = 22 + Math.random() * 2; r.x = (Math.random() - 0.5) * 80; }
          const X = cx + r.x, Z = cz + r.z;
          pos.setXYZ(i * 2, X, r.y, Z);
          pos.setXYZ(i * 2 + 1, X + 0.12, r.y + 0.55, Z);
        });
        pos.needsUpdate = true;
      }
    }

    // fotografía
    this.photoPlane.visible = !!opts.photo;
    this.canvas.style.filter = opts.photo ? "grayscale(1) contrast(1.35) brightness(1.05)" : "";

    // sol y sombras siguen a la cámara
    this.sun.position.set(this.camLook.x + 18, 34, this.camLook.z + 22);
    this.sun.target.position.set(this.camLook.x, 0, this.camLook.z);

    this.renderer.render(this.scene, this.camera);
    this.drawOverlay(t, opts);
  }

  drawOverlay(t, opts) {
    const ctx = this.octx, { W, H } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // viñeta
    const g = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.8);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.26)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    if (this.labels && !opts.photo) this.drawLabels(t, opts);
    if (opts.photo) {
      ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, W - 6, H - 6);
    }
    if (opts.mode !== "pre" && !opts.photo && !opts.hideMap) this.drawMiniMap(t);
  }

  drawLabels(t, opts) {
    const ctx = this.octx, race = this.race;
    const v = new V3();
    const items = [];
    race.horses.forEach((h, i) => {
      if (h.collapse && t > h.collapse.t + 2) return;
      const x = opts.mode === "pre" ? 0 : posAt(h, t);
      v.set(x - NOSE + 0.35, 2.75, laneZ(h.lane)).project(this.camera);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) return;
      const dist = this.camera.position.distanceTo(this.horses[i].root.position);
      items.push({ h, sx: (v.x + 1) / 2 * this.W, sy: (1 - v.y) / 2 * this.H, dist });
    });
    items.sort((a, b) => b.dist - a.dist);
    ctx.textBaseline = "middle";
    for (const it of items) {
      const scale = Math.max(0.75, Math.min(1.15, 22 / it.dist));
      const fs = Math.round(12 * scale);
      ctx.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      const name = it.h.name;
      const tw = ctx.measureText(name).width;
      const r = fs * 0.78, pad = fs * 0.5;
      const w = r * 2 + pad * 2 + tw, hgt = r * 2 + 4;
      const x0 = it.sx - w / 2, y0 = it.sy - hgt;
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = "rgba(10,25,18,0.78)";
      ctx.beginPath(); ctx.roundRect(x0, y0, w, hgt, hgt / 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = it.h.cloth[0];
      ctx.beginPath(); ctx.arc(x0 + 2 + r, y0 + hgt / 2, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = it.h.cloth[1]; ctx.textAlign = "center";
      ctx.font = `700 ${Math.round(fs * 0.95)}px Georgia, serif`;
      ctx.fillText(String(it.h.num), x0 + 2 + r, y0 + hgt / 2 + 1);
      ctx.fillStyle = "#f5efe0"; ctx.textAlign = "left";
      ctx.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
      ctx.fillText(name, x0 + 2 + r * 2 + pad * 0.7, y0 + hgt / 2 + 1);
    }
  }

  drawMiniMap(t) {
    const ctx = this.octx, { W } = this;
    const race = this.race;
    const narrow = W < 560;
    const x0 = narrow ? Math.max(150, W * 0.38) : W * 0.3, x1 = W * 0.96, y = 22;
    ctx.fillStyle = "rgba(10,25,18,0.65)";
    ctx.beginPath(); ctx.roundRect(x0 - 12, y - 12, x1 - x0 + 24, 24, 12); ctx.fill();
    ctx.strokeStyle = "rgba(240,232,210,0.45)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    ctx.fillStyle = "#c9a54b"; ctx.fillRect(x1 - 1, y - 8, 3, 16);
    const sorted = race.horses.slice().sort((a, b) => posAt(a, t) - posAt(b, t));
    for (const h of sorted) {
      const f = Math.min(1, posAt(h, t) / DISTANCE);
      const X = x0 + (x1 - x0) * f;
      ctx.beginPath(); ctx.arc(X, y, 6, 0, TAU);
      ctx.fillStyle = h.cloth[0]; ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1; ctx.stroke();
    }
  }
}
