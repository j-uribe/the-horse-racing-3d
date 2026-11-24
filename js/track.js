// Geometría del óvalo. Todo se ubica en coordenadas de pista:
//   s   = metros recorridos desde el partidor (la meta está en s = DISTANCE)
//   off = distancia lateral desde la baranda interior (positivo hacia afuera)
// La carrera parte en la recta opuesta, toma la curva y termina en la recta
// principal, frente a la tribuna.
import { DISTANCE } from "./race.js";

export const R = 70; // radio de la baranda interior en las curvas
export const HOME_LEN = 320; // la recta final empieza 320 m antes de la meta
export const LANE = 1.5;
export const laneOffset = (lane) => 1.3 + lane * LANE;
export const RAIL_OUT = laneOffset(11) + 1.3;

const TURN = Math.PI * R;
const S_TURN1 = DISTANCE - HOME_LEN - TURN; // entrada a la curva final
const S_HOME = DISTANCE - HOME_LEN; // salida a la recta final
const X_HOME0 = -HOME_LEN; // la meta queda en x = 0
const X_END = 200; // fin de la recta principal
const S_TURN2 = S_HOME + (X_END - X_HOME0);
const X_START = X_HOME0 + S_TURN1; // el partidor, en la recta opuesta
const S_BACK2 = S_TURN2 + TURN;
export const LOOP = S_BACK2 + (X_END - X_START);
export const CENTER = { x: (X_HOME0 + X_END) / 2, z: -R };

const wrap = (s) => ((s % LOOP) + LOOP) % LOOP;

/** Punto de la baranda interior en s: posición, dirección de avance y normal hacia afuera. */
export function railFrame(s) {
  s = wrap(s);
  if (s < S_TURN1) {
    return { x: X_START - s, z: -2 * R, hx: -1, hz: 0, nx: 0, nz: -1 };
  }
  if (s < S_HOME) {
    const f = (s - S_TURN1) / R;
    const sx = -Math.sin(f), sz = -Math.cos(f);
    return { x: X_HOME0 + R * sx, z: -R + R * sz, hx: -Math.cos(f), hz: Math.sin(f), nx: sx, nz: sz };
  }
  if (s < S_TURN2) {
    return { x: X_HOME0 + (s - S_HOME), z: 0, hx: 1, hz: 0, nx: 0, nz: 1 };
  }
  if (s < S_BACK2) {
    const f = (s - S_TURN2) / R;
    const sx = Math.sin(f), sz = Math.cos(f);
    return { x: X_END + R * sx, z: -R + R * sz, hx: Math.cos(f), hz: -Math.sin(f), nx: sx, nz: sz };
  }
  return { x: X_END - (s - S_BACK2), z: -2 * R, hx: -1, hz: 0, nx: 0, nz: -1 };
}

/** Posición en el mundo para (s, off). */
export function trackXZ(s, off) {
  const f = railFrame(s);
  return { x: f.x + f.nx * off, z: f.z + f.nz * off };
}

/** Ángulo para rotation.y de un objeto cuyo +x local mira hacia el avance y +z local hacia afuera. */
export function headingAngle(s) {
  const f = railFrame(s);
  return Math.atan2(-f.hz, f.hx);
}

export const isTurn = (s) => {
  s = wrap(s);
  return (s >= S_TURN1 && s < S_HOME) || (s >= S_TURN2 && s < S_BACK2);
};
