// One live camera: go2rtc's WebRTC/MSE player on the Pi, or the brain's MJPEG
// (desk fallback) drawn onto a canvas. Either way it reports latency.
import { useEffect, useRef, useState } from 'preact/hooks';
import { guideX, parseMultipart, remoteToken, serverNow, withToken, type CamInfo, type CamStatus } from '../lib/cams.ts';

type Props = { cam: CamInfo; backend: CamStatus['backend']; guides: CamStatus['guides'] | null; big?: boolean };

export function CamPlayer({ cam, backend, guides, big }: Props) {
  const [latency, setLatency] = useState<{ ms: number; how: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const mirror = cam.mirror ? { transform: 'scaleX(-1)' } : undefined;
  return (
    <div class={`camplayer ${big ? 'big' : ''}`}>
      {backend === 'go2rtc' ? <Go2rtc cam={cam} style={mirror} onLatency={setLatency} onError={setErr} />
        : backend === 'fallback' ? <Mjpeg cam={cam} style={mirror} onLatency={setLatency} onError={setErr} />
        : <div class="camoff">Cameras off</div>}
      {cam.guides && guides && <Guides g={guides} />}
      <span class="camname">{cam.name}</span>
      <Latency l={latency} />
      {err && <span class="camerr" title={err}>{err}</span>}
    </div>
  );
}

function Latency({ l }: { l: { ms: number; how: string } | null }) {
  if (!l) return <span class="latency dim" title="Waiting for the first frame">—</span>;
  const cls = l.ms < 250 ? 'ok' : l.ms < 700 ? 'warn' : 'bad';
  return <span class={`latency ${cls}`} title={`Glass-to-glass estimate (${l.how})`}>{Math.round(l.ms)} ms</span>;
}

export function Guides({ g }: { g: CamStatus['guides'] }) {
  const bandColor = ['var(--bad)', 'var(--warn)', 'var(--ok)'];
  const line = (side: -1 | 1) => `M${guideX(g, 1, side)},100 L${guideX(g, g.top, side)},${g.top * 100}`;
  return (
    <svg class="guides-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path d={line(-1)} /><path d={line(1)} />
      {g.bands.map((y, i) => (
        <g style={{ stroke: bandColor[i] }}>
          <line x1={guideX(g, y, -1)} y1={y * 100} x2={guideX(g, y, -1) + 6} y2={y * 100} />
          <line x1={guideX(g, y, 1)} y1={y * 100} x2={guideX(g, y, 1) - 6} y2={y * 100} />
        </g>
      ))}
    </svg>
  );
}

type PlayerProps = { cam: CamInfo; style?: Record<string, string>; onLatency: (l: { ms: number; how: string } | null) => void; onError: (e: string | null) => void };

/** The brain's multipart MJPEG, parsed in JS so each frame's server time gives the latency. */
function Mjpeg({ cam, style, onLatency, onError }: PlayerProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctl = new AbortController();
    let lat: number[] = [];
    let last = 0;
    const run = async () => {
      for (let attempt = 0; !ctl.signal.aborted; attempt++) {
        try {
          const res = await fetch(`/api/cams/${encodeURIComponent(cam.id)}/mjpeg`, { signal: ctl.signal, headers: remoteToken ? { 'x-slate-token': remoteToken } : {} });
          if (!res.ok || !res.body) { let m = `camera answered ${res.status}`; try { m = (await res.json()).error ?? m; } catch { /* not JSON */ } throw new Error(m); }
          onError(null);
          const rd = res.body.getReader();
          let buf: Uint8Array = new Uint8Array(0);
          let drawing = false;
          for (;;) {
            const { done, value } = await rd.read();
            if (done) break;
            const nb = new Uint8Array(buf.length + value.length); nb.set(buf); nb.set(value, buf.length); buf = nb;
            const { frames, rest } = parseMultipart(buf);
            buf = rest;
            const f = frames[frames.length - 1];   // only the newest frame matters
            if (!f || drawing || !canvas.current) continue;
            drawing = true;
            createImageBitmap(new Blob([f.jpeg as BlobPart], { type: 'image/jpeg' })).then((bmp) => {
              const c = canvas.current;
              if (c) {
                if (c.width !== bmp.width || c.height !== bmp.height) { c.width = bmp.width; c.height = bmp.height; }
                c.getContext('2d')?.drawImage(bmp, 0, 0);
              }
              bmp.close();
              if (f.at) {
                lat.push(serverNow() - f.at); if (lat.length > 15) lat = lat.slice(-15);
                if (Date.now() - last > 1000) { last = Date.now(); onLatency({ ms: Math.max(0, lat.reduce((a, b) => a + b, 0) / lat.length), how: 'MJPEG, frame time vs the brain clock' }); }
              }
            }).catch(() => {}).finally(() => { drawing = false; });
          }
        } catch (e) {
          if (ctl.signal.aborted) return;
          onError((e as Error).message);
          onLatency(null);
        }
        await new Promise((r) => setTimeout(r, Math.min(5000, 500 * 2 ** Math.min(attempt, 4))));
      }
    };
    void run();
    return () => ctl.abort();
  }, [cam.id]);
  return <canvas ref={canvas} class="camvideo" style={style} />;
}

type VideoRtcEl = HTMLElement & { src: string; mode: string; pc?: RTCPeerConnection; video?: HTMLVideoElement; background?: boolean };
let playerLoad: Promise<unknown> | null = null;

/** go2rtc's own <video-stream> element (WebRTC, then MSE), loaded from the brain's /go2rtc proxy. */
function Go2rtc({ cam, style, onLatency, onError }: PlayerProps) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let el: VideoRtcEl | null = null;
    let timer: number | undefined;
    playerLoad ??= import(/* @vite-ignore */ withToken('/go2rtc/video-stream.js'));
    playerLoad.then(() => {
      if (!host.current) return;
      el = document.createElement('video-stream') as VideoRtcEl;
      el.mode = 'webrtc,mse,mjpeg';
      el.background = false;
      Object.assign(el.style, { width: '100%', height: '100%', display: 'block', ...(style ?? {}) });
      host.current.replaceChildren(el);
      const ws = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${withToken(`/api/cams/ws?src=${encodeURIComponent(cam.id)}`)}`;
      el.src = ws;
      onError(null);
      timer = window.setInterval(async () => {
        const v = el?.querySelector('video') ?? el?.video;
        if (el?.pc && el.pc.connectionState === 'connected') {
          let jb = 0, rtt = 0;
          (await el.pc.getStats()).forEach((r: any) => {
            if (r.type === 'inbound-rtp' && r.kind === 'video' && r.jitterBufferEmittedCount) jb = (r.jitterBufferDelay / r.jitterBufferEmittedCount) * 1000;
            if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime) rtt = r.currentRoundTripTime * 1000;
          });
          onLatency({ ms: jb + rtt / 2 + 35, how: 'WebRTC: jitter buffer + half the round trip + decode' });
        } else if (v && v.buffered.length) {
          onLatency({ ms: Math.max(0, (v.buffered.end(v.buffered.length - 1) - v.currentTime) * 1000) + 120, how: 'MSE: buffered ahead + segment delay' });
        } else onLatency(null);
      }, 2000);
    }).catch((e) => onError(`go2rtc player not loaded: ${(e as Error).message}`));
    return () => { clearInterval(timer); el?.remove(); };
  }, [cam.id]);
  return <div ref={host} class="camvideo" />;
}
