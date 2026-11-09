// /globe/aircraft.json: the truck as one "aircraft" in dump1090's format, so a
// God's Eye View globe on the same LAN can draw it, track it and ride along in
// cockpit view. God's Eye reads it through its Local ADS-B layer:
//   LOCAL_RECEIVER_FEEDS=1090=http://<brain>:<port>/globe/aircraft.json
// God's Eye only fetches private (RFC1918) addresses, sends no login, and wants
// a path ending in aircraft.json, so this lives outside /api with no auth. That
// is why it is on by itself only under SIM; a real truck turns it on with
// GLOBE_FEED=1, knowing anyone on its network can then read where it is.
import type { FastifyInstance } from 'fastify';
import type { State } from './types.ts';

/** An address from ICAO's reserved F block, so it never matches a real aircraft. */
export const GLOBE_HEX = 'f1a7e0';

type Dump1090 = { now: number; messages: number; aircraft: Record<string, unknown>[] };

/** The feed document for the truck's current state. Pure (tested). */
export function globeAircraft(s: Pick<State, 'gps' | 'speedMph'>, nowMs: number, callsign: string, messages: number): Dump1090 {
  const doc: Dump1090 = { now: nowMs / 1000, messages, aircraft: [] };
  if (!s.gps?.fix) return doc; // no fix: nothing to draw, and God's Eye ages the truck out
  doc.aircraft.push({
    hex: GLOBE_HEX,
    flight: callsign.replace(/[^0-9A-Za-z]/g, '').slice(0, 8).toUpperCase().padEnd(8),
    category: 'C2',        // ADS-B: surface vehicle, service
    alt_baro: 'ground',
    lat: s.gps.lat,
    lon: s.gps.lon,
    gs: Math.round((s.speedMph ?? 0) * 0.868976 * 10) / 10, // knots
    ...(s.gps.headingDeg === null ? {} : { track: s.gps.headingDeg }),
    seen: 0,
    seen_pos: 0,
    messages,
  });
  return doc;
}

export function registerGlobe(app: FastifyInstance, state: () => State, opts: { enabled: boolean; callsign: string }) {
  let messages = 0;
  app.get('/globe/aircraft.json', async (_req, reply) => {
    if (!opts.enabled) return reply.code(404).send({ error: 'The globe feed is off (GLOBE_FEED=1 turns it on)' });
    reply.header('Cache-Control', 'no-store');
    return globeAircraft(state(), Date.now(), opts.callsign, ++messages);
  });
}
