// The dash tablet as the truck's GPS. The cockpit page asks its own browser
// for location (navigator.geolocation) and sends each fix over the socket as
// {"type":"gps", lat, lon, accM, speedMps, headingDeg, altM}; the brain uses
// it whenever there's no GPS puck (gpsd) with a fresh fix, so a puck, when
// fitted, always wins. Browsers only share location with secure pages: on the
// truck's own http Wi-Fi, Chrome on the tablet needs the dash address under
// chrome://flags "Insecure origins treated as secure" (deploy/android/README.md).
//
// Only the dash tablet may feed it: an Android browser on a private LAN or
// Tailscale address (the same test as the tablet's hello), with the setting
// on. A laptop opening the cockpit at home never moves the truck. The tablet
// sleeps with the ignition off, so parked features (theft and tow alerts,
// "where's the truck") still need a puck or the LTE-M watch.
import { okTabletIp } from './tablet.ts';
import type { GpsFix } from './gps.ts';

const MS_TO_MPH = 2.2369363;
/** A fix worse than this is position-only (fix: false): Wi-Fi/cell guesses, not GPS. */
export const TABLET_MAX_ACC_M = 100;
/** A puck fix younger than this keeps the tablet's ignored. */
export const PUCK_FRESH_MS = 5000;

/** Is this socket the dash tablet? Android, on a private or Tailscale address. Pure. */
export const isDashTablet = (ip: string | undefined, ua: string | undefined) => !!ip && !!ua && /Android/i.test(ua) && okTabletIp(ip.replace(/^::ffff:/, ''));

/** A socket message → a GPS fix, or null when it isn't a usable one. Pure. */
export function tabletFix(m: Record<string, unknown>, now: number): GpsFix | null {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const lat = num(m.lat), lon = num(m.lon), acc = num(m.accM);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return null;
  const spd = num(m.speedMps), hdg = num(m.headingDeg), alt = num(m.altM);
  return {
    lat, lon,
    speedMph: spd !== null && spd >= 0 && spd < 90 ? spd * MS_TO_MPH : null,
    headingDeg: hdg !== null && hdg >= 0 && hdg <= 360 ? hdg : null,
    fix: acc !== null && acc > 0 && acc <= TABLET_MAX_ACC_M,
    at: new Date(now), // the brain's clock: a tablet's can be off
    altM: alt,
  };
}

/** Which source feeds the position now. Pure. */
export function useTabletFix(o: { enabled: boolean; puckFixAt: number; simOwnsGps: boolean; now: number }): boolean {
  if (!o.enabled || o.simOwnsGps) return false;
  return o.now - o.puckFixAt > PUCK_FRESH_MS;
}
