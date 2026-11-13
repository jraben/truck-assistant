import { useEffect, useState } from 'preact/hooks';
import { send, type Charger } from '../lib/brain.ts';
import { refreshChargers, useChargers } from '../lib/data.ts';
import { Card, Modal, V, whySoc } from './common.tsx';
import { socLabel, type WP } from './drive.tsx';
import { NavModal } from './NavModal.tsx';

const NEG = /below|past your|avoid|unknown|No .* plug|needs an adapter|not checked|busy|out of service|Slow last time/i;
const POS = /^You paid|stalls free|full speed last time/;

export function Chargers({ s }: WP) {
  const c = useChargers();
  const [waze, setWaze] = useState<Charger | null>(null);
  return (
    <Card label="Where to charge" right={<button class="btn sm" type="button" onClick={() => void refreshChargers(true)} disabled={c.loading}>{c.loading ? 'Looking…' : 'Refresh'}</button>}>
      {c.message && <div class={c.list.length ? 'dimtxt' : 'banner'} style="font-size:var(--fs-body-sm)">{c.message}{/settings/.test(c.message) && <> <a href="/settings">Open settings</a></>}</div>}
      <div class="list">
        {c.list.slice(0, 12).map((ch) => (
          <div class="item charger">
            <div class="row" style="align-items:flex-start">
              <div class="score" title="Score 0-100 from your charging preferences">{ch.score}</div>
              <div class="grow">
                <h4 class="clamp2">{ch.name}</h4>
                <div class="chmeta num">{ch.distanceMi.toFixed(1)} mi · {ch.maxKw ? `${Math.round(ch.maxKw)} kW` : 'kW ?'} · {ch.connectors.join('/') || 'plugs ?'}<span class="dimtxt"> · {ch.network ?? 'Network unknown'}</span></div>
              </div>
              <button class="gobtn" type="button" onClick={() => setWaze(ch)} aria-label={`Navigate to ${ch.name}`} title="Navigate">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8z" /></svg>
              </button>
            </div>
            <div class="reasons">{ch.reasons.map((r) => <span class={NEG.test(r) ? 'neg' : POS.test(r) ? 'pos' : ''}>{r}</span>)}</div>
          </div>
        ))}
      </div>
      <div class="attrib">Station data: NREL/NLR Alternative Fuels Data Center, Open Charge Map (openchargemap.org) and, when a key is set, Google Places for live stall counts. “You paid” comes from your own charge log. {s?.soc === null ? 'Set the charge level to check reach.' : ''}</div>
      {waze && <WazeModal ch={waze} onClose={() => setWaze(null)} />}
    </Card>
  );
}

/** Send a charger (or a road-trip stop) to navigation: Waze or Organic Maps (NavModal). */
export function WazeModal({ ch, onClose }: { ch: Pick<Charger, 'name' | 'lat' | 'lon'>; onClose: () => void }) {
  return <NavModal target={{ name: ch.name, lat: ch.lat, lon: ch.lon }} onClose={onClose} />;
}

export function SocSlider({ s }: WP) {
  const cur = s?.soc ?? null;
  const [v, setV] = useState<number>(cur ?? 50);
  const [dragging, setDragging] = useState(false);
  useEffect(() => { if (!dragging && cur !== null) setV(Math.round(cur)); }, [cur, dragging]);
  const commit = (n: number) => { setDragging(false); send({ type: 'soc', value: n }); };
  return (
    <Card label="Charge level" right={<span class={`tag ${s?.socSource === 'estimate' ? 'warn' : s?.socSource ? 'ok' : 'dim'}`}>{socLabel(s?.socSource ?? null)}</span>}>
      <div class="row between">
        <div class="big num">{dragging ? v : <V v={cur === null ? null : Math.round(cur)} why={whySoc(s)} />}<small>%</small></div>
        <div class="dimtxt" style="font-size:var(--fs-caption);text-align:right">{s?.socSource === 'estimate' ? 'Estimated from miles driven' : s?.socSource === 'manual' ? 'Set by hand' : s?.socSource === 'can' ? 'From the truck' : 'Not set'}</div>
      </div>
      <input class="soc" type="range" min={0} max={100} step={1} value={v} aria-label="Set charge level"
        onInput={(e) => { setDragging(true); setV(Number((e.target as HTMLInputElement).value)); }}
        onChange={(e) => commit(Number((e.target as HTMLInputElement).value))} />
      <div class="row wrap">{[20, 50, 80, 90, 100].map((n) => <button class="btn sm" type="button" onClick={() => { setV(n); commit(n); }}>{n}%</button>)}</div>
      <div class="dimtxt" style="font-size:var(--fs-caption)">Raising it while parked logs a charge session.</div>
    </Card>
  );
}
