// Track C client side: camera status, clips, the remote token, viewer heartbeats.
import { useEffect, useState } from 'preact/hooks';
import type { Alert, CamStatus, Clip, PowerStatus, RemoteSettings, TruckSnapshot } from '../../../brain/src/remote/types.ts';

export type { Alert, CamStatus, Clip, PowerStatus, RemoteSettings, TruckSnapshot };
export type CamInfo = CamStatus['cameras'][number];

/** The remote token, when this page was opened from the Truck link (?token=). The cockpit on the bar needs none. */
export const remoteToken: string | null = (() => { try { return new URLSearchParams(location.search).get('token'); } catch { return null; } })();

/** Add ?token= for URLs the browser loads by itself (img, video, WebSocket, module import). */
export function withToken(url: string): string {
  if (!remoteToken) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(remoteToken)}`;
}

export async function rapi<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...(remoteToken ? { 'x-slate-token': remoteToken } : {}) };
  const res = await fetch(path, { ...init, headers: { ...headers, ...((init?.headers as Record<string, string>) ?? {}) } });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

/** Server clock minus ours, from /api/cams (frame times are the brain's clock). */
let clockOffset = 0;
export const serverNow = () => Date.now() + clockOffset;

export function useCamStatus(ms = 8000): { status: (CamStatus & { serverTime: number }) | null; error: string | null; reload: () => void } {
  const [status, setStatus] = useState<(CamStatus & { serverTime: number }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const f = async () => {
      const t0 = Date.now();
      try {
        const s = await rapi<CamStatus & { serverTime: number }>('/api/cams');
        clockOffset = s.serverTime - (t0 + Date.now()) / 2;
        if (alive) { setStatus(s); setError(null); }
      } catch (e) { if (alive) setError((e as Error).message); }
    };
    void f();
    const id = setInterval(f, ms);
    return () => { alive = false; clearInterval(id); };
  }, [n]);
  return { status, error, reload: () => setN((x) => x + 1) };
}

const viewerId = `v${Math.random().toString(36).slice(2, 10)}`;

/** While a camera page is visible, tell the brain someone is watching (keeps a remote-woken Pi awake). */
export function useViewerHeartbeat(on = true) {
  useEffect(() => {
    if (!on) return;
    const ping = () => { if (!document.hidden) void rapi('/api/remote/viewer', { method: 'POST', body: JSON.stringify({ id: viewerId }) }).catch(() => {}); };
    ping();
    const id = setInterval(ping, 20_000);
    document.addEventListener('visibilitychange', ping);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', ping); };
  }, [on]);
}

export const wake = () => rapi<PowerStatus>('/api/remote/wake', { method: 'POST', body: JSON.stringify({ id: viewerId }) });
export const saveClip = (camera?: string) => rapi<Clip[]>('/api/cams/clip', { method: 'POST', body: JSON.stringify(camera ? { camera } : {}) });
export const listClips = () => rapi<Clip[]>('/api/cams/clips');
export const deleteClip = (id: string) => rapi<null>(`/api/cams/clips/${encodeURIComponent(id)}`, { method: 'DELETE' });

export function fmtBytes(b: number): string {
  if (b >= 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`;
  if (b >= 1024 ** 2) return `${(b / 1024 ** 2).toFixed(0)} MB`;
  return `${Math.max(0, Math.round(b / 1024))} KB`;
}

/** Pick the rear camera: role "rear", else one called Rear, else the first. Pure. */
export function rearCamera(cams: CamInfo[]): CamInfo | null {
  const on = cams.filter((c) => c.enabled);
  return on.find((c) => c.role === 'rear') ?? on.find((c) => /rear|back/i.test(c.name)) ?? on[0] ?? null;
}

/**
 * Parse a multipart MJPEG chunk buffer: returns the frames found and the rest.
 * Each part: headers (Content-Length, X-Frame-Time), blank line, JPEG. Pure.
 */
export function parseMultipart(buf: Uint8Array): { frames: { jpeg: Uint8Array; at: number | null }[]; rest: Uint8Array } {
  const frames: { jpeg: Uint8Array; at: number | null }[] = [];
  let pos = 0;
  const dec = new TextDecoder();
  for (;;) {
    const hdrEnd = indexOf(buf, CRLFCRLF, pos);
    if (hdrEnd < 0) break;
    const head = dec.decode(buf.subarray(pos, hdrEnd));
    const len = Number(/content-length:\s*(\d+)/i.exec(head)?.[1] ?? NaN);
    const at = Number(/x-frame-time:\s*(\d+)/i.exec(head)?.[1] ?? NaN);
    if (!Number.isFinite(len)) { pos = hdrEnd + 4; continue; }
    const start = hdrEnd + 4;
    if (buf.length < start + len) break;
    frames.push({ jpeg: buf.slice(start, start + len), at: Number.isFinite(at) ? at : null });
    pos = start + len;
  }
  return { frames, rest: buf.slice(pos) };
}
const CRLFCRLF = new Uint8Array([13, 10, 13, 10]);
function indexOf(h: Uint8Array, n: Uint8Array, from: number): number {
  outer: for (let i = from; i <= h.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (h[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}

/** x of a parking guide line (0..100) at height y (0..1 of the frame), for the left or right line. Pure. */
export function guideX(g: { bottomWidth: number; topWidth: number; top: number; offsetX: number }, y: number, side: -1 | 1): number {
  const f = Math.max(0, Math.min(1, (1 - y) / Math.max(0.01, 1 - g.top)));   // 0 at the bottom, 1 at the top of the guides
  const half = (g.bottomWidth + (g.topWidth - g.bottomWidth) * f) / 2;
  return (0.5 + g.offsetX + side * half) * 100;
}
