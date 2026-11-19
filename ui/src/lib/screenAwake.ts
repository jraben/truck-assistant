// Keep the screen on while the truck is on, and only then.
//
// The dash tablet charges whenever the truck is on (Tasker's "Power Any"), so
// "charging" is the signal: hold a screen wake lock while it charges, and let it
// go on battery so Android's own timeout and Tasker's lock after the truck turns
// off (Settings › Truck, "Dash tablet when the truck turns off") can sleep it.
// Before the cockpit moved to an https address Chrome ignored the wake lock (it
// needs a secure page), so it never mattered; on https, holding it all the time
// kept the screen on overnight and ran the battery flat.
// Where there's no battery to ask about (the Pi's own screen, a desktop), hold it.

type Battery = { charging: boolean; addEventListener: (t: 'chargingchange', f: () => void) => void };
type WakeLock = { release: () => Promise<void>; addEventListener?: (t: 'release', f: () => void) => void };
type Nav = Navigator & { getBattery?: () => Promise<Battery>; wakeLock?: { request: (t: 'screen') => Promise<WakeLock> } };

/** Hold the screen on? Charging (truck on) or no battery to ask about: yes. On battery: no. Pure. */
export const shouldHold = (battery: { charging: boolean } | null): boolean => !battery || battery.charging;

export function keepScreenAwakeWhileCharging(nav: Nav = navigator as Nav, doc: Document = document): void {
  if (!nav.wakeLock) return;
  let battery: Battery | null = null;
  let lock: WakeLock | null = null;
  let asking = false;
  const sync = async () => {
    const want = shouldHold(battery) && doc.visibilityState === 'visible';
    if (want && !lock && !asking) {
      asking = true;
      try {
        lock = await nav.wakeLock!.request('screen');
        lock.addEventListener?.('release', () => { lock = null; }); // Chrome lets go when the page is hidden
      } catch { /* not allowed now (battery saver, hidden): try again on the next change */ }
      finally { asking = false; }
    } else if (!want && lock) {
      const l = lock; lock = null;
      await l.release().catch(() => {});
    }
  };
  doc.addEventListener('visibilitychange', () => void sync());
  if (nav.getBattery) {
    nav.getBattery().then((b) => { battery = b; b.addEventListener('chargingchange', () => void sync()); void sync(); }, () => void sync());
  } else void sync();
}
