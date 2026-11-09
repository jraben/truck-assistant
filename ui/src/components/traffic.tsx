// The Traffic screen: 511 cameras ahead (along the trip route, else the way
// the truck is heading, else nearby when parked), crashes, closures and
// roadwork ahead, and speed / red-light cameras from OpenStreetMap.
import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/brain.ts';
import type { TrafficView } from '../../../brain/src/types.ts';
import { fmtTime } from '../lib/fmt.ts';
import { Card } from './common.tsx';
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

export function TrafficAhead(_p: WP) {
  const { v, err } = useTraffic();
  const minute = useMinute();
  const [big, setBig] = useState<string | null>(null);
  const keyedNames = v.states.filter((s) => s.keyed).map((s) => s.name.replace(/ \(.*\)$/, '')).join(', ');
  return (
    <div class="tfgrid">
      <Card label="Cameras ahead" right={<span class="dimtxt" style="font-size:13px">{FOLLOW[v.following]}</span>}>
        {(err || v.message) && <div class="banner" style="font-size:14px">{err ?? v.message}{v.message?.includes('settings page') && <> <a href="/settings#traffic">Open settings</a></>}</div>}
        {!v.cameras.length && !v.message && <div class="dimtxt">No 511 cameras ahead.</div>}
        <div class="tfcams">
          {v.cameras.map((c) => {
            const view = c.views[0];
            return (
              <button type="button" class="tfcam" onClick={() => setBig(big === c.key ? null : c.key)} aria-label={`${c.location ?? c.roadway}, ${c.distMi} miles`}>
                <img src={bust(view.url, minute)} alt="" loading="lazy" />
                <div class="tfcap num"><b>{c.distMi} mi</b> · {c.location ?? c.roadway ?? 'Camera'}</div>
              </button>
            );
          })}
        </div>
        {big && (() => { const c = v.cameras.find((x) => x.key === big); return c ? <div class="tfbig" onClick={() => setBig(null)}><img src={bust(c.views[0].url, minute)} alt={c.location ?? ''} /><div class="tfcap">{c.location} · {c.distMi} mi{c.direction ? ` · ${c.direction}` : ''}</div></div> : null; })()}
      </Card>
      <div class="tfside">
        <Card label="On the road ahead">
          {!v.events.length && <div class="dimtxt">Nothing reported ahead.</div>}
          <div class="list">
            {v.events.map((e) => (
              <div class={`item tfev ${e.type}`}>
                <div class="row between"><b>{EV_LABEL[e.type]}{e.fullClosure ? ': road closed' : ''}</b><span class="num">{e.distMi} mi</span></div>
                <div>{[e.roadway, e.direction].filter(Boolean).join(' ')}{e.description ? `: ${e.description}` : ''}</div>
                {(e.lanes || e.updatedAt) && <div class="dimtxt" style="font-size:13px">{e.lanes ?? ''}{e.lanes && e.updatedAt ? ' · ' : ''}{e.updatedAt ? `updated ${fmtTime(e.updatedAt)}` : ''}</div>}
              </div>
            ))}
          </div>
        </Card>
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
