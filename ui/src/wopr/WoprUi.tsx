// WOPR on the cockpit: the rail button, the subtitle, the next-appointment
// card (one tap to Waze) and the gate-code card on arrival.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { renderSVG } from 'uqr';
import { api, stateStore, store, toast, useStore } from '../lib/brain.ts';
import { Card, Icon, Modal } from '../components/common.tsx';
import { CarPlayWazeHint } from '../components/carplay.tsx';
import type { WP } from '../components/drive.tsx';
import type { NextStatus } from '../../../brain/src/wopr/calendar.ts';
import type { GateStatus } from '../../../brain/src/wopr/gate.ts';
import { assistantStore, voice, voiceStore, type Phase } from './voice.ts';
import '../media/media.css';

const MIC = 'M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM5 11a7 7 0 0 0 14 0M12 18v3';
const PHASE: Record<Phase, string> = { idle: '', listening: 'Listening', transcribing: 'Hearing', thinking: 'Thinking', speaking: 'Speaking', error: '' };

/** The rail button: tap to talk (it stops when you do), hold to talk, tap again to stop. */
export function WoprButton() {
  const v = useStore(voiceStore);
  const s = useStore(stateStore);
  const a = useStore(assistantStore);
  const name = a?.name ?? 'WOPR';
  const offline = s?.network?.link === 'offline' && !a?.online;
  useEffect(() => { void voice.checkConfigured(); }, []);
  const label = PHASE[v.phase] || name;
  return (
    <button type="button" class={`voice wopr-${v.phase} ${offline ? 'wopr-off' : ''}`} aria-label={`${name} voice: ${label}`}
      title={offline ? `${name} needs the internet (the truck is offline)` : 'Tap and talk, or hold while talking'}
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); voice.press(); }}
      onPointerUp={() => voice.release()} onPointerCancel={() => voice.release()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) { voice.press(); setTimeout(() => voice.release(), 0); } } }}>
      <Icon d={MIC} />{offline ? name : label}
    </button>
  );
}

/** What was heard and what WOPR is saying, over the bottom of the screen. Hides itself 10 s after it finishes. */
export function WoprSubtitle() {
  const v = useStore(voiceStore);
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, []);
  const busy = v.phase !== 'idle' && v.phase !== 'error';
  const stale = !busy && Date.now() - v.shownAt > (v.phase === 'error' ? 12_000 : 10_000);
  if ((!v.you && !v.reply && !v.error && v.phase !== 'listening') || stale) return null;
  return (
    <div class={`wopr-sub ${v.phase}`} role="status" aria-live="polite" onClick={() => (busy ? undefined : voice.dismiss())}>
      <div class="row between"><span class="lbl">WOPR · {PHASE[v.phase]}{v.searching ? ' · searching the web' : ''}</span>{busy && <button class="btn sm" type="button" onClick={(e) => { e.stopPropagation(); voice.cancel(); }}>Stop</button>}</div>
      {v.phase === 'listening' && !v.you && <div class="wopr-you dimtxt">Go ahead… (tap again when done)</div>}
      {v.you && <div class="wopr-you">“{v.you}”</div>}
      {v.reply && <div class="wopr-reply">{v.reply}</div>}
      {v.phase === 'thinking' && !v.reply && <div class="wopr-reply dimtxt">…</div>}
      {v.note && <div class="dimtxt" style="font-size:14px">{v.note}</div>}
      {v.error && <div class="err" style="font-size:16px">{v.error}</div>}
    </div>
  );
}

// ---- next appointment -----------------------------------------------------------------

export const nextStore = store<NextStatus | null>(null);
let nextTimer: number | undefined, nextUsers = 0;
async function loadNext() { try { nextStore.set(await api<NextStatus>('/api/wopr/next')); } catch { /* keep */ } }
function useNext() {
  useEffect(() => {
    nextUsers++;
    void loadNext();
    if (nextUsers === 1) nextTimer = window.setInterval(() => void loadNext(), 60_000);
    return () => { nextUsers--; if (!nextUsers) clearInterval(nextTimer); };
  }, []);
  return useStore(nextStore);
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
const dayOf = (iso: string) => {
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return '';
  const t = new Date(now); t.setDate(now.getDate() + 1);
  return d.toDateString() === t.toDateString() ? 'tomorrow ' : `${d.toLocaleDateString([], { weekday: 'short' })} `;
};

/** Widget "nextAppointment": "Next: 2:00 pm · title · location", one tap to Waze. Placeable on any view. */
export function NextAppointment({ s }: WP) {
  const n = useNext();
  const [waze, setWaze] = useState(false);
  const [gateBusy, setGateBusy] = useState(false);
  const a = n?.next ?? null;
  const checkGate = async () => {
    setGateBusy(true);
    try {
      const g = await api<GateStatus>('/api/wopr/gate/check', { method: 'POST' });
      gateStore.set(g?.kind === 'codes' ? g : null);
      if (g && g.kind !== 'codes') toast(g.text.slice(0, 140));
    } catch (e) { toast((e as Error).message); } finally { setGateBusy(false); }
  };
  return (
    <Card class="nextappt" label="Next appointment" right={s?.place ? <button class="tag accent" type="button" disabled={gateBusy} onClick={() => void checkGate()}>{gateBusy ? '…' : 'GATE CODE'}</button> : undefined}>
      {a ? (
        <button type="button" class="np" style="text-align:left" disabled={!a.wazeUrl} onClick={() => setWaze(true)}>
          <span class="appt-time num">{timeOf(a.start)}<small>{dayOf(a.start)}</small></span>
          <span class="grow npt">
            <b class="ellip">{a.title}</b>
            <span class="ellip dimtxt">{a.location ?? 'No address on the event'}</span>
          </span>
          {a.wazeUrl && <span class="btn primary">Waze</span>}
        </button>
      ) : (
        <div class="dimtxt">{n === null ? 'Asking WOPR…' : !n.configured ? 'Connect WOPR on the settings page to see your calendar.' : !n.online ? 'Offline: the calendar needs the internet.' : n.message ?? 'Nothing on the calendar in the next day and a half.'}</div>
      )}
      {a && n?.message && <div class="dimtxt" style="font-size:12px">Last checked {n.fetchedAt ? timeOf(n.fetchedAt) : '—'} ({n.message})</div>}
      {waze && a?.wazeUrl && <WazeLinkModal title={a.title} where={a.location!} url={a.wazeUrl} onClose={() => setWaze(false)} />}
    </Card>
  );
}

/** Same as the Charge view's Waze modal, for an address instead of a charger. */
export function WazeLinkModal({ title, where, url, onClose }: { title: string; where: string; url: string; onClose: () => void }) {
  const svg = useMemo(() => renderSVG(url, { border: 1 }), [url]);
  const [copied, setCopied] = useState(false);
  return (
    <Modal title="Send to Waze" onClose={onClose}>
      <div class="row wrap" style="gap:20px;align-items:flex-start">
        <div class="qr" dangerouslySetInnerHTML={{ __html: svg }} aria-label="QR code for the Waze link" />
        <div class="grow" style="display:grid;gap:10px">
          <div style="font-family:var(--display);font-size:24px;font-weight:600">{title}</div>
          <div class="dimtxt">{where}</div>
          <CarPlayWazeHint />
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

// ---- gate code on arrival ----------------------------------------------------------------

export const gateStore = store<GateStatus>(null);
const DISMISSED = new Set<string>();

/** Big, dismissable card with the code(s) for where the truck just stopped. Codes stay in the brain's memory; nothing here stores them. */
export function GateCard() {
  const g = useStore(gateStore);
  const s = useStore(stateStore);
  useEffect(() => {
    let alive = true;
    const f = async () => { try { const r = await api<GateStatus>('/api/wopr/gate'); if (alive && (!r || !DISMISSED.has(r.at))) gateStore.set(r); } catch { /* brain away */ } };
    void f();
    const id = setInterval(() => void f(), 4000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  if (!g || g.kind !== 'codes' || DISMISSED.has(g.at) || s?.reverse) return null;
  const close = () => { DISMISSED.add(g.at); gateStore.set(null); void api('/api/wopr/gate/dismiss', { method: 'POST' }).catch(() => {}); };
  return (
    <div class="scrim gate-scrim" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="modal gate" role="alertdialog" aria-label={`Codes for ${g.place ?? 'this place'}`}>
        <div class="row between"><span class="lbl">Gate code · from WOPR{g.how ? ` · ${g.how}` : ''}</span><button class="btn big" type="button" onClick={close}>Dismiss</button></div>
        <h3>{g.place}</h3>
        <div class="gate-codes">
          {g.codes.map((c) => <div class="gate-code"><span class="lbl">{c.label}</span><b class="num">{c.value}</b></div>)}
        </div>
      </div>
    </div>
  );
}
