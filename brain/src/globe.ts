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
/** The inbound pickup flight when ADS-B gave no hex (same reserved block). */
export const PICKUP_HEX = 'f1a7e2';

/** The airport pickup's inbound plane, drawn beside the truck so the two can be seen converging. */
export type InboundPlane = { callsign: string; lat: number; lon: number; altFt: number | 'ground' | null; gsKt: number | null; track: number | null; hex: string | null };

type Dump1090 = { now: number; messages: number; aircraft: Record<string, unknown>[] };

/** The feed document for the truck's current state. Pure (tested). */
export function globeAircraft(s: Pick<State, 'gps' | 'speedMph'>, nowMs: number, callsign: string, messages: number, plane: InboundPlane | null = null): Dump1090 {
  const doc: Dump1090 = { now: nowMs / 1000, messages, aircraft: [] };
  // The real hex when ADS-B gave one: God's Eye's Local ADS-B card can then look up the aircraft type.
  // It does NOT merge with God's Eye's public Flights layer (that only de-duplicates against its
  // Military layer), so with Flights on the plane shows twice; turn Flights off to see it once.
  if (plane) doc.aircraft.push({
    hex: plane.hex ?? PICKUP_HEX,
    flight: plane.callsign.replace(/[^0-9A-Za-z]/g, '').slice(0, 8).toUpperCase().padEnd(8),
    alt_baro: plane.altFt ?? 'ground',
    lat: plane.lat, lon: plane.lon,
    ...(plane.gsKt === null ? {} : { gs: plane.gsKt }),
    ...(plane.track === null ? {} : { track: plane.track }),
    seen: 0, seen_pos: 0, messages,
  });
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

export function registerGlobe(app: FastifyInstance, state: () => State, opts: { enabled: boolean; callsign: string; plane?: () => InboundPlane | null }) {
  let messages = 0;
  app.get('/globe/aircraft.json', async (_req, reply) => {
    if (!opts.enabled) return reply.code(404).send({ error: 'The globe feed is off (GLOBE_FEED=1 turns it on)' });
    reply.header('Cache-Control', 'no-store');
    return globeAircraft(state(), Date.now(), opts.callsign, ++messages, opts.plane?.() ?? null);
  });
}
