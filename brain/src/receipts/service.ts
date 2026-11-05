// Charging receipts -> draft charge sessions, confirmed with one tap.
// Drafts live in SQLite (receipt_drafts); confirming one fills a matching
// detected session (same time, no cost yet) or creates a new ChargeSession
// with source 'receipt' and costSource 'receipt'.
//
// Mail: WOPR reads Jeff's Outlook, but (checked 2026-11-05) exposes no route
// that searches mail and returns message bodies. The periodic import below
// asks for GET /api/mail/search (shape in docs/contract.md, Track B) and
// stays quiet, saying so on the settings page, while WOPR answers 404.
import { createHash } from 'node:crypto';
import type { Db } from '../db.ts';
import type { ChargeService } from '../charges/service.ts';
import type { ChargeSession } from '../types.ts';
import { parseReceipt, type ReceiptInput, type ReceiptParse } from './parse.ts';
import { WoprError, woprJson, type WoprConfig } from '../wopr/client.ts';

export type ReceiptDraft = ReceiptParse & {
  id: number;
  createdAt: string;
  state: 'draft' | 'confirmed' | 'dismissed';
  sourceRef: string;               // messageId, or a hash of the body
  subject: string | null;
  sessionId: number | null;        // the ChargeSession it became
};

export class ReceiptError extends Error {
  status: number;
  constructor(m: string, status = 400) { super(m); this.status = status; }
}

/** How far apart a receipt and a detected session can start and still be the same charge. */
export const MATCH_MS = 3 * 3600_000;

/** A detected public/other session near this receipt's time that has no cost yet. Pure. */
export function matchSession(d: Pick<ReceiptParse, 'startedAt'>, sessions: ChargeSession[]): ChargeSession | null {
  if (!d.startedAt) return null;
  const t = Date.parse(d.startedAt);
  let best: ChargeSession | null = null, gap = Infinity;
  for (const s of sessions) {
    if (s.source !== 'detected' || s.place === 'home' || s.cost !== null) continue;
    const g = Math.abs(Date.parse(s.startedAt) - t);
    if (g <= MATCH_MS && g < gap) { best = s; gap = g; }
  }
  return best;
}

type Row = { id: number; created_at: string; state: string; source_ref: string; subject: string | null; session_id: number | null; data: string };

export class ReceiptService {
  private db: Db;
  private charges: ChargeService;
  private driver: () => string;
  private listeners: (() => void)[] = [];
  mail: { lastRun: string | null; message: string | null; imported: number; available: boolean | null } = { lastRun: null, message: null, imported: 0, available: null };

  constructor(db: Db, charges: ChargeService, driver: () => string) {
    this.db = db; this.charges = charges; this.driver = driver;
    db.exec(`CREATE TABLE IF NOT EXISTS receipt_drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'draft',
      source_ref TEXT NOT NULL UNIQUE, subject TEXT, session_id INTEGER, data TEXT NOT NULL)`);
  }

  onChange(f: () => void) { this.listeners.push(f); }
  private changed() { for (const f of this.listeners) { try { f(); } catch { /* ignore */ } } }

  private toDraft(r: Row): ReceiptDraft {
    return { ...(JSON.parse(r.data) as ReceiptParse), id: r.id, createdAt: r.created_at, state: r.state as ReceiptDraft['state'], sourceRef: r.source_ref, subject: r.subject, sessionId: r.session_id };
  }

  list(state: ReceiptDraft['state'] | 'all' = 'draft'): ReceiptDraft[] {
    const rows = (state === 'all'
      ? this.db.prepare('SELECT * FROM receipt_drafts ORDER BY id DESC LIMIT 200').all()
      : this.db.prepare('SELECT * FROM receipt_drafts WHERE state = ? ORDER BY id DESC LIMIT 200').all(state)) as Row[];
    return rows.map((r) => this.toDraft(r));
  }

  get(id: number): ReceiptDraft | null {
    const r = this.db.prepare('SELECT * FROM receipt_drafts WHERE id = ?').get(id) as Row | undefined;
    return r ? this.toDraft(r) : null;
  }

  /** POST /api/charges/import-receipt. 422 when nothing chargeable is in it; a repeat comes back as {duplicate}. */
  import(input: ReceiptInput & { messageId?: string }): { draft: ReceiptDraft; duplicate: boolean } {
    if (!input.text && !input.html) throw new ReceiptError('send the email as text or html');
    if ((input.text ?? '').length + (input.html ?? '').length > 400_000) throw new ReceiptError('that email is too big (400 kB max)', 413);
    const ref = input.messageId?.trim().slice(0, 300) || 'sha1:' + createHash('sha1').update(input.html ?? input.text ?? '').digest('hex');
    const dupe = this.db.prepare('SELECT * FROM receipt_drafts WHERE source_ref = ?').get(ref) as Row | undefined;
    if (dupe) return { draft: this.toDraft(dupe), duplicate: true };
    const p = parseReceipt(input);
    if (!p) throw new ReceiptError("No charging total or kWh found: this doesn't look like an Electrify America, ChargePoint, EVgo or Tesla receipt.", 422);
    const res = this.db.prepare('INSERT INTO receipt_drafts (created_at, state, source_ref, subject, data) VALUES (?, ?, ?, ?, ?)')
      .run(new Date().toISOString(), 'draft', ref, input.subject?.slice(0, 200) ?? null, JSON.stringify(p));
    this.changed();
    return { draft: this.get(Number(res.lastInsertRowid))!, duplicate: false };
  }

  /** One tap: the draft becomes (or completes) a ChargeSession. `edits` may correct cost/kWh/network/time first. */
  confirm(id: number, edits: Partial<Pick<ReceiptParse, 'cost' | 'kwh' | 'network' | 'stationName' | 'startedAt' | 'endedAt'>> = {}): { draft: ReceiptDraft; session: ChargeSession } {
    const d = this.get(id);
    if (!d) throw new ReceiptError('no such receipt', 404);
    if (d.state !== 'draft') throw new ReceiptError(`that receipt was already ${d.state}`, 409);
    const v = { ...d, ...Object.fromEntries(Object.entries(edits).filter(([, x]) => x !== undefined)) } as ReceiptDraft;
    if (v.cost === null || !Number.isFinite(v.cost) || v.cost < 0 || v.cost > 10000) throw new ReceiptError('the receipt needs a total before it can be logged');
    if (v.kwh !== null && (!Number.isFinite(v.kwh) || v.kwh < 0 || v.kwh > 1000)) throw new ReceiptError('kWh must be 0-1000');
    const startedAt = v.startedAt && Number.isFinite(Date.parse(v.startedAt)) ? new Date(v.startedAt).toISOString() : new Date().toISOString();
    const station = v.stationName ?? v.address;
    const match = matchSession({ startedAt }, this.charges.store.list(new Date(Date.parse(startedAt) - MATCH_MS).toISOString(), new Date(Date.parse(startedAt) + MATCH_MS).toISOString()));
    let session: ChargeSession | null;
    if (match) {
      session = this.charges.update(match.id, {
        cost: v.cost, costSource: 'receipt', kwh: v.kwh ?? match.kwh, network: v.network ?? match.network, stationName: station ?? match.stationName,
        note: [match.note, 'Cost from receipt email'].filter(Boolean).join(' · ').slice(0, 500),
      });
    } else {
      session = this.charges.store.create({
        startedAt, endedAt: v.endedAt && Number.isFinite(Date.parse(v.endedAt)) ? new Date(v.endedAt).toISOString() : null,
        place: 'public', network: v.network, stationName: station, lat: null, lon: null,
        kwh: v.kwh, cost: v.cost, costSource: 'receipt', startSoc: null, endSoc: null, maxKw: null,
        note: v.address && v.stationName ? v.address.slice(0, 200) : null, source: 'receipt', driverId: this.driver(),
      });
    }
    if (!session) throw new ReceiptError('the charge session could not be saved', 500);
    this.db.prepare("UPDATE receipt_drafts SET state = 'confirmed', session_id = ?, data = ? WHERE id = ?")
      .run(session.id, JSON.stringify({ network: v.network, stationName: v.stationName, address: v.address, startedAt, endedAt: v.endedAt, kwh: v.kwh, cost: v.cost, confidence: v.confidence, missing: v.missing }), id);
    this.changed();
    return { draft: this.get(id)!, session };
  }

  dismiss(id: number): boolean {
    const ok = Number(this.db.prepare("UPDATE receipt_drafts SET state = 'dismissed' WHERE id = ? AND state = 'draft'").run(id).changes) > 0;
    if (ok) this.changed();
    return ok;
  }

  /**
   * Ask WOPR for receipt emails since the last run (GET /api/mail/search, not
   * in WOPR yet). 404 = WOPR doesn't have it: remember that and try again a day later.
   */
  async importFromWopr(cfg: WoprConfig, sinceIso: string): Promise<number> {
    const q = encodeURIComponent('Electrify America OR ChargePoint OR EVgo OR Supercharging receipt');
    this.mail.lastRun = new Date().toISOString();
    let r: { messages?: { id?: string; internetMessageId?: string; from?: string; subject?: string; receivedDateTime?: string; body?: string; bodyType?: string }[] };
    try {
      r = await woprJson(cfg, `/api/mail/search?q=${q}&since=${encodeURIComponent(sinceIso)}&body=1&top=25`, { timeoutMs: 30_000 });
    } catch (e) {
      if (e instanceof WoprError && e.status === 404) { this.mail.available = false; this.mail.message = "WOPR has no mail search route yet (GET /api/mail/search). Paste receipts on the settings page until it does."; return 0; }
      this.mail.message = (e as Error).message;
      return 0;
    }
    this.mail.available = true;
    let n = 0;
    for (const m of r.messages ?? []) {
      if (!m.body) continue;
      try {
        const html = m.bodyType === 'html' || /<\w+[^>]*>/.test(m.body);
        const res = this.import({ ...(html ? { html: m.body } : { text: m.body }), subject: m.subject, from: m.from, receivedAt: m.receivedDateTime, messageId: m.internetMessageId ?? m.id });
        if (!res.duplicate) n++;
      } catch { /* not a receipt: skip */ }
    }
    this.mail.imported += n;
    this.mail.message = n ? `${n} new receipt${n === 1 ? '' : 's'} to confirm.` : 'No new receipts.';
    return n;
  }
}
