// The truck on a Traccar server (traccar.org), as one more vehicle beside the
// ones with their own GPS trackers. Traccar's OsmAnd protocol is plain HTTP:
// one request per position, with any extra query fields kept as attributes,
// which Home Assistant's Traccar Server integration then shows.
//
// Off unless TRACCAR_URL is set (e.g. http://192.168.1.219:5056 on the home
// network, or a public address for the device port). The truck has no modem,
// so a post fails whenever it has no hotspot or Wi-Fi: that position is
// dropped, never queued, and the next one goes when the link is back.
import type { State } from './types.ts';

/** Seconds between reports: while driving, and while parked. */
export const TRACCAR_MOVING_S = 30;
export const TRACCAR_PARKED_S = 600;

/** The OsmAnd request for the truck's current state, or null without a GPS fix. Pure (tested). */
export function traccarUrl(base: string, id: string, s: Pick<State, 'gps' | 'speedMph' | 'soc' | 'rangeMi' | 'ignition' | 'aux12v'>, nowMs: number): string | null {
  if (!s.gps?.fix) return null;
  const q = new URLSearchParams({
    id,
    timestamp: String(Math.floor(nowMs / 1000)),
    lat: String(s.gps.lat),
    lon: String(s.gps.lon),
  });
  if (s.speedMph !== null) q.set('speed', String(Math.round(s.speedMph * 0.868976 * 10) / 10)); // knots
  if (s.gps.headingDeg !== null) q.set('bearing', String(Math.round(s.gps.headingDeg)));
  if (s.soc !== null) q.set('batteryLevel', String(Math.round(s.soc)));
  if (s.rangeMi !== null) q.set('rangeMi', String(Math.round(s.rangeMi)));
  if (s.ignition !== null) q.set('ignition', String(s.ignition));
  if (s.aux12v !== null) q.set('aux12v', String(s.aux12v));
  return `${base.replace(/\/+$/, '')}/?${q.toString()}`;
}

/** Seconds until the next report: often while the truck is on or moving, rarely while parked. */
export function traccarInterval(s: Pick<State, 'ignition' | 'speedMph'>): number {
  return s.ignition || (s.speedMph ?? 0) > 1 ? TRACCAR_MOVING_S : TRACCAR_PARKED_S;
}

/** Starts the report loop. Returns a stop function. */
export function startTraccar(state: () => State, opts: { url: string; id: string }): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let failing = false;
  const tick = async () => {
    const s = state();
    const url = traccarUrl(opts.url, opts.id, s, Date.now());
    if (url) {
      try {
        const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`Traccar said ${res.status}`);
        if (failing) console.log('[traccar] reporting again');
        failing = false;
      } catch (e) {
        if (!failing) console.log(`[traccar] position not sent (${(e as Error).message}); will keep trying`);
        failing = true;
      }
    }
    if (!stopped) timer = setTimeout(tick, traccarInterval(s) * 1000);
  };
  timer = setTimeout(tick, 5_000);
  return () => { stopped = true; if (timer) clearTimeout(timer); };
}
