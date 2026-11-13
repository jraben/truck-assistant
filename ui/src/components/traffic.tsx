// The Traffic screen: 511 cameras ahead (along the trip route, else the way
// the truck is heading, else nearby when parked), crashes, closures and
// roadwork ahead, and speed / red-light cameras from OpenStreetMap.
import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/brain.ts';
import type { TrafficView } from '../../../brain/src/types.ts';
import type { HazardView } from '../../../brain/src/hazards/service.ts';
import { fmtTime } from '../lib/fmt.ts';
import { Card } from './common.tsx';
import { askPassenger } from '../drive/Passenger.tsx';
import type { WP } from './drive.tsx';

const EMPTY: TrafficView = { cameras: [], events: [], enforcement: [], states: [], message: null, following: 'nearby' };
const FOLLOW = { route: 'Along your trip route', heading: 'Ahead, the way you’re heading', nearby: 'Nearby (parked)' };
const EV_LABEL = { crash: 'Crash', closure: 'Closure', roadwork: 'Roadwork', other: 'Incident' } as const;

function useTraffic(ms = 15_000) {
  const [v, setV] = useState<TrafficView>(EMPTY);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const load = async () => { try { setV(await api<TrafficView>('/api/traffic')); setErr(null); } catch (e) { setErr((e as Error).message); } };
    void load();
    const id = setInterval(() => void load(), ms);
    return () => clearInterval(id);
  }, [ms]);
  return { v, err };
}

/** A new picture every minute (the camera images update about that often). */
function useMinute() {
  const [n, setN] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => { const id = setInterval(() => setN(Math.floor(Date.now() / 60_000)), 10_000); return () => clearInterval(id); }, []);
  return n;
}

const bust = (url: string, n: number) => `${url}${url.includes('?') ? '&' : '?'}t=${n}`;

export function TrafficAhead({ s }: WP) {
  const { v, err } = useTraffic();
  // Driving lockout (drive/lockout.ts): pictures pause while moving, like video does, unless passenger mode is on; the list stays.
  const locked = !!s?.drive?.lockout.locked && !s.drive.lockout.passenger;
  const minute = useMinute();
  const [big, setBig] = useState<string | null>(null);
  const keyedNames = v.states.filter((s) => s.keyed).map((s) => s.name.replace(/ \(.*\)$/, '')).join(', ');
  return (
    <div class={`tfgrid ${v.cameras.length ? '' : 'nocams'}`}>
      <Card label="Cameras ahead" right={<span class="dimtxt" style="font-size:var(--fs-caption)">{FOLLOW[v.following]}</span>}>
        {(err || v.message) && <div class="banner" style="font-size:var(--fs-body-sm)">{err ?? v.message}{v.message?.includes('settings page') && <> <a href="/settings#traffic">Open settings</a></>}</div>}
        {!v.cameras.length && !v.message && <div class="dimtxt">No 511 cameras ahead.</div>}
        <div class="tfcams">
          {v.cameras.map((c) => {
            const view = c.views[0];
            return (
              <button type="button" class="tfcam" onClick={(e) => (locked ? askPassenger(e) : setBig(big === c.key ? null : c.key))} aria-label={`${c.location ?? c.roadway}, ${c.distMi} miles`}>
                {locked ? <div class="tfpaused">Picture paused while driving. Passenger? Tap</div> : <img src={bust(view.url, minute)} alt="" loading="lazy" />}
                <div class="tfcap num"><b>{c.distMi} mi</b> · {c.location ?? c.roadway ?? 'Camera'}</div>
              </button>
            );
          })}
        </div>
        {big && !locked && (() => { const c = v.cameras.find((x) => x.key === big); return c ? <div class="tfbig" onClick={() => setBig(null)}><img src={bust(c.views[0].url, minute)} alt={c.location ?? ''} /><div class="tfcap">{c.location} · {c.distMi} mi{c.direction ? ` · ${c.direction}` : ''}</div></div> : null; })()}
      </Card>
      <div class="tfside">
        <Card label="On the road ahead">
          {!v.events.length && <div class="dimtxt">Nothing reported ahead.</div>}
          <div class="list">
            {v.events.map((e) => (
              <div class={`item tfev ${e.type}`}>
                <div class="row between"><b>{EV_LABEL[e.type]}{e.fullClosure ? ': road closed' : ''}</b><span class="num">{e.distMi} mi</span></div>
                <div>{[e.roadway, e.direction].filter(Boolean).join(' ')}{e.description ? `: ${e.description}` : ''}</div>
                {(e.lanes || e.updatedAt) && <div class="dimtxt" style="font-size:var(--fs-caption)">{e.lanes ?? ''}{e.lanes && e.updatedAt ? ' · ' : ''}{e.updatedAt ? `updated ${fmtTime(e.updatedAt)}` : ''}</div>}
              </div>
            ))}
          </div>
        </Card>
        <HazardsCard />
        <Card label="Enforcement cameras">
          {!v.enforcement.length && <div class="dimtxt">None mapped ahead.</div>}
          <div class="list">
            {v.enforcement.map((c) => (
              <div class="item row between"><span><b>{c.kind === 'red-light' ? 'Red-light camera' : c.kind === 'speed' ? 'Speed camera' : 'Enforcement camera'}</b>{c.maxspeed ? ` · limit ${c.maxspeed}` : ''}</span><span class="num">{c.distMi} mi</span></div>
            ))}
          </div>
        </Card>
        <div class="attrib">Cameras and incidents: {keyedNames || 'state 511 services'} (state DOT data, via each state’s 511 developer API). Enforcement camera locations: © OpenStreetMap contributors; coverage varies. Police don’t publish live cameras.</div>
      </div>
    </div>
  );
}

const HZ_LABEL = { warning: 'Warning', storm: 'Storms', rain: 'Rain', wind: 'Wind', fog: 'Visibility', fire: 'Fire' } as const;

/** NWS warnings, the forecast for when you'll be there, and fires near the route (or around you). */
function HazardsCard() {
  const [v, setV] = useState<HazardView | null>(null);
  useEffect(() => {
    const load = async () => { try { setV(await api<HazardView>('/api/hazards')); } catch { /* keep */ } };
    void load(); const id = setInterval(() => void load(), 60_000); return () => clearInterval(id);
  }, []);
  return (
    <Card label="Weather and fires ahead" right={<span class="dimtxt" style="font-size:var(--fs-caption)">{v?.following === 'route' ? 'along your trip' : 'around you'}</span>}>
      {!v?.checkedAt && <div class="dimtxt">Checking…</div>}
      {v?.checkedAt && !v.hazards.length && <div class="dimtxt">Nothing to watch for{v.following === 'route' ? ' on the rest of the trip' : ' nearby'}.</div>}
      <div class="list">
        {v?.hazards.slice(0, 8).map((h) => (
          <div class={`item tfev ${h.severity === 'high' ? 'crash' : 'roadwork'}`}>
            <div class="row between"><b>{HZ_LABEL[h.kind]}: {h.title}</b>{v.following === 'route' && <span class="num">mile {h.mi}</span>}</div>
            {(h.detail || h.at) && <div class="dimtxt" style="font-size:var(--fs-caption)">{h.detail ?? ''}{h.detail && h.at ? ' · ' : ''}{h.at ? (h.kind === 'warning' ? `until ${fmtTime(h.at)}` : h.kind === 'fire' ? `seen ${fmtTime(h.at)}` : `around ${fmtTime(h.at)}`) : ''}</div>}
          </div>
        ))}
      </div>
      {v && !v.firesOn && <div class="dimtxt" style="font-size:var(--fs-caption)">Add a free NASA FIRMS key on the settings page to see fires near the route.</div>}
      {v?.errors.length ? <div class="dimtxt" style="font-size:var(--fs-caption)">{v.errors.join(' · ')}</div> : null}
      <div class="attrib">Warnings: National Weather Service. Forecast: Open-Meteo. Fires: NASA FIRMS (satellite hotspots, a few hours old).</div>
    </Card>
  );
}
