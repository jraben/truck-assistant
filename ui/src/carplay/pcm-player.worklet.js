// AudioWorklet: plays interleaved Int16 PCM posted to its port, through a ring
// buffer, resampled (linear) from the dongle's rate to the AudioContext's.
// Plain JS (loaded with audioWorklet.addModule, never bundled into the page).
/* global sampleRate, registerProcessor, AudioWorkletProcessor */

const PREBUFFER_S = 0.08;   // start (and restart after an underrun) once this much is queued
const MAX_LAG_S = 0.5;      // more queued than this: the dongle's clock ran ahead; skip to TARGET_S
const TARGET_S = 0.15;
const CAPACITY_S = 2;

class PcmPlayer extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.ch = o.channels === 1 ? 1 : 2;
    this.srcRate = o.sampleRate || 44100;
    this.step = this.srcRate / sampleRate;        // source frames per output frame
    this.cap = Math.ceil(this.srcRate * CAPACITY_S);   // in frames
    this.buf = new Float32Array(this.cap * this.ch);
    this.r = 0;            // read position, fractional frames
    this.w = 0;            // write position, whole frames (monotonic)
    this.playing = false;
    this.underruns = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d === 'flush') { this.r = this.w; this.playing = false; return; }
      if (d instanceof Int16Array) this.write(d);
    };
  }

  available() { return this.w - this.r; }

  write(pcm) {
    const ch = this.ch, frames = Math.floor(pcm.length / ch), cap = this.cap;
    for (let f = 0; f < frames; f++) {
      const base = ((this.w + f) % cap) * ch;
      for (let c = 0; c < ch; c++) this.buf[base + c] = pcm[f * ch + c] / 32768;
    }
    this.w += frames;
    if (this.available() > cap - 1) this.r = this.w - (cap - 1);           // overflow: drop the oldest
    if (this.available() > this.srcRate * MAX_LAG_S) this.r = this.w - this.srcRate * TARGET_S;
  }

  sample(pos, c) {
    const i = Math.floor(pos), t = pos - i, cap = this.cap, ch = this.ch;
    const a = this.buf[(i % cap) * ch + c];
    const b = i + 1 < this.w ? this.buf[((i + 1) % cap) * ch + c] : a;
    return a + (b - a) * t;
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const n = out[0].length;
    if (!this.playing) {
      if (this.available() >= this.srcRate * PREBUFFER_S) this.playing = true;
      else return true; // silence
    }
    for (let i = 0; i < n; i++) {
      if (this.w - this.r < 1) { this.playing = false; this.underruns++; break; }
      for (let c = 0; c < out.length; c++) out[c][i] = this.sample(this.r, this.ch === 1 ? 0 : Math.min(c, 1));
      this.r += this.step;
    }
    return true;
  }
}

registerProcessor('slate-pcm-player', PcmPlayer);
