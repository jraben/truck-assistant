// CarPlay audio out: one AudioWorklet ring-buffer player per stream
// (format + dongle channel), each through a gain for its role, so music,
// navigation prompts and Siri/calls mix and duck independently.
import { applyAudioCommand, gains, initialMix, pcmFormat, roleFor, streamKey, type MixState, type Role } from './pcm.ts';

type Stream = { node: AudioWorkletNode; gain: GainNode; role: Role };

const WORKLET_URL = new URL('./pcm-player.worklet.js', import.meta.url);

export class AudioOut {
  private ctx: AudioContext | null = null;
  private ready: Promise<void> | null = null;
  private streams = new Map<string, Stream>();
  private pending = new Map<string, Int16Array[]>();
  private mix: MixState = initialMix();
  private unlockBound = false;
  /** Called with true while the browser holds audio back until a tap. */
  onBlocked: (blocked: boolean) => void = () => {};
  /** Called with true when Siri or a call wants the mic, false when done. */
  onMic: (open: boolean) => void = () => {};

  private context(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.ready = ctx.audioWorklet.addModule(WORKLET_URL.href).catch((e) => { console.error('[carplay] audio worklet failed to load', e); throw e; });
    ctx.onstatechange = () => this.onBlocked(ctx.state === 'suspended');
    if (ctx.state === 'suspended') {
      // Kiosk Chromium runs with --autoplay-policy=no-user-gesture-required; a normal browser waits for a tap.
      void ctx.resume().catch(() => {});
      this.bindUnlock();
    }
    return ctx;
  }

  private bindUnlock() {
    if (this.unlockBound) return;
    this.unlockBound = true;
    const unlock = () => {
      if (!this.ctx || this.ctx.state !== 'suspended') return;
      void this.ctx.resume().then(() => this.onBlocked(false)).catch(() => {});
    };
    addEventListener('pointerdown', unlock, { capture: true });
    addEventListener('keydown', unlock, { capture: true });
    setTimeout(() => { if (this.ctx?.state === 'suspended') this.onBlocked(true); }, 300);
  }

  /** Call from a user gesture (the "Tap for sound" chip). */
  unlock() { void this.context().resume().then(() => this.onBlocked(false)).catch(() => {}); }

  private async stream(decodeType: number, audioType: number): Promise<Stream | null> {
    const key = streamKey(decodeType, audioType);
    const have = this.streams.get(key);
    if (have) return have;
    const fmt = pcmFormat(decodeType);
    if (!fmt) return null;
    const ctx = this.context();
    await this.ready;
    if (this.streams.has(key)) return this.streams.get(key)!;
    const node = new AudioWorkletNode(ctx, 'slate-pcm-player', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { sampleRate: fmt.sampleRate, channels: fmt.channels },
    });
    const gain = ctx.createGain();
    const role = roleFor(decodeType, audioType);
    gain.gain.value = gains(this.mix)[role];
    node.connect(gain).connect(ctx.destination);
    const s = { node, gain, role };
    this.streams.set(key, s);
    return s;
  }

  /** Interleaved Int16 PCM from the dongle. */
  push(decodeType: number, audioType: number, pcm: Int16Array) {
    const key = streamKey(decodeType, audioType);
    const s = this.streams.get(key);
    if (s) { s.node.port.postMessage(pcm, [pcm.buffer]); return; }
    // First packet of a stream: queue while its worklet node is made.
    const q = this.pending.get(key);
    if (q) { q.push(pcm); return; }
    this.pending.set(key, [pcm]);
    void this.stream(decodeType, audioType).then((st) => {
      const queued = this.pending.get(key) ?? [];
      this.pending.delete(key);
      if (st) for (const p of queued) st.node.port.postMessage(p, [p.buffer]);
    }).catch(() => this.pending.delete(key));
  }

  /** AudioData without samples: a command (start/stop of nav, Siri, calls) or a volume hint. */
  control(decodeType: number, audioType: number, command?: number, volume?: number, volumeDuration?: number) {
    if (command !== undefined && command !== null) {
      const r = applyAudioCommand(this.mix, command);
      this.mix = r.mix;
      if (r.mic !== null) this.onMic(r.mic);
      this.applyGains(0.15);
    } else if (volumeDuration !== undefined && volume !== undefined && roleFor(decodeType, audioType) === 'media') {
      this.mix = { ...this.mix, mediaHint: volume };
      this.applyGains(Math.max(0.02, volumeDuration));
    }
  }

  private applyGains(seconds: number) {
    if (!this.ctx) return;
    const g = gains(this.mix);
    const t = this.ctx.currentTime;
    for (const s of this.streams.values()) {
      s.gain.gain.cancelScheduledValues(t);
      s.gain.gain.setTargetAtTime(g[s.role], t, seconds / 3);
    }
  }

  /** Phone gone: drop queued audio and forget ducking. */
  reset() {
    for (const s of this.streams.values()) s.node.port.postMessage('flush');
    this.mix = initialMix();
    this.applyGains(0.05);
    this.onMic(false);
  }

  async close() {
    this.reset();
    for (const s of this.streams.values()) { s.node.disconnect(); s.gain.disconnect(); }
    this.streams.clear();
    const c = this.ctx;
    this.ctx = null; this.ready = null;
    await c?.close().catch(() => {});
  }
}
