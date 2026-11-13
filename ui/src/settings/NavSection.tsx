// Settings, Truck: Navigation. Which apps the Navigate window offers on this
// screen, which opens first, and how to set up offline navigation on the dash
// tablet. (CoMaps, Organic Maps and OsmAnd keep their own downloaded maps;
// none lets another app download them, so that step is inside the app.)
import { useState } from 'preact/hooks';
import { getNavPref, getOsmandPackage, getShownApps, isAndroid, NAV_APPS, PLAY, setNavPref, setOsmandPackage, setShownApps, type NavApp, type NavPref, type OsmandPackage } from '../lib/nav.ts';

export function NavSection() {
  const [pref, setPref] = useState<NavPref>(() => getNavPref());
  const [shown, setShown] = useState<NavApp[]>(() => getShownApps());
  const [osm, setOsm] = useState<OsmandPackage>(() => getOsmandPackage());
  const android = isAndroid(navigator.userAgent);
  const toggle = (a: NavApp, on: boolean) => {
    const next = on ? [...shown, a] : shown.filter((x) => x !== a);
    if (!next.length) return; // keep at least one
    setShownApps(next); setShown(getShownApps());
    if (!on && pref === a) { setNavPref('auto'); setPref('auto'); }
  };
  const store = (pkg: string, label: string) => (android ? <> (<a href={PLAY(pkg)} target="_blank" rel="noreferrer">{label}</a>)</> : '');
  return (
    <section class="card" id="navigation">
      <h2>Navigation</h2>
      <p class="help">Charge stops, road-trip stops, the airport pickup and calendar appointments all have a Navigate button. These choices are for this screen: the dash tablet can have apps a phone doesn't.</p>

      <h3 class="sub">Apps to offer</h3>
      <div class="form" style="gap:var(--s1)">
        {NAV_APPS.map((a) => (
          <label class="check"><input type="checkbox" checked={shown.includes(a.id)} disabled={shown.length === 1 && shown.includes(a.id)} onChange={(e) => toggle(a.id, (e.target as HTMLInputElement).checked)} /> <b>{a.label}</b> <span class="dimtxt">· {a.note}</span></label>
        ))}
      </div>

      <h3 class="sub">Opens first</h3>
      <div class="row wrap" style="gap:var(--s15);align-items:flex-end">
        <label class="f" style="min-width:260px"><span>Navigate opens on</span>
          <select value={pref} onChange={(e) => { const v = (e.target as HTMLSelectElement).value as NavPref; setNavPref(v); setPref(v); }}>
            <option value="auto">Automatic: Waze with signal, the first offline app without</option>
            {NAV_APPS.filter((a) => shown.includes(a.id)).map((a) => <option value={a.id}>{a.label}</option>)}
          </select>
        </label>
        {shown.includes('osmand') && (
          <label class="f" style="min-width:200px"><span>OsmAnd version</span>
            <select value={osm} onChange={(e) => { const v = (e.target as HTMLSelectElement).value as OsmandPackage; setOsmandPackage(v); setOsm(v); }}>
              <option value="net.osmand">OsmAnd (free)</option>
              <option value="net.osmand.plus">OsmAnd+ (paid, or F-Droid)</option>
            </select>
          </label>
        )}
      </div>

      <h3 class="sub">Offline navigation on the tablet</h3>
      <p class="help">CoMaps, Organic Maps and OsmAnd are free OpenStreetMap apps with turn-by-turn voice guidance that needs no signal. Set one up once, on Wi-Fi:</p>
      <ol class="help" style="margin:0;padding-left:1.4em;display:grid;gap:var(--s05)">
        <li>Install it: CoMaps{store('app.comaps.google', 'Play')} (also on F-Droid), Organic Maps{store('app.organicmaps', 'Play')}, or OsmAnd{store('net.osmand', 'Play')}.</li>
        <li>Download the maps for your home state and every state you drive through, from inside the app (CoMaps and Organic Maps: <b>Menu → Download maps</b>). A state is about 100-700 MB.</li>
        <li>Allow location access, and turn on voice instructions.</li>
        <li>Tap Navigate anywhere in the cockpit and pick the app. With a GPS fix, CoMaps and Organic Maps open with the route from the truck; tap Start there.</li>
      </ol>
      <p class="help">ABRP has no link that carries a destination, so its tab gives the place to copy and opens ABRP to paste it in.</p>
    </section>
  );
}
