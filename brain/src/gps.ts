// gpsd client over its JSON socket (localhost:2947). Silent when gpsd is absent.
import net from 'node:net';

export type GpsFix = { lat: number; lon: number; speedMph: number | null; headingDeg: number | null; fix: boolean; at: Date };
export type GpsStatus = 'fix' | 'no fix' | 'no gpsd';

const MS_TO_MPH = 2.2369363;

/** Parse one gpsd JSON line. Returns a fix for TPV reports, null otherwise. Pure. */
export function parseGpsdLine(line: string): GpsFix | null {
  let m: Record<string, unknown>;
  try { m = JSON.parse(line); } catch { return null; }
  if (m.class !== 'TPV') return null;
  const mode = Number(m.mode ?? 0);
  const lat = Number(m.lat), lon = Number(m.lon);
  const hasPos = Number.isFinite(lat) && Number.isFinite(lon);
  if (!hasPos) return { lat: NaN, lon: NaN, speedMph: null, headingDeg: null, fix: false, at: new Date() };
  const speed = Number(m.speed);
  const track = Number(m.track);
  return {
    lat, lon,
    speedMph: Number.isFinite(speed) ? speed * MS_TO_MPH : null,
    headingDeg: Number.isFinite(track) ? track : null,
    fix: mode >= 2,
    at: typeof m.time === 'string' && Number.isFinite(Date.parse(m.time)) ? new Date(m.time) : new Date(),
  };
}

export class GpsdClient {
  connected = false;
  last: GpsFix | null = null;
  private sock: net.Socket | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private logged = false;

  private host: string;
  private port: number;
  private onFix: (f: GpsFix) => void;

  constructor(host: string, port: number, onFix: (f: GpsFix) => void) { this.host = host; this.port = port; this.onFix = onFix; }

  get status(): GpsStatus {
    if (!this.connected) return 'no gpsd';
    return this.last?.fix && Date.now() - this.last.at.getTime() < 10_000 ? 'fix' : 'no fix';
  }

  start() { this.connect(); }

  private connect() {
    if (this.stopped) return;
    const s = net.connect({ host: this.host, port: this.port });
    this.sock = s;
    let buf = '';
    s.setEncoding('utf8');
    s.on('connect', () => {
      this.connected = true; this.logged = false;
      console.log(`[gps] gpsd at ${this.host}:${this.port}`);
      s.write('?WATCH={"enable":true,"json":true};\n');
    });
    s.on('data', (d: string) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        const f = parseGpsdLine(line);
        if (f) { this.last = f; if (f.fix) this.onFix(f); }
      }
      if (buf.length > 65536) buf = '';
    });
    s.on('error', (e) => {
      if (!this.logged) { console.log(`[gps] no gpsd at ${this.host}:${this.port} (${(e as NodeJS.ErrnoException).code ?? e.message}); retrying every 15 s`); this.logged = true; }
    });
    s.on('close', () => {
      this.connected = false; this.sock = null;
      if (!this.stopped) this.timer = setTimeout(() => this.connect(), 15_000);
    });
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.sock?.destroy();
  }
}
