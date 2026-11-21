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
//
// Wait a few seconds before taking the lock. When the truck turns on, Tasker
// re-launches the cockpit app about 0.1 s after the tablet starts charging (and
// right after it turns the screen on). If Chrome holds the page's wake lock when
// the app is re-launched, its keep-screen-on gets stuck: release() then returns
// but the screen never sleeps again until the page is hidden, so on battery the
// screen stayed on and the battery ran down anyway. Re-launching with no lock
// held is harmless, so let that settle first. Letting go is still immediate.

type Battery = { charging: boolean; addEventListener: (t: 'chargingchange', f: () => void) => void };
type WakeLock = { release: () => Promise<void>; addEventListener?: (t: 'release', f: () => void) => void };
type Nav = Navigator & { getBattery?: () => Promise<Battery>; wakeLock?: { request: (t: 'screen') => Promise<WakeLock> } };

/** How long to wait, after the screen should go on, before taking the lock (Tasker's re-launch comes first). */
export const SETTLE_MS = 5000;

/** Hold the screen on? Charging (truck on) or no battery to ask about: yes. On battery: no. Pure. */
export const shouldHold = (battery: { charging: boolean } | null): boolean => !battery || battery.charging;

export function keepScreenAwakeWhileCharging(nav: Nav = navigator as Nav, doc: Document = document, settleMs = SETTLE_MS): void {
  if (!nav.wakeLock) return;
  let battery: Battery | null = null;
  let lock: WakeLock | null = null;
  let asking = false;
  let wait: ReturnType<typeof setTimeout> | null = null;
  const want = () => shouldHold(battery) && doc.visibilityState === 'visible';
  const take = async () => {
    wait = null;
    if (!want() || lock || asking) return;
    asking = true;
    try {
      const l = await nav.wakeLock!.request('screen');
      if (!want()) { await l.release().catch(() => {}); return; } // unplugged or hidden while asking
      lock = l;
      l.addEventListener?.('release', () => { if (lock === l) lock = null; }); // Chrome lets go when the page is hidden
    } catch { /* not allowed now (battery saver, hidden): try again on the next change */ }
    finally { asking = false; }
  };
  const sync = async () => {
    if (want()) {
      // Every change restarts the wait, so a re-launch right after it still comes before the lock.
      if (!lock) { if (wait) clearTimeout(wait); wait = setTimeout(() => void take(), settleMs); }
      return;
    }
    if (wait) { clearTimeout(wait); wait = null; }
    if (lock) { const l = lock; lock = null; await l.release().catch(() => {}); }
  };
  doc.addEventListener('visibilitychange', () => void sync());
  if (nav.getBattery) {
    nav.getBattery().then((b) => { battery = b; b.addEventListener('chargingchange', () => void sync()); void sync(); }, () => void sync());
  } else void sync();
}
