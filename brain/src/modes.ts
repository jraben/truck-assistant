// CAMP mode, PET mode, TRAILER profiles and the LIGHT SHOW: things for when
// the truck is parked, all switched off the moment it drives away.
//
// The Slate's own climate and lights can't be controlled (no confirmed CAN
// access, and the HVAC is knobs), so these work around it: relays on the
// truck box for a fan, bed lights or a fridge, the cabin temperature sensor,
// the 12 V reading, and a WLED LED strip for the light show.
import type { Brain } from './brain.ts';
import { kvGet, kvSet, type Db } from './db.ts';
import { RELAY_IDS } from './settings.ts';

export type Trailer = {
  id: string; name: string; lengthFt: number | null; weightLb: number | null;
  brakeGain: string | null; notes: string | null;
  service: { name: string; everyMonths: number; lastDone: string | null }[];
};
export type ModesConfig = {
  camp: { on: boolean; relays: string[]; cutoffV: number; cutOffAt: string | null };
  pet: { on: boolean; message: string; alertF: number; fanRelay: string | null; fanOnF: number; alertedAt: string | null };
  trailers: Trailer[];
  activeTrailer: string | null;
  checklist: string[];
  light: { wledUrl: string | null };
};

const KEY = 'modes';
export const DEFAULT_CHECKLIST = [
  'Coupler latched and pinned', 'Safety chains crossed under the tongue', 'Breakaway cable clipped to the truck',
  'Wiring plugged in', 'Running lights', 'Left turn signal', 'Right turn signal', 'Brake lights',
  'Jack raised, wheel chocks stowed', 'Tire pressures checked', 'Load secured',
];

export function defaultModes(): ModesConfig {
  return {
    camp: { on: false, relays: [], cutoffV: 12.1, cutOffAt: null },
    pet: { on: false, message: "I'm OK! My human will be right back.", alertF: 82, fanRelay: null, fanOnF: 78, alertedAt: null },
    trailers: [], activeTrailer: null, checklist: DEFAULT_CHECKLIST, light: { wledUrl: null },
  };
}

export class ModesError extends Error {
  status: number;
  constructor(m: string, status = 400) { super(m); this.status = status; }
}

const relayOk = (r: unknown): r is string => typeof r === 'string' && (RELAY_IDS as readonly string[]).includes(r);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d);
const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

/** Merge a PATCH into the config. Pure. Throws ModesError on bad input. */
export function mergeModes(cur: ModesConfig, b: unknown): ModesConfig {
  if (!b || typeof b !== 'object') throw new ModesError('send an object');
  const x = b as Record<string, any>;
  const n: ModesConfig = structuredClone(cur);
  if (x.camp) {
    if ('relays' in x.camp) n.camp.relays = Array.isArray(x.camp.relays) ? [...new Set(x.camp.relays.filter(relayOk))] as string[] : [];
    if ('cutoffV' in x.camp) n.camp.cutoffV = num(x.camp.cutoffV, 11, 13, 12.1);
  }
  if (x.pet) {
    if ('message' in x.pet) n.pet.message = str(x.pet.message, 120) ?? defaultModes().pet.message;
    if ('alertF' in x.pet) n.pet.alertF = num(x.pet.alertF, 65, 110, 82);
    if ('fanOnF' in x.pet) n.pet.fanOnF = num(x.pet.fanOnF, 60, 110, 78);
    if ('fanRelay' in x.pet) n.pet.fanRelay = relayOk(x.pet.fanRelay) ? x.pet.fanRelay : null;
  }
  if ('trailers' in x) {
    if (!Array.isArray(x.trailers)) throw new ModesError('trailers must be a list');
    n.trailers = x.trailers.slice(0, 12).map((t: any, i: number): Trailer => {
      const name = str(t?.name, 40);
      if (!name) throw new ModesError(`trailer ${i + 1} needs a name`);
      return {
        id: typeof t.id === 'string' && /^[\w-]{1,40}$/.test(t.id) ? t.id : `t${Date.now().toString(36)}${i}`,
        name, lengthFt: t.lengthFt == null || t.lengthFt === '' ? null : num(Number(t.lengthFt), 1, 60, 0) || null,
        weightLb: t.weightLb == null || t.weightLb === '' ? null : num(Number(t.weightLb), 1, 20_000, 0) || null,
        brakeGain: str(t.brakeGain, 20), notes: str(t.notes, 400),
        service: Array.isArray(t.service) ? t.service.slice(0, 10).map((s: any) => ({ name: str(s?.name, 40) ?? 'Service', everyMonths: num(Number(s?.everyMonths), 1, 120, 12), lastDone: typeof s?.lastDone === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.lastDone) ? s.lastDone : null })) : [],
      };
    });
    if (n.activeTrailer && !n.trailers.some((t) => t.id === n.activeTrailer)) n.activeTrailer = null;
  }
  if ('activeTrailer' in x) n.activeTrailer = x.activeTrailer === null || n.trailers.some((t) => t.id === x.activeTrailer) ? x.activeTrailer : n.activeTrailer;
  if ('checklist' in x && Array.isArray(x.checklist)) n.checklist = x.checklist.map((s: unknown) => str(s, 60)).filter((s: string | null): s is string => !!s).slice(0, 30);
  if (x.light && 'wledUrl' in x.light) {
    const u = x.light.wledUrl;
    if (u === null || u === '') n.light.wledUrl = null;
    else if (typeof u === 'string' && /^https?:\/\/[\w.-]+(:\d+)?\/?$/.test(u.trim())) n.light.wledUrl = u.trim().replace(/\/$/, '');
    else throw new ModesError('light.wledUrl is the strip\'s address, e.g. http://192.168.4.50');
  }
  return n;
}

/** When a trailer service is next due (YYYY-MM-DD), or null if never done. Pure. */
export function nextDue(lastDone: string | null, everyMonths: number): string | null {
  if (!lastDone) return null;
  const d = new Date(`${lastDone}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + everyMonths);
  return d.toISOString().slice(0, 10);
}

/** What the fan relay should be for pet mode: on above fanOnF, off 2°F below (no chatter). Pure. */
export function petFan(tempF: number | null, fanOnF: number, isOn: boolean): boolean {
  if (tempF === null) return isOn;
  return isOn ? tempF > fanOnF - 2 : tempF >= fanOnF;
}

type Alert = (kind: 'cabinHot' | 'low12v', title: string, message: string) => void;

export class Modes {
  private db: Db;
  private brain: Brain;
  private alert: Alert;
  private fanOn = false;

  constructor(db: Db, brain: Brain, alert: Alert) { this.db = db; this.brain = brain; this.alert = alert; }

  get(): ModesConfig { return { ...defaultModes(), ...(kvGet<ModesConfig>(this.db, KEY) ?? {}) }; }
  private set(c: ModesConfig) { kvSet(this.db, KEY, c); }
  patch(b: unknown) { const c = mergeModes(this.get(), b); this.set(c); return c; }

  private moving() { const s = this.brain.getState(); return (s.speedMph ?? 0) >= 2; }

  camp(on: boolean) {
    if (on && this.moving()) throw new ModesError('Camp mode is for when you\'re parked.', 409);
    const c = this.get();
    c.camp.on = on; c.camp.cutOffAt = null;
    this.set(c);
    for (const r of c.camp.relays) this.brain.setRelay(r, on);
    return c;
  }

  pet(on: boolean) {
    if (on && this.moving()) throw new ModesError('Pet mode is for when you\'re parked.', 409);
    const c = this.get();
    c.pet.on = on; c.pet.alertedAt = null;
    this.set(c);
    if (!on && c.pet.fanRelay && this.fanOn) { this.brain.setRelay(c.pet.fanRelay, false); this.fanOn = false; }
    return c;
  }

  /** Every few seconds: driving ends both modes; camp guards the 12 V battery; pet runs the fan and warns early. */
  tick() {
    const c = this.get();
    if (!c.camp.on && !c.pet.on) return;
    const s = this.brain.getState();
    if (this.moving()) { if (c.camp.on) this.camp(false); if (c.pet.on) this.pet(false); return; }
    if (c.camp.on && !c.camp.cutOffAt && s.aux12v !== null && s.aux12v < c.camp.cutoffV) {
      for (const r of c.camp.relays) this.brain.setRelay(r, false);
      c.camp.cutOffAt = new Date().toISOString();
      this.set(c);
      this.alert('low12v', 'Camp mode: 12V low', `The 12V battery is at ${s.aux12v.toFixed(2)} V, so camp mode switched off its relays to save it.`);
    }
    if (c.pet.on) {
      const t = s.cabinTempF;
      if (c.pet.fanRelay) {
        const want = petFan(t, c.pet.fanOnF, this.fanOn);
        if (want !== this.fanOn) { this.brain.setRelay(c.pet.fanRelay, want); this.fanOn = want; }
      }
      const last = c.pet.alertedAt ? Date.parse(c.pet.alertedAt) : 0;
      if (t !== null && t >= c.pet.alertF && Date.now() - last > 10 * 60_000) {
        c.pet.alertedAt = new Date().toISOString();
        this.set(c);
        this.alert('cabinHot', `Pet mode: cab ${Math.round(t)}°F`, `Pet mode is on and the cab is at ${Math.round(t)}°F (alert at ${c.pet.alertF}°F). Check on them.`);
      }
    }
  }

  // ---- WLED light show ---------------------------------------------------------

  private async wled(path: string, init?: RequestInit) {
    const u = this.get().light.wledUrl;
    if (!u) throw new ModesError('Enter the LED strip\'s address (WLED) in Settings first.', 503);
    let r: Response;
    try { r = await fetch(u + path, { ...init, signal: AbortSignal.timeout(5000) }); }
    catch (e) { throw new ModesError(`The LED strip at ${u} didn't answer (${(e as Error).name === 'TimeoutError' ? 'timed out' : (e as Error).message}).`, 502); }
    if (!r.ok) throw new ModesError(`The LED strip answered ${r.status}`, 502);
    return r.json();
  }

  async lightState() {
    const j = await this.wled('/json') as { state?: { on?: boolean; bri?: number; ps?: number; seg?: { fx?: number; pal?: number }[] }; effects?: string[]; palettes?: string[] };
    let presets: { id: number; name: string }[] = [];
    try {
      const p = await this.wled('/presets.json') as Record<string, { n?: string }>;
      presets = Object.entries(p).filter(([k, v]) => k !== '0' && v?.n).map(([k, v]) => ({ id: Number(k), name: String(v.n) }));
    } catch { /* older WLED: no presets file */ }
    return { on: !!j.state?.on, bri: j.state?.bri ?? 0, preset: j.state?.ps ?? -1, fx: j.state?.seg?.[0]?.fx ?? 0, pal: j.state?.seg?.[0]?.pal ?? 0, effects: j.effects ?? [], palettes: j.palettes ?? [], presets };
  }

  async lightSet(b: { on?: boolean; bri?: number; fx?: number; pal?: number; ps?: number }) {
    if (b.on !== false && this.moving()) throw new ModesError('The light show is parked only (Arizona: no flashing lights while driving).', 409);
    const body: Record<string, unknown> = {};
    if (typeof b.on === 'boolean') body.on = b.on;
    if (typeof b.bri === 'number') body.bri = Math.max(1, Math.min(255, Math.round(b.bri)));
    if (typeof b.ps === 'number') body.ps = Math.round(b.ps);
    if (typeof b.fx === 'number' || typeof b.pal === 'number') body.seg = [{ ...(typeof b.fx === 'number' ? { fx: b.fx } : {}), ...(typeof b.pal === 'number' ? { pal: b.pal } : {}) }];
    await this.wled('/json/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return this.lightState();
  }

  /** Driving: the strip goes off (if one is set up). */
  async lightGuard() { if (this.get().light.wledUrl && this.moving()) await this.wled('/json/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"on":false}' }).catch(() => {}); }
}
