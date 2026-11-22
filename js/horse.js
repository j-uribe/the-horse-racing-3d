// Dibujo procedural de un caballo de carrera con jinete.
// Coordenadas locales en metros: x hacia adelante, y hacia abajo, suelo en y = 0.
// La nariz del caballo queda en x ≈ 0 (el contexto llega trasladado a la nariz).
const TAU = Math.PI * 2;
const NOSE = 1.9;

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (f < 0) { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  else { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// Pierna de dos segmentos. p: fase (0..1), run: 0 parado … 1 galope.
function leg(ctx, hx, hy, p, front, run, color, hoof) {
  const l1 = 0.6, l2 = 0.66;
  const s = Math.sin(TAU * p), c = Math.cos(TAU * p);
  const a = front ? run * (0.62 * s + 0.12) : run * (0.55 * s - 0.08) + (1 - run) * 0.08;
  const b = front
    ? run * (1.05 * Math.max(0, c) + 0.12)
    : run * (0.95 * Math.max(0, -c) + 0.2) + (1 - run) * 0.22;
  const kx = hx + l1 * Math.sin(a), ky = hy + l1 * Math.cos(a);
  const a2 = front ? a - b : a + b;
  const fx = kx + l2 * Math.sin(a2), fy = Math.min(0, ky + l2 * Math.cos(a2));
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineWidth = front ? 0.17 : 0.22;
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.stroke();
  ctx.lineWidth = 0.095;
  ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
  ctx.fillStyle = hoof;
  ctx.beginPath(); ctx.ellipse(fx + 0.02, fy - 0.03, 0.07, 0.05, a2, 0, TAU); ctx.fill();
  return { x: fx, y: fy };
}

function jacketPattern(ctx, silks) {
  // Se dibuja con el clip del torso ya activo
  const alt = silks.sleeves;
  ctx.fillStyle = alt;
  switch (silks.pattern) {
    case "hoops":
      for (let i = -3; i < 4; i++) {
        ctx.save(); ctx.translate(0.21, -1.93); ctx.rotate(-0.65);
        ctx.fillRect(-0.4, i * 0.1 - 0.025, 0.8, 0.05); ctx.restore();
      }
      break;
    case "sash":
      ctx.beginPath(); ctx.moveTo(0.02, -1.95); ctx.lineTo(0.1, -2.02); ctx.lineTo(0.42, -1.87); ctx.lineTo(0.36, -1.8); ctx.fill();
      break;
    case "halves":
      ctx.beginPath(); ctx.moveTo(0.21, -2.3); ctx.lineTo(0.7, -2.0); ctx.lineTo(0.3, -1.6); ctx.lineTo(-0.1, -1.9); ctx.fill();
      break;
    case "stars":
      for (const [x, y] of [[0.12, -1.86], [0.3, -1.97], [0.26, -1.82]]) {
        ctx.beginPath(); ctx.arc(x, y, 0.035, 0, TAU); ctx.fill();
      }
      break;
    case "band":
      ctx.save(); ctx.translate(0.21, -1.93); ctx.rotate(-0.65);
      ctx.fillRect(-0.4, -0.04, 0.8, 0.08); ctx.restore();
      break;
  }
}

/**
 * h: { phase, run (0..1), coat, silks, cloth, num, pitch, headDrop, alpha, slump }
 */
export function drawHorse(ctx, h) {
  const p = h.phase, run = h.run;
  const bob = run * 0.07 * Math.sin(TAU * p + 0.6);
  const pitch = (h.pitch || 0) + run * 0.035 * Math.sin(TAU * p + 1.4);
  const coat = h.coat;
  const farLeg = shade(coat.leg, -0.35), nearLeg = coat.leg, hoof = "#141110";

  ctx.save();
  ctx.translate(-NOSE, 0);

  // sombra
  ctx.fillStyle = "rgba(10,20,8,0.28)";
  ctx.beginPath(); ctx.ellipse(0.15, 0.02, 1.25, 0.11, 0, 0, TAU); ctx.fill();

  ctx.translate(0, bob);
  ctx.translate(0, -1.3); ctx.rotate(pitch); ctx.translate(0, 1.3);

  // patas lejanas
  leg(ctx, 0.6, -1.2, p + 0.36, true, run, farLeg, hoof);
  leg(ctx, -0.6, -1.25, p + 0.02, false, run, farLeg, hoof);

  // cola
  const tw = Math.sin(TAU * p * 1 + 2) * 0.08 * run;
  ctx.strokeStyle = coat.mane; ctx.lineCap = "round"; ctx.lineWidth = 0.16;
  ctx.beginPath(); ctx.moveTo(-0.95, -1.44);
  ctx.bezierCurveTo(-1.25, -1.5 + tw, -1.45, -1.32 + tw, -1.62 + run * -0.1, -1.05 + run * -0.12 + tw);
  ctx.stroke();
  ctx.lineWidth = 0.08;
  ctx.beginPath(); ctx.moveTo(-1.0, -1.42);
  ctx.bezierCurveTo(-1.3, -1.42 + tw, -1.5, -1.2 + tw, -1.55, -0.95 + tw); ctx.stroke();

  // cuerpo
  ctx.fillStyle = coat.body;
  ctx.beginPath();
  ctx.moveTo(-0.95, -1.45);
  ctx.bezierCurveTo(-0.62, -1.7, 0.25, -1.63, 0.62, -1.6);
  ctx.bezierCurveTo(0.95, -1.55, 1.02, -1.24, 0.86, -1.05);
  ctx.bezierCurveTo(0.42, -0.94, -0.38, -0.98, -0.8, -1.04);
  ctx.bezierCurveTo(-1.08, -1.1, -1.12, -1.36, -0.95, -1.45);
  ctx.fill();
  // brillo
  ctx.fillStyle = "rgba(255,240,220,0.10)";
  ctx.beginPath(); ctx.ellipse(-0.1, -1.47, 0.7, 0.13, -0.03, 0, TAU); ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.beginPath(); ctx.ellipse(0.0, -1.06, 0.75, 0.08, 0, 0, TAU); ctx.fill();

  // cuello y cabeza
  const nod = run * 0.07 * Math.sin(TAU * p + 2.2) + (h.headDrop || 0);
  ctx.save();
  ctx.translate(0.75, -1.5); ctx.rotate(nod); ctx.translate(-0.75, 1.5);
  ctx.fillStyle = coat.body;
  ctx.beginPath();
  ctx.moveTo(0.48, -1.62);
  ctx.quadraticCurveTo(0.86, -1.98, 1.16, -2.07);
  ctx.lineTo(1.32, -2.1);
  ctx.lineTo(1.86, -1.74);
  ctx.quadraticCurveTo(1.94, -1.63, 1.84, -1.57);
  ctx.lineTo(1.46, -1.68);
  ctx.quadraticCurveTo(1.25, -1.62, 1.1, -1.46);
  ctx.quadraticCurveTo(1.0, -1.25, 0.86, -1.12);
  ctx.closePath(); ctx.fill();
  // oreja, ojo, ollar, crin
  ctx.beginPath(); ctx.moveTo(1.2, -2.07); ctx.lineTo(1.17, -2.24); ctx.lineTo(1.3, -2.1); ctx.fill();
  ctx.fillStyle = "#0b0807";
  ctx.beginPath(); ctx.arc(1.42, -1.98, 0.035, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(1.83, -1.65, 0.022, 0, TAU); ctx.fill();
  ctx.strokeStyle = coat.mane; ctx.lineWidth = 0.07;
  ctx.beginPath(); ctx.moveTo(0.55, -1.66); ctx.quadraticCurveTo(0.88, -2.0, 1.2, -2.09); ctx.stroke();
  // anteojeras / brida
  ctx.strokeStyle = "#1a1412"; ctx.lineWidth = 0.035;
  ctx.beginPath(); ctx.moveTo(1.3, -2.08); ctx.lineTo(1.5, -1.7); ctx.moveTo(1.38, -1.92); ctx.lineTo(1.8, -1.68); ctx.stroke();
  ctx.fillStyle = h.silks.cap;
  ctx.beginPath(); ctx.ellipse(1.43, -1.97, 0.07, 0.06, 0, 0, TAU); ctx.fill();
  ctx.restore();

  // mandil con número
  ctx.fillStyle = h.cloth[0];
  ctx.beginPath();
  ctx.moveTo(-0.3, -1.66); ctx.lineTo(0.34, -1.64); ctx.lineTo(0.38, -1.22); ctx.lineTo(-0.26, -1.24); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 0.02; ctx.stroke();
  ctx.fillStyle = h.cloth[1];
  ctx.save(); ctx.scale(0.01, 0.01);
  ctx.font = "bold 30px Georgia, serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(String(h.num), 5, -141);
  ctx.restore();
  // montura
  ctx.fillStyle = "#1c1410";
  ctx.beginPath(); ctx.ellipse(0.06, -1.67, 0.22, 0.05, 0, 0, TAU); ctx.fill();

  // patas cercanas
  leg(ctx, 0.62, -1.2, p + 0.46, true, run, nearLeg, hoof);
  leg(ctx, -0.58, -1.25, p + 0.12, false, run, nearLeg, hoof);

  // jinete
  const jb = run * 0.04 * Math.sin(TAU * p + 3.4);
  const pump = run * 0.06 * Math.sin(TAU * p);
  const slump = h.slump || 0;
  ctx.save();
  ctx.translate(0, jb);
  // pierna (pantalón blanco, bota negra)
  ctx.lineCap = "round";
  ctx.strokeStyle = "#ece8de"; ctx.lineWidth = 0.13;
  ctx.beginPath(); ctx.moveTo(0.0, -1.83); ctx.lineTo(0.36, -1.76); ctx.stroke();
  ctx.strokeStyle = "#111"; ctx.lineWidth = 0.1;
  ctx.beginPath(); ctx.moveTo(0.36, -1.76); ctx.lineTo(0.2, -1.55); ctx.stroke();
  // torso
  ctx.save();
  ctx.translate(0, slump * 0.15);
  const torso = new Path2D();
  torso.moveTo(-0.08, -1.82); torso.lineTo(0.0, -1.98);
  torso.quadraticCurveTo(0.25, -2.16, 0.48, -2.1);
  torso.lineTo(0.5, -1.98); torso.quadraticCurveTo(0.28, -1.86, 0.06, -1.76); torso.closePath();
  ctx.fillStyle = h.silks.jacket; ctx.fill(torso);
  ctx.save(); ctx.clip(torso); jacketPattern(ctx, h.silks); ctx.restore();
  // brazo
  ctx.strokeStyle = h.silks.sleeves; ctx.lineWidth = 0.085;
  ctx.beginPath(); ctx.moveTo(0.42, -2.06); ctx.lineTo(0.6 + pump * 0.4, -1.9); ctx.lineTo(0.86 + pump, -1.86 + pump * 0.3); ctx.stroke();
  // riendas
  ctx.strokeStyle = "rgba(20,14,10,0.8)"; ctx.lineWidth = 0.02;
  ctx.beginPath(); ctx.moveTo(0.88 + pump, -1.86); ctx.lineTo(1.6, -1.72 + (h.headDrop || 0) * 0.6); ctx.stroke();
  // cabeza / casco
  ctx.fillStyle = "#e2b996";
  ctx.beginPath(); ctx.arc(0.58, -2.15, 0.075, 0, TAU); ctx.fill();
  ctx.fillStyle = h.silks.cap;
  ctx.beginPath(); ctx.arc(0.55, -2.2, 0.1, Math.PI * 0.95, Math.PI * 2.2); ctx.fill();
  ctx.fillRect(0.6, -2.22, 0.12, 0.03);
  ctx.restore();
  ctx.restore();

  ctx.restore();
}

// Silueta mínima para el mini‑mapa / leyenda
export { shade };
