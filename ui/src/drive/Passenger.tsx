// Passenger mode (drive/lockout.ts in the brain): a passenger is using the
// tablet, so video, the browser, long lists, typing and the parked apps stay
// open while the truck moves. Turned on from Settings, Truck, or by tapping
// anything a lockout paused ("Are you the passenger?"). While it is on, a pill in the top strip says so and turns it off with one tap, so the
// driver always knows the lockouts are lifted.
import { useState } from 'preact/hooks';
import { toast } from '../lib/brain.ts';
import { setPassenger, useLockout } from './hooks.ts';

const CONFIRM = 'Are you the passenger?\n\nPassenger mode keeps video, the browser, games and typing open while the truck is moving. The driver should not watch or use the screen while driving.\n\nIt stays on until the truck next starts up. Tap the Passenger pill at the top to turn it off sooner.';

/** Turn passenger mode on (asking first) or off. True when it changed. */
async function flip(on: boolean, setBusy: (b: boolean) => void): Promise<boolean> {
  if (on && !confirm(CONFIRM)) return false;
  setBusy(true);
  try { await setPassenger(on); toast(on ? 'Passenger mode on' : 'Passenger mode off'); return true; } catch (e) { toast(`Not changed: ${(e as Error).message}`); return false; } finally { setBusy(false); }
}

/** A parked-only tool tapped while driving: ask, and on yes turn passenger mode on and carry on to it. */
export function askPassengerThen(then: () => void) {
  void flip(true, () => {}).then((ok) => { if (ok) then(); });
}

/** Tapped something a lockout paused: ask, and on yes turn passenger mode on. */
export function askPassenger(e?: Event) {
  e?.preventDefault(); e?.stopPropagation();
  void flip(true, () => {});
}

/** Settings, Truck tab: the on/off switch. Takes effect at once; it has nothing to do with the Save button. */
export function PassengerSetting() {
  const { passenger, moving } = useLockout();
  const [busy, setBusy] = useState(false);
  return (
    <section class="card" id="passenger">
      <h2>Passenger mode</h2>
      <div class="row wrap" style="gap:var(--s15);align-items:center">
        <label class="check">
          <input type="checkbox" role="switch" checked={passenger} disabled={busy} onChange={(e) => void flip((e.target as HTMLInputElement).checked, setBusy)} />
          {' '}Let a passenger use the tablet while driving
        </label>
        <span class={passenger ? 'okmsg' : 'dimtxt'}>{passenger ? (moving ? 'On: nothing pauses while moving' : 'On') : 'Off'}</span>
      </div>
      <p class="help">
        Over the lockout speed, video, the browser, long lists, typing and the Watch, Games and Karaoke apps normally pause.
        Passenger mode keeps them open. The light strip stays parked only, and camp and pet mode still end when you drive.
        While driving, Settings steps aside, so the top bar shows a <b>Passenger?</b> button, and tapping anything that's paused asks too. It applies straight away (no need to Save),
        shows a <b>Passenger</b> pill in the top bar while it's on (tap it to turn off), and lasts until the truck next starts up.
      </p>
    </section>
  );
}

/** Top strip, while moving and passenger mode is off: the passenger's way in, since Settings steps aside at speed. */
export function PassengerAsk() {
  return (
    <button type="button" class="pill passenger-ask" onClick={() => askPassenger()} title="Passenger? Tap to use the tablet while driving" aria-label="Passenger? Tap to use the tablet while driving">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="7" r="3" /><path d="M5 20c1-4 4-6 7-6s6 2 7 6" /></svg>
      Passenger?
    </button>
  );
}

/** Top strip, while passenger mode is on: tap to turn it off. */
export function PassengerPill() {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" class="pill passenger-pill" disabled={busy} onClick={() => void flip(false, setBusy)} title="Passenger mode is on: tap to turn it off" aria-label="Passenger mode on. Tap to turn off">
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="7" r="3" /><path d="M5 20c1-4 4-6 7-6s6 2 7 6" /></svg>
      Passenger
    </button>
  );
}
