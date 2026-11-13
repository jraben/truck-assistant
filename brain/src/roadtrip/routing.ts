// Route-planning settings (Settings, Truck, Route planning): the local
// GraphHopper, whether the public OSRM demo may be asked, and the towing speed
// cap used while a trailer is hitched (Parked, Tow). Kept in the kv table.
import { kvGet, kvSet, type Db } from '../db.ts';
import { graphhopperInfo, type GhInfo, type RouteOpts } from './route.ts';

export type RoutingConfig = { graphhopperUrl: string | null; publicOsrm: boolean; towMph: number };
export type RoutingStatus = RoutingConfig & {
  graphhopper: { ok: true; info: GhInfo } | { ok: false; error: string } | null;
  towing: { trailer: string; mph: number } | null;
  osrm: string;
};

const KEY = 'routing';
export class RoutingError extends Error {}

export const defaultRouting = (env: string | undefined = process.env.GRAPHHOPPER_URL): RoutingConfig => ({ graphhopperUrl: env?.trim() || null, publicOsrm: true, towMph: 65 });

/** Validate a settings patch against the current settings. Pure. */
export function mergeRouting(cur: RoutingConfig, b: unknown): RoutingConfig {
  if (typeof b !== 'object' || b === null) throw new RoutingError('routing settings must be an object');
  const x = b as Record<string, unknown>;
  const n = { ...cur };
  if ('graphhopperUrl' in x) {
    const v = x.graphhopperUrl;
    if (v === null || v === '') n.graphhopperUrl = null;
    else {
      let u: URL;
      try { u = new URL(String(v).trim()); } catch { throw new RoutingError('GraphHopper address must be a URL, e.g. http://localhost:8989'); }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new RoutingError('GraphHopper address must be http or https');
      n.graphhopperUrl = u.toString().replace(/\/$/, '');
    }
  }
  if ('publicOsrm' in x) { if (typeof x.publicOsrm !== 'boolean') throw new RoutingError('publicOsrm must be true or false'); n.publicOsrm = x.publicOsrm; }
  if ('towMph' in x) {
    const m = Number(x.towMph);
    if (!Number.isFinite(m) || m < 35 || m > 80) throw new RoutingError('towing speed cap must be 35 to 80 mph');
    n.towMph = Math.round(m);
  }
  return n;
}

export class RoutingSettings {
  private db: Db;
  private routerUrl: string | undefined;
  constructor(db: Db, routerUrl?: string) { this.db = db; this.routerUrl = routerUrl; }

  get(): RoutingConfig { return { ...defaultRouting(), ...(kvGet<Partial<RoutingConfig>>(this.db, KEY) ?? {}) }; }
  patch(b: unknown): RoutingConfig { const n = mergeRouting(this.get(), b); kvSet(this.db, KEY, n); return n; }

  /** The hitched trailer (Parked, Tow), if any. */
  private trailer(): string | null {
    const m = kvGet<{ trailers?: { id: string; name: string }[]; activeTrailer?: string | null }>(this.db, 'modes');
    return m?.activeTrailer ? m.trailers?.find((t) => t.id === m.activeTrailer)?.name ?? null : null;
  }

  /** What fetchRoute needs right now. */
  opts(): RouteOpts {
    const c = this.get();
    return { router: this.routerUrl, graphhopper: c.graphhopperUrl, publicOsrm: c.publicOsrm, towMph: this.trailer() ? c.towMph : null };
  }

  async status(): Promise<RoutingStatus> {
    const c = this.get();
    let graphhopper: RoutingStatus['graphhopper'] = null;
    if (c.graphhopperUrl) {
      try { graphhopper = { ok: true, info: await graphhopperInfo(c.graphhopperUrl, fetch, true) }; } catch (e) { graphhopper = { ok: false, error: (e as Error).message }; }
    }
    const t = this.trailer();
    return { ...c, graphhopper, towing: t ? { trailer: t, mph: c.towMph } : null, osrm: this.routerUrl ?? (c.publicOsrm ? 'public demo (router.project-osrm.org)' : 'off') };
  }
}
