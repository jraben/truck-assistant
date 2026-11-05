// The microphone for Siri and calls (micType 'os': the Pi's mic, not the
// dongle's). node-carplay's WebMicrophone turns it into 16 kHz Int16 PCM on a
// MessagePort; the worker wraps each chunk in SendAudio.
import './polyfills.ts';
import WebMicrophone from './vendor/node-carplay/web/WebMicrophone.js';

type MicInternals = { recorder: AudioWorkletNode | null; audioContext: AudioContext };

export class MicIn {
  private mic: WebMicrophone | null = null;
  private stream: MediaStream | null = null;
  private gen = 0;
  onState: (open: boolean, error?: string) => void = () => {};

  constructor(private toWorker: (port: MessagePort) => void) {}

  get open() { return this.mic !== null; }

  async start() {
    if (this.mic) return;
    const gen = ++this.gen;
    if (!navigator.mediaDevices?.getUserMedia) { this.onState(false, 'no microphone API here'); return; }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      this.onState(false, `microphone refused: ${(e as Error).message}`);
      return;
    }
    if (gen !== this.gen) { stream.getTracks().forEach((t) => t.stop()); return; } // stopped while asking
    const ch = new MessageChannel();
    this.toWorker(ch.port2);
    const mic = new WebMicrophone(stream, ch.port1);
    this.mic = mic; this.stream = stream;
    const inner = mic as unknown as MicInternals;
    void inner.audioContext.resume().catch(() => {});
    // WebMicrophone loads its worklet asynchronously and start() is a no-op until then.
    for (let i = 0; i < 60 && !inner.recorder && gen === this.gen; i++) await new Promise((r) => setTimeout(r, 50));
    if (gen !== this.gen || !inner.recorder) { if (gen === this.gen) { this.stop(); this.onState(false, 'mic worklet did not load'); } return; }
    await mic.start();
    this.onState(true);
  }

  stop() {
    this.gen++;
    const mic = this.mic;
    this.mic = null;
    if (mic) {
      const inner = mic as unknown as MicInternals;
      if (!inner.recorder) void inner.audioContext.close().catch(() => {}); // destroy() skips this case
      try { mic.stop(); } catch { /* not started */ }
      try { mic.destroy(); } catch { /* ignore */ }
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (mic) this.onState(false);
  }
}
