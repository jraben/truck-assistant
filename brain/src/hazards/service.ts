// Hazards ahead: on a trip, along the rest of its route; otherwise around the
// truck. Refreshed every 15 minutes while online.
import { haversineMi } from '../geo.ts';
import type { Route } from '../roadtrip/route.ts';
import { firesNearRoute, firmsUrl, forecastUrl, parseAlerts, parseFirms, parseForecast, pointsAhead, type Hazard, type RoutePoint } from './route.ts';

const EVERY_MS = 15 * 60_000;
export type HazardView = { hazards: Hazard[]; checkedAt: string | null; following: 'route' | 'here' | 'none'; errors: string[]; firesOn: boolean };
export type HazardBrief = { kind: Hazard['kind']; text: string } | null;

export type HazardDeps = {
  route: () => { route: Route; mi: number } | null;
  gps: () => { lat: number; lon: number } | null;
  online: () => boolean;
  firmsKey: () => string | null;
  userAgent: string;
  fetchFn?: typeof fetch;
};

export class HazardService {
  private d: HazardDeps;
  private v: HazardView = { hazards: [], checkedAt: null, following: 'none', errors: [], firesOn: false };
  private last = 0;
  private lastKey = '';
  private busy = false;

  constructor(d: HazardDeps) { this.d = d; }

  view(): HazardView { return { ...this.v, firesOn: !!this.d.firmsKey() }; }

  brief(): HazardBrief {
    const h = this.v.hazards.find((x) => x.severity === 'high' && x.mi <= 120);
    if (!h) return null;
    const when = h.at && h.kind !== 'warning' && h.kind !== 'fire' ? ` around ${new Date(h.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : '';
    return { kind: h.kind, text: `${h.title}${this.v.following === 'route' ? ` at mile ${h.mi}` : ''}${when}` };
  }

  async tick(now = Date.now(), force = false) {
    const r = this.d.route(), g = this.d.gps();
    const key = r ? `${r.route.miles.toFixed(0)}:${Math.floor(r.mi / 20)}` : g ? `${g.lat.toFixed(1)},${g.lon.toFixed(1)}` : '';
    if (this.busy || !this.d.online() || (!force && now - this.last < EVERY_MS && key === this.lastKey)) return;
    if (!r && !g) return;
    this.busy = true; this.last = now; this.lastKey = key;
    const f = this.d.fetchFn ?? fetch, errors: string[] = [];
    try {
      const pts: RoutePoint[] = r ? pointsAhead(r.route, r.mi, now) : [{ mi: 0, lat: g!.lat, lon: g!.lon, at: now }];
      const hazards: Hazard[] = [];
      // NWS warnings, one point at a time (deduplicated: one storm covers several points).
      const seen = new Set<string>();
      for (const p of pts) {
        try {
          const res = await f(`https://api.weather.gov/alerts/active?point=${p.lat.toFixed(4)},${p.lon.toFixed(4)}`, { headers: { 'user-agent': this.d.userAgent, accept: 'application/geo+json' }, signal: AbortSignal.timeout(10_000) });
          if (res.ok) for (const h of parseAlerts(await res.json(), p)) if (!seen.has(h.key)) { seen.add(h.key); hazards.push(h); }
          else if (res.status !== 404) errors.push(`NWS answered ${res.status}`);
        } catch (e) { errors.push(`NWS: ${(e as Error).message}`); break; }
      }
      try {
        const res = await f(forecastUrl(pts), { signal: AbortSignal.timeout(15_000) });
        if (res.ok) hazards.push(...parseForecast(await res.json(), pts)); else errors.push(`Forecast answered ${res.status}`);
      } catch (e) { errors.push(`Forecast: ${(e as Error).message}`); }
      const key2 = this.d.firmsKey();
      if (key2) {
        try {
          if (r) {
            const res = await f(firmsUrl(key2, r.route, r.mi), { signal: AbortSignal.timeout(20_000) });
            if (res.ok) hazards.push(...firesNearRoute(parseFirms(await res.text()), r.route, r.mi)); else errors.push(`NASA FIRMS answered ${res.status}`);
          } else {
            const box = `${(g!.lon - 0.5).toFixed(2)},${(g!.lat - 0.4).toFixed(2)},${(g!.lon + 0.5).toFixed(2)},${(g!.lat + 0.4).toFixed(2)}`;
            const res = await f(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key2)}/VIIRS_SNPP_NRT/${box}/1`, { signal: AbortSignal.timeout(20_000) });
            if (res.ok) {
              const spots = parseFirms(await res.text()).map((s) => ({ s, d: haversineMi(g!, s) })).filter((x) => x.d <= 25).sort((a, b) => a.d - b.d);
              if (spots.length) hazards.push({ key: 'fire:here', kind: 'fire', severity: spots[0].d <= 5 ? 'high' : 'medium', title: `Fire ${Math.round(spots[0].d)} mi away`, detail: `${spots.length} satellite hotspot${spots.length === 1 ? '' : 's'} within 25 mi (NASA FIRMS)`, mi: 0, at: spots[0].s.at, lat: spots[0].s.lat, lon: spots[0].s.lon });
            } else errors.push(`NASA FIRMS answered ${res.status}`);
          }
        } catch (e) { errors.push(`NASA FIRMS: ${(e as Error).message}`); }
      }
      const rank = { high: 0, medium: 1 };
      hazards.sort((a, b) => a.mi - b.mi || rank[a.severity] - rank[b.severity]);
      this.v = { hazards, checkedAt: new Date(now).toISOString(), following: r ? 'route' : 'here', errors, firesOn: !!key2 };
    } finally { this.busy = false; }
  }
}
