// Caballo y jinete en 3D, armados con primitivas (sin modelos externos).
// Coordenadas locales en metros: x hacia adelante, y hacia arriba, suelo en y = 0.
// La nariz queda en x ≈ NOSE.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
export const NOSE = 1.9;
const L1 = 0.6, L2 = 0.66;

const SPHERE = new THREE.SphereGeometry(1, 28, 18);
const capsuleCache = new Map();
const capsuleGeo = (r, len) => {
  const key = `${r}|${len.toFixed(3)}`;
  if (!capsuleCache.has(key)) capsuleCache.set(key, new THREE.CapsuleGeometry(r, len, 6, 14));
  return capsuleCache.get(key);
};
const SHARED_GEOS = new Set([SPHERE]);
const shared = (g) => (SHARED_GEOS.add(g), g);
const EAR = shared(new THREE.ConeGeometry(0.035, 0.14, 8));
const MANE = shared(new THREE.BoxGeometry(0.1, 0.13, 0.05));
const HOOF_GEO = shared(new THREE.CylinderGeometry(0.05, 0.065, 0.075, 12));
const TAIL = shared(new THREE.ConeGeometry(0.12, 0.7, 10));
const HELMET = shared(new THREE.SphereGeometry(0.098, 18, 10, 0, TAU, 0, Math.PI / 2));
const PEAK = shared(new THREE.BoxGeometry(0.09, 0.012, 0.11));
const CLOTH_L = shared(new THREE.SphereGeometry(1, 16, 12, Math.PI / 2 - 0.36, 0.72, 0.55, 0.95));
const CLOTH_R = shared(new THREE.SphereGeometry(1, 16, 12, Math.PI * 1.5 - 0.36, 0.72, 0.55, 0.95));
const WHIP = shared(new THREE.CylinderGeometry(0.008, 0.012, 0.55, 5));

const std = (color, roughness = 0.55, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
const SKIN = std("#e2b996", 0.7), BLACK = std("#141110", 0.45), PANTS = std("#ece8de", 0.8);
const TACK = std("#1c1410", 0.5), HOOF = std("#141110", 0.6), GLOVE = std("#f2f2ee", 0.7);
const SHARED_MATS = new Set([SKIN, BLACK, PANTS, TACK, HOOF, GLOVE]);

function canvasTex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function clothTexture(cloth, num) {
  return canvasTex(256, 200, (g, w, h) => {
    g.fillStyle = cloth[0]; g.fillRect(0, 0, w, h);
    g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = cloth[1];
    g.font = "bold 120px Georgia, 'Times New Roman', serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(num), w / 2, h / 2 + 8);
  });
}

function jacketTexture(silks) {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = silks.jacket; g.fillRect(0, 0, w, h);
    g.fillStyle = silks.sleeves;
    switch (silks.pattern) {
      case "hoops": for (let y = 8; y < h; y += 26) g.fillRect(0, y, w, 11); break;
      case "band": g.fillRect(0, h * 0.42, w, h * 0.16); break;
      case "halves": g.fillRect(0, 0, w / 2, h); break;
      case "sash":
        g.save(); g.translate(w / 2, h / 2); g.rotate(0.7); g.fillRect(-w, -9, w * 2, 18); g.restore(); break;
      case "stars":
        for (let i = 0; i < 18; i++) { g.beginPath(); g.arc((i * 37) % w, (i * 23 + (i % 3) * 9) % h, 6, 0, TAU); g.fill(); }
        break;
    }
  });
}

function mesh(parent, geo, mat) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m); return m;
}
function blob(parent, pos, scale, mat) {
  const m = mesh(parent, SPHERE, mat);
  m.position.set(pos[0], pos[1], pos[2] || 0); m.scale.set(scale[0], scale[1], scale[2]);
  return m;
}
function capsule(parent, a, b, r, mat, squash) {
  const va = new THREE.Vector3(a[0], a[1], a[2] || 0), vb = new THREE.Vector3(b[0], b[1], b[2] || 0);
  const d = vb.clone().sub(va);
  const m = mesh(parent, capsuleGeo(r, Math.max(0.001, d.length())), mat);
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  if (squash) m.scale.set(1, 1, squash);
  return m;
}
function group(parent, pos) {
  const g = new THREE.Group(); g.position.set(pos[0], pos[1], pos[2] || 0); parent.add(g); return g;
}

function makeLeg(parent, hip, front, coatM, legM) {
  const g = group(parent, hip);
  if (front) {
    blob(g, [0.02, -0.12, 0], [0.15, 0.3, 0.12], coatM);
    capsule(g, [0, 0, 0], [0, -L1, 0], 0.075, coatM);
  } else {
    blob(g, [-0.02, -0.14, 0], [0.19, 0.34, 0.14], coatM);
    capsule(g, [0, 0, 0], [0, -L1, 0], 0.08, coatM);
  }
  const knee = group(g, [0, -L1, 0]);
  blob(knee, [0, 0, 0], [0.075, 0.08, 0.068], legM);
  capsule(knee, [0, 0, 0], [0, -L2 + 0.09, 0], 0.042, legM);
  blob(knee, [0, -L2 + 0.09, 0], [0.058, 0.06, 0.055], legM);
  capsule(knee, [0, -L2 + 0.09, 0], [0.03, -L2 + 0.05, 0], 0.045, legM);
  const hoof = mesh(knee, HOOF_GEO, HOOF);
  hoof.position.set(0.035, -L2 + 0.025, 0);
  return { g, knee, front };
}

/** h: caballo de la carrera ({ coat, silks, cloth, num }) */
export function buildHorse(h) {
  const coatM = std(h.coat.body, 0.42, { metalness: 0.05 });
  const maneM = std(h.coat.mane, 0.85);
  const legM = std(h.coat.leg, 0.5);
  const capM = std(h.silks.cap, 0.5);
  const sleeveM = std(h.silks.sleeves, 0.55);
  const jacketM = std("#ffffff", 0.55, { map: jacketTexture(h.silks) });
  const clothM = std("#ffffff", 0.75, { map: clothTexture(h.cloth, h.num) });

  const root = new THREE.Group();
  const pivot = group(root, [0, 1.3, 0]);
  const inner = group(pivot, [0, -1.3, 0]);

  // cuerpo
  blob(inner, [-0.02, 1.34, 0], [0.92, 0.36, 0.32], coatM);
  blob(inner, [0.56, 1.3, 0], [0.42, 0.4, 0.3], coatM);
  blob(inner, [-0.62, 1.37, 0], [0.47, 0.41, 0.34], coatM);
  blob(inner, [-0.05, 1.14, 0], [0.62, 0.2, 0.26], coatM);

  // mandil (parches que envuelven el torso) y montura
  for (const geo of [CLOTH_L, CLOTH_R]) {
    const patch = mesh(inner, geo, clothM);
    patch.castShadow = false;
    patch.position.set(0.02, 1.34, 0); patch.scale.set(0.935, 0.372, 0.334);
  }
  blob(inner, [0.04, 1.69, 0], [0.25, 0.05, 0.19], TACK);

  // cuello y cabeza
  const NP = [0.72, 1.5];
  const neck = group(inner, [NP[0], NP[1], 0]);
  const nl = (x, y, z = 0) => [x - NP[0], y - NP[1], z];
  capsule(neck, nl(0.6, 1.42), nl(1.12, 1.95), 0.21, coatM, 0.82);
  capsule(neck, nl(0.92, 1.78), nl(1.26, 2.04), 0.14, coatM, 0.9);
  capsule(neck, nl(1.27, 2.03), nl(1.78, 1.69), 0.115, coatM);
  blob(neck, nl(1.34, 1.92), [0.16, 0.15, 0.11], coatM);
  blob(neck, nl(1.79, 1.68), [0.1, 0.09, 0.085], coatM);
  for (const z of [0.06, -0.06]) {
    const ear = mesh(neck, EAR, coatM);
    ear.position.set(...nl(1.2, 2.17, z)); ear.rotation.z = 0.35;
  }
  for (const z of [0.105, -0.105]) {
    blob(neck, nl(1.43, 1.97, z), [0.03, 0.03, 0.02], BLACK);
    blob(neck, nl(1.42, 1.98, z * 1.08), [0.055, 0.045, 0.02], capM); // anteojera
    blob(neck, nl(1.86, 1.67, z * 0.5), [0.022, 0.018, 0.02], BLACK);
    capsule(neck, nl(1.3, 2.06, z * 1.05), nl(1.6, 1.66, z * 0.9), 0.012, TACK);
  }
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const m = mesh(neck, MANE, maneM);
    m.position.set(...nl(0.62 + t * 0.58, 1.66 + t * 0.42, 0));
    m.rotation.z = -0.8 + Math.sin(i * 2.1) * 0.15;
  }
  const bit = new THREE.Object3D(); bit.position.set(...nl(1.66, 1.64, 0)); neck.add(bit);

  // cola
  const tail = group(inner, [-1.02, 1.5, 0]);
  capsule(tail, [0, 0, 0], [-0.18, -0.08, 0], 0.06, maneM);
  const tail2 = group(tail, [-0.18, -0.08, 0]);
  const hair = mesh(tail2, TAIL, maneM);
  hair.position.set(-0.05, -0.32, 0); hair.rotation.z = -0.15;

  // patas (+z es el lado de la cámara); desfases del galope del original
  const legs = [
    { ...makeLeg(inner, [0.62, 1.2, 0.17], true, coatM, legM), off: 0.46 },
    { ...makeLeg(inner, [0.6, 1.2, -0.17], true, coatM, legM), off: 0.36 },
    { ...makeLeg(inner, [-0.58, 1.25, 0.18], false, coatM, legM), off: 0.12 },
    { ...makeLeg(inner, [-0.6, 1.25, -0.18], false, coatM, legM), off: 0.02 },
  ];

  // jinete
  const jockey = group(inner, [0, 0, 0]);
  blob(jockey, [0.02, 1.9, 0], [0.13, 0.1, 0.15], PANTS);
  for (const s of [1, -1]) {
    capsule(jockey, [0.02, 1.88, 0.11 * s], [0.36, 1.8, 0.24 * s], 0.06, PANTS);
    capsule(jockey, [0.36, 1.8, 0.24 * s], [0.24, 1.56, 0.3 * s], 0.045, BLACK);
  }
  const upper = group(jockey, [0.04, 1.95, 0]);
  capsule(upper, [0, 0, 0], [0.38, 0.13, 0], 0.13, jacketM, 1.15);
  blob(upper, [0.58, 0.2, 0], [0.075, 0.08, 0.07], SKIN);
  const helmet = mesh(upper, HELMET, capM);
  helmet.position.set(0.56, 0.22, 0); helmet.rotation.z = -0.35;
  const peak = mesh(upper, PEAK, capM);
  peak.position.set(0.66, 0.25, 0); peak.rotation.z = -0.25;
  const arms = [];
  for (const s of [1, -1]) {
    const sh = group(upper, [0.36, 0.11, 0.16 * s]);
    capsule(sh, [0, 0, 0], [0.17, -0.15, 0.04 * s], 0.045, sleeveM);
    const el = group(sh, [0.17, -0.15, 0.04 * s]);
    capsule(el, [0, 0, 0], [0.25, -0.02, -0.08 * s], 0.04, sleeveM);
    const hand = new THREE.Object3D(); hand.position.set(0.27, -0.02, -0.08 * s); el.add(hand);
    blob(el, [0.27, -0.02, -0.08 * s], [0.035, 0.035, 0.035], GLOVE);
    arms.push({ sh, el, hand });
  }
  // fusta en la mano del lado de la cámara
  const whip = mesh(arms[0].el, WHIP, BLACK);
  whip.position.set(0.2, 0.18, -0.08); whip.rotation.z = 0.5;

  const reinGeo = new THREE.BufferGeometry();
  reinGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(12), 3));
  const reins = new THREE.LineSegments(reinGeo, new THREE.LineBasicMaterial({ color: "#1a120c" }));
  reins.frustumCulled = false; inner.add(reins);

  return {
    root, pivot, inner, neck, tail, tail2, legs, jockey, upper, arms, bit, reins,
    textures: [jacketM.map, clothM.map],
  };
}

export function disposeHorse(H) {
  H.root.traverse((o) => {
    if (!o.isMesh && !o.isLineSegments) return;
    if (o.isLineSegments) o.geometry.dispose();
    if (!SHARED_MATS.has(o.material)) o.material.dispose();
  });
  H.textures.forEach((t) => t.dispose());
}

function legAngles(p, front, run) {
  const s = Math.sin(TAU * p), c = Math.cos(TAU * p);
  const a = front ? run * (0.62 * s + 0.12) : run * (0.55 * s - 0.08) + (1 - run) * 0.08;
  const b = front ? run * (1.05 * Math.max(0, c) + 0.12) : run * (0.95 * Math.max(0, -c) + 0.2) + (1 - run) * 0.22;
  return { a, rel: front ? -b : b };
}

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

/** s: { phase, run (0..1), pitch, headDrop, slump, drive (0..1, empuje final) } */
export function poseHorse(H, s) {
  const p = s.phase, run = s.run;
  let minFoot = Infinity;
  for (const L of H.legs) {
    const { a, rel } = legAngles(p + L.off, L.front, run);
    L.g.rotation.z = a; L.knee.rotation.z = rel;
    const foot = L.g.position.y - L1 * Math.cos(a) - L2 * Math.cos(a + rel);
    if (foot < minFoot) minFoot = foot;
  }
  const bob = run * 0.07 * Math.sin(TAU * p + 0.6);
  H.pivot.position.y = 1.3 + bob + Math.max(0, -(minFoot + bob));
  H.pivot.rotation.z = -((s.pitch || 0) + run * 0.035 * Math.sin(TAU * p + 1.4));
  H.neck.rotation.z = -(run * 0.08 * Math.sin(TAU * p + 2.2) + (s.headDrop || 0));
  H.tail.rotation.z = 0.25 * run + 0.1 * run * Math.sin(TAU * p + 2);
  H.tail2.rotation.z = 0.25 * run + 0.12 * Math.sin(TAU * p + 2.8);

  const slump = s.slump || 0, drive = s.drive || 0;
  H.jockey.position.y = run * 0.04 * Math.sin(TAU * p + 3.4) - bob * 0.6 - slump * 0.06;
  H.upper.rotation.z = slump * 0.35 - drive * 0.06;
  const pump = run * (0.06 + 0.07 * drive) * Math.sin(TAU * p);
  H.arms[1].sh.rotation.z = pump * 2.2; H.arms[1].el.rotation.z = -pump * 1.5;
  // en la recta final, el brazo de la fusta sube y baja al ritmo del galope
  const whipUp = drive * (0.9 + 0.7 * Math.sin(TAU * p * 0.5));
  H.arms[0].sh.rotation.z = pump * 2.2 + whipUp; H.arms[0].el.rotation.z = -pump * 1.5 + whipUp * 0.4;

  // riendas desde las manos al bocado
  const pos = H.reins.geometry.attributes.position;
  H.inner.updateMatrixWorld(true);
  H.bit.getWorldPosition(tmpB); H.inner.worldToLocal(tmpB);
  for (let i = 0; i < 2; i++) {
    if (i === 0 && drive > 0.3) { pos.setXYZ(0, tmpB.x, tmpB.y, tmpB.z); pos.setXYZ(1, tmpB.x, tmpB.y, tmpB.z); continue; }
    H.arms[i].hand.getWorldPosition(tmpA); H.inner.worldToLocal(tmpA);
    pos.setXYZ(i * 2, tmpA.x, tmpA.y, tmpA.z);
    pos.setXYZ(i * 2 + 1, tmpB.x, tmpB.y, tmpB.z + (i ? -0.08 : 0.08));
  }
  pos.needsUpdate = true;
}
