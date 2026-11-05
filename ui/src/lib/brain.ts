// Live link to the brain: /ws for State, /api for the rest. Reconnects by itself.
import { useEffect, useState } from 'preact/hooks';
import type { Driver, Settings, State } from '../../../brain/src/types.ts';

export type { Charger, ChargeSession, ChargeSummary, CompareVehicle, Driver, GasSensor, NetCandidate, NetworkStatus, GasStatus, Health, ImportJob, Layout, LayoutWidget, Place, PlaceSuggestion, Settings, State, Stop, TimelineItem, Trip, TripPoint } from '../../../brain/src/types.ts';

export type Store<T> = { get: () => T; set: (v: T) => void; sub: (f: () => void) => () => void };
export function store<T>(init: T): Store<T> {
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

/** Like send(), but silent when the brain is away (for background updates the user didn't ask for). */
export function sendQuiet(msg: Record<string, unknown>): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(msg));
  return true;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = init?.body ? { 'content-type': 'application/json' } : {};
  const res = await fetch(path, { ...init, headers: { ...headers, ...((init?.headers as Record<string, string>) ?? {}) } });
  // Logged out (or the session expired) on a phone: back to the login page.
  if (res.status === 401 && location.pathname !== '/' && location.pathname !== '/login') location.href = `/login?next=${encodeURIComponent(location.pathname + location.hash)}`;
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const b = await res.json(); if (b?.error) msg = b.error; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

/** The profile in use: the brain's active driver, else the first named one. */
export function activeDriver(s: Settings | null, st: State | null): Driver | null {
  if (!s) return null;
  return s.drivers.find((d) => d.id === st?.driver?.id) ?? s.drivers.find((d) => !d.guest) ?? s.drivers[0] ?? null;
}

/** PUT /api/drivers/:id, then refresh settings so every view follows. */
export async function putDriver(id: string, patch: Record<string, unknown>): Promise<Driver> {
  const d = await api<Driver>(`/api/drivers/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) });
  await loadSettings();
  return d;
}

export async function pickDriver(id: string) {
  try { await api('/api/driver', { method: 'POST', body: JSON.stringify({ id }) }); }
  catch (e) { toast(`Driver not changed: ${(e as Error).message}`); }
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
