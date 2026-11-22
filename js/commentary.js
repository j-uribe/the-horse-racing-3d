import { DISTANCE, LENGTH_M, posAt } from "./race.js";

const pick = (a) => a[Math.floor(Math.random() * a.length)];

function bodies(m) {
  const L = m / LENGTH_M;
  if (L < 0.3) return "apenas una cabeza";
  if (L < 0.75) return "medio cuerpo";
  if (L < 1.25) return "un cuerpo";
  const h = Math.round(L * 2) / 2;
  return `${Number.isInteger(h) ? h : Math.floor(h) + " y medio"} cuerpos`;
}

// Relator: observa la carrera y emite frases con prioridad.
export class Commentator {
  constructor(race) {
    this.race = race;
    this.leader = null;
    this.leaderSince = 0;
    this.lastLeadCall = -10;
    this.milestones = new Set();
    this.events = new Set();
    this.rankHist = [];
    this.lastHist = -1;
    this.lastCharge = {};
    this.lastAny = 0;
  }

  name(h) { return h.name; }

  pre() {
    const r = this.race;
    const lines = [pick([
      "Los ejemplares ya están en los partidores.",
      "Todo listo en las gateras. Ingresa el último ejemplar.",
      "Los competidores se acomodan en los partidores.",
    ])];
    if (r.rain) lines.push("Pista pesada tras la lluvia de la tarde.");
    return lines;
  }

  update(t) {
    const r = this.race;
    const out = [];
    const say = (text, pri = 1) => { out.push({ text, pri }); this.lastAny = t; };
    const alive = r.horses.filter((h) => !(h.collapse && t > h.collapse.t));
    const sorted = alive.map((h) => ({ h, x: posAt(h, t) })).sort((a, b) => b.x - a.x);
    const lead = sorted[0];
    const remaining = DISTANCE - lead.x;
    const winnerT = r.horses[r.order[0]].finishT;
    if (t >= winnerT) return out;

    // largada
    if (!this.events.has("start") && t > 0.05) {
      this.events.add("start");
      say(pick(["¡Largaron!", "¡Y largaron!", "¡Se abren los partidores, largaron!"]), 3);
    }
    if (r.events.slowHorse >= 0 && !this.events.has("slow") && t > 0.9) {
      this.events.add("slow");
      say(`Salió lento ${r.horses[r.events.slowHorse].name}, queda atrás en los primeros metros.`, 2);
    }
    const bolt = r.horses.find((h) => h.bolter);
    if (bolt && !this.events.has("bolt") && t > r.duration * 0.09) {
      this.events.add("bolt");
      say(`¡${bolt.name} sale disparado! Imprime un ritmo durísimo adelante.`, 2);
    }

    // primera mención del puntero
    if (!this.events.has("first") && t > r.duration * 0.13) {
      this.events.add("first");
      const [a, b, c] = sorted;
      say(`${a.h.name} toma la punta, ${b ? `seguido por ${b.h.name}` : ""}${c ? ` y ${c.h.name}` : ""}.`, 2);
      this.leader = a.h.idx; this.lastLeadCall = t;
    }

    // cambio de puntero
    if (this.events.has("first")) {
      if (lead.h.idx !== this.leader) {
        if (this.pending !== lead.h.idx) { this.pending = lead.h.idx; this.leaderSince = t; }
        if (t - this.leaderSince > 0.45 && t - this.lastLeadCall > 1.8 && remaining > 25) {
          const prev = r.horses[this.leader];
          say(pick([
            `¡${lead.h.name} supera a ${prev.name} y pasa a comandar!`,
            `Cambio en la punta: ahora manda ${lead.h.name}.`,
            `¡${lead.h.name} se pone adelante!`,
          ]), 2);
          this.leader = lead.h.idx; this.lastLeadCall = t;
        }
      } else this.pending = null;
    }

    // hitos de distancia
    const ms = [
      [800, () => `Pasan los primeros 200 metros. ${lead.h.name} adelante.`],
      [500, () => {
        const b = sorted[1];
        return b ? `Mitad de carrera: ${lead.h.name} aventaja por ${bodies(lead.x - b.x)} a ${b.h.name}.` : "Mitad de carrera.";
      }],
      [320, () => "¡Entran a la recta final!"],
      [200, () => {
        const b = sorted[1];
        return b && lead.x - b.x < 3 ? `¡Doscientos metros! ${lead.h.name} y ${b.h.name} luchan palmo a palmo.` : `¡Doscientos metros! ${lead.h.name} sigue mandando.`;
      }],
      [90, () => {
        const b = sorted[1];
        return b && lead.x - b.x < 1.2 ? "¡Últimos cien metros, vienen pegados!" : "¡Últimos cien metros!";
      }],
    ];
    for (const [m, f] of ms) {
      if (remaining <= m && !this.milestones.has(m) && t > 1) {
        this.milestones.add(m);
        say(f(), m <= 200 ? 3 : 1);
        break;
      }
    }

    // historial de posiciones para detectar atropelladas
    if (t - this.lastHist >= 0.5) {
      this.lastHist = t;
      const ranks = {};
      sorted.forEach((s, i) => (ranks[s.h.idx] = i));
      this.rankHist.push({ t, ranks });
      if (this.rankHist.length > 10) this.rankHist.shift();
      const old = this.rankHist.find((e) => t - e.t >= 2.8 && t - e.t <= 3.6);
      if (old && remaining < 600 && remaining > 40) {
        for (const s of sorted.slice(0, 3)) {
          const before = old.ranks[s.h.idx];
          const now = ranks[s.h.idx];
          if (before != null && before - now >= 2 && (this.lastCharge[s.h.idx] ?? -99) < t - 6) {
            this.lastCharge[s.h.idx] = t;
            say(pick([
              `¡${s.h.name} viene atropellando por fuera!`,
              `¡Atención a ${s.h.name}, que avanza con todo!`,
              `¡${s.h.name} remonta posiciones!`,
            ]), 2);
            break;
          }
        }
      }
    }

    // incidentes
    const st = r.events.stumbleHorse;
    if (st >= 0 && !this.events.has("stumble") && t > r.horses[st].stumbleT + 0.1) {
      this.events.add("stumble");
      say(`¡Trastabilla ${r.horses[st].name}! Pierde terreno.`, 3);
    }
    const ch = r.events.collapseHorse;
    if (ch >= 0 && !this.events.has("collapse") && t > r.horses[ch].collapse.t + 0.35) {
      this.events.add("collapse");
      say(`¡Atención! ${r.horses[ch].name} se detiene de golpe en la recta… sufrió un colapso.`, 3);
    }

    // relleno: quién cierra
    if (t - this.lastAny > 4.5 && remaining > 350 && sorted.length > 3) {
      const last = sorted[sorted.length - 1];
      say(pick([
        `Cierra el lote ${last.h.name}.`,
        `${sorted[1].h.name} se mantiene expectante en el segundo lugar.`,
        `${sorted[2].h.name} corre tercero, a la espera.`,
      ]), 0);
    }
    return out;
  }
}
