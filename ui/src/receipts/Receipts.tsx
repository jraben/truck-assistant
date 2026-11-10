// Charging receipts turned into draft charge sessions: confirm with one tap
// (the cockpit prompt), or paste a receipt email on the settings page.
import { useEffect, useState } from 'preact/hooks';
import { api, store, toast, useStore } from '../lib/brain.ts';
import { fmtDateTime, money } from '../lib/fmt.ts';
import { Modal } from '../components/common.tsx';
import type { ReceiptDraft } from '../../../brain/src/receipts/parse.ts';

export const draftsStore = store<ReceiptDraft[]>([]);
export async function loadDrafts() { try { draftsStore.set(await api<ReceiptDraft[]>('/api/charges/drafts')); } catch { /* keep */ } }

function DraftRow({ d, onDone }: { d: ReceiptDraft; onDone: () => void }) {
  const [cost, setCost] = useState(d.cost === null ? '' : String(d.cost));
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await api(`/api/charges/drafts/${d.id}/confirm`, { method: 'POST', body: JSON.stringify(cost.trim() && Number(cost) !== d.cost ? { cost: Number(cost) } : {}) });
      toast('Charge logged from the receipt'); onDone();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const dismiss = async () => { try { await api(`/api/charges/drafts/${d.id}/dismiss`, { method: 'POST' }); onDone(); } catch (e) { toast((e as Error).message); } };
  return (
    <div class="item">
      <div class="row between wrap">
        <div class="grow">
          <h4 class="ellip">{d.network ?? 'Unknown network'}{d.stationName ? ` · ${d.stationName}` : ''}</h4>
          <div class="lbl ellip">{d.startedAt ? fmtDateTime(d.startedAt) : 'time unknown'} · {d.kwh !== null ? `${d.kwh} kWh` : 'kWh unknown'}{d.confidence === 'low' ? ' · check it' : ''}</div>
        </div>
        <div class="mid num">{money(d.cost) ?? '—'}</div>
      </div>
      <div class="row wrap">
        {d.cost === null && <label class="row" style="gap:var(--s1)">$<input type="number" step="0.01" min="0" style="width:110px" value={cost} placeholder="total" onInput={(e) => setCost((e.target as HTMLInputElement).value)} /></label>}
        <button class="btn primary" type="button" disabled={busy || (d.cost === null && !cost.trim())} onClick={() => void confirm()}>Confirm</button>
        <button class="btn" type="button" onClick={() => void dismiss()}>Not mine</button>
        {d.missing.length > 0 && <span class="dimtxt" style="font-size:var(--fs-caption)">Not found: {d.missing.join(', ')}</span>}
      </div>
    </div>
  );
}

export function DraftList() {
  const drafts = useStore(draftsStore);
  useEffect(() => { void loadDrafts(); }, []);
  if (!drafts.length) return <div class="dimtxt" style="font-size:var(--fs-body-sm)">No receipts waiting.</div>;
  return <div class="list">{drafts.map((d) => <DraftRow d={d} onDone={() => void loadDrafts()} />)}</div>;
}

/** Cockpit: a small prompt when receipts are waiting for their confirm tap. */
export function ReceiptPrompt() {
  const drafts = useStore(draftsStore);
  const [open, setOpen] = useState(false);
  useEffect(() => { void loadDrafts(); const id = setInterval(() => void loadDrafts(), 60_000); return () => clearInterval(id); }, []);
  if (!drafts.length) return null;
  return (
    <>
      <button type="button" class="receipt-pill pill" onClick={() => setOpen(true)}><span class="dot warn" />{drafts.length} charging receipt{drafts.length === 1 ? '' : 's'} to confirm</button>
      {open && <Modal title="Charging receipts" onClose={() => setOpen(false)}><DraftList /></Modal>}
    </>
  );
}

/** Settings: paste a receipt email; see what the mail import is doing. */
export function ReceiptImport() {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mail, setMail] = useState<{ lastRun: string | null; message: string | null; available: boolean | null; autoImport: boolean; woprConfigured: boolean } | null>(null);
  useEffect(() => { api<typeof mail>('/api/charges/receipts/mail').then(setMail).catch(() => {}); }, []);
  const submit = async () => {
    setMsg(null);
    const html = /<\w+[^>]*>/.test(text);
    try {
      const r = await api<{ draft: ReceiptDraft; duplicate: boolean }>('/api/charges/import-receipt', { method: 'POST', body: JSON.stringify(html ? { html: text } : { text }) });
      setMsg({ ok: true, text: r.duplicate ? 'Already imported.' : `Read it: ${r.draft.network ?? 'unknown network'}, ${money(r.draft.cost) ?? 'no total'}, ${r.draft.kwh ?? '?'} kWh. Confirm it below.` });
      setText(''); void loadDrafts();
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const runMail = async () => { try { setMail(await api('/api/charges/receipts/mail', { method: 'POST' })); void loadDrafts(); } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } };
  return (
    <div class="form">
      <label class="f"><span>Paste a receipt email (Electrify America, ChargePoint, EVgo, Tesla): text or HTML</span>
        <textarea rows={6} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} placeholder="Open the receipt email, select all, copy, paste here." />
      </label>
      <div class="row wrap">
        <button class="btn primary" type="button" disabled={!text.trim()} onClick={() => void submit()}>Read receipt</button>
        {msg && <span class={msg.ok ? 'okmsg' : 'err'}>{msg.text}</span>}
      </div>
      <DraftList />
      <p class="help">From Jeff's mailbox through WOPR: {mail === null ? '…' : !mail.woprConfigured ? 'set up WOPR above first.' : mail.available === false ? mail.message : mail.message ?? (mail.autoImport ? 'checked every 6 hours.' : 'automatic import is off.')} <button class="btn sm" type="button" onClick={() => void runMail()}>Check mail now</button></p>
    </div>
  );
}
