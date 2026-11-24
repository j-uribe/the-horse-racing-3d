// Graba la llegada como video: compone la escena 3D, la capa 2D y una franja
// con el relato en un canvas propio, y lo captura con MediaRecorder.
const W = 1280, H = 720, FPS = 30;

function pickType() {
  if (typeof MediaRecorder === "undefined") return null;
  const types = [
    ["video/mp4;codecs=avc1.42E01F,mp4a.40.2", "mp4"],
    ["video/mp4", "mp4"],
    ["video/webm;codecs=vp9,opus", "webm"],
    ["video/webm;codecs=vp8,opus", "webm"],
    ["video/webm", "webm"],
  ];
  return types.find(([t]) => MediaRecorder.isTypeSupported(t)) || null;
}

export class Recorder {
  constructor() {
    this.type = pickType();
    this.supported = !!this.type && !!HTMLCanvasElement.prototype.captureStream;
    this.canvas = document.createElement("canvas");
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d");
    this.rec = null;
    this.blob = null;
  }

  get recording() { return !!this.rec; }
  get ext() { return this.type ? this.type[1] : "webm"; }

  start(audioStream) {
    if (!this.supported || this.rec) return;
    this.blob = null;
    const stream = this.canvas.captureStream(FPS);
    if (audioStream) for (const tr of audioStream.getAudioTracks()) stream.addTrack(tr);
    const chunks = [];
    try {
      this.rec = new MediaRecorder(stream, { mimeType: this.type[0], videoBitsPerSecond: 6_000_000 });
    } catch {
      this.rec = new MediaRecorder(stream);
    }
    this.rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    this.done = new Promise((res) => {
      this.rec.onstop = () => {
        this.blob = new Blob(chunks, { type: this.rec?.mimeType || this.type[0] });
        this.rec = null;
        res(this.blob);
      };
    });
    this.rec.start(250);
  }

  stop() {
    if (this.rec && this.rec.state !== "inactive") this.rec.stop();
    return this.done;
  }

  cancel() {
    if (this.rec) { this.rec.onstop = () => { this.rec = null; }; if (this.rec.state !== "inactive") this.rec.stop(); }
    this.blob = null;
  }

  /** Se llama justo después de renderizar, en el mismo cuadro. hud: { ticker, dist, label } */
  capture(gl, overlay, hud) {
    if (!this.rec) return;
    const c = this.ctx;
    // encuadre 16:9 recortando lo que sobre
    const sw = gl.width, sh = gl.height, ar = W / H;
    let cw = sw, ch = sw / ar;
    if (ch > sh) { ch = sh; cw = sh * ar; }
    const sx = (sw - cw) / 2, sy = (sh - ch) / 2;
    c.filter = gl.style.filter || "none";
    c.drawImage(gl, sx, sy, cw, ch, 0, 0, W, H);
    c.filter = "none";
    const ox = sx * (overlay.width / sw), oy = sy * (overlay.height / sh);
    c.drawImage(overlay, ox, oy, cw * (overlay.width / sw), ch * (overlay.height / sh), 0, 0, W, H);

    // franja inferior con el relato
    c.fillStyle = "rgba(10,25,18,0.9)"; c.fillRect(0, H - 64, W, 64);
    c.fillStyle = "#c9a54b"; c.fillRect(0, H - 64, W, 3);
    c.fillStyle = "#7b1e2b"; c.fillRect(0, H - 61, 120, 61);
    c.fillStyle = "#fff"; c.font = "700 16px system-ui, sans-serif"; c.textBaseline = "middle"; c.textAlign = "center";
    c.fillText(hud.label || "EN VIVO", 60, H - 31);
    c.textAlign = "left"; c.fillStyle = "#f5efe0"; c.font = "26px Georgia, serif";
    c.fillText(hud.ticker || "", 140, H - 31, W - 170);
    // distancia y marca
    if (hud.dist) {
      c.fillStyle = "rgba(10,25,18,0.8)"; c.fillRect(20, 20, 210, 50);
      c.fillStyle = "#c9a54b"; c.fillRect(20, 20, 4, 50);
      c.fillStyle = "#f5efe0"; c.font = "600 26px Georgia, serif"; c.fillText(hud.dist, 36, 46);
    }
    c.textAlign = "right"; c.fillStyle = "rgba(245,239,224,0.85)"; c.font = "600 18px Georgia, serif";
    c.fillText("The Horse Racing 3D", W - 24, H - 88);
  }
}
