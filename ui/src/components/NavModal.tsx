// "Navigate": every place the cockpit sends somewhere (chargers, road-trip
// stops, the airport pickup, calendar appointments) opens this. Waze goes to
// the iPhone and CarPlay; CoMaps, Organic Maps and OsmAnd navigate on the dash
// tablet itself, offline; ABRP gets the place to paste. lib/nav.ts builds the
// links; Settings, Truck, Navigation picks which apps show and which comes first.
import { useMemo, useState } from 'preact/hooks';
import { renderSVG } from 'uqr';
import { stateStore, useStore } from '../lib/brain.ts';
import { ABRP_URL, abrpText, appLabel, comapsLink, getNavPref, getOsmandPackage, getShownApps, isAndroid, NAV_APPS, organicLink, osmandLink, pickApp, tabletLink, wazeLink, type NavApp, type NavTarget } from '../lib/nav.ts';
import { CarPlayWazeHint } from './carplay.tsx';
import { Modal } from './common.tsx';

function Link({ url, label }: { url: string; label: string }) {
  const svg = useMemo(() => renderSVG(url, { border: 1 }), [url]);
  const [copied, setCopied] = useState(false);
  return (
    <div class="row wrap" style="gap:var(--s3);align-items:flex-start">
      <div class="qr" dangerouslySetInnerHTML={{ __html: svg }} aria-label={`QR code for the ${label} link`} />
      <div class="grow" style="display:grid;gap:var(--s1);min-width:200px">
        <code style="word-break:break-all;font-size:var(--fs-caption)">{url}</code>
        <div class="row wrap">
          <button class="btn" type="button" onClick={() => { void navigator.clipboard?.writeText(url).then(() => setCopied(true)); }}>{copied ? 'Copied' : 'Copy link'}</button>
          <a class="btn" href={url} target="_blank" rel="noreferrer">Open link</a>
        </div>
      </div>
    </div>
  );
}

const NOTHING = <div class="dimtxt">No address or position to send.</div>;

export function NavModal({ target, where, onClose }: { target: NavTarget; where?: string | null; onClose: () => void }) {
  const s = useStore(stateStore);
  const offline = s?.network?.link === 'offline';
  const shown = getShownApps();
  const [app, setApp] = useState<NavApp>(() => pickApp(getNavPref(), offline, shown));
  const [copied, setCopied] = useState(false);
  const from = s?.gps?.fix ? { lat: s.gps.lat, lon: s.gps.lon } : null;
  const android = isAndroid(navigator.userAgent);
  const isOffline = NAV_APPS.find((a) => a.id === app)!.offline;
  const raw = app === 'organic' ? organicLink(target, from) : app === 'comaps' ? comapsLink(target, from) : app === 'osmand' ? osmandLink(target, from) : null;
  const tablet = tabletLink(app, target, from, getOsmandPackage());
  const routeFromTruck = !!from && target.lat != null;
  const text = abrpText(target);
  return (
    <Modal title="Navigate" onClose={onClose}>
      <div style="display:grid;gap:var(--s15)">
        <div>
          <div style="font-family:var(--display);font-size:var(--fs-title);font-weight:600">{target.name}</div>
          {where && <div class="dimtxt">{where}</div>}
        </div>
        <div class="mtabs" role="tablist">
          {shown.map((a) => <button type="button" role="tab" aria-selected={app === a} onClick={() => { setApp(a); setCopied(false); }}>{appLabel(a)}{NAV_APPS.find((x) => x.id === a)!.offline ? ' (offline)' : ''}</button>)}
        </div>

        {offline && !isOffline && <div class="banner">The truck has no internet right now, and {appLabel(app)} needs signal. CoMaps, Organic Maps and OsmAnd work offline.</div>}

        {app === 'waze' && (
          <>
            <CarPlayWazeHint />
            {(() => { const w = wazeLink(target); return w ? <Link url={w} label="Waze" /> : NOTHING; })()}
          </>
        )}

        {isOffline && (
          !raw ? (app === 'osmand' && target.query ? <div class="dimtxt">OsmAnd's link needs a position, and this is a typed address. Use CoMaps or Organic Maps, which can search for it.</div> : NOTHING) : (
            <>
              {android && tablet && <a class="btn big primary" href={tablet}>{routeFromTruck ? `Start route in ${appLabel(app)}` : `Open in ${appLabel(app)}`}</a>}
              <div class="dimtxt">
                Navigates on {android ? 'this tablet' : `a device with ${appLabel(app)}`} with no signal needed, in any region downloaded inside {appLabel(app)} (Settings, Truck, Navigation has the setup).
                {android ? ' Not installed? The button opens its Play Store page.' : ` Scan with a phone that has ${appLabel(app)}.`}
              </div>
              {!android && <Link url={raw} label={appLabel(app)} />}
            </>
          )
        )}

        {app === 'abrp' && (
          text ? (
            <>
              <div class="dimtxt">ABRP has no link that carries a destination, so copy it and paste it into ABRP's destination box.</div>
              <div class="row wrap" style="gap:var(--s15);align-items:center">
                <code style="font-size:var(--fs-title)">{text}</code>
                <button type="button" class="btn" onClick={() => { void navigator.clipboard?.writeText(text).then(() => setCopied(true)); }}>{copied ? 'Copied' : 'Copy'}</button>
                <a class="btn primary" href={ABRP_URL} target="_blank" rel="noreferrer">Open ABRP</a>
              </div>
            </>
          ) : NOTHING
        )}
      </div>
    </Modal>
  );
}
