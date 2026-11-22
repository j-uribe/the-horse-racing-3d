import { mulberry32, shuffle, range, pick } from "./rng.js";

export const DISTANCE = 1000; // metros
export const LENGTH_M = 2.4; // un "cuerpo" de caballo, en metros

// Colores estándar de mandil por número (fondo, número)
export const CLOTHS = [
  ["#c8202a", "#ffffff"], ["#f2f2ee", "#111111"], ["#1d4cb8", "#ffffff"],
  ["#f0c919", "#111111"], ["#1c7f37", "#ffffff"], ["#141414", "#f0c919"],
  ["#ee7718", "#111111"], ["#f2a3c0", "#111111"], ["#24aaa8", "#111111"],
  ["#652a8c", "#ffffff"], ["#8f8f8f", "#c8202a"], ["#a3d23a", "#111111"],
];

const SILK_COLORS = [
  "#b0182a", "#0d2f6e", "#f2efe6", "#e8b923", "#0e6b3a", "#121212", "#6b1f7a",
  "#e35d12", "#2a8fd6", "#7a1b1b", "#d9468f", "#3f4a55", "#1aa59a", "#c9a227",
];
const COATS = [
  { body: "#5b3420", mane: "#1b120d", leg: "#2a1a12" }, // castaño
  { body: "#7b3a1b", mane: "#4a1f0d", leg: "#5e2c14" }, // alazán
  { body: "#3a2417", mane: "#140d09", leg: "#1a110c" }, // castaño oscuro
  { body: "#8d877f", mane: "#4a4642", leg: "#5d5852" }, // tordillo
  { body: "#201b19", mane: "#0b0909", leg: "#121010" }, // negro
  { body: "#6a4526", mane: "#24170f", leg: "#2e1e14" }, // zaino
];
const PATTERNS = ["plain", "hoops", "sash", "halves", "stars", "band"];

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const M = 900; // muestras por perfil

// Construye la curva de avance normalizado (0..1) en función del tiempo normalizado (0..1).
function buildProfile(rnd, o) {
  const noise = [0, 1, 2].map(() => ({
    f: range(rnd, 1.2, 4.2), ph: range(rnd, 0, Math.PI * 2), a: range(rnd, 0.008, 0.02),
  }));
  const D = new Float64Array(M + 1);
  let prev = 0;
  let acc = 0;
  for (let i = 0; i <= M; i++) {
    const u = i / M;
    let v = smooth(o.startDelay, o.startDelay + 0.075, u) * 0.92 + 0.08 * (u > o.startDelay ? 1 : 0);
    let m = 1 + 0.065 * o.style * (1 - 2 * u) + o.kick * smooth(0.7, 0.96, u);
    for (const n of noise) m += n.a * Math.sin(Math.PI * 2 * n.f * u + n.ph);
    if (o.bolter) m *= 1 + 0.2 * Math.exp(-u / 0.25) - 0.08 * smooth(0.55, 1, u);
    if (o.stumble) {
      const d = (u - o.stumble.u) / 0.022;
      m *= 1 - o.stumble.depth * Math.exp(-d * d);
    }
    v *= m;
    if (i > 0) acc += (prev + v) / 2;
    D[i] = acc;
    prev = v;
  }
  for (let i = 0; i <= M; i++) D[i] /= acc;
  return D;
}

function sample(D, u) {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const f = u * M;
  const i = Math.floor(f);
  return D[i] + (D[i + 1] - D[i]) * (f - i);
}

function invert(D, frac) {
  let lo = 0, hi = M;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (D[mid] < frac) lo = mid; else hi = mid;
  }
  return hi / M;
}

/**
 * Crea una carrera completa y determinista.
 * El orden de llegada se sortea PRIMERO con su propio generador (Fisher–Yates
 * uniforme). Todo lo demás —ritmos, remontadas, eventos— se genera después con
 * otro generador y se ajusta para terminar en ese orden, así que nada de lo
 * visual altera las probabilidades.
 */
export function createRace({ names, seed, duration = 30, events = {} }) {
  const n = names.length;
  const orderRnd = mulberry32(seed);
  const rnd = mulberry32((seed ^ 0x9e3779b9) >>> 0);

  const order = shuffle([...Array(n).keys()], orderRnd); // order[k] = caballo en el lugar k
  const place = [];
  order.forEach((h, k) => (place[h] = k));

  const dscale = duration / 30;
  const rain = rnd() < (events.rain ?? 0);
  const collapseOn = n >= 3 && rnd() < (events.collapse ?? 0);
  const bolterOn = !collapseOn && n >= 3 && rnd() < (events.bolter ?? 0);
  const incidentsOn = rnd() < (events.incidents ?? 0);

  const collapseHorse = collapseOn ? order[n - 1] : -1;
  let bolterHorse = -1;
  if (bolterOn) {
    const pool = order.slice(Math.ceil(n / 2));
    bolterHorse = pick(rnd, pool);
  }
  let stumbleHorse = -1, slowHorse = -1;
  if (incidentsOn) {
    const pool = [...Array(n).keys()].filter((h) => h !== collapseHorse && h !== bolterHorse);
    stumbleHorse = pick(rnd, pool);
    if (rnd() < 0.6) slowHorse = pick(rnd, pool.filter((h) => h !== stumbleHorse));
  }

  // Tiempos de llegada, en orden
  const photo = n >= 2 && rnd() < 0.32;
  // llegada estrecha también por el último lugar (solo afecta a la escenificación)
  const photoLast = n >= 3 && !collapseOn && rnd() < 0.4;
  const T = new Array(n);
  let t = duration * range(rnd, 0.985, 1.015) * (rain ? 1.04 : 1);
  for (let k = 0; k < n; k++) {
    const h = order[k];
    if (k > 0) {
      let gap;
      if (k === 1) gap = photo ? range(rnd, 0.004, 0.022) : range(rnd, 0.035, 0.22);
      else if (k === n - 1 && photoLast) gap = range(rnd, 0.004, 0.022);
      else gap = rnd() < 0.25 ? range(rnd, 0.008, 0.03) : range(rnd, 0.03, 0.2);
      t += gap * dscale;
    }
    T[h] = t;
  }
  const lastFinite = t;

  // Colores: chaquetillas sin repetir combinación
  const silkPool = shuffle(SILK_COLORS, rnd);
  const horses = names.map((name, i) => {
    const jacket = silkPool[i % silkPool.length];
    let sleeves = pick(rnd, SILK_COLORS);
    if (sleeves === jacket) sleeves = silkPool[(i + 5) % silkPool.length];
    const style = h_style(rnd, place[i], n);
    const h = {
      idx: i,
      name,
      num: i + 1,
      lane: i,
      cloth: CLOTHS[i % CLOTHS.length],
      silks: { jacket, sleeves, cap: rnd() < 0.5 ? sleeves : jacket, pattern: pick(rnd, PATTERNS) },
      coat: pick(rnd, COATS),
      place: place[i],
      finishT: T[i],
      stumbleT: null,
      collapse: null,
      bolter: i === bolterHorse || i === collapseHorse,
      slowStart: i === slowHorse,
      phase0: rnd(),
    };
    const opts = {
      style: h.bolter ? 1 : style,
      kick: h.bolter ? 0 : range(rnd, 0, 0.05) * (place[i] < 3 ? 1.3 : 0.8),
      startDelay: i === slowHorse ? range(rnd, 0.012, 0.02) : range(rnd, 0, 0.006),
      bolter: h.bolter,
      stumble: i === stumbleHorse ? { u: range(rnd, 0.3, 0.72), depth: 0.55 } : null,
    };
    if (i === collapseHorse) {
      const Tref = lastFinite + range(rnd, 0.3, 0.8) * dscale;
      const D = buildProfile(rnd, opts);
      const frac = range(rnd, 0.72, 0.87);
      const uc = invert(D, frac);
      const tc = uc * Tref;
      const vc = (DISTANCE * (sample(D, uc + 1 / M) - sample(D, uc))) / (Tref / M);
      h.finishT = Infinity;
      h.collapse = { t: tc, x: frac * DISTANCE, v: vc };
      h.D = D;
      h.Tref = Tref;
    } else {
      h.D = buildProfile(rnd, opts);
      h.Tref = T[i];
      if (opts.stumble) h.stumbleT = opts.stumble.u * T[i];
    }
    h.vEnd = (DISTANCE * (h.D[M] - h.D[M - 1])) / (h.Tref / M);
    return h;
  });

  const race = {
    seed, names, n, order, duration, rain, photo, photoLast, horses,
    events: { collapseHorse, bolterHorse, stumbleHorse, slowHorse },
    endT: lastFinite + 2.2 * dscale,
  };

  // Márgenes entre lugares consecutivos (metros, al cruzar el de adelante)
  race.margins = order.map((h, k) => {
    if (k === 0) return null;
    const ahead = order[k - 1];
    if (horses[h].collapse) return { dnf: true };
    const ta = horses[ahead].finishT;
    return { meters: DISTANCE - posAt(horses[h], ta) };
  });
  return race;
}

function h_style(rnd, placeK, n) {
  // Algo de dramatismo: el ganador suele venir de atrás; los últimos a veces arrancan rápido.
  const rel = n > 1 ? placeK / (n - 1) : 0;
  return Math.max(-1, Math.min(1, range(rnd, -1, 1) * 0.8 + (rel - 0.5) * 0.7));
}

// Posición (metros desde la partida, medida en la nariz) en el tiempo t
export function posAt(h, t) {
  if (t <= 0) return 0;
  if (h.collapse) {
    const c = h.collapse;
    if (t <= c.t) return DISTANCE * sample(h.D, t / h.Tref);
    const tau = 0.55;
    return c.x + c.v * tau * (1 - Math.exp(-(t - c.t) / tau));
  }
  if (t <= h.Tref) return DISTANCE * sample(h.D, t / h.Tref);
  const tau = 2.6;
  return DISTANCE + h.vEnd * tau * (1 - Math.exp(-(t - h.Tref) / tau));
}

export function speedAt(h, t) {
  const dt = 1 / 120;
  return (posAt(h, t + dt) - posAt(h, t - dt)) / (2 * dt);
}

export function marginText(m) {
  if (!m) return "";
  if (m.dnf) return "no terminó";
  const L = m.meters / LENGTH_M;
  if (L < 0.12) return "por una nariz";
  if (L < 0.3) return "por una cabeza";
  if (L < 0.45) return "por un pescuezo";
  if (L < 0.75) return "por medio cuerpo";
  if (L < 1.25) return "por un cuerpo";
  const half = Math.round(L * 2) / 2;
  const s = Number.isInteger(half) ? `${half}` : `${Math.floor(half)} ½`;
  return `por ${s} cuerpos`;
}

export function marginShort(m) {
  if (!m) return "";
  if (m.dnf) return "—";
  const L = m.meters / LENGTH_M;
  if (L < 0.12) return "nariz";
  if (L < 0.3) return "cabeza";
  if (L < 0.45) return "pescuezo";
  if (L < 0.75) return "½ cuerpo";
  const half = Math.round(L * 2) / 2;
  return `${Number.isInteger(half) ? half : Math.floor(half) + " ½"} c.`;
}
