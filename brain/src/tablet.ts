// The dash TABLET (Galaxy Tab S7 FE in Slate's tablet mount) running the
// cockpit in Chrome, with the Pi under the dash as the brain.
//
// What the brain can't do from here, Tasker on the tablet does, triggered by
// its local "HTTP Request" event (deploy/android/README.md):
//   GET http://<tablet>:<port>/slate/front          bring the cockpit back to the front
//   GET http://<tablet>:<port>/slate/launch?pkg=…    open an installed app (Moonlight, RetroArch)
// The tablet's address is learned from the cockpit itself (it says hello every
// minute), so nothing has to be typed in. Ignition wake/sleep is Tasker's own
// "power connected / disconnected" profile; on power loss it asks the brain
// how long to wait (GET /api/tablet/sleep, Settings > Truck > "When the truck
// turns off"), and falls back to 2 minutes if the brain doesn't answer.
import { kvGet, kvSet, type Db } from './db.ts';
import type { TabletSleep } from './types.ts';

/** What Tasker reads when the truck turns off. Flat fields, seconds included, so the task needs no arithmetic. Pure. */
export function sleepPlan(t: TabletSleep) {
  return { minutes: t.minutes, waitSec: t.minutes * 60, never: t.never, keepOn: t.never ? 1 : 0, minBattery: t.minBattery };
}

export type TabletState = { ip: string | null; seenAt: string | null; ua: string | null; taskerPort: number };
const KEY = 'tablet';

/** Android app links: the streaming apps open themselves for their own https address. Pure. */
export function intentUrl(url: string, pkg: string): string {
  const u = new URL(url);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};package=${pkg};S.browser_fallback_url=${encodeURIComponent(url)};end`;
}

/** A private LAN or Tailscale address, the only places a tablet in the truck can be. Pure. */
export const okTabletIp = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)\d{1,3}\.\d{1,3}(\.\d{1,3})?$/.test(ip.replace(/^::ffff:/, ''));

export class Tablet {
  private db: Db;
  constructor(db: Db) { this.db = db; }

  get(): TabletState { return { ip: null, seenAt: null, ua: null, taskerPort: 1821, ...(kvGet<TabletState>(this.db, KEY) ?? {}) }; }

  /** The cockpit on an Android tablet checking in. */
  hello(ip: string, ua: string) {
    const clean = ip.replace(/^::ffff:/, '');
    if (!/Android/i.test(ua) || !okTabletIp(clean)) return this.get();
    const s = { ...this.get(), ip: clean, seenAt: new Date().toISOString(), ua: ua.slice(0, 160) };
    kvSet(this.db, KEY, s);
    return s;
  }

  setPort(port: unknown) {
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error('port is 1024-65535');
    kvSet(this.db, KEY, { ...this.get(), taskerPort: p });
    return this.get();
  }

  private async tasker(path: string): Promise<{ ok: boolean; error?: string }> {
    const s = this.get();
    if (!s.ip) return { ok: false, error: 'The tablet hasn\'t checked in yet: open the cockpit on it.' };
    try {
      const r = await fetch(`http://${s.ip}:${s.taskerPort}${path}`, { signal: AbortSignal.timeout(3000) });
      return r.ok ? { ok: true } : { ok: false, error: `Tasker on the tablet answered ${r.status}` };
    } catch (e) { return { ok: false, error: `Tasker on the tablet didn't answer (${(e as Error).name === 'TimeoutError' ? 'timed out' : (e as Error).message}): see deploy/android/README.md` }; }
  }

  /** Bring the cockpit back over whatever app is open (the truck started moving). */
  front() { return this.tasker('/slate/front'); }
  /** Open an installed Android app by package name. */
  launch(pkg: string) {
    if (!/^[a-zA-Z][\w.]{2,100}$/.test(pkg)) return Promise.resolve({ ok: false, error: 'bad package' });
    return this.tasker(`/slate/launch?pkg=${encodeURIComponent(pkg)}`);
  }
}
