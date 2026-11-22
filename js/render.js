import { drawHorse } from "./horse.js";
import { DISTANCE, posAt, speedAt } from "./race.js";

const TAU = Math.PI * 2;
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerpK = (k, dt) => 1 - Math.exp(-k * dt);

// Cordillera determinista: suma de picos triangulares con ruido
function ridge(seed, n, peaks) {
  let st = seed;
  const rnd = () => ((st = (st * 16807) % 2147483647) / 2147483647);
  const P = Array.from({ length: peaks }, () => ({ x: rnd(), h: 0.3 + rnd() * 0.7, s: 3.5 + rnd() * 5 }));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    let y = 0.12;
    for (const p of P) {
      let d = Math.abs(u - p.x); d = Math.min(d, 1 - d); // periódico
      y = Math.max(y, p.h - p.s * d);
    }
    y += (rnd() - 0.5) * 0.035;
    pts.push(-y);
  }
  return pts;
}

export class Scene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cam = { x: 6, z: 1, cy: null };
    this.particles = [];
    this.rainDrops = [];
    this.mountFar = ridge(48271, 220, 14);
    this.mountNear = ridge(9301, 160, 10);
    this.trees = [];
    let x = 0, s = 11;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    while (x < 1) { this.trees.push({ x, r: 0.6 + rnd() * 0.8, h: 0.5 + rnd() * 0.7, t: rnd() }); x += 0.012 + rnd() * 0.018; }
    this.phases = [];
    this.lastPhase = [];
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.W = Math.max(320, r.width);
    this.H = Math.max(200, r.height);
    this.canvas.width = Math.round(this.W * dpr);
    this.canvas.height = Math.round(this.H * dpr);
    this.dpr = dpr;
    this.ppm = this.H * 0.056;
    if (this.W / this.H < 1.2) this.ppm = this.H * 0.047;
    this.rainDrops = Array.from({ length: 220 }, () => ({
      x: Math.random() * this.W, y: Math.random() * this.H, v: 600 + Math.random() * 500,
    }));
  }

  // ---- geometría de la pista -------------------------------------------------
  get railY() { return this.H * 0.53; }
  laneD(lane, n) { return n <= 1 ? 0.5 : lane / (n - 1); }
  groundY(d) { return this.railY + (this.H - this.railY) * (0.16 + 0.74 * d); }
  depthScale(d) { return 0.68 + 0.32 * d; }
  sx(x, d) { return this.W * 0.5 + (x - this.cam.x) * this.ppm * this.depthScale(d); }

  reset(race) {
    this.race = race;
    this.cam = { x: Math.min(7, (this.W / this.ppm) * 0.2), z: 1, cy: null };
    this.particles = [];
    this.phases = race.horses.map((h) => h.phase0);
    this.lastPhase = this.phases.slice();
    this.stopped = race.horses.map(() => 0);
  }

  // ---- cámara ----------------------------------------------------------------
  // Transformación: y' = z·(y − cy) + M, x' = z·(x − W/2) + W/2
  get midY() { return this.H * 0.47; }
  applyCam(ctx) {
    ctx.translate(this.W / 2, this.midY);
    ctx.scale(this.cam.z, this.cam.z);
    ctx.translate(-this.W / 2, -this.cam.cy);
  }

  // Zoom y centro vertical para encuadrar a dos caballos (o a uno)
  frameFor(ha, hb, zMax = 1.85) {
    const n = this.race.n;
    const d1 = this.laneD(ha.lane, n), d2 = this.laneD(hb.lane, n);
    const k1 = this.ppm * this.depthScale(d1), k2 = this.ppm * this.depthScale(d2);
    const yTop = Math.min(this.groundY(d1) - 2.5 * k1, this.groundY(d2) - 2.5 * k2);
    const yBot = Math.max(this.groundY(d1) + 0.15 * k1, this.groundY(d2) + 0.15 * k2);
    const zt = Math.max(1, Math.min(zMax, (this.H * 0.7) / (yBot - yTop)));
    return { zt, cy: (yTop + yBot) / 2 };
  }

  // mode: "pre" | "race" | "photo" (cámara quieta) | "focus" (sigue a focus = [caballo, caballo?])
  updateCamera(t, dtReal, dtRace, mode, focus) {
    const race = this.race;
    const c = this.cam;
    if (c.cy == null) c.cy = this.midY;
    if (mode === "photo") return;
    let target, zt = 1, cy = this.midY, v = 0;

    if (mode === "pre") {
      target = Math.min(7, (this.W / this.ppm) * 0.2);
    } else if (mode === "focus") {
      const a = focus[0], b = focus[1] || focus[0];
      const xa = posAt(a, t), xb = posAt(b, t);
      target = (xa + xb) / 2 + (focus.length === 1 ? -0.8 : 0.4);
      v = (speedAt(a, t) + speedAt(b, t)) / 2;
      ({ zt, cy } = this.frameFor(a, b, focus.length === 1 ? 1.6 : 1.9));
    } else {
      const alive = race.horses.filter((h) => !(h.collapse && t > h.collapse.t));
      const sorted = alive.map((h) => ({ h, x: posAt(h, t) })).sort((a, b) => b.x - a.x);
      const lead = sorted[0], second = sorted[1] || sorted[0];
      const winnerDone = t >= race.horses[race.order[0]].finishT;
      if (winnerDone) {
        target = DISTANCE + 3;
        zt = 1.15;
      } else {
        const remaining = DISTANCE - lead.x;
        const close = smooth(95, 15, remaining);
        // durante la carrera: centrar al grupo de punta sin perder al puntero
        const half = this.W / 2 / (this.ppm * 0.84);
        const top = sorted.slice(0, Math.min(4, sorted.length));
        let pack = top.reduce((a, s) => a + s.x, 0) / top.length;
        pack = Math.max(pack, lead.x - half * 0.72);
        const duel = (lead.x + second.x) / 2 + 0.4;
        target = pack + (duel - pack) * close;
        v = speedAt(lead.h, t);
        const f = this.frameFor(lead.h, second.h);
        zt = 1 + (f.zt - 1) * close;
        cy = this.midY + (f.cy - this.midY) * close;
      }
    }
    if (this.snap) {
      // corte de cámara (repetición)
      this.snap = false;
      c.x = target; c.z = zt; c.cy = cy;
      return;
    }
    c.x += v * dtRace;
    c.x += (target - c.x) * lerpK(3.2, dtReal);
    c.z += (zt - c.z) * lerpK(2.4, dtReal);
    c.cy += (cy - c.cy) * lerpK(2.4, dtReal);
  }

  // ---- partículas --------------------------------------------------------------
  updateParticles(t, dt, rain) {
    const race = this.race;
    race.horses.forEach((h, i) => {
      const v = speedAt(h, t);
      const stride = 6.8;
      this.phases[i] += (dt * v) / stride;
      const prev = this.lastPhase[i];
      const cur = this.phases[i];
      if (v > 6 && Math.floor(prev * 2) !== Math.floor(cur * 2) && this.particles.length < 500) {
        const x = posAt(h, t) - 1.0;
        const d = this.laneD(h.lane, race.n);
        const k = rain ? 4 : 2;
        for (let j = 0; j < k; j++) {
          this.particles.push({
            x, d: d + (Math.random() - 0.5) * 0.04, y: -0.05,
            vx: v * (0.05 + Math.random() * 0.25) * (Math.random() < 0.5 ? 1 : 0.4),
            vy: -(1.2 + Math.random() * 2.6), life: 1,
            c: rain ? (Math.random() < 0.7 ? "#3b2a1a" : "#5a4128") : (Math.random() < 0.6 ? "#3f5a22" : "#5b4a2c"),
            s: 0.05 + Math.random() * 0.07,
          });
        }
      }
      this.lastPhase[i] = cur;
    });
    for (const p of this.particles) {
      p.vy += 9.8 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y > 0) { p.y = 0; p.life -= dt * 2.5; p.vx *= 0.8; }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  // ---- dibujo ------------------------------------------------------------------
  draw(t, opts) {
    const { ctx, W, H, race } = this;
    const rain = race.rain;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();

    // zoom alrededor del foco
    if (this.cam.cy == null) this.cam.cy = this.midY;
    this.applyCam(ctx);

    this.drawBackground(rain);
    this.drawTrack(rain);
    this.drawRailAndPoles();
    this.drawFinishLine(opts.photo);

    // caballos por profundidad (lejos → cerca)
    const n = race.n;
    const byDepth = race.horses.slice().sort((a, b) => a.lane - b.lane);
    const gateOpen = opts.mode !== "pre";
    for (const h of byDepth) {
      const d = this.laneD(h.lane, n);
      const x = opts.mode === "pre" ? 0 : posAt(h, t);
      const v = opts.mode === "pre" ? 0 : speedAt(h, t);
      const s = this.depthScale(d);
      const gx = this.sx(x, d), gy = this.groundY(d);
      if (gx < -300 || gx > W + 300) { if (x < 3) this.drawGateLane(d, gateOpen, t); continue; }
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
      if (opts.mode === "pre") {
        run = 0; headDrop = 0.06 * Math.sin(performance.now() / 700 + h.lane);
      }
      ctx.save();
      ctx.translate(gx, gy);
      const k = this.ppm * s;
      ctx.scale(k, k);
      drawHorse(ctx, {
        phase: this.phases[h.idx] ?? 0, run, coat: h.coat, silks: h.silks, cloth: h.cloth, num: h.num,
        pitch, headDrop, slump,
      });
      ctx.restore();
      this.drawGateLane(d, gateOpen, t);
    }
    this.drawParticles();
    ctx.restore();

    if (rain && !opts.photo) this.drawRain(opts.dtReal || 0.016);
    if (opts.photo) this.drawPhotoOverlay();
    this.drawVignette();
    if (opts.mode !== "pre" && !opts.photo && !opts.hideMap) this.drawMiniMap(t);
  }

  drawBackground(rain) {
    const { ctx, W, H } = this;
    const horizon = H * 0.41;
    // cielo
    const g = ctx.createLinearGradient(0, -H, 0, horizon);
    if (rain) { g.addColorStop(0, "#4b5560"); g.addColorStop(1, "#9aa3a8"); }
    else { g.addColorStop(0, "#5f8fc4"); g.addColorStop(0.7, "#b9d1e3"); g.addColorStop(1, "#e9e2cf"); }
    ctx.fillStyle = g; ctx.fillRect(-W, -H, W * 3, horizon + H + 2);
    // nubes suaves
    ctx.fillStyle = rain ? "rgba(70,78,86,0.5)" : "rgba(255,255,255,0.55)";
    const cOff = (-this.cam.x * this.ppm * 0.01) % (W * 1.5);
    for (let i = 0; i < 6; i++) {
      const cx = ((i * 0.27 * W * 1.5 + cOff) % (W * 1.5) + W * 1.5) % (W * 1.5) - W * 0.25;
      const cy = H * (0.08 + (i % 3) * 0.06);
      for (let j = 0; j < 4; j++) {
        ctx.beginPath(); ctx.ellipse(cx + j * W * 0.03, cy + (j % 2) * 4, W * 0.05, H * 0.022, 0, 0, TAU); ctx.fill();
      }
    }
    // cordillera
    this.drawRange(this.mountFar, horizon - H * 0.02, H * 0.2, 0.012, rain ? "#7d8791" : "#8ea2b8", true);
    this.drawRange(this.mountNear, horizon + H * 0.005, H * 0.09, 0.03, rain ? "#59636a" : "#5f7486", false);
    // bruma
    const mg = ctx.createLinearGradient(0, horizon - H * 0.08, 0, horizon);
    mg.addColorStop(0, "rgba(233,226,207,0)"); mg.addColorStop(1, rain ? "rgba(150,158,162,0.7)" : "rgba(233,226,207,0.65)");
    ctx.fillStyle = mg; ctx.fillRect(-W, horizon - H * 0.08, W * 3, H * 0.08);
    // árboles
    const period = W * 2.2;
    const off = -this.cam.x * this.ppm * 0.14;
    ctx.fillStyle = rain ? "#2b3a2c" : "#2f4a2a";
    for (const tr of this.trees) {
      let x = ((tr.x * period + off) % period + period) % period - W * 0.6;
      const r = H * 0.028 * tr.r;
      for (let rep = 0; rep < 2; rep++, x += period) {
        if (x < -W * 0.7 || x > W * 1.7) continue;
        ctx.beginPath();
        ctx.ellipse(x, horizon - r * tr.h * 0.6, r * 0.8, r * (0.8 + tr.h), 0, 0, TAU);
        ctx.fill();
      }
    }
    // césped interior
    const ig = ctx.createLinearGradient(0, horizon, 0, this.railY);
    ig.addColorStop(0, rain ? "#3e5537" : "#4f7a3a"); ig.addColorStop(1, rain ? "#4a6340" : "#6a9a4a");
    ctx.fillStyle = ig; ctx.fillRect(-W, horizon, W * 3, this.railY - horizon + 1);
    // seto interior
    ctx.fillStyle = rain ? "#2c3f2a" : "#37552f";
    ctx.fillRect(-W, this.railY - H * 0.045, W * 3, H * 0.022);
  }

  drawRange(pts, base, height, par, color, snow) {
    const { ctx, W } = this;
    const period = W * 2.6;
    const off = ((-this.cam.x * this.ppm * par) % period + period) % period;
    const draw = (fill) => {
      ctx.beginPath();
      ctx.moveTo(off - period - W, base + 2);
      for (let rep = -1; rep <= 1; rep++) {
        pts.forEach((p, i) => ctx.lineTo(off + rep * period + (i / (pts.length - 1)) * period - W * 0.5, base + p * height));
      }
      ctx.lineTo(off + period * 2, base + 2); ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
    };
    draw(color);
    if (snow) {
      ctx.save();
      ctx.beginPath(); ctx.rect(-W, base - height * 2, W * 3, height * 1.42); ctx.clip();
      draw("rgba(248,250,252,0.92)");
      ctx.restore();
    }
  }

  quad(x0, x1, d0, d1) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(this.sx(x0, d0), this.groundY(d0));
    ctx.lineTo(this.sx(x1, d0), this.groundY(d0));
    ctx.lineTo(this.sx(x1, d1), this.groundY(d1));
    ctx.lineTo(this.sx(x0, d1), this.groundY(d1));
    ctx.closePath();
  }

  drawTrack(rain) {
    const { ctx, W, H } = this;
    const top = this.groundY(-0.22);
    const g = ctx.createLinearGradient(0, top, 0, H * 1.3);
    if (rain) { g.addColorStop(0, "#4f5a34"); g.addColorStop(1, "#3a4426"); }
    else { g.addColorStop(0, "#6f9c45"); g.addColorStop(1, "#4d7c2f"); }
    ctx.fillStyle = g; ctx.fillRect(-W, top, W * 3, H * 1.5);
    // franjas de corte de pasto
    const step = 7;
    const visL = this.cam.x - W / (this.ppm * 0.5), visR = this.cam.x + W / (this.ppm * 0.5);
    ctx.fillStyle = rain ? "rgba(30,26,12,0.12)" : "rgba(255,255,220,0.07)";
    for (let x = Math.floor(visL / (step * 2)) * step * 2; x < visR; x += step * 2) {
      this.quad(x, x + step, -0.22, 1.6); ctx.fill();
    }
    // huellas / desgaste cerca de la baranda
    ctx.fillStyle = rain ? "rgba(60,40,20,0.25)" : "rgba(120,100,60,0.12)";
    ctx.fillRect(-W, top, W * 3, (this.groundY(0.02) - top));
  }

  drawRailAndPoles() {
    const { ctx, W } = this;
    const d = -0.2;
    const s = this.depthScale(d), k = this.ppm * s, gy = this.groundY(d);
    const visL = this.cam.x - W / (this.ppm * 0.45) - 10, visR = this.cam.x + W / (this.ppm * 0.45) + 10;
    // baranda
    ctx.strokeStyle = "#f4f2ea"; ctx.lineWidth = Math.max(1.5, k * 0.09);
    ctx.beginPath(); ctx.moveTo(this.sx(visL, d), gy - k * 1.05); ctx.lineTo(this.sx(visR, d), gy - k * 1.05); ctx.stroke();
    ctx.lineWidth = Math.max(1, k * 0.05);
    for (let x = Math.floor(visL / 2.5) * 2.5; x < visR; x += 2.5) {
      const X = this.sx(x, d);
      ctx.beginPath(); ctx.moveTo(X, gy); ctx.lineTo(X + k * 0.15, gy - k * 1.05); ctx.stroke();
    }
    // postes de distancia (metros que faltan)
    for (let x = Math.ceil(visL / 100) * 100; x < visR; x += 100) {
      if (x <= 0 || x >= DISTANCE) continue;
      const X = this.sx(x, d);
      const rem = DISTANCE - x;
      ctx.fillStyle = "#f4f2ea"; ctx.fillRect(X - k * 0.06, gy - k * 2.6, k * 0.12, k * 2.6);
      ctx.fillStyle = rem <= 200 ? "#b3201f" : "#1d3a6b";
      ctx.fillRect(X - k * 0.45, gy - k * 3.25, k * 0.9, k * 0.7);
      ctx.fillStyle = "#fff"; ctx.font = `bold ${Math.round(k * 0.45)}px Georgia, serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(rem), X, gy - k * 2.9);
    }
    // disco de meta
    if (DISTANCE > visL && DISTANCE < visR) {
      const X = this.sx(DISTANCE, d);
      ctx.fillStyle = "#f4f2ea"; ctx.fillRect(X - k * 0.08, gy - k * 4.2, k * 0.16, k * 4.2);
      ctx.beginPath(); ctx.arc(X, gy - k * 4.3, k * 0.55, 0, TAU);
      ctx.fillStyle = "#b3201f"; ctx.fill();
      ctx.beginPath(); ctx.arc(X, gy - k * 4.3, k * 0.32, 0, TAU);
      ctx.fillStyle = "#f4f2ea"; ctx.fill();
      ctx.fillStyle = "#b3201f"; ctx.font = `bold ${Math.round(k * 0.28)}px Georgia, serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("META", X, gy - k * 4.3);
    }
  }

  drawFinishLine(photo) {
    const { ctx } = this;
    ctx.fillStyle = photo ? "rgba(255,255,255,0.95)" : "rgba(250,250,245,0.85)";
    this.quad(DISTANCE - 0.12, DISTANCE + 0.12, -0.2, 1.6); ctx.fill();
  }

  drawGateLane(d, open, t) {
    const x = -0.35;
    if (open && t > 4) return;
    const { ctx } = this;
    const s = this.depthScale(d), k = this.ppm * s;
    const X = this.sx(x, d), Y = this.groundY(d);
    if (X < -200 || X > this.W + 200) return;
    ctx.save();
    ctx.globalAlpha = open ? Math.max(0, 1 - t / 4) : 1;
    // marco del partidor
    ctx.fillStyle = "#2f5d3a";
    ctx.fillRect(X - k * 3.2, Y - k * 3.0, k * 0.16, k * 3.0);
    ctx.fillRect(X - k * 0.05, Y - k * 3.0, k * 0.16, k * 3.0);
    ctx.fillRect(X - k * 3.2, Y - k * 3.05, k * 3.4, k * 0.22);
    // puerta
    if (!open) {
      ctx.fillStyle = "#3b7448";
      ctx.fillRect(X + k * 0.05, Y - k * 1.9, k * 0.12, k * 1.5);
      ctx.strokeStyle = "#d9d4c2"; ctx.lineWidth = Math.max(1, k * 0.03);
      ctx.strokeRect(X + k * 0.05, Y - k * 1.9, k * 0.12, k * 1.5);
    } else {
      ctx.fillStyle = "#3b7448";
      ctx.fillRect(X + k * 0.05, Y - k * 1.9, k * 0.7, k * 0.08);
    }
    ctx.restore();
  }

  drawParticles() {
    const { ctx } = this;
    for (const p of this.particles) {
      const s = this.depthScale(p.d), k = this.ppm * s;
      ctx.globalAlpha = Math.min(1, p.life);
      ctx.fillStyle = p.c;
      ctx.fillRect(this.sx(p.x, p.d), this.groundY(p.d) + p.y * k, p.s * k, p.s * k);
    }
    ctx.globalAlpha = 1;
  }

  drawRain(dt) {
    const { ctx, W, H } = this;
    ctx.strokeStyle = "rgba(210,220,230,0.35)"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const r of this.rainDrops) {
      r.y += r.v * dt; r.x -= r.v * dt * 0.25;
      if (r.y > H) { r.y = -20; r.x = Math.random() * W * 1.2; }
      ctx.moveTo(r.x, r.y); ctx.lineTo(r.x + 4, r.y - 16);
    }
    ctx.stroke();
    ctx.fillStyle = "rgba(60,70,80,0.12)"; ctx.fillRect(0, 0, W, H);
  }

  drawPhotoOverlay() {
    const { ctx, W, H } = this;
    // blanco y negro en una sola pasada
    ctx.save();
    ctx.globalCompositeOperation = "saturation";
    ctx.fillStyle = "#888"; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "soft-light";
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // plano vertical de la meta (en perspectiva) en rojo
    ctx.save();
    this.applyCam(ctx);
    const d0 = -0.2, d1 = 1.6, hgt = 3.2;
    const k0 = this.ppm * this.depthScale(d0), k1 = this.ppm * this.depthScale(d1);
    const x0 = this.sx(DISTANCE, d0), x1 = this.sx(DISTANCE, d1);
    const y0 = this.groundY(d0), y1 = this.groundY(d1);
    ctx.fillStyle = "rgba(220,30,30,0.10)";
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y0 - hgt * k0); ctx.lineTo(x1, y1 - hgt * k1); ctx.lineTo(x1, y1); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(230,30,30,0.95)"; ctx.lineWidth = 2 / this.cam.z;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    for (const d of [0, 0.25, 0.5, 0.75, 1]) {
      const x = this.sx(DISTANCE, d), y = this.groundY(d), k = this.ppm * this.depthScale(d);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - hgt * k); ctx.stroke();
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, W - 6, H - 6);
  }

  drawVignette() {
    const { ctx, W, H } = this;
    const g = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.8);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.28)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  drawMiniMap(t) {
    const { ctx, W } = this;
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
