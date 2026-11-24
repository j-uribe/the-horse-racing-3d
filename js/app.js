import { createRace, DISTANCE, LENGTH_M, posAt, speedAt, marginText } from "./race.js";
import { newSeed } from "./rng.js";
import { Scene } from "./render.js";
import { Commentator } from "./commentary.js";
import { Sound, Voice } from "./audio.js";

const $ = (id) => document.getElementById(id);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const DEFAULT_NAMES = ["Ana", "Benjamín", "Constanza", "Diego", "Elena", "Felipe"];
const STORE_KEY = "gp-orden-names";

let scene;
try {
  scene = new Scene($("track"));
} catch (err) {
  const msg = document.createElement("div");
  msg.className = "webgl-error";
  msg.textContent = "Este navegador no tiene WebGL activo, así que no puede mostrar la carrera en 3D. Prueba con Chrome, Edge o Firefox actualizados.";
  $("screen").appendChild(msg);
  throw err;
}
const sound = new Sound();
const voice = new Voice();

let race = null;
let comm = null;
let mode = "idle"; // idle | pre | running | photo | done
let raceT = 0, modeT = 0, timeScale = 1;
let winnerCalled = false, closeCalled = false, announced = false, lastDecided = false, lastAnnounced = false, preLines = [], preIdx = 0;
let shared = null;
let lastBoard = 0, hoofAcc = 0, last = performance.now();
let lastTick = { t: -10, pri: 0 };

// ---------------------------------------------------------------- entradas
function parseNames() {
  return $("names").value
    .split(/[\n;,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12)
    .map((s) => s.slice(0, 20));
}

function getEvents() {
  const v = (id) => ($(`ev-${id}`).checked ? parseFloat($(`ev-${id}-p`).value) : 0);
  return { rain: v("rain"), incidents: v("inc"), bolter: v("bolt"), collapse: v("col") };
}

function updateNamesHint() {
  const raw = $("names").value.split(/[\n;,]+/).map((s) => s.trim()).filter(Boolean);
  const n = Math.min(raw.length, 12);
  const el = $("names-count");
  if (raw.length < 2) { el.textContent = "Necesitas al menos 2 participantes."; el.classList.add("err"); }
  else if (raw.length > 12) { el.textContent = `Máximo 12: correrán los primeros 12 (hay ${raw.length}).`; el.classList.add("err"); }
  else { el.textContent = `${n} participantes inscritos.`; el.classList.remove("err"); }
  const ok = raw.length >= 2;
  $("btn-start").disabled = !ok || isBusy();
  $("btn-start-overlay").disabled = !ok;
}

const isBusy = () => mode === "pre" || mode === "running" || mode === "photo";

// ---------------------------------------------------------------- HUD
function ticker(text, pri = 1) {
  if (pri < lastTick.pri && performance.now() / 1000 - lastTick.t < 1.6) return;
  lastTick = { t: performance.now() / 1000, pri };
  const old = $("ticker-text");
  const el = old.cloneNode(false);
  el.textContent = text;
  el.classList.toggle("hot", pri >= 3);
  old.replaceWith(el);
  voice.say(text, pri);
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2400);
}

function clothHTML(h) {
  return `<span class="cloth" style="background:${h.cloth[0]};color:${h.cloth[1]}">${h.num}</span>`;
}
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function standings(t) {
  return race.horses
    .map((h) => {
      const x = mode === "pre" || mode === "idle" ? 0 : posAt(h, t);
      const out = h.collapse && t > h.collapse.t;
      const done = h.finishT < t;
      const key = out ? 1e9 - x : done ? -1e9 + h.finishT : -x;
      return { h, x, out, done, key };
    })
    .sort((a, b) => (mode === "pre" || mode === "idle" ? a.h.num - b.h.num : a.key - b.key));
}

function updateBoard(t) {
  const list = standings(t);
  const leadX = list[0].x;
  const showGap = mode !== "pre" && mode !== "idle";
  $("board").innerHTML = list
    .map((s, i) => {
      let gap = "";
      if (showGap && i > 0 && !s.out) {
        const g = (leadX - s.x) / LENGTH_M;
        gap = s.done && list[0].done ? "" : `+${g < 10 ? g.toFixed(1) : Math.round(g)}`;
      }
      if (s.out) gap = "retirado";
      return `<li class="${s.out ? "out" : ""}"><span class="pos">${showGap ? i + 1 : ""}</span>${clothHTML(s.h)}<span class="name">${esc(s.h.name)}</span><span class="gap">${gap}</span></li>`;
    })
    .join("");

  const lead = list.find((s) => !s.out) || list[0];
  let dist;
  if (mode === "pre" || mode === "idle") dist = `${DISTANCE} m`;
  else if (lead.x >= DISTANCE) dist = "Llegada";
  else dist = `Faltan ${Math.max(10, Math.ceil((DISTANCE - lead.x) / 10) * 10)} m`;
  $("badge-dist").textContent = dist;
  $("badge-info").textContent = `${DISTANCE} m · Pasto · ${race.rain ? "Pista pesada" : "Pista ligera"} · ${race.n} competidores`;
}

// ---------------------------------------------------------------- carrera
function buildPreview() {
  const names = parseNames();
  if (names.length < 2) return;
  race = createRace({ names, seed: 1, duration: 30, events: {} });
  scene.reset(race);
  updateBoard(0);
}

function startRace(seed, cfg) {
  const names = cfg?.names ?? parseNames();
  if (names.length < 2) { toast("Necesitas al menos 2 participantes."); return; }
  const duration = cfg?.duration ?? parseInt($("duration").value, 10);
  const events = cfg?.events ?? getEvents();
  const lastZoom = cfg?.lastZoom ?? $("opt-last").checked;

  sound.init();
  sound.setMuted(!$("opt-sound").checked);
  voice.stop();

  race = createRace({ names, seed, duration, events });
  race.cfg = { names, duration, events, lastZoom };
  scene.reset(race);
  comm = new Commentator(race);

  mode = "pre"; modeT = 0; raceT = 0; timeScale = 1;
  winnerCalled = false; closeCalled = false; announced = false; lastDecided = false; lastAnnounced = false;
  $("board").style.visibility = "";
  $("replay-label").hidden = true;
  preLines = comm.pre(); preIdx = 0;
  lastTick = { t: -10, pri: 0 };

  $("idle").hidden = true;
  $("results").hidden = true;
  $("photo-label").hidden = true;
  $("panel").classList.add("locked");
  $("btn-start").disabled = true;
  updateBoard(0);
}

// ¿Habrá repetición del último lugar?
const lastReplay = () =>
  race.cfg.lastZoom && race.n >= 3 && !race.horses[race.order[race.n - 1]].collapse;
const lastPair = () => [race.horses[race.order[race.n - 2]], race.horses[race.order[race.n - 1]]];

function announceWinner() {
  announced = true;
  if (!lastReplay()) $("board").style.visibility = "";
  const [a, b, c] = race.order.map((i) => race.horses[i]);
  const m = marginText(race.margins[1]);
  let text = race.photo ? `Fotografía: ¡ganó ${a.name} ${m}!` : `¡Ganó ${a.name} ${m}!`;
  if (b && !b.collapse) text += ` Segundo, ${b.name}${c && !c.collapse ? `; tercero, ${c.name}` : ""}.`;
  ticker(text, 4);
}

function afterWinner() {
  if (!lastReplay()) return;
  $("board").style.visibility = "hidden"; // no revelar al último antes de la repetición
  mode = "follow"; modeT = 0;
}

function startReplay() {
  const [a] = lastPair();
  mode = "replay"; modeT = 0;
  raceT = Math.max(0, a.finishT - 2.6 * (race.duration / 30));
  timeScale = 0.6;
  scene.particles = [];
  scene.snap = true;
  $("replay-label").hidden = false;
  $("badge-dist").textContent = "Repetición";
  ticker("Repetición: así se definió el último lugar.", 3);
}

function announceLast() {
  lastAnnounced = true;
  const [a, b] = lastPair();
  const m = marginText(race.margins[race.n - 1]);
  ticker(`Último lugar para ${b.name}: ${a.name} lo superó ${m}.`, 4);
}

function finish() {
  mode = "done";
  $("replay-label").hidden = true;
  $("photo-label").hidden = true;
  $("board").style.visibility = "";
  const lastH = race.horses[race.order[race.n - 1]];
  if (race.cfg.lastZoom && lastH.collapse) ticker(`Último lugar para ${lastH.name}, que no terminó la carrera.`, 2);
  sound.fanfare();
  $("panel").classList.remove("locked");
  $("btn-start").textContent = "Nueva carrera";
  updateNamesHint();
  showResults();
}

function showResults() {
  const rows = race.order.map((idx, k) => {
    const h = race.horses[idx];
    const m = k === 0 ? "ganador" : marginText(race.margins[k]);
    return `<li style="animation-delay:${k * 0.07}s"><span class="place">${k + 1}°</span>${clothHTML(h)}<span class="rname">${esc(h.name)}</span><span class="rmargin">${m}</span></li>`;
  });
  $("results-list").innerHTML = rows.join("");
  $("seed-line").textContent = `Carrera n.º ${race.seed.toString(36).toUpperCase()} · ${race.rain ? "pista pesada" : "pista ligera"}`;
  $("results").hidden = false;
}

function orderText() {
  return ["The Horse Racing — resultado oficial", ...race.order.map((i, k) => `${k + 1}. ${race.horses[i].name}`)].join("\n");
}

function shareURL() {
  const u = new URL(location.href);
  u.hash = "";
  const p = new URLSearchParams();
  p.set("p", race.cfg.names.join("|"));
  p.set("s", race.seed.toString(36));
  p.set("d", String(race.cfg.duration));
  const e = race.cfg.events;
  p.set("e", [e.rain, e.incidents, e.bolter, e.collapse].map((x) => Math.round(x * 100)).join("-"));
  if (race.cfg.lastZoom) p.set("u", "1");
  u.search = p.toString();
  return u.toString();
}

async function copy(text, okMsg) {
  try { await navigator.clipboard.writeText(text); toast(okMsg); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast(okMsg); } catch { toast("No se pudo copiar."); }
    ta.remove();
  }
}

// ---------------------------------------------------------------- bucle
const ease = (cur, target, k, dt) => cur + (target - cur) * (1 - Math.exp(-k * dt));

function showPhoto(label, sub) {
  const el = $("photo-label");
  el.querySelector("span").textContent = label;
  el.querySelector("small").textContent = sub;
  el.hidden = false;
  sound.shutter();
}

function frame(now) {
  const dtReal = Math.min(0.05, (now - last) / 1000);
  last = now;
  let dtRace = 0;

  if (mode === "pre") {
    modeT += dtReal;
    if (preIdx < preLines.length && modeT >= preIdx * 1.3) ticker(preLines[preIdx++], 1);
    const preDur = 1.3 * preLines.length + 0.9;
    if (modeT >= preDur) { mode = "running"; sound.bell(); }
  } else if (mode === "running") {
    const winner = race.horses[race.order[0]];
    let target = 1;
    if (raceT < winner.finishT) {
      const xs = race.horses.filter((h) => !(h.collapse && raceT > h.collapse.t)).map((h) => posAt(h, raceT)).sort((a, b) => b - a);
      const rem = DISTANCE - xs[0], gap = xs[0] - (xs[1] ?? -99);
      if (rem < 30 && gap < 1.8) target = 0.3;
      if (race.photo && !closeCalled && rem < 45) {
        closeCalled = true;
        $("board").style.visibility = "hidden";
        const [a, b] = [race.horses[race.order[0]], race.horses[race.order[1]]];
        const [p, q] = Math.random() < 0.5 ? [a, b] : [b, a];
        ticker(`¡${p.name} y ${q.name} vienen cabeza a cabeza!`, 3);
      }
    } else target = 1.3;
    timeScale = ease(timeScale, target, 5, dtReal);
    let next = raceT + dtReal * timeScale;
    if (!winnerCalled && next >= winner.finishT) {
      winnerCalled = true;
      if (race.photo) {
        next = winner.finishT;
        mode = "photo"; modeT = 0;
        showPhoto("FOTOGRAFÍA", "Revisando la llegada…");
        $("badge-dist").textContent = "Llegada";
        ticker("¡Cruzan juntos el disco! Hay que esperar la fotografía…", 3);
      } else { announceWinner(); afterWinner(); }
    }
    dtRace = next - raceT;
    raceT = next;
    for (const l of comm.update(raceT)) ticker(l.text, l.pri);
    if (mode === "running" && raceT >= race.endT) finish();
  } else if (mode === "photo") {
    modeT += dtReal;
    if (modeT > 2.7) {
      $("photo-label").hidden = true;
      mode = "running";
      announceWinner();
      afterWinner();
    }
  } else if (mode === "follow") {
    // la cámara acompaña al ganador mientras se anuncia; luego corte a la repetición
    modeT += dtReal;
    timeScale = ease(timeScale, 0.7, 4, dtReal);
    dtRace = dtReal * timeScale;
    raceT += dtRace;
    if (modeT > 2.2) startReplay();
  } else if (mode === "replay") {
    modeT += dtReal;
    const [a, b] = lastPair();
    const rem = DISTANCE - Math.max(posAt(a, raceT), posAt(b, raceT));
    const target = !lastDecided && rem < 25 ? 0.28 : 0.6;
    timeScale = ease(timeScale, target, 5, dtReal);
    let next = raceT + dtReal * timeScale;
    if (!lastDecided && next >= a.finishT) {
      lastDecided = true;
      if (race.photoLast) {
        next = a.finishT;
        mode = "photoLast"; modeT = 0;
        showPhoto("FOTOGRAFÍA", "Definiendo el último lugar…");
        ticker("¡Cruzan juntos! La fotografía define el último lugar…", 3);
      }
    }
    if (!lastAnnounced && !race.photoLast && next >= b.finishT) announceLast();
    dtRace = next - raceT;
    raceT = next;
    if (mode === "replay" && raceT >= b.finishT + 1.4) finish();
  } else if (mode === "photoLast") {
    modeT += dtReal;
    if (modeT > 2.6) {
      $("photo-label").hidden = true;
      announceLast();
      mode = "replay";
    }
  }

  if (race) {
    const frozen = mode === "photo" || mode === "photoLast";
    if (!frozen) scene.updateParticles(raceT, dtRace, race.rain);
    const camMode = mode === "pre" || mode === "idle" ? "pre" : "race";
    let cm = camMode, focus = null;
    if (frozen) cm = "photo";
    else if (mode === "follow") { cm = "focus"; focus = [race.horses[race.order[0]]]; }
    else if (mode === "replay") { cm = "focus"; focus = lastPair(); }
    scene.updateCamera(raceT, dtReal, dtRace, cm, focus);
    const replaying = mode === "follow" || mode === "replay" || mode === "photoLast";
    scene.draw(raceT, { mode: camMode, photo: frozen, dtReal, hideMap: replaying });

    if (now - lastBoard > 140 && !frozen && !replaying) { lastBoard = now; updateBoard(raceT); }

    // sonido
    if (sound.ctx) {
      let level = 0.08;
      if (mode === "pre") level = 0.15;
      if (mode === "follow" || mode === "replay" || mode === "photoLast") level = 0.45;
      else if (mode === "running" || mode === "photo") {
        const prog = Math.min(1, posAt(race.horses[race.order[0]], raceT) / DISTANCE);
        level = winnerCalled ? 0.7 : 0.18 + 0.75 * smooth(0.45, 1, prog);
      }
      if (mode === "done") level = 0.12;
      sound.crowd(level);
      if ((mode === "running" || mode === "replay") && dtRace > 0 && raceT < race.endT - 0.8) {
        hoofAcc += dtReal;
        const interval = 0.07 / Math.max(0.3, timeScale);
        while (hoofAcc > interval) {
          sound.hoof(0.2 + 0.25 * Math.random() * scene.cam.z);
          hoofAcc -= interval * (0.6 + 0.8 * Math.random());
        }
      }
    }
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- arranque
function onStart() {
  if (isBusy()) return;
  if (shared) {
    const s = shared; shared = null;
    $("idle-note").textContent = "Cada orden posible tiene la misma probabilidad.";
    startRace(s.seed, s.cfg);
  } else startRace(newSeed());
}

function loadShared() {
  const q = new URLSearchParams(location.search);
  if (!q.has("s") || !q.has("p")) return false;
  const names = q.get("p").split("|").map((s) => s.trim()).filter(Boolean).slice(0, 12);
  const seed = parseInt(q.get("s"), 36) >>> 0;
  const duration = [20, 30, 45].includes(+q.get("d")) ? +q.get("d") : 30;
  const [rain, incidents, bolter, collapse] = (q.get("e") || "0-0-0-0").split("-").map((x) => Math.min(1, Math.max(0, (+x || 0) / 100)));
  if (names.length < 2 || !Number.isFinite(seed)) return false;
  $("names").value = names.join("\n");
  $("duration").value = String(duration);
  const lastZoom = q.get("u") === "1";
  $("opt-last").checked = lastZoom;
  shared = { seed, cfg: { names, duration, events: { rain, incidents, bolter, collapse }, lastZoom } };
  $("idle-note").textContent = "Carrera compartida: presiona Largar para verla exactamente como fue.";
  return true;
}

function init() {
  if (!loadShared()) {
    let saved = null;
    try { saved = localStorage.getItem(STORE_KEY); } catch {}
    $("names").value = saved || DEFAULT_NAMES.join("\n");
  }
  updateNamesHint();
  buildPreview();

  let deb;
  $("names").addEventListener("input", () => {
    updateNamesHint();
    try { localStorage.setItem(STORE_KEY, $("names").value); } catch {}
    shared = null;
    $("idle-note").textContent = "Cada orden posible tiene la misma probabilidad.";
    clearTimeout(deb);
    deb = setTimeout(() => { if (mode === "idle") buildPreview(); }, 250);
  });

  $("btn-start").addEventListener("click", onStart);
  $("btn-start-overlay").addEventListener("click", onStart);
  $("btn-new").addEventListener("click", () => { $("results").hidden = true; startRace(newSeed()); });
  $("btn-replay").addEventListener("click", () => startRace(race.seed, race.cfg));
  $("btn-copy").addEventListener("click", () => copy(orderText(), "Orden copiado."));
  $("btn-share").addEventListener("click", async () => {
    const url = shareURL();
    if (navigator.share) {
      try { await navigator.share({ title: "The Horse Racing", text: orderText(), url }); return; } catch (e) { if (e?.name === "AbortError") return; }
    }
    copy(url, "Enlace copiado: quien lo abra verá la misma carrera.");
  });
  try { if (!shared) $("opt-last").checked = localStorage.getItem("thr-last") === "1"; } catch {}
  $("opt-last").addEventListener("change", (e) => { try { localStorage.setItem("thr-last", e.target.checked ? "1" : "0"); } catch {} });
  const setView = (view) => {
    scene.view = view;
    $("views").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === view)));
  };
  try {
    const v = localStorage.getItem("thr-view");
    if (["tv", "close", "back"].includes(v)) setView(v);
    if (localStorage.getItem("thr-labels") === "0") $("opt-labels").checked = false;
  } catch {}
  scene.labels = $("opt-labels").checked;
  $("views").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-view]");
    if (!b) return;
    setView(b.dataset.view);
    try { localStorage.setItem("thr-view", b.dataset.view); } catch {}
  });
  $("opt-labels").addEventListener("change", (e) => {
    scene.labels = e.target.checked;
    try { localStorage.setItem("thr-labels", e.target.checked ? "1" : "0"); } catch {}
  });
  $("opt-sound").addEventListener("change", (e) => sound.setMuted(!e.target.checked));
  $("opt-voice").addEventListener("change", (e) => {
    voice.enabled = e.target.checked;
    if (!voice.ok && e.target.checked) toast("Tu navegador no tiene voz sintetizada.");
    if (!e.target.checked) voice.stop();
  });
  document.addEventListener("keydown", (e) => {
    if (e.target !== document.body) return;
    if (e.code === "Space") { e.preventDefault(); onStart(); }
    const views = { Digit1: "tv", Digit2: "close", Digit3: "back" };
    if (views[e.code]) $("views").querySelector(`[data-view="${views[e.code]}"]`).click();
  });

  new ResizeObserver(() => scene.resize()).observe($("screen"));
  requestAnimationFrame((t) => { last = t; frame(t); });

  // Para pruebas automatizadas
  window.__gp = { get race() { return race; }, get mode() { return mode; }, get t() { return raceT; }, startRace, scene };
}

init();
