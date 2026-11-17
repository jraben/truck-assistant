// Startup: the truck being assembled, once when the cockpit opens (the kiosk boots
// into it). Tap anywhere to skip. Never while the truck is moving: if it is (or turns
// out to be once the brain answers), it goes away at once. Not again in the same
// browser session, so the reload after an update (which showed it already) skips it.
import { useEffect, useState } from 'preact/hooks';
import { settingsStore, stateStore, useStore } from '../lib/brain.ts';
import { PROJECT } from '../../../brain/src/project.ts';
import { truckOf } from './hooks.ts';
import { Assembly } from './Assembly.tsx';

const KEY = 'slate.assembled';
const seen = () => { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } };
const mark = () => { try { sessionStorage.setItem(KEY, '1'); } catch { /* private window */ } };

/** Whether to play it: not seen this session, and the truck isn't moving. Pure. */
export function shouldPlay(alreadySeen: boolean, moving: boolean, noSplash: boolean): boolean {
  return !alreadySeen && !moving && !noSplash;
}

export function StartupAssembly() {
  const s = useStore(stateStore);
  const settings = useStore(settingsStore);
  const [on, setOn] = useState(() => shouldPlay(seen(), false, /[?&]nosplash\b/.test(location.search)));
  const [leaving, setLeaving] = useState(false);
  const moving = !!s?.drive?.lockout.locked || (s?.speedMph ?? 0) > 3;
  const close = () => { mark(); setLeaving(true); setTimeout(() => setOn(false), 350); };
  useEffect(() => { if (on && moving) { mark(); setOn(false); } }, [moving, on]);
  useEffect(() => { if (on) mark(); }, []);
  if (!on) return null;
  return (
    <div class={`startup-assembly${leaving ? ' leaving' : ''}`} role="dialog" aria-label={`${PROJECT.name} starting`} onClick={close}>
      <div class="sa-top"><span class="sa-brand"><img src="/icon.svg" alt="" />{PROJECT.name}</span><span class="sa-skip">Tap to skip</span></div>
      <Assembly t={truckOf(settings)} captions id="startup-asm" onDone={() => setTimeout(close, 900)} />
    </div>
  );
}
