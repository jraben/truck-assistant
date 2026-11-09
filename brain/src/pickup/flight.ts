// Airport pickup: which flight, where it is, and when to leave. Pure.
//
// Position comes from ADS-B (adsb.fi's open data, by callsign) and the route
// from adsbdb; both are free and keyless. ADS-B says where the plane is, not
// the gate, the official arrival time or the baggage carousel: those need a
// paid flight-status service, and the screen says so.
import { haversineMi } from '../geo.ts';

/** IATA airline code → ICAO (the callsign prefix ADS-B uses). The common North American carriers and a few more. */
export const AIRLINES: Record<string, { icao: string; name: string }> = {
  AA: { icao: 'AAL', name: 'American' }, UA: { icao: 'UAL', name: 'United' }, DL: { icao: 'DAL', name: 'Delta' },
  WN: { icao: 'SWA', name: 'Southwest' }, AS: { icao: 'ASA', name: 'Alaska' }, B6: { icao: 'JBU', name: 'JetBlue' },
  NK: { icao: 'NKS', name: 'Spirit' }, F9: { icao: 'FFT', name: 'Frontier' }, G4: { icao: 'AAY', name: 'Allegiant' },
  HA: { icao: 'HAL', name: 'Hawaiian' }, SY: { icao: 'SCX', name: 'Sun Country' }, MX: { icao: 'MXY', name: 'Breeze' },
  AC: { icao: 'ACA', name: 'Air Canada' }, WS: { icao: 'WJA', name: 'WestJet' }, AM: { icao: 'AMX', name: 'Aeroméxico' },
  Y4: { icao: 'VOI', name: 'Volaris' }, BA: { icao: 'BAW', name: 'British Airways' }, LH: { icao: 'DLH', name: 'Lufthansa' },
  AF: { icao: 'AFR', name: 'Air France' }, KL: { icao: 'KLM', name: 'KLM' }, OO: { icao: 'SKW', name: 'SkyWest' },
  YX: { icao: 'RPA', name: 'Republic' }, MQ: { icao: 'ENY', name: 'Envoy' }, OH: { icao: 'JIA', name: 'PSA' }, '9E': { icao: 'EDV', name: 'Endeavor' },
};
const BY_NAME = Object.fromEntries(Object.entries(AIRLINES).map(([iata, a]) => [a.name.toLowerCase(), iata]));

export type FlightId = { iata: string | null; number: string; callsign: string; label: string };

/** "AA 1234", "aa1234", "AAL1234", "American 1234" → the ADS-B callsign. Null when it isn't a flight number. */
export function parseFlight(text: string): FlightId | null {
  const t = text.trim();
  let m = /^([A-Za-z]{3})\s*(\d{1,4})$/.exec(t);
  if (m) {
    const icao = m[1].toUpperCase();
    const iata = Object.entries(AIRLINES).find(([, a]) => a.icao === icao)?.[0] ?? null;
    return { iata, number: m[2], callsign: `${icao}${m[2]}`, label: `${iata ?? icao} ${m[2]}` };
  }
  m = /^([A-Za-z]\d|\d[A-Za-z]|[A-Za-z]{2})\s*(\d{1,4})$/.exec(t);
  if (m) {
    const iata = m[1].toUpperCase(), a = AIRLINES[iata];
    if (!a) return null;
    return { iata, number: m[2], callsign: `${a.icao}${m[2]}`, label: `${iata} ${m[2]}` };
  }
  m = /^([A-Za-zé ]+?)\s+(?:flight\s+)?(\d{1,4})$/i.exec(t);
  if (m) {
    const iata = BY_NAME[m[1].trim().toLowerCase()];
    if (iata) return { iata, number: m[2], callsign: `${AIRLINES[iata].icao}${m[2]}`, label: `${iata} ${m[2]}` };
  }
  return null;
}

/** A flight number in free text (a calendar event: "Pick up Sam, AA 1234"). */
export function findFlight(text: string): FlightId | null {
  const re = /\b([A-Z]{2}|[A-Z]\d|\d[A-Z])\s?(\d{1,4})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) { const f = parseFlight(`${m[1]} ${m[2]}`); if (f) return f; }
  const n = /\b(American|United|Delta|Southwest|Alaska|JetBlue|Spirit|Frontier|Allegiant|Hawaiian|Breeze)\s+(?:flight\s+)?(\d{1,4})\b/i.exec(text);
  return n ? parseFlight(`${n[1]} ${n[2]}`) : null;
}

/** What ADS-B says right now (readsb fields). */
/** hex: the ICAO 24-bit address (adsb.fi `hex`), for God's Eye to match the plane with its own ADS-B. */
export type Aircraft = { lat: number; lon: number; altFt: number | 'ground' | null; gsKt: number | null; track: number | null; seenAt: number; hex?: string | null };
export type Airport = { iata: string | null; icao: string | null; name: string; city: string | null; lat: number; lon: number };

export function parseAdsb(body: unknown, now: number): Aircraft | null {
  const ac = (body as { ac?: Record<string, unknown>[]; aircraft?: Record<string, unknown>[] } | null)?.ac ?? (body as { aircraft?: Record<string, unknown>[] } | null)?.aircraft;
  const a = Array.isArray(ac) ? ac.find((x) => typeof x.lat === 'number' && typeof x.lon === 'number') : null;
  if (!a) return null;
  const alt = a.alt_baro === 'ground' ? 'ground' : typeof a.alt_baro === 'number' ? a.alt_baro : null;
  const seen = typeof a.seen_pos === 'number' ? a.seen_pos : typeof a.seen === 'number' ? a.seen : 0;
  const hex = typeof a.hex === 'string' && /^~?[0-9a-f]{6}$/i.test(a.hex) ? a.hex.replace('~', '').toLowerCase() : null;
  return { lat: a.lat as number, lon: a.lon as number, altFt: alt, gsKt: typeof a.gs === 'number' ? a.gs : null, track: typeof a.track === 'number' ? a.track : null, seenAt: now - seen * 1000, hex };
}

export function parseRoute(body: unknown): { origin: Airport | null; destination: Airport | null } {
  const r = (body as { response?: { flightroute?: { origin?: Record<string, unknown>; destination?: Record<string, unknown> } } } | null)?.response?.flightroute;
  const ap = (x: Record<string, unknown> | undefined): Airport | null => (x && typeof x.latitude === 'number' && typeof x.longitude === 'number'
    ? { iata: (x.iata_code as string) ?? null, icao: (x.icao_code as string) ?? null, name: String(x.name ?? x.iata_code ?? 'Airport'), city: (x.municipality as string) ?? null, lat: x.latitude as number, lon: x.longitude as number } : null);
  return { origin: ap(r?.origin), destination: ap(r?.destination) };
}

export type PickupPhase = 'waiting' | 'en-route' | 'approach' | 'landed' | 'taxiing' | 'at-gate' | 'lost';

export type PickupState = {
  phase: PickupPhase;
  milesOut: number | null;
  /** When it should touch down / reach the gate / be out front, and when to leave. */
  landsAt: string | null;
  gateAt: string | null;
  readyAt: string | null;
  leaveAt: string | null;
  driveMin: number | null;
  line: string;
  /** Where the plane is (fresh ADS-B only), for the card and the God's Eye globe. */
  plane?: { lat: number; lon: number; altFt: number | 'ground' | null; gsKt: number | null; track: number | null; hex: string | null } | null;
  /** The airline's own word (FlightAware AeroAPI, only with a key in Settings). */
  official?: Official | null;
};

/** Gate, bags and delays from FlightAware AeroAPI: the part ADS-B can't know. */
export type Official = {
  status: string | null;
  gate: string | null; terminal: string | null; baggage: string | null;
  /** Arrival delay in minutes (+ late, − early), or null. */
  delayMin: number | null;
  /** Estimated touchdown ("on") and gate arrival ("in"). */
  estimatedOn: string | null; estimatedIn: string | null;
  cancelled: boolean; diverted: boolean;
  checkedAt: string;
};

/**
 * AeroAPI `GET /flights/{ident}` → the leg arriving nearest now (it lists a
 * few days either side). Field names from AeroAPI v4's documented schema; not
 * yet checked against a live answer. Pure.
 */
export function parseAeroApi(body: unknown, now: number): Official | null {
  const fl = (body as { flights?: Record<string, unknown>[] } | null)?.flights;
  if (!Array.isArray(fl) || !fl.length) return null;
  const t = (v: unknown) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : null);
  const arrive = (f: Record<string, unknown>) => Date.parse(t(f.estimated_on) ?? t(f.scheduled_on) ?? t(f.estimated_in) ?? t(f.scheduled_in) ?? '') || Infinity;
  const f = [...fl].sort((a, b) => Math.abs(arrive(a) - now) - Math.abs(arrive(b) - now))[0];
  const delay = typeof f.arrival_delay === 'number' ? Math.round(f.arrival_delay / 60) : null;
  return {
    status: s(f.status), gate: s(f.gate_destination), terminal: s(f.terminal_destination), baggage: s(f.baggage_claim),
    delayMin: delay, estimatedOn: t(f.estimated_on), estimatedIn: t(f.estimated_in),
    cancelled: f.cancelled === true, diverted: f.diverted === true, checkedAt: new Date(now).toISOString(),
  };
}

/** Minutes from touchdown to the gate, and from the gate to the curb (more with checked bags). */
export const TAXI_MIN = 10;
export const DEPLANE_MIN = 15;
export const BAGS_MIN = 25;

/**
 * Where the flight is in its arrival, from one ADS-B reading. `landedAt` is
 * when it was first seen on the ground at the destination (kept by the caller).
 */
export function pickupState(o: { now: number; ac: Aircraft | null; dest: Airport | null; landedAt: number | null; stoppedSince: number | null; bags: boolean; driveMin: number | null; label: string; who: string | null }): PickupState {
  const ac = o.ac;
  const plane = ac && o.now - ac.seenAt <= 10 * 60_000 ? { lat: ac.lat, lon: ac.lon, altFt: ac.altFt, gsKt: ac.gsKt, track: ac.track, hex: ac.hex ?? null } : null;
  return { ...stateOf(o), plane };
}

function stateOf(o: Parameters<typeof pickupState>[0]): PickupState {
  const { now, ac, dest } = o;
  const iso = (t: number) => new Date(t).toISOString();
  const curb = (o.bags ? BAGS_MIN : 0) + DEPLANE_MIN;
  const who = o.who ? `${o.who}'s ` : '';
  const leave = (ready: number) => (o.driveMin === null ? null : ready - (o.driveMin + 5) * 60_000);
  if (!dest) return { phase: ac ? 'en-route' : 'waiting', milesOut: null, landsAt: null, gateAt: null, readyAt: null, leaveAt: null, driveMin: o.driveMin, line: ac ? `${o.label} is flying; its destination isn't known.` : `${o.label} isn't in the air yet.` };
  if (!ac || now - ac.seenAt > 10 * 60_000) {
    if (o.landedAt) { const gate = o.landedAt + TAXI_MIN * 60_000; const ready = gate + curb * 60_000; return { phase: 'at-gate', milesOut: 0, landsAt: iso(o.landedAt), gateAt: iso(gate), readyAt: iso(ready), leaveAt: leave(ready) ? iso(leave(ready)!) : null, driveMin: o.driveMin, line: `${who}${o.label} landed; out front about ${new Date(ready).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.` }; }
    return { phase: ac ? 'lost' : 'waiting', milesOut: null, landsAt: null, gateAt: null, readyAt: null, leaveAt: null, driveMin: o.driveMin, line: ac ? `${o.label}: no recent position (out of receiver range).` : `${who}${o.label} isn't in the air yet.` };
  }
  const mi = haversineMi(ac, dest);
  const onGround = ac.altFt === 'ground' || (typeof ac.altFt === 'number' && ac.altFt < 200 && (ac.gsKt ?? 0) < 60);
  if (onGround && mi < 5) {
    const landed = o.landedAt ?? now;
    const stopped = o.stoppedSince !== null && now - o.stoppedSince > 90_000;
    const gate = stopped ? Math.min(now, landed + TAXI_MIN * 60_000) : Math.max(now, landed + TAXI_MIN * 60_000);
    const ready = gate + curb * 60_000;
    const l = leave(ready);
    return { phase: stopped ? 'at-gate' : 'taxiing', milesOut: 0, landsAt: iso(landed), gateAt: iso(gate), readyAt: iso(ready), leaveAt: l ? iso(l) : null, driveMin: o.driveMin,
      line: stopped ? `${who}${o.label} is at the gate: out front in about ${Math.round((ready - now) / 60_000)} min.` : `${who}${o.label} landed and is taxiing.` };
  }
  // In the air: distance over ground speed, slowed for the approach.
  const gs = Math.max(ac.gsKt ?? 400, 140) * 1.15078;
  const toLand = (mi / (gs * 0.85)) * 60 + (mi > 40 ? 6 : 2);
  const lands = now + toLand * 60_000, gate = lands + TAXI_MIN * 60_000, ready = gate + curb * 60_000;
  const l = leave(ready);
  const when = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const leaveTxt = l === null ? '' : l <= now ? ' Leave now.' : ` Leave by ${when(l)}.`;
  return { phase: mi < 40 ? 'approach' : 'en-route', milesOut: Math.round(mi), landsAt: iso(lands), gateAt: iso(gate), readyAt: iso(ready), leaveAt: l ? iso(l) : null, driveMin: o.driveMin,
    line: `${who}${o.label} is ${Math.round(mi)} mi out, lands about ${when(lands)}.${leaveTxt}` };
}
