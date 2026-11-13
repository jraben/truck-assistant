// Settings, Truck: Route planning. Where the road-trip planner and the airport
// pickup get road routes: a local GraphHopper on the Pi (offline; set up with
// deploy/graphhopper/), the public OSRM demo when online, else a straight line.
import { useEffect, useState } from 'preact/hooks';
import type { RoutingStatus } from '../../../brain/src/roadtrip/routing.ts';
import { api, toast } from '../lib/brain.ts';

export function RoutingSection() {
  const [s, setS] = useState<RoutingStatus | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => { try { const n = await api<RoutingStatus>('/api/routing'); setS(n); setUrl(n.graphhopperUrl ?? ''); } catch (e) { toast((e as Error).message); } };
  useEffect(() => { void load(); }, []);
  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try { const n = await api<RoutingStatus>('/api/routing', { method: 'PUT', body: JSON.stringify(patch) }); setS(n); setUrl(n.graphhopperUrl ?? ''); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const gh = s?.graphhopper;
  return (
    <section class="card" id="routing">
      <h2>Route planning</h2>
      <p class="help">Road routes for the road-trip planner and the airport pickup. A local router on the Pi (GraphHopper, built for your states on the homelab) works with no signal; outside it, the public router is used when the truck is online, else a straight line plus 25%.</p>
      {s && (
        <>
          <div class="row wrap" style="gap:var(--s15);align-items:flex-end">
            <label class="f" style="min-width:260px"><span>Local router (GraphHopper)</span><input type="url" value={url} placeholder="http://localhost:8989" onInput={(e) => setUrl((e.target as HTMLInputElement).value)} /></label>
            <button type="button" class="btn primary" disabled={busy || url === (s.graphhopperUrl ?? '')} onClick={() => void save({ graphhopperUrl: url.trim() || null })}>Save</button>
            <button type="button" class="btn" disabled={busy} onClick={() => void load()}>Check</button>
          </div>
          <p class={gh ? (gh.ok ? 'okmsg' : 'err') : 'help'}>
            {!gh ? 'No local router set: routes need the internet.'
              : gh.ok ? `Connected: GraphHopper ${gh.info.version ?? ''}, covers ${gh.info.bbox ? `${gh.info.bbox[1].toFixed(1)}..${gh.info.bbox[3].toFixed(1)}°N, ${gh.info.bbox[0].toFixed(1)}..${gh.info.bbox[2].toFixed(1)}°E` : 'its region'}${gh.info.elevation ? ', with elevation (climbs offline)' : ', no elevation (climbs need the internet)'}${gh.info.dataDate ? `, map data of ${gh.info.dataDate.slice(0, 10)}` : ''}.`
              : `Not answering: ${gh.error}. Routes fall back to the public router or a straight line.`}
          </p>
          <div class="row wrap" style="gap:var(--s15);align-items:flex-end">
            <label class="check"><input type="checkbox" checked={s.publicOsrm} disabled={busy} onChange={(e) => void save({ publicOsrm: (e.target as HTMLInputElement).checked })} /> Use the public router (OSRM demo) when online</label>
            <label class="f" style="width:200px"><span>Towing: no faster than (mph)</span><input type="number" min={35} max={80} value={s.towMph} onChange={(e) => void save({ towMph: Number((e.target as HTMLInputElement).value) })} /></label>
          </div>
          <p class="help">{s.towing ? `Towing ${s.towing.trailer} now: routes are planned at no more than ${s.towing.mph} mph (local router only).` : 'The towing cap applies while a trailer is hitched (Parked, Tow), and only with the local router.'} Setup: deploy/graphhopper/README.md.</p>
        </>
      )}
    </section>
  );
}
