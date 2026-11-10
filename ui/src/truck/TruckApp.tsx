// The Truck page (/truck): the truck from a phone, or inside an HA / WOPR iframe.
// Where it is, battery / 12V / cabin, last seen, alerts, relays, Wake & view
// cameras, dashcam clips. Served by the brain, so it only loads while the Pi
// is awake; while it sleeps, Home Assistant has the watch's entities and its
// Wake button (docs/remote.md).
import { useEffect, useState } from 'preact/hooks';
import { CamPlayer } from '../components/camplayer.tsx';
import { ClipPlayer } from '../components/cams.tsx';
import { fmtBytes, rapi, tileView, useCamStatus, useViewerHeartbeat, wake, withToken, type Clip, type TruckSnapshot } from '../lib/cams.ts';
import { paintTheme, pickTheme } from '../lib/theme.ts';

const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
};
const v = (x: number | null | undefined, d = 0, unit = '') => (x === null || x === undefined ? '—' : `${x.toFixed(d)}${unit}`);

function MapBox({ pos }: { pos: TruckSnapshot['position'] }) {
  if (!pos) return <div class="map"><div class="noloc">No position yet</div></div>;
  const t = tileView(pos.lat, pos.lon);
  return (
    <a class="map" href={`https://www.openstreetmap.org/?mlat=${pos.lat}&mlon=${pos.lon}#map=17/${pos.lat}/${pos.lon}`} target="_blank" rel="noreferrer" title="Open in a map">
      <div class="osm-tiles" style={{ left: `calc(50% - ${t.offX}px)`, top: `calc(50% - ${t.offY}px)` }}>{t.tiles.map((u) => <img src={u} alt="" loading="lazy" />)}</div>
      <span class="pin" />
      <span class="credit">© OpenStreetMap</span>
    </a>
  );
}

export function TruckApp() {
  const [snap, setSnap] = useState<TruckSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  // The owner's photo (open route, 404 without one): shown above the header when there is one.
  const [photo, setPhoto] = useState<string | null>('/api/vehicle/photo');
  const load = () => rapi<TruckSnapshot>('/api/truck').then((s) => { setSnap(s); setErr(null); }).catch((e) => setErr((e as Error).message));
  useEffect(() => { void load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, []);
  useEffect(() => { paintTheme(pickTheme(undefined, snap?.position ?? null)); }, [snap?.position?.lat]);
  useViewerHeartbeat(view);

  const relay = async (id: string, on: boolean) => {
    setBusy(id);
    try { const r = await rapi<{ via: string }>('/api/truck/relay', { method: 'POST', body: JSON.stringify({ id, on }) }); if (r.via === 'watch') setErr('Sent to the always-on watch: it reaches the truck box at its next check-in.'); setTimeout(load, 800); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(null); }
  };
  const doWake = async () => { setBusy('wake'); try { await wake(); setView(true); void load(); } catch (e) { setErr((e as Error).message); } finally { setBusy(null); } };

  if (!snap) return <div class="truck"><h1>SLATE TRUCK</h1><p class="dimtxt">{err ? `Can't reach the truck: ${err}` : 'Loading…'}</p></div>;
  const w = snap.watch;
  return (
    <div class="truck">
      {photo && <img class="truckphoto" src={photo} alt="The truck" onError={() => setPhoto(null)} />}
      <div class="head">
        <h1>SLATE TRUCK</h1>
        <span class="sp" />
        <span class="tag ok" title={snap.power.why}>PI AWAKE · {snap.power.why}</span>
        <span class={`tag ${w.online ? 'ok' : 'dim'}`} title="Tier 1: the always-on LTE-M watch">WATCH {w.online ? 'ONLINE' : 'OFFLINE'} · {ago(w.lastSeen)}</span>
      </div>
      {err && <div class="banner">{err}</div>}
      <MapBox pos={snap.position} />
      <div class="dimtxt" style="font-size:var(--fs-caption)">
        {snap.place ? `${snap.place.name ?? 'Unnamed stop'} since ${new Date(snap.place.since).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : snap.speedMph && snap.speedMph > 1 ? `Driving, ${Math.round(snap.speedMph)} mph` : ''}
        {snap.position && ` · position from ${snap.position.source === 'gps' ? 'the cockpit GPS' : `the watch, ${ago(snap.position.at)}`}`}
      </div>
      <div class="stats">
        <div class="stat"><b>{v(snap.soc, 0, '%')}</b><span>Charge{snap.rangeMi !== null ? ` · ${snap.rangeMi} mi` : ''}</span></div>
        <div class="stat"><b>{v(snap.aux12v, 2, ' V')}</b><span>12V battery</span></div>
        <div class="stat"><b>{v(snap.cabinTempF, 0, '°F')}</b><span>Cabin</span></div>
        <div class="stat"><b>{snap.ignition === null ? '—' : snap.ignition ? 'ON' : 'OFF'}</b><span>Ignition{snap.gear ? ` · ${snap.gear}` : ''}</span></div>
        <div class="stat"><b>{w.rssi !== null ? `${w.rssi} dBm` : '—'}</b><span>Watch LTE-M{w.backupMv !== null ? ` · ${(w.backupMv / 1000).toFixed(2)} V cell` : ''}</span></div>
      </div>

      {!view ? <button class="btn big primary" type="button" disabled={busy === 'wake'} onClick={() => void doWake()}>{busy === 'wake' ? 'Waking…' : 'Wake & view cameras'}</button> : <Cameras />}

      <section class="card">
        <div class="row between"><span class="lbl">Relays</span><span class={`tag ${snap.truckbox ? 'ok' : 'warn'}`}>{snap.truckbox ? 'TRUCK BOX ONLINE' : w.online ? 'VIA THE WATCH' : 'TRUCK BOX OFFLINE'}</span></div>
        <div class="relays">
          {Object.entries(snap.relays).sort().map(([id, r]) => (
            <button type="button" class={r.on ? 'on' : ''} disabled={busy === id || (!snap.truckbox && !w.online)} onClick={() => void relay(id, !r.on)}>
              {r.name}<small>{r.on === null ? 'unknown' : r.on ? 'ON' : 'OFF'}</small>
            </button>
          ))}
        </div>
      </section>

      <section class="card">
        <span class="lbl">Alerts</span>
        {!snap.alerts.length ? <div class="dimtxt">None.</div> : (
          <div class="alerts">
            {snap.alerts.map((a) => <div class="alert"><b>{a.title}</b><div>{a.message}</div><small>{new Date(a.at).toLocaleString()} · {a.source === 'watch' ? 'from the watch' : a.delivered.length ? `sent via ${a.delivered.join(', ')}` : `not delivered${a.error ? `: ${a.error}` : ''}`}</small></div>)}
          </div>
        )}
      </section>

      <section class="card">
        <span class="lbl">Dashcam clips</span>
        {clip && <ClipPlayer clip={clip} label={clip.camera} />}
        {!snap.clips.length ? <div class="dimtxt">No clips yet.</div> : (
          <div class="clips">
            {snap.clips.map((c) => (
              <div class="clip">
                <button type="button" class="clip-main" disabled={c.state !== 'ready'} onClick={() => setClip(c)}>
                  <b>{new Date(c.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</b>
                  <span>{c.camera} · {c.reason} · {c.state === 'ready' ? `${c.durationS} s, ${fmtBytes(c.bytes)}` : c.state}</span>
                </button>
                {c.state === 'ready' && <a class="btn sm" href={withToken(`/api/cams/clips/${c.id}.mp4`)} download>Save</a>}
              </div>
            ))}
          </div>
        )}
      </section>
      <p class="dimtxt" style="font-size:var(--fs-caption)">Updated {ago(snap.ts)}. While the Pi sleeps this page can't load: use Home Assistant's Slate Watch device (Wake Pi button), then reopen.</p>
    </div>
  );
}

function Cameras() {
  const { status, error } = useCamStatus();
  if (!status) return <div class="dimtxt">{error ?? 'Starting cameras…'}</div>;
  const cams = status.cameras.filter((c) => c.enabled);
  return <div class="camgrid">{cams.map((c) => <CamPlayer cam={c} backend={status.backend} guides={status.guides} />)}</div>;
}
