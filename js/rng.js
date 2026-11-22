// Generador pseudoaleatorio con semilla (mulberry32): la misma semilla
// reproduce exactamente la misma carrera.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Semilla nueva tomada del generador criptográfico del navegador.
export function newSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

// Fisher–Yates: cada permutación tiene la misma probabilidad.
export function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const range = (rnd, lo, hi) => lo + rnd() * (hi - lo);
export const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
