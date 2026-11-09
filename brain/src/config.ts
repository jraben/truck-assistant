import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url)); // brain/src or brain/dist
export const BRAIN_ROOT = path.resolve(here, '..');

function flag(v: string | undefined): boolean {
  return v === '1' || v === 'true' || v === 'yes';
}

function version(): string {
  try { return JSON.parse(readFileSync(path.join(BRAIN_ROOT, 'package.json'), 'utf8')).version ?? '0.0.0'; } catch { return '0.0.0'; }
}

/** Process config. Only plumbing lives here; secrets (API keys) go in Settings, via the settings page. */
const demo = flag(process.env.DEMO);

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  /** DEMO=1: a screen-recording truck. Implies SIM; every real integration is
   *  blocked (src/demo/gate.ts) and an empty DATA_DIR is seeded with invented data. */
  demo,
  sim: demo || flag(process.env.SIM),
  /** Seconds of simulated driving per real second (SIM only). */
  /** SIM only: push automatic alerts and maintenance reminders to the phone. Off by
   *  default, so a simulated truck's "cabin hot" / "moved" alerts don't reach Jeff. */
  simAlerts: !demo && flag(process.env.SIM_ALERTS),
  simSpeedup: Math.max(1, Number(process.env.SIM_SPEEDUP ?? 1) || 1),
  /** OSRM server for road-trip routes (default: OSRM's public demo server, light use only). */
  routerUrl: process.env.ROUTER_URL || undefined,
  /** /globe/aircraft.json, the truck for a God's Eye View globe (src/globe.ts). On
   *  under SIM; a real truck needs GLOBE_FEED=1, since the feed has no login. */
  globeFeed: demo || flag(process.env.SIM) || flag(process.env.GLOBE_FEED),
  /** The truck's name on the globe (8 letters or digits at most). */
  globeCallsign: process.env.GLOBE_CALLSIGN ?? 'TRUCK',
  mqttUrl: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
  mqttDisabled: demo || flag(process.env.MQTT_DISABLED),
  gpsdHost: process.env.GPSD_HOST ?? '127.0.0.1',
  gpsdPort: Number(process.env.GPSD_PORT ?? 2947),
  /** The USB Wi-Fi adapter that joins hotspots / home Wi-Fi. wlan0 stays the truck's access point. */
  netClientIface: process.env.NET_CLIENT_IFACE ?? 'wlan1',
  /** GEOCODE_DISABLED=1: never call OpenStreetMap (tests, offline desks). */
  geocodeDisabled: demo || flag(process.env.GEOCODE_DISABLED),
  uiDir: path.resolve(process.env.UI_DIR ?? path.join(BRAIN_ROOT, '../ui/dist')),
  version: version(),
};
