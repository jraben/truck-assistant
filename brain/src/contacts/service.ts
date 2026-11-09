// Contacts, synced: each connected address book is read again every 30
// minutes (and on demand), so a changed address changes here too. The address
// book is the truth: a contact removed there is removed here. Addresses are
// looked up on the map once per change (OpenStreetMap, rate-limited).
// Connection secrets (OAuth tokens, CardDAV passwords) live in
// DATA_DIR/contacts.json, mode 0600, never sent to the UI.
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Db } from '../db.ts';
import { kvGet, kvSet } from '../db.ts';
import {
  cardDavContacts, googleAuthUrl, googleContacts, googleExchange, googleRefresh, outlookContacts, outlookDevicePoll, outlookDeviceStart,
  outlookRefresh, SourceError, type DeviceCode, type OAuthToken, type RawContact,
} from './sources.ts';
import type { Contact, ContactPhone, ContactsStatus, ContactSourceKind, ContactSourceStatus } from './types.ts';

export const SYNC_MS = 30 * 60_000;
const GEOCODE_PER_PASS = 20;

type CardDavAccount = { id: string; label: string; url: string; username: string; password: string };
export type ContactSecrets = {
  outlook: { clientId: string | null; token?: OAuthToken; account?: string | null };
  google: { clientId: string | null; secret?: string; token?: OAuthToken; account?: string | null };
  carddav: CardDavAccount[];
};

export class ContactsError extends Error {}

export type ContactDeps = {
  db: Db;
  dataDir: string;
  online: () => boolean;
  /** Address → place (OpenStreetMap search), or null when address search is off. */
  geocode: (q: string) => Promise<{ lat: number; lon: number }[]> | null;
  /** Demo: an invented address book, no network. */
  demo?: RawContact[] | null;
  demoPlaces?: { sourceId: string; lat: number; lon: number }[];
  fetchFn?: typeof fetch;
};

const hash = (s: string | null) => (s ? createHash('sha1').update(s.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16) : null);

export class ContactService {
  private d: ContactDeps;
  private file: string;
  private sec: ContactSecrets;
  private pending: (DeviceCode & { clientId: string }) | null = null;
  private googleState: string | null = null;
  private status = new Map<string, { lastSync: string | null; error: string | null }>();
  private syncing = false;
  private geocoding = false;

  constructor(d: ContactDeps) {
    this.d = d;
    mkdirSync(d.dataDir, { recursive: true });
    this.file = path.join(d.dataDir, 'contacts.json');
    try { this.sec = JSON.parse(readFileSync(this.file, 'utf8')) as ContactSecrets; }
    catch { this.sec = { outlook: { clientId: null }, google: { clientId: null }, carddav: [] }; }
    this.sec.carddav ??= [];
    d.db.exec(`
      CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL, source_id TEXT NOT NULL,
        name TEXT NOT NULL, org TEXT, phones TEXT NOT NULL DEFAULT '[]', address TEXT, addr_hash TEXT,
        lat REAL, lon REAL, geocode TEXT NOT NULL DEFAULT 'none', updated_at TEXT NOT NULL,
        UNIQUE (source, source_id)
      );
    `);
    for (const [k, v] of Object.entries(kvGet<Record<string, { lastSync: string | null; error: string | null }>>(d.db, 'contacts.status') ?? {})) this.status.set(k, v);
  }

  private save() {
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.sec, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
  private saveStatus() { kvSet(this.d.db, 'contacts.status', Object.fromEntries(this.status)); }

  // ---- reading ---------------------------------------------------------------------------

  list(q?: string | null): Contact[] {
    const rows = this.d.db.prepare('SELECT * FROM contacts ORDER BY name COLLATE NOCASE').all() as Record<string, unknown>[];
    const all = rows.map((r) => ({
      id: Number(r.id), source: String(r.source), sourceId: String(r.source_id), name: String(r.name), org: (r.org as string) ?? null,
      phones: JSON.parse(String(r.phones ?? '[]')) as ContactPhone[], address: (r.address as string) ?? null,
      lat: r.lat === null ? null : Number(r.lat), lon: r.lon === null ? null : Number(r.lon), geocode: r.geocode as Contact['geocode'], updatedAt: String(r.updated_at),
    }));
    const s = q?.trim().toLowerCase();
    return s ? all.filter((c) => c.name.toLowerCase().includes(s) || (c.org ?? '').toLowerCase().includes(s) || (c.address ?? '').toLowerCase().includes(s)) : all;
  }

  get(id: number): Contact | null { return this.list().find((c) => c.id === id) ?? null; }

  private sources(): { id: string; kind: ContactSourceKind; label: string; account: string | null; connected: boolean }[] {
    const out: { id: string; kind: ContactSourceKind; label: string; account: string | null; connected: boolean }[] = [];
    if (this.d.demo) out.push({ id: 'demo', kind: 'demo', label: 'Demo contacts', account: null, connected: true });
    if (this.sec.outlook.token) out.push({ id: 'outlook', kind: 'outlook', label: 'Outlook', account: this.sec.outlook.account ?? null, connected: true });
    if (this.sec.google.token) out.push({ id: 'google', kind: 'google', label: 'Google', account: this.sec.google.account ?? null, connected: true });
    for (const a of this.sec.carddav) out.push({ id: `carddav:${a.id}`, kind: 'carddav', label: a.label, account: a.username, connected: true });
    return out;
  }

  view(): ContactsStatus {
    const counts = new Map<string, number>();
    for (const r of this.d.db.prepare('SELECT source, COUNT(*) AS n FROM contacts GROUP BY source').all() as { source: string; n: number }[]) counts.set(r.source, Number(r.n));
    const located = Number((this.d.db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE geocode = 'found'").get() as { n: number }).n);
    const sources: ContactSourceStatus[] = this.sources().map((s) => ({ ...s, contacts: counts.get(s.id) ?? 0, lastSync: this.status.get(s.id)?.lastSync ?? null, error: this.status.get(s.id)?.error ?? null }));
    return {
      sources, total: [...counts.values()].reduce((a, b) => a + b, 0), located,
      outlookPending: this.pending ? { userCode: this.pending.userCode, verificationUri: this.pending.verificationUri, expiresAt: new Date(this.pending.expiresAt).toISOString() } : null,
      outlookClientId: this.sec.outlook.clientId, googleClientId: this.sec.google.clientId, googleSecretSet: !!this.sec.google.secret,
    };
  }

  // ---- connecting ----------------------------------------------------------------------

  setClients(p: { outlookClientId?: unknown; googleClientId?: unknown; googleSecret?: unknown }) {
    const id = (v: unknown, name: string) => { if (v === null || v === '') return null; if (typeof v !== 'string' || !/^[\w.-]{8,200}$/.test(v.trim())) throw new ContactsError(`${name} doesn't look like a client id`); return v.trim(); };
    if (p.outlookClientId !== undefined) { this.sec.outlook.clientId = id(p.outlookClientId, 'The Microsoft client id'); }
    if (p.googleClientId !== undefined) { this.sec.google.clientId = id(p.googleClientId, 'The Google client id'); }
    if (p.googleSecret !== undefined) { if (p.googleSecret === null || p.googleSecret === '') delete this.sec.google.secret; else if (typeof p.googleSecret === 'string' && !p.googleSecret.includes('•')) this.sec.google.secret = p.googleSecret.trim(); }
    this.save();
  }

  /** Microsoft sign-in: a code to enter at microsoft.com/devicelogin; this polls until it's done. */
  async outlookStart(): Promise<ContactsStatus['outlookPending']> {
    const clientId = this.sec.outlook.clientId;
    if (!clientId) throw new ContactsError('Paste your Microsoft app (client) id first.');
    const dc = await outlookDeviceStart(clientId, this.d.fetchFn);
    this.pending = { ...dc, clientId };
    void this.pollOutlook();
    return this.view().outlookPending;
  }

  private async pollOutlook() {
    const p = this.pending;
    while (p && this.pending === p && Date.now() < p.expiresAt) {
      await new Promise((r) => setTimeout(r, p.intervalS * 1000));
      if (this.pending !== p) return;
      try {
        const t = await outlookDevicePoll(p.clientId, p.deviceCode, this.d.fetchFn);
        if (t === 'pending') continue;
        this.sec.outlook.token = t; this.save(); this.pending = null;
        await this.syncOne('outlook').catch(() => {});
        return;
      } catch (e) { this.status.set('outlook', { lastSync: null, error: (e as Error).message }); this.saveStatus(); this.pending = null; return; }
    }
    if (this.pending === p) this.pending = null;
  }

  googleUrl(redirectUri: string): string {
    const { clientId, secret } = this.sec.google;
    if (!clientId || !secret) throw new ContactsError('Paste your Google client id and secret first.');
    this.googleState = randomBytes(12).toString('hex');
    return googleAuthUrl(clientId, redirectUri, this.googleState);
  }

  /** The address Google sent the browser to (or just its code). */
  async googleFinish(pasted: string, redirectUri: string): Promise<void> {
    const { clientId, secret } = this.sec.google;
    if (!clientId || !secret) throw new ContactsError('Paste your Google client id and secret first.');
    let code = pasted.trim(), state: string | null = null;
    try { const u = new URL(code); code = u.searchParams.get('code') ?? ''; state = u.searchParams.get('state'); if (u.searchParams.get('error')) throw new ContactsError(`Google said: ${u.searchParams.get('error')}`); } catch (e) { if (e instanceof ContactsError) throw e; }
    if (!code) throw new ContactsError('That address has no code in it: paste the whole address from the browser bar.');
    if (state !== null && state !== this.googleState) throw new ContactsError('That sign-in is from an older attempt: press Connect Google again.');
    this.sec.google.token = await googleExchange(clientId, secret, code, redirectUri, this.d.fetchFn);
    this.save();
    await this.syncOne('google').catch(() => {});
  }

  async addCardDav(p: { label?: unknown; url?: unknown; username?: unknown; password?: unknown }): Promise<void> {
    const url = typeof p.url === 'string' && /^https:\/\//i.test(p.url.trim()) ? p.url.trim() : null;
    if (!url) throw new ContactsError('The server address must start with https:// (iCloud: https://contacts.icloud.com).');
    if (typeof p.username !== 'string' || !p.username.trim() || typeof p.password !== 'string' || !p.password) throw new ContactsError('Username and (app-specific) password are required.');
    const a: CardDavAccount = { id: randomBytes(4).toString('hex'), label: typeof p.label === 'string' && p.label.trim() ? p.label.trim().slice(0, 40) : new URL(url).host, url, username: p.username.trim(), password: p.password };
    await cardDavContacts(a.url, a.username, a.password, this.d.fetchFn);   // proves the login before saving
    this.sec.carddav.push(a); this.save();
    await this.syncOne(`carddav:${a.id}`).catch(() => {});
  }

  /** Disconnect an address book: its tokens/password and its contacts go. */
  remove(id: string) {
    if (id === 'outlook') this.sec.outlook = { clientId: this.sec.outlook.clientId };
    else if (id === 'google') this.sec.google = { clientId: this.sec.google.clientId, secret: this.sec.google.secret };
    else if (id.startsWith('carddav:')) this.sec.carddav = this.sec.carddav.filter((a) => `carddav:${a.id}` !== id);
    else throw new ContactsError('No such address book.');
    this.save();
    this.d.db.prepare('DELETE FROM contacts WHERE source = ?').run(id);
    this.status.delete(id); this.saveStatus();
  }

  // ---- syncing --------------------------------------------------------------------------

  private async fresh(kind: 'outlook' | 'google'): Promise<string> {
    const s = kind === 'outlook' ? this.sec.outlook : this.sec.google;
    if (!s.token) throw new SourceError('Not connected.', true);
    if (Date.now() < s.token.expiresAt - 60_000) return s.token.access;
    s.token = kind === 'outlook'
      ? await outlookRefresh(this.sec.outlook.clientId!, s.token.refresh, this.d.fetchFn)
      : await googleRefresh(this.sec.google.clientId!, this.sec.google.secret!, s.token.refresh, this.d.fetchFn);
    this.save();
    return s.token.access;
  }

  async syncOne(id: string): Promise<number> {
    let raw: RawContact[];
    try {
      if (id === 'demo') raw = this.d.demo ?? [];
      else if (id === 'outlook') { const r = await outlookContacts(await this.fresh('outlook'), this.d.fetchFn); this.sec.outlook.account = r.account; this.save(); raw = r.contacts; }
      else if (id === 'google') { const r = await googleContacts(await this.fresh('google'), this.d.fetchFn); this.sec.google.account = r.account; this.save(); raw = r.contacts; }
      else {
        const a = this.sec.carddav.find((x) => `carddav:${x.id}` === id);
        if (!a) throw new SourceError('No such address book.');
        raw = await cardDavContacts(a.url, a.username, a.password, this.d.fetchFn);
      }
    } catch (e) {
      this.status.set(id, { lastSync: this.status.get(id)?.lastSync ?? null, error: (e as Error).message }); this.saveStatus();
      throw e;
    }
    const n = this.apply(id, raw);
    this.status.set(id, { lastSync: new Date().toISOString(), error: null }); this.saveStatus();
    void this.geocodePass();
    return n;
  }

  /** The address book's list replaces this source's contacts: new ones in, changed ones updated, gone ones out. */
  apply(source: string, raw: RawContact[]): number {
    const db = this.d.db;
    const old = new Map((db.prepare('SELECT source_id, addr_hash FROM contacts WHERE source = ?').all(source) as { source_id: string; addr_hash: string | null }[]).map((r) => [r.source_id, r.addr_hash]));
    const now = new Date().toISOString();
    const seen = new Set<string>();
    const demoAt = new Map((this.d.demoPlaces ?? []).map((p) => [p.sourceId, p]));
    for (const c of raw) {
      if (seen.has(c.sourceId)) continue;
      seen.add(c.sourceId);
      const h = hash(c.address);
      const moved = !old.has(c.sourceId) || old.get(c.sourceId) !== h;
      const known = source === 'demo' ? demoAt.get(c.sourceId) : null;
      db.prepare(`INSERT INTO contacts (source, source_id, name, org, phones, address, addr_hash, lat, lon, geocode, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source, source_id) DO UPDATE SET name = excluded.name, org = excluded.org, phones = excluded.phones, address = excluded.address, addr_hash = excluded.addr_hash, updated_at = excluded.updated_at
        ${moved ? ', lat = excluded.lat, lon = excluded.lon, geocode = excluded.geocode' : ''}`)
        .run(source, c.sourceId, c.name.slice(0, 120), c.org, JSON.stringify(c.phones.slice(0, 8)), c.address, h,
          known?.lat ?? null, known?.lon ?? null, known ? 'found' : c.address ? 'pending' : 'none', now);
    }
    for (const id of old.keys()) if (!seen.has(id)) db.prepare('DELETE FROM contacts WHERE source = ? AND source_id = ?').run(source, id);
    return seen.size;
  }

  /** Every connected address book, then the map lookups. */
  async syncAll(): Promise<void> {
    if (this.syncing) return;
    this.syncing = true;
    try { for (const s of this.sources()) { if (s.id !== 'demo' && !this.d.online()) continue; try { await this.syncOne(s.id); } catch (e) { console.warn(`[contacts] ${s.id}: ${(e as Error).message}`); } } }
    finally { this.syncing = false; }
  }

  /** Look up addresses that changed (a few at a time: OpenStreetMap asks for one search a second). */
  async geocodePass(): Promise<void> {
    if (this.geocoding || !this.d.online()) return;
    this.geocoding = true;
    try {
      const rows = this.d.db.prepare("SELECT id, address FROM contacts WHERE geocode = 'pending' AND address IS NOT NULL LIMIT ?").all(GEOCODE_PER_PASS) as { id: number; address: string }[];
      for (const r of rows) {
        const p = this.d.geocode(r.address);
        if (!p) break;
        const hits = await p;
        const hit = hits[0];
        this.d.db.prepare('UPDATE contacts SET lat = ?, lon = ?, geocode = ? WHERE id = ?').run(hit?.lat ?? null, hit?.lon ?? null, hit ? 'found' : 'not-found', r.id);
      }
    } finally { this.geocoding = false; }
  }

  /** Contacts on the map, as trip destinations. */
  places(): { name: string; lat: number; lon: number; contactId: number; kind: string; phones: ContactPhone[]; address: string | null }[] {
    return this.list().filter((c) => c.lat !== null && c.lon !== null).map((c) => ({ name: c.name, lat: c.lat!, lon: c.lon!, contactId: c.id, kind: c.org && !c.phones.some((p) => p.label === 'mobile' || p.label === 'home') ? 'work' : 'friend', phones: c.phones, address: c.address }));
  }
}
