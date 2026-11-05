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
export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  sim: flag(process.env.SIM),
  /** Seconds of simulated driving per real second (SIM only). */
  simSpeedup: Math.max(1, Number(process.env.SIM_SPEEDUP ?? 1) || 1),
  mqttUrl: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
  mqttDisabled: flag(process.env.MQTT_DISABLED),
  gpsdHost: process.env.GPSD_HOST ?? '127.0.0.1',
  gpsdPort: Number(process.env.GPSD_PORT ?? 2947),
  /** The USB Wi-Fi adapter that joins hotspots / home Wi-Fi. wlan0 stays the truck's access point. */
  netClientIface: process.env.NET_CLIENT_IFACE ?? 'wlan1',
  /** GEOCODE_DISABLED=1: never call OpenStreetMap (tests, offline desks). */
  geocodeDisabled: flag(process.env.GEOCODE_DISABLED),
  uiDir: path.resolve(process.env.UI_DIR ?? path.join(BRAIN_ROOT, '../ui/dist')),
  version: version(),
};
