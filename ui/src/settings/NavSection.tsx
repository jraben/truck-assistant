// Settings, Truck: Navigation. Which app the Navigate window opens first on
// this screen, and how to set up Organic Maps on the dash tablet for
// navigation with no signal. (Organic Maps keeps its own downloaded maps; it
// has no way for another app to download them, so that step is in Organic Maps.)
import { useState } from 'preact/hooks';
import { getNavPref, isAndroid, ORGANIC_PLAY, setNavPref, type NavPref } from '../lib/nav.ts';

const CHOICES: [NavPref, string, string][] = [
  ['auto', 'Automatic', 'Waze while the truck has internet, Organic Maps when it has none'],
  ['waze', 'Waze', 'On the iPhone, through CarPlay. Needs signal'],
  ['organic', 'Organic Maps', 'On this tablet. Works with no signal in downloaded states'],
];

export function NavSection() {
  const [pref, setPref] = useState<NavPref>(() => getNavPref());
  const pick = (v: NavPref) => { setNavPref(v); setPref(v); };
  const android = isAndroid(navigator.userAgent);
  return (
    <section class="card" id="navigation">
      <h2>Navigation</h2>
      <p class="help">Charge stops, road-trip stops, the airport pickup and calendar appointments all have a Navigate button. Both apps are always offered; this picks which one it opens on first, on this screen.</p>
      <div class="form" style="gap:var(--s1)" role="radiogroup" aria-label="Navigation app">
        {CHOICES.map(([v, label, why]) => (
          <label class="check"><input type="radio" name="navapp" checked={pref === v} onChange={() => pick(v)} /> <b>{label}</b> <span class="dimtxt">· {why}</span></label>
        ))}
      </div>

      <h3 class="sub">Offline navigation with Organic Maps</h3>
      <p class="help">Organic Maps is a free OpenStreetMap navigation app with turn-by-turn directions and voice guidance that need no signal at all. Set it up once on the dash tablet, on Wi-Fi:</p>
      <ol class="help" style="margin:0;padding-left:1.4em;display:grid;gap:var(--s05)">
        <li>Install Organic Maps from Google Play{android ? <> (<a href={ORGANIC_PLAY} target="_blank" rel="noreferrer">open its page</a>)</> : ''}.</li>
        <li>In Organic Maps, open <b>Menu → Download maps</b> and download your home state and every state you drive through. A state is about 100-700 MB.</li>
        <li>Allow it location access, and turn on <b>Settings → Navigation → Voice instructions</b>.</li>
        <li>Tap Navigate anywhere in the cockpit, choose <b>Organic Maps (offline)</b>, and the route starts from the truck's position.</li>
      </ol>
      <p class="help">Update its maps now and then from the same Download maps screen; it asks when a newer map is out.</p>
    </section>
  );
}
