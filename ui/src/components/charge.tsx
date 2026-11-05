import { useEffect, useMemo, useState } from 'preact/hooks';
import { renderSVG } from 'uqr';
import { send, type Charger } from '../lib/brain.ts';
import { refreshChargers, useChargers } from '../lib/data.ts';
import { wazeUrl } from '../lib/fmt.ts';
import { Card, Modal, V, whySoc } from './common.tsx';
import { socLabel, type WP } from './drive.tsx';

const NEG = /below|past your|avoid|unknown|No .* plug|needs an adapter|not checked/i;

export function Chargers({ s }: WP) {
  const c = useChargers();
  const [waze, setWaze] = useState<Charger | null>(null);
  return (
    <Card label="Where to charge" right={<button class="btn sm" type="button" onClick={() => void refreshChargers(true)} disabled={c.loading}>{c.loading ? 'Looking…' : 'Refresh'}</button>}>
      {c.message && <div class={c.list.length ? 'dimtxt' : 'banner'} style="font-size:14px">{c.message}{/settings/.test(c.message) && <> <a href="/settings">Open settings</a></>}</div>}
      <div class="list">
        {c.list.slice(0, 12).map((ch) => (
          <div class="item">
            <div class="row">
              <div class="grow">
                <h4 class="ellip">{ch.name}</h4>
                <div class="lbl ellip">{ch.network ?? 'Network unknown'} · {ch.distanceMi.toFixed(1)} mi · {ch.maxKw ? `${Math.round(ch.maxKw)} kW` : 'kW unknown'} · {ch.connectors.join('/') || 'plugs unknown'}</div>
              </div>
              <div class="score" title="Score 0-100 from your charging preferences">{ch.score}</div>
              <button class="btn primary" type="button" onClick={() => setWaze(ch)}>Send to Waze</button>
            </div>
            <div class="reasons">{ch.reasons.map((r) => <span class={NEG.test(r) ? 'neg' : ''}>{r}</span>)}</div>
          </div>
        ))}
      </div>
      <div class="attrib">Station data: NREL Alternative Fuels Data Center and Open Charge Map (openchargemap.org). {s?.soc === null ? 'Set the charge level to check reach.' : ''}</div>
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
      <div class="row wrap" style="gap:20px;align-items:flex-start">
        <div class="qr" dangerouslySetInnerHTML={{ __html: svg }} aria-label="QR code for the Waze link" />
        <div class="grow" style="display:grid;gap:10px">
          <div style="font-family:var(--display);font-size:24px;font-weight:600">{ch.name}</div>
          <div class="dimtxt">Scan with the phone camera, and Waze opens with the route. CarPlay shows it in the CarPlay view.</div>
          <code style="word-break:break-all;font-size:13px">{url}</code>
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
        <div class="dimtxt" style="font-size:13px;text-align:right">{s?.socSource === 'estimate' ? 'Estimated from miles driven' : s?.socSource === 'manual' ? 'Set by hand' : s?.socSource === 'can' ? 'From the truck' : 'Not set'}</div>
      </div>
      <input class="soc" type="range" min={0} max={100} step={1} value={v} aria-label="Set charge level"
        onInput={(e) => { setDragging(true); setV(Number((e.target as HTMLInputElement).value)); }}
        onChange={(e) => commit(Number((e.target as HTMLInputElement).value))} />
      <div class="row wrap">{[20, 50, 80, 90, 100].map((n) => <button class="btn sm" type="button" onClick={() => { setV(n); commit(n); }}>{n}%</button>)}</div>
      <div class="dimtxt" style="font-size:12px">Raising it while parked logs a charge session.</div>
    </Card>
  );
}
