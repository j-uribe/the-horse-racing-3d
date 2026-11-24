// Sonido sintetizado con Web Audio (sin archivos externos).
export class Sound {
  constructor() { this.ctx = null; this.muted = false; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; }
    this.noise = buf;

    // público
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 650; bp.Q.value = 0.5;
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0;
    src.connect(bp).connect(this.crowdGain).connect(this.master);
    src.start();
  }

  // pista de audio para grabar la llegada en video
  stream() {
    if (!this.ctx || !this.ctx.createMediaStreamDestination) return null;
    if (!this.dest) { this.dest = this.ctx.createMediaStreamDestination(); this.master.connect(this.dest); }
    return this.dest.stream;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  crowd(level) {
    if (!this.ctx) return;
    this.crowdGain.gain.setTargetAtTime(0.02 + level * 0.35, this.ctx.currentTime, 0.4);
  }

  bell() {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    for (let k = 0; k < 9; k++) {
      const t = t0 + k * 0.11;
      for (const [f, a] of [[1480, 0.12], [2960, 0.05], [4100, 0.03]]) {
        const o = ctx.createOscillator(); o.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(a, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
        o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.3);
      }
    }
  }

  hoof(vol = 0.5) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noise;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 260 + Math.random() * 120;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol * 0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    s.connect(lp).connect(g).connect(this.master);
    s.start(t, Math.random() * 1.5, 0.1);
  }

  shutter() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const dt of [0, 0.07]) {
      const s = ctx.createBufferSource(); s.buffer = this.noise;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.5, t + dt); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.04);
      s.connect(hp).connect(g).connect(this.master);
      s.start(t + dt, Math.random(), 0.05);
    }
  }

  fanfare() {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime + 0.05;
    const notes = [[523, 0], [659, 0.14], [784, 0.28], [1047, 0.42]];
    for (const [f, dt] of notes) {
      const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2200;
      const g = ctx.createGain();
      const t = t0 + dt, dur = dt === 0.42 ? 0.7 : 0.16;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(lp).connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    }
  }
}

// Relato por voz (Web Speech API), opcional.
export class Voice {
  constructor() {
    this.enabled = false;
    this.voice = null;
    this.ok = "speechSynthesis" in window;
    if (this.ok) {
      const choose = () => {
        const vs = speechSynthesis.getVoices();
        this.voice = vs.find((v) => /es[-_]CL/i.test(v.lang)) || vs.find((v) => /es[-_](419|MX|US|AR)/i.test(v.lang)) || vs.find((v) => /^es/i.test(v.lang)) || null;
      };
      choose();
      speechSynthesis.onvoiceschanged = choose;
    }
  }
  say(text, pri) {
    if (!this.ok || !this.enabled) return;
    if (speechSynthesis.speaking) {
      if (pri < 2) return;
      speechSynthesis.cancel();
    }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = this.voice?.lang || "es-CL";
    if (this.voice) u.voice = this.voice;
    u.rate = 1.15; u.pitch = 1.0;
    speechSynthesis.speak(u);
  }
  stop() { if (this.ok) speechSynthesis.cancel(); }
}
