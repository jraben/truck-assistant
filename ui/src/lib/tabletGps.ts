// The dash tablet as the truck's GPS (brain/src/tabletGps.ts): this browser's
// location, sent over the socket at most once a second. Starts only on an
// Android tablet (the dash) or when the SIM test panel's desk test is on, so a
// laptop opening the cockpit never prompts for location. The brain decides
// whether to use it (setting on, no GPS puck with a fresh fix).
import { useEffect } from 'preact/hooks';
import { sendQuiet, settingsStore, store, useStore } from './brain.ts';

export type TabletGpsStatus = 'off' | 'insecure' | 'denied' | 'unavailable' | 'waiting' | 'sending';
export const tabletGpsStore = store<TabletGpsStatus>('off');
export const DESK_TEST_KEY = 'slate.gps.device';

const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

/** Should this screen send its location? Pure. */
export function wantsTabletGps(o: { setting: boolean | undefined; ua: string; deskTest: boolean; hasGeo: boolean }): boolean {
  return o.setting !== false && o.hasGeo && (/Android/i.test(o.ua) || o.deskTest);
}

/** A browser position → the socket message. Pure. */
export function gpsMessage(c: { latitude: number; longitude: number; accuracy: number; speed: number | null; heading: number | null; altitude: number | null }) {
  return {
    type: 'gps', lat: c.latitude, lon: c.longitude, accM: c.accuracy,
    speedMps: c.speed ?? null,
    headingDeg: c.heading !== null && Number.isFinite(c.heading) ? c.heading : null,
    altM: c.altitude ?? null,
  };
}

export function useTabletGps() {
  const settings = useStore(settingsStore);
  const on = wantsTabletGps({ setting: settings?.tabletGps, ua: navigator.userAgent, deskTest: lsGet(DESK_TEST_KEY) === '1', hasGeo: 'geolocation' in navigator });
  useEffect(() => {
    if (!on) { tabletGpsStore.set('off'); return; }
    // Browsers only share location with secure pages: http on the truck's Wi-Fi needs the Chrome flag.
    if (!window.isSecureContext) { tabletGpsStore.set('insecure'); return; }
    tabletGpsStore.set('waiting');
    let last = 0;
    // A fix that arrives before the socket is open (the first one, on load) is kept and sent once it is.
    let unsent: ReturnType<typeof gpsMessage> | null = null;
    const send = (m: ReturnType<typeof gpsMessage>) => { if (sendQuiet(m)) { unsent = null; tabletGpsStore.set('sending'); } else unsent = m; };
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const now = Date.now();
        if (now - last < 1000) return;
        last = now;
        send(gpsMessage(p.coords));
      },
      (e) => tabletGpsStore.set(e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
    const retry = setInterval(() => { if (unsent) send(unsent); }, 1000);
    return () => { navigator.geolocation.clearWatch(id); clearInterval(retry); };
  }, [on]);
}
