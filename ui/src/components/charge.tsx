import { useEffect, useMemo, useState } from 'preact/hooks';
import { renderSVG } from 'uqr';
import { send, type Charger } from '../lib/brain.ts';
import { refreshChargers, useChargers } from '../lib/data.ts';
import { wazeUrl } from '../lib/fmt.ts';
import { Card, Modal, V, whySoc } from './common.tsx';
import { socLabel, type WP } from './drive.tsx';
import { CarPlayWazeHint } from './carplay.tsx';

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
              <button class="gobtn" type="button" onClick={() => setWaze(ch)} aria-label={`Send ${ch.name} to Waze`} title="Send to Waze">
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

export function WazeModal({ ch, onClose }: { ch: Charger; onClose: () => void }) {
  const url = wazeUrl(ch.lat, ch.lon);
  const svg = useMemo(() => renderSVG(url, { border: 1 }), [url]);
  const [copied, setCopied] = useState(false);
  return (
    <Modal title="Send to Waze" onClose={onClose}>
      <div class="row wrap" style="gap:var(--s3);align-items:flex-start">
        <div class="qr" dangerouslySetInnerHTML={{ __html: svg }} aria-label="QR code for the Waze link" />
        <div class="grow" style="display:grid;gap:var(--s1)">
          <div style="font-family:var(--display);font-size:var(--fs-title);font-weight:600">{ch.name}</div>
          <CarPlayWazeHint />
          <code style="word-break:break-all;font-size:var(--fs-caption)">{url}</code>
          <div class="row wrap">
            <button class="btn" type="button" onClick={() => { void navigator.clipboard?.writeText(url).then(() => setCopied(true)); }}>{copied ? 'Copied' : 'Copy link'}</button>
            <a class="btn" href={url} target="_blank" rel="noreferrer">Open link</a>
          </div>
        </div>
      </div>
    </Modal>
  );
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
