// Shared fetches: chargers (one fetch serves Drive's next-charger card and the
// Charge view) and charge sessions/summary.
import { useEffect } from 'preact/hooks';
import { useState } from 'preact/hooks';
import { api, stateStore, useStore, type Charger, type ChargeSession, type ChargeSummary, type GasStatus, type GoalSummary } from './brain.ts';

type ChargerState = { list: Charger[]; message: string | null; loading: boolean; at: number; lat: number | null; lon: number | null };
const chargerStore = (() => {
  let v: ChargerState = { list: [], message: null, loading: false, at: 0, lat: null, lon: null };
  const subs = new Set<() => void>();
  return { get: () => v, set: (n: ChargerState) => { v = n; subs.forEach((f) => f()); }, sub: (f: () => void) => { subs.add(f); return () => subs.delete(f); } };
})();

const REFRESH_MS = 2 * 60_000;
const MOVE_DEG = 0.02; // ~1.4 mi

export async function refreshChargers(force = false) {
  const c = chargerStore.get();
  if (c.loading) return;
  const st = stateStore.get();
  const g = st?.gps?.fix ? st.gps : null;
  const moved = g && (c.lat === null || Math.abs(g.lat - c.lat) > MOVE_DEG || Math.abs(g.lon - (c.lon ?? 0)) > MOVE_DEG);
  if (!force && !moved && Date.now() - c.at < REFRESH_MS) return;
  chargerStore.set({ ...c, loading: true });
  try {
    const res = await fetch('/api/chargers');
    const list = res.ok ? ((await res.json()) as Charger[]) : [];
    const hdr = res.headers.get('x-slate-message');
    const message = !res.ok ? `Charger lookup failed (${res.status})` : hdr ? decodeURIComponent(hdr) : list.length ? null : 'No chargers found nearby.';
    chargerStore.set({ list, message, loading: false, at: Date.now(), lat: g?.lat ?? null, lon: g?.lon ?? null });
  } catch {
    chargerStore.set({ ...chargerStore.get(), loading: false, at: Date.now(), message: 'Brain not reachable' });
  }
}

export function useChargers() {
  const v = useStore(chargerStore);
  useEffect(() => {
    void refreshChargers();
    const id = setInterval(() => void refreshChargers(), 20_000);
    return () => clearInterval(id);
  }, []);
  return v;
}

type ChargesState = { sessions: ChargeSession[]; months: ChargeSummary[]; years: ChargeSummary[]; at: number; error: string | null };
const chargesStore = (() => {
  let v: ChargesState = { sessions: [], months: [], years: [], at: 0, error: null };
  const subs = new Set<() => void>();
  return { get: () => v, set: (n: ChargesState) => { v = n; subs.forEach((f) => f()); }, sub: (f: () => void) => { subs.add(f); return () => subs.delete(f); } };
})();

export async function refreshCharges() {
  try {
    const [sessions, months, years] = await Promise.all([
      api<ChargeSession[]>('/api/charges'),
      api<ChargeSummary[]>('/api/charges/summary?period=month'),
      api<ChargeSummary[]>('/api/charges/summary?period=year'),
    ]);
    chargesStore.set({ sessions, months, years, at: Date.now(), error: null });
  } catch (e) {
    chargesStore.set({ ...chargesStore.get(), error: (e as Error).message });
  }
}

let chargesPolling = false;
export function useCharges() {
  const v = useStore(chargesStore);
  useEffect(() => {
    if (!chargesPolling) { chargesPolling = true; void refreshCharges(); setInterval(() => void refreshCharges(), 30_000); }
  }, []);
  return v;
}

/** Gas price status for the Charge view's "Gas nearby" line. Refreshed every 10 minutes. */
export function useGas(driverId: string | null | undefined) {
  const [g, setG] = useState<GasStatus | null>(null);
  useEffect(() => {
    let live = true;
    const f = () => api<GasStatus>(`/api/gas${driverId ? `?driver=${encodeURIComponent(driverId)}` : ''}`).then((x) => { if (live) setG(x); }).catch(() => {});
    void f();
    const id = setInterval(f, 10 * 60_000);
    return () => { live = false; clearInterval(id); };
  }, [driverId]);
  return g;
}

/** "2h ago", "5 min ago". */
export function ago(iso: string, now = Date.now()) {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)} days ago`;
}

export async function saveSession(id: number | null, body: Partial<ChargeSession>) {
  const s = id === null
    ? await api<ChargeSession>('/api/charges', { method: 'POST', body: JSON.stringify(body) })
    : await api<ChargeSession>(`/api/charges/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  await refreshCharges();
  return s;
}

export async function deleteSession(id: number) {
  await api(`/api/charges/${id}`, { method: 'DELETE', headers: {} });
  await refreshCharges();
}

// ---- payoff goal (GET /api/goal), one fetch for the Charge card, the Drive card and /settings ----
type GoalState = { g: GoalSummary | null; error: string | null; at: number };
const goalStore = (() => {
  let v: GoalState = { g: null, error: null, at: 0 };
  const subs = new Set<() => void>();
  return { get: () => v, set: (n: GoalState) => { v = n; subs.forEach((f) => f()); }, sub: (f: () => void) => { subs.add(f); return () => subs.delete(f); } };
})();

export async function refreshGoal() {
  try { goalStore.set({ g: await api<GoalSummary>('/api/goal'), error: null, at: Date.now() }); }
  catch (e) { goalStore.set({ ...goalStore.get(), error: (e as Error).message }); }
}

let goalPolling = false;
export function useGoal() {
  const v = useStore(goalStore);
  useEffect(() => {
    if (!goalPolling) { goalPolling = true; void refreshGoal(); setInterval(() => void refreshGoal(), 60_000); }
  }, []);
  return v;
}
