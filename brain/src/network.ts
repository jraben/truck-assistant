// Getting online through whoever is driving (docs/connectivity.md).
//
// Order: home Wi-Fi, the active driver's phone hotspot, any other driver's
// hotspot in range, the active driver's Bluetooth tether, else offline.
// On the Pi this drives NetworkManager with nmcli (execFile + an argument
// list, never a shell string) on the USB client radio (NET_CLIENT_IFACE,
// default wlan1). The built-in wlan0 is the truck's access point and is never
// touched: the brain only creates, changes and deletes profiles named slate-net-*.
// On a desk (not Linux, SIM=1, or no nmcli) a simulated backend stands in.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { metersBetween } from './geo.ts';
import type { Driver, NetCandidate, NetworkStatus, Settings } from './types.ts';

export const PREFIX = 'slate-net-';
export const PRIORITY = { home: 100, activeHotspot: 90, otherHotspot: 50, bt: 30 } as const;
/** Don't hop to a better network on a signal this weak. */
export const MIN_SWITCH_SIGNAL = 25;
const RETRY_MS = 2 * 60_000;

export type Wanted = {
  id: string; name: string; kind: 'home' | 'hotspot' | 'bt'; label: string;
  driverId: string | null; priority: number;
  ssid?: string; password?: string; mac?: string;
};

const possessive = (n: string) => `${n.toUpperCase()}${/s$/i.test(n) ? "'" : "'S"}`;

/** The profiles the settings call for, best first. Pure. */
export function wantedProfiles(s: Pick<Settings, 'homeWifi' | 'drivers'>, activeId: string | null): Wanted[] {
  const out: Wanted[] = [];
  if (s.homeWifi?.ssid) out.push({ id: 'home', name: `${PREFIX}home`, kind: 'home', label: 'HOME WI-FI', driverId: null, priority: PRIORITY.home, ssid: s.homeWifi.ssid, password: s.homeWifi.password });
  const active = s.drivers.find((d) => d.id === activeId) ?? null;
  const hot = (d: Driver, p: number): Wanted => ({ id: `hotspot:${d.id}`, name: `${PREFIX}hotspot-${d.id}`, kind: 'hotspot', label: `${possessive(d.name)} HOTSPOT`, driverId: d.id, priority: p, ssid: d.hotspot!.ssid, password: d.hotspot!.password });
  if (active?.hotspot?.ssid) out.push(hot(active, PRIORITY.activeHotspot));
  for (const d of s.drivers) if (d !== active && d.hotspot?.ssid) out.push(hot(d, PRIORITY.otherHotspot));
  if (active?.btTetherMac) out.push({ id: `bt:${active.id}`, name: `${PREFIX}bt-${active.id}`, kind: 'bt', label: `BT · ${active.name.toUpperCase()}`, driverId: active.id, priority: PRIORITY.bt, mac: active.btTetherMac });
  return out;
}

export type Seen = { ssid: string; signal: number };

/** What's in range, in priority order. Bluetooth counts as in range when the adapter works (a page costs too much to scan for). Pure. */
export function candidates(wanted: Wanted[], seen: Seen[], btOk: boolean, activeId: string | null): NetCandidate[] {
  return wanted.map((w) => {
    const s = w.ssid ? seen.filter((x) => x.ssid === w.ssid).sort((a, b) => b.signal - a.signal)[0] : undefined;
    return {
      id: w.id, kind: w.kind, label: w.label, ssid: w.ssid ?? null, driverId: w.driverId,
      inRange: w.kind === 'bt' ? btOk : !!s, signal: s ? s.signal : null, active: w.id === activeId,
    };
  });
}

/**
 * Which candidate to bring up, or null to stay put. Pure.
 * - A manual pick wins while it's in range.
 * - Otherwise the first in-range candidate, unless we're already on it.
 * - From one working link, only hop to a better one with a usable signal.
 * - A profile that just failed waits RETRY_MS before it's tried again.
 */
export function decide(cands: NetCandidate[], activeId: string | null, manualId: string | null, failedUntil: Map<string, number>, now = Date.now()): string | null {
  const usable = (c: NetCandidate) => c.inRange && (failedUntil.get(c.id) ?? 0) <= now;
  if (manualId) {
    const m = cands.find((c) => c.id === manualId);
    if (m && usable(m)) return m.id === activeId ? null : m.id;
  }
  const best = cands.find(usable);
  if (!best || best.id === activeId) return null;
  if (activeId === null) return best.id;
  const curIdx = cands.findIndex((c) => c.id === activeId);
  const bestIdx = cands.indexOf(best);
  if (curIdx === -1) return best.id; // on something that's no longer wanted
  if (bestIdx < curIdx && (best.kind === 'bt' || (best.signal ?? 0) >= MIN_SWITCH_SIGNAL)) return best.id;
  return null;
}

// ---- backends ----------------------------------------------------------------

export interface NetBackend {
  kind: NetworkStatus['backend'];
  sync(wanted: Wanted[]): Promise<void>;
  scan(): Promise<Seen[]>;
  /** The slate-net-* profile that's up, if any, and its signal. */
  active(): Promise<{ name: string | null; signal: number | null }>;
  up(name: string): Promise<void>;
  /** 'supported', or why Bluetooth tethering can't be used. */
  bluetooth(): Promise<string>;
  /** rx+tx bytes so far on the client radio and on the Bluetooth PAN link. */
  counters(): { wifi: number; bt: number };
}

export type Runner = (args: string[], timeoutMs?: number) => Promise<{ code: number; stdout: string; stderr: string }>;

/** nmcli with an argument list; nothing goes through a shell. */
export const nmcliRunner: Runner = (args, timeoutMs = 30_000) => new Promise((resolve) => {
  execFile('nmcli', args, { timeout: timeoutMs, maxBuffer: 1 << 20, env: { ...process.env, LC_ALL: 'C' } }, (err, stdout, stderr) => {
    const code = err ? (typeof (err as NodeJS.ErrnoException).code === 'number' ? Number((err as NodeJS.ErrnoException).code) : (err as { code?: string }).code === 'ENOENT' ? 127 : 1) : 0;
    resolve({ code, stdout: String(stdout), stderr: String(stderr || (err?.message ?? '')) });
  });
});

/** Split one line of `nmcli -t` output: ':' separates, '\:' and '\\' are escapes. */
export function splitTerse(line: string): string[] {
  const out: string[] = []; let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '\\' && i + 1 < line.length) { cur += line[++i]; continue; }
    if (c === ':') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

const readCounter = (iface: string) => {
  let n = 0;
  for (const f of ['rx_bytes', 'tx_bytes']) { try { n += Number(readFileSync(`/sys/class/net/${iface}/statistics/${f}`, 'utf8').trim()) || 0; } catch { /* no such link */ } }
  return n;
};

export class NmcliBackend implements NetBackend {
  kind = 'nmcli' as const;
  private run: Runner;
  private iface: string;
  private synced = new Map<string, string>();
  private lastSeen: (Seen & { inUse: boolean })[] = [];

  constructor(run: Runner, iface: string) {
    if (iface === 'wlan0') console.warn('[net] NET_CLIENT_IFACE is wlan0, the access point radio; the client should be the USB adapter (wlan1)');
    this.run = run; this.iface = iface;
  }

  private async nm(args: string[], timeoutMs?: number) {
    const r = await this.run(args, timeoutMs);
    if (r.code !== 0) throw new Error(`nmcli ${args[0]} ${args[1] ?? ''}: ${(r.stderr || r.stdout).trim().split('\n')[0] || `exit ${r.code}`}`);
    return r.stdout;
  }

  async sync(wanted: Wanted[]) {
    const existing = (await this.nm(['-t', '-f', 'NAME,TYPE', 'connection', 'show'])).split('\n').filter(Boolean).map((l) => splitTerse(l)[0]).filter((n) => n.startsWith(PREFIX));
    const want = new Map(wanted.map((w) => [w.name, w]));
    for (const name of existing) if (!want.has(name)) { await this.nm(['connection', 'delete', name]); this.synced.delete(name); }
    for (const w of wanted) {
      const key = JSON.stringify([w.ssid, w.password, w.mac, w.priority, this.iface]);
      if (this.synced.get(w.name) === key && existing.includes(w.name)) continue;
      if (existing.includes(w.name)) await this.nm(['connection', 'delete', w.name]);
      const args = w.kind === 'bt'
        ? ['connection', 'add', 'type', 'bluetooth', 'con-name', w.name, 'ifname', '*', 'bt-type', 'panu', 'bluetooth.bdaddr', w.mac!, 'connection.autoconnect', 'no', 'connection.autoconnect-priority', String(w.priority)]
        : ['connection', 'add', 'type', 'wifi', 'con-name', w.name, 'ifname', this.iface, 'ssid', w.ssid!, 'connection.autoconnect', 'yes', 'connection.autoconnect-priority', String(w.priority),
          ...(w.password ? ['wifi-sec.key-mgmt', 'wpa-psk', 'wifi-sec.psk', w.password] : [])];
      await this.nm(args);
      this.synced.set(w.name, key);
    }
  }

  async scan(): Promise<Seen[]> {
    const out = await this.nm(['-t', '-f', 'IN-USE,SSID,SIGNAL', 'device', 'wifi', 'list', 'ifname', this.iface, '--rescan', 'auto'], 45_000);
    this.lastSeen = out.split('\n').filter(Boolean).map((l) => {
      const [inUse, ssid, signal] = splitTerse(l);
      return { inUse: inUse.trim() === '*', ssid, signal: Number(signal) || 0 };
    }).filter((x) => x.ssid);
    return this.lastSeen.map(({ ssid, signal }) => ({ ssid, signal }));
  }

  async active() {
    const out = await this.nm(['-t', '-f', 'NAME,TYPE,DEVICE', 'connection', 'show', '--active']);
    const rows = out.split('\n').filter(Boolean).map(splitTerse);
    const mine = rows.find((r) => r[0].startsWith(PREFIX));
    const signal = mine && mine[1].includes('wireless') ? this.lastSeen.find((s) => s.inUse)?.signal ?? null : null;
    return { name: mine?.[0] ?? null, signal };
  }

  async up(name: string) {
    if (!name.startsWith(PREFIX)) throw new Error(`refusing to touch ${name}: not a slate-net profile`);
    await this.nm(['--wait', '30', 'connection', 'up', name], 40_000);
  }

  async bluetooth() {
    try {
      const out = await this.nm(['-t', '-f', 'DEVICE,TYPE,STATE', 'device']);
      const bt = out.split('\n').filter(Boolean).map(splitTerse).find((r) => r[1] === 'bt');
      if (!bt) return 'not available: NetworkManager sees no Bluetooth adapter (is bluetoothd running?)';
      return 'supported';
    } catch (e) { return `not available: ${(e as Error).message}`; }
  }

  counters() { return { wifi: readCounter(this.iface), bt: readCounter('bnep0') }; }
}

/** On a desk: home Wi-Fi is "seen" near home, the active driver's hotspot always, data trickles in. */
export class SimBackend implements NetBackend {
  kind = 'sim' as const;
  private wanted: Wanted[] = [];
  private cur: string | null = null;
  private bytes = { wifi: 0, bt: 0 };
  private getPos: () => { lat: number; lon: number } | null;
  private getSettings: () => Settings;
  private getDriver: () => string | null;

  constructor(getPos: () => { lat: number; lon: number } | null, getSettings: () => Settings, getDriver: () => string | null) {
    this.getPos = getPos; this.getSettings = getSettings; this.getDriver = getDriver;
  }
  async sync(w: Wanted[]) { this.wanted = w; if (this.cur && !w.some((x) => x.name === this.cur)) this.cur = null; }
  async scan(): Promise<Seen[]> {
    const s = this.getSettings(), pos = this.getPos();
    const seen: Seen[] = [];
    if (s.homeWifi && pos && s.homeLocation && metersBetween(pos, s.homeLocation) < 150) seen.push({ ssid: s.homeWifi.ssid, signal: 70 });
    const d = s.drivers.find((x) => x.id === this.getDriver());
    if (d?.hotspot) seen.push({ ssid: d.hotspot.ssid, signal: 82 });
    if (!seen.some((x) => this.wanted.find((w) => w.name === this.cur)?.ssid === x.ssid) && this.cur && !this.cur.includes('-bt-')) this.cur = null;
    return seen;
  }
  async active() {
    const w = this.wanted.find((x) => x.name === this.cur);
    if (w && w.kind !== 'bt') this.bytes.wifi += w.kind === 'home' ? 400_000 : 60_000 + Math.round(Math.random() * 40_000);
    if (w?.kind === 'bt') this.bytes.bt += 15_000;
    return { name: this.cur, signal: w ? (w.kind === 'home' ? 70 : w.kind === 'bt' ? null : 82) : null };
  }
  async up(name: string) { this.cur = name; }
  async bluetooth() { return 'supported'; }
  counters() { return { ...this.bytes }; }
}

export class UnavailableBackend implements NetBackend {
  kind = 'unavailable' as const;
  reason: string;
  constructor(reason: string) { this.reason = reason; }
  async sync() {}
  async scan() { return []; }
  async active() { return { name: null, signal: null }; }
  async up() { throw new Error(this.reason); }
  async bluetooth() { return `not available: ${this.reason}`; }
  counters() { return { wifi: 0, bt: 0 }; }
}

/** nmcli on Linux, the simulation on a desk. */
export async function pickBackend(opts: { sim: boolean; iface: string; run?: Runner; makeSim: () => NetBackend }): Promise<NetBackend> {
  if (opts.sim || process.platform !== 'linux') return opts.makeSim();
  const run = opts.run ?? nmcliRunner;
  const v = await run(['--version'], 5000);
  if (v.code !== 0) return new UnavailableBackend('nmcli not found: install NetworkManager (deploy/pi/README.md)');
  return new NmcliBackend(run, opts.iface);
}

// ---- the manager -------------------------------------------------------------

type ByteBook = { month: string; byDriver: Record<string, number> };
const monthOf = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export class NetManager {
  status: NetworkStatus;
  cands: NetCandidate[] = [];
  private backend: NetBackend;
  private getSettings: () => Settings;
  private getDriver: () => string | null;
  private manual: string | null = null;
  private failed = new Map<string, number>();
  private lastCounters: { wifi: number; bt: number } | null = null;
  private book: ByteBook;
  private saveBook: (b: ByteBook) => void;
  private onChange: () => void;
  private wantedKey = '';
  private wanted: Wanted[] = [];
  private busy: Promise<void> | null = null;

  constructor(backend: NetBackend, getSettings: () => Settings, getDriver: () => string | null, book: ByteBook | null, saveBook: (b: ByteBook) => void, onChange: () => void) {
    this.backend = backend; this.getSettings = getSettings; this.getDriver = getDriver; this.saveBook = saveBook; this.onChange = onChange;
    this.book = book && book.month === monthOf() ? book : { month: monthOf(), byDriver: {} };
    this.status = {
      link: 'offline', label: 'OFFLINE', ssid: null, driverId: null, signal: null, manual: false, saveData: false,
      bytesThisTrip: 0, bytesThisMonth: { ...this.book.byDriver }, backend: backend.kind, bluetooth: 'not checked yet',
      error: backend instanceof UnavailableBackend ? backend.reason : null,
    };
  }

  /** One pass: profiles in step with settings, scan, pick, switch, count bytes. Never throws. */
  tick(): Promise<void> {
    if (this.busy) return this.busy;
    this.busy = this.pass().catch((e) => { this.status.error = (e as Error).message; }).finally(() => { this.busy = null; this.onChange(); });
    return this.busy;
  }

  private async pass() {
    const s = this.getSettings();
    const wanted = wantedProfiles(s, this.getDriver());
    const key = JSON.stringify(wanted);
    let err: string | null = null;
    if (key !== this.wantedKey) {
      try { await this.backend.sync(wanted); this.wantedKey = key; } catch (e) { err = (e as Error).message; }
    }
    this.wanted = wanted;
    let seen: Seen[] = [];
    try { seen = await this.backend.scan(); } catch (e) { err ??= (e as Error).message; }
    const bt = await this.backend.bluetooth();
    let act = await this.backend.active().catch(() => ({ name: null, signal: null }));
    let activeId = wanted.find((w) => w.name === act.name)?.id ?? null;
    this.cands = candidates(wanted, seen, bt === 'supported', activeId);
    const go = decide(this.cands, activeId, this.manual, this.failed);
    if (go) {
      const w = wanted.find((x) => x.id === go)!;
      try {
        await this.backend.up(w.name);
        this.failed.delete(go);
        act = await this.backend.active().catch(() => ({ name: null, signal: null }));
        activeId = wanted.find((x) => x.name === act.name)?.id ?? null;
        this.cands = candidates(wanted, seen, bt === 'supported', activeId);
        console.log(`[net] on ${w.label}`);
      } catch (e) {
        this.failed.set(go, Date.now() + RETRY_MS);
        err ??= `${w.label}: ${(e as Error).message}`;
      }
    }
    this.count(activeId);
    const w = wanted.find((x) => x.id === activeId) ?? null;
    const link = w ? w.kind : 'offline';
    this.status = {
      ...this.status,
      link, label: w?.label ?? 'OFFLINE', ssid: w?.ssid ?? null, driverId: w?.driverId ?? null,
      signal: act.signal, manual: this.manual !== null,
      saveData: s.saveDataOnHotspot && (link === 'hotspot' || link === 'bt'),
      bytesThisMonth: { ...this.book.byDriver }, bluetooth: bt, error: err,
    };
  }

  /** Bytes since the last pass go to whoever's phone carried them. */
  private count(activeId: string | null) {
    const c = this.backend.counters();
    const prev = this.lastCounters;
    this.lastCounters = c;
    if (!prev) return;
    const w = this.wanted.find((x) => x.id === activeId);
    if (!w || w.kind === 'home' || !w.driverId) return;
    const d = Math.max(0, w.kind === 'bt' ? c.bt - prev.bt : c.wifi - prev.wifi); // a counter reset reads as 0, not negative
    if (!d) return;
    if (this.book.month !== monthOf()) this.book = { month: monthOf(), byDriver: {} };
    this.book.byDriver[w.driverId] = (this.book.byDriver[w.driverId] ?? 0) + d;
    this.status.bytesThisTrip += d;
    this.saveBook(this.book);
  }

  /** Swap in the real backend once it's known (nmcli is probed asynchronously at start). */
  setBackend(b: NetBackend) {
    this.backend = b; this.wantedKey = ''; this.lastCounters = null;
    this.status = { ...this.status, backend: b.kind, error: b instanceof UnavailableBackend ? b.reason : null };
  }

  tripStarted() { this.status.bytesThisTrip = 0; this.onChange(); }

  /** A hand-picked network (null = back to the automatic order). */
  pick(id: string | null): boolean {
    if (id !== null && !this.cands.some((c) => c.id === id)) return false;
    this.manual = id;
    if (id) this.failed.delete(id);
    void this.tick();
    return true;
  }
}
