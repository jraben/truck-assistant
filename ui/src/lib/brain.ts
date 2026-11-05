// Live link to the brain: /ws for State, /api for the rest. Reconnects by itself.
import { useEffect, useState } from 'preact/hooks';
import type { Settings, State } from '../../../brain/src/types.ts';

export type { Charger, ChargeSession, ChargeSummary, Health, Layout, LayoutWidget, Settings, State, Trip, TripPoint } from '../../../brain/src/types.ts';

type Store<T> = { get: () => T; set: (v: T) => void; sub: (f: () => void) => () => void };
function store<T>(init: T): Store<T> {
  let v = init;
  const subs = new Set<() => void>();
  return {
    get: () => v,
    set: (n) => { v = n; subs.forEach((f) => f()); },
    sub: (f) => { subs.add(f); return () => subs.delete(f); },
  };
}

export function useStore<T>(s: Store<T>): T {
  const [, force] = useState(0);
  useEffect(() => s.sub(() => force((n) => n + 1)), [s]);
  return s.get();
}

export const stateStore = store<State | null>(null);
export const linkStore = store<{ connected: boolean; since: number }>({ connected: false, since: Date.now() });
export const settingsStore = store<Settings | null>(null);
export const toastStore = store<string | null>(null);

let ws: WebSocket | null = null;
let backoff = 500;
let toastTimer: number | undefined;

export function toast(msg: string) {
  toastStore.set(msg);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastStore.set(null), 2400);
}

export function connect() {
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => { backoff = 500; linkStore.set({ connected: true, since: Date.now() }); };
  sock.onmessage = (e) => {
    try {
      const m = JSON.parse(e.data);
      if (m.type === 'state') stateStore.set(m.data as State);
      else if (m.type === 'error') toast(String(m.message));
    } catch { /* ignore */ }
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    if (linkStore.get().connected) linkStore.set({ connected: false, since: Date.now() });
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 5000);
  };
  sock.onerror = () => sock.close();
}

export function send(msg: Record<string, unknown>): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) { toast('Not connected to the brain'); return false; }
  ws.send(JSON.stringify(msg));
  return true;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = init?.body ? { 'content-type': 'application/json' } : {};
  const res = await fetch(path, { ...init, headers: { ...headers, ...((init?.headers as Record<string, string>) ?? {}) } });
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

export async function loadSettings(): Promise<Settings | null> {
  try { const s = await api<Settings>('/api/settings'); settingsStore.set(s); return s; } catch { return settingsStore.get(); }
}

/** Settings change rarely and only from the portal; a slow poll keeps the cockpit in step. */
export function pollSettings(ms = 15_000) {
  void loadSettings();
  setInterval(() => void loadSettings(), ms);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void loadSettings(); });
}
