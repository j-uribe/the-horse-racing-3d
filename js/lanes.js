// Trayectoria lateral de cada caballo: se cierran hacia la baranda, abren por
// fuera para adelantar y no se montan sobre otro. Es solo escenificación: se
// calcula a partir de posAt, así que no cambia el orden de llegada, y es
// determinista, así que una carrera compartida se ve igual.
import { posAt, speedAt } from "./race.js";
import { laneOffset } from "./track.js";

const DT = 0.05;
const BODY = 3.0; // largo que ocupa un caballo, con margen
const GAP = 1.25; // separación lateral mínima entre caballos que van a la par
const LATERAL_SPEED = 0.75; // m/s
const HOLD_GATE = 1.4; // segundos en su carril tras la largada

export function planLanes(race) {
  const n = race.n;
  const steps = Math.ceil((race.endT + 6) / DT) + 1;
  const rail = laneOffset(0), wide = laneOffset(11) + 0.6;
  const cur = race.horses.map((h) => laneOffset(h.lane));
  const lanes = race.horses.map(() => new Float32Array(steps));
  const xs = new Float64Array(n), vs = new Float64Array(n);

  for (let k = 0; k < steps; k++) {
    const t = k * DT;
    for (let i = 0; i < n; i++) { xs[i] = posAt(race.horses[i], t); vs[i] = speedAt(race.horses[i], t); }

    if (t > HOLD_GATE) {
      for (let i = 0; i < n; i++) {
        const h = race.horses[i];
        const out = h.collapse && t > h.collapse.t;
        let target = out ? Math.min(wide, cur[i] + 3) : rail;
        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const dx = xs[j] - xs[i];
          const dl = cur[j] - cur[i];
          // alguien adelante en mi línea y más lento: abrirse por fuera
          if (dx > -0.5 && dx < 6 && Math.abs(dl) < GAP && vs[i] > vs[j] - 0.4) target = Math.max(target, cur[j] + GAP + 0.15);
          // no cerrarse sobre quien va a la par o recién superado
          if (dl < 0 && -dl < GAP + 0.3 && dx > -BODY - 1.5 && dx < 7) target = Math.max(target, cur[i]);
        }
        const step = LATERAL_SPEED * DT;
        cur[i] += Math.max(-step, Math.min(step, target - cur[i]));
      }
      // separar a los que quedaron encimados
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            if (Math.abs(xs[i] - xs[j]) > BODY) continue;
            const d = cur[j] - cur[i];
            if (Math.abs(d) >= GAP) continue;
            const push = Math.min(0.06, (GAP - Math.abs(d)) / 2) * (d >= 0 ? 1 : -1);
            cur[i] -= push; cur[j] += push;
          }
        }
        for (let i = 0; i < n; i++) cur[i] = Math.max(rail, Math.min(wide, cur[i]));
      }
    }
    for (let i = 0; i < n; i++) lanes[i][k] = cur[i];
  }

  return {
    at(i, t) {
      const f = Math.max(0, t) / DT;
      const k = Math.min(steps - 2, Math.floor(f));
      const a = lanes[i][k], b = lanes[i][k + 1];
      return a + (b - a) * Math.min(1, f - k);
    },
    // velocidad lateral (m/s) para inclinar al caballo cuando cambia de línea
    drift(i, t) {
      const k = Math.min(steps - 2, Math.max(0, Math.floor(t / DT)));
      return (lanes[i][k + 1] - lanes[i][k]) / DT;
    },
  };
}
