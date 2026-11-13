// "Navigate": every place the cockpit sends somewhere (chargers, road-trip
// stops, the airport pickup, calendar appointments) opens this. Waze goes to the
// iPhone and CarPlay as before; Organic Maps navigates on the dash tablet itself
// and keeps working with no signal. lib/nav.ts builds the links.
import { useMemo, useState } from 'preact/hooks';
import { renderSVG } from 'uqr';
import { stateStore, useStore } from '../lib/brain.ts';
import { androidIntent, getNavPref, isAndroid, organicLink, pickApp, wazeLink, type NavApp, type NavTarget } from '../lib/nav.ts';
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

export function NavModal({ target, where, onClose }: { target: NavTarget; where?: string | null; onClose: () => void }) {
  const s = useStore(stateStore);
  const offline = s?.network?.link === 'offline';
  const [app, setApp] = useState<NavApp>(() => pickApp(getNavPref(), offline));
  const from = s?.gps?.fix ? { lat: s.gps.lat, lon: s.gps.lon } : null;
  const waze = wazeLink(target);
  const om = organicLink(target, from);
  const android = isAndroid(navigator.userAgent);
  return (
    <Modal title="Navigate" onClose={onClose}>
      <div style="display:grid;gap:var(--s15)">
        <div>
          <div style="font-family:var(--display);font-size:var(--fs-title);font-weight:600">{target.name}</div>
          {where && <div class="dimtxt">{where}</div>}
        </div>
        <div class="mtabs" role="tablist">
          <button type="button" role="tab" aria-selected={app === 'waze'} onClick={() => setApp('waze')}>Waze</button>
          <button type="button" role="tab" aria-selected={app === 'organic'} onClick={() => setApp('organic')}>Organic Maps (offline)</button>
        </div>
        {app === 'waze' && (
          <>
            {offline && <div class="banner">The truck has no internet right now, and Waze needs signal on the phone. Organic Maps works offline.</div>}
            <CarPlayWazeHint />
            {waze ? <Link url={waze} label="Waze" /> : <div class="dimtxt">No address or position to send.</div>}
          </>
        )}
        {app === 'organic' && (
          om ? (
            <>
              {android && <a class="btn big primary" href={androidIntent(om)}>{from && target.lat != null ? 'Start route in Organic Maps' : 'Open in Organic Maps'}</a>}
              <div class="dimtxt">
                Navigates on {android ? 'this tablet' : 'a device with Organic Maps'} with no signal needed, in any state downloaded inside Organic Maps
                (Settings, Truck, Navigation has the setup). {android ? 'Not installed? The button opens its Play Store page.' : 'Scan with a phone that has Organic Maps.'}
              </div>
              {!android && <Link url={om} label="Organic Maps" />}
            </>
          ) : <div class="dimtxt">No address or position to send.</div>
        )}
      </div>
    </Modal>
  );
}
