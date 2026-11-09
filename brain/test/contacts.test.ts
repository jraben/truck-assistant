import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db.ts';
import { parseVCard, splitVCards, davResponses, davHrefIn, isAddressBook, addressData } from '../src/contacts/vcard.ts';
import { cardDavContacts, outlookDevicePoll } from '../src/contacts/sources.ts';
import { ContactService } from '../src/contacts/service.ts';

const CARD = [
  'BEGIN:VCARD', 'VERSION:3.0', 'UID:abc-1', 'FN:Sam Rivera', 'N:Rivera;Sam;;;',
  'TEL;TYPE=CELL:+1 602 555 0134', 'item1.TEL;type=WORK:(602) 555-0199',
  'ADR;TYPE=WORK:;;1 Office Park;Phoenix;AZ;85004;USA',
  'ADR;TYPE=HOME:;;1200 N Beaver St\\nApt 2;Flagstaff;AZ;86001;',
  ' ',
  'NOTE:long note that is fold', ' ed over a line', 'END:VCARD',
].join('\r\n');

describe('vCard', () => {
  it('reads name, phones and the home address', () => {
    const c = parseVCard(CARD)!;
    expect(c).toMatchObject({ uid: 'abc-1', name: 'Sam Rivera', org: null });
    expect(c.phones).toEqual([{ number: '+1 602 555 0134', label: 'mobile' }, { number: '(602) 555-0199', label: 'work' }]);
    expect(c.address).toBe('1200 N Beaver St, Apt 2, Flagstaff, AZ 86001');
  });
  it('falls back to N or ORG for the name, and skips a card with none', () => {
    expect(parseVCard('BEGIN:VCARD\nN:Lee;Jordan;;;\nEND:VCARD')!.name).toBe('Jordan Lee');
    expect(parseVCard('BEGIN:VCARD\nORG:Desert Bloom Café;\nEND:VCARD')!.name).toBe('Desert Bloom Café');
    expect(parseVCard('BEGIN:VCARD\nTEL:1\nEND:VCARD')).toBeNull();
    expect(splitVCards(`${CARD}\n${CARD}`)).toHaveLength(2);
  });
});

describe('CardDAV', () => {
  const MS = (body: string) => `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">${body}</d:multistatus>`;
  it('reads multistatus responses with any namespace prefix', () => {
    const xml = MS('<d:response><d:href>/book/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype></d:prop></d:propstat></d:response>');
    const r = davResponses(xml);
    expect(r[0].href).toBe('/book/');
    expect(isAddressBook(r[0].body)).toBe(true);
    expect(davHrefIn('<a:current-user-principal><a:href>/p/1/</a:href></a:current-user-principal>', 'current-user-principal')).toBe('/p/1/');
    expect(addressData('<x:address-data>BEGIN:VCARD&#13;\nFN:A &amp; B\nEND:VCARD</x:address-data>')).toContain('FN:A & B');
  });

  it('discovers the address books from the server address and reads every card', async () => {
    const calls: string[] = [];
    const f = (async (u: string, init: RequestInit) => {
      const url = String(u); calls.push(`${init.method} ${new URL(url).pathname}`);
      const h = new Headers(init.headers);
      if (h.get('authorization') !== `Basic ${Buffer.from('me:app-pass').toString('base64')}`) return new Response('', { status: 401 });
      const p = new URL(url).pathname;
      if (p === '/') return new Response(MS('<d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>'), { status: 207 });
      if (p === '/123/principal/') return new Response(MS('<d:response><d:href>/123/principal/</d:href><d:propstat><d:prop><card:addressbook-home-set><d:href>/123/carddavhome/</d:href></card:addressbook-home-set></d:prop></d:propstat></d:response>'), { status: 207 });
      if (p === '/123/carddavhome/' && init.method === 'PROPFIND') return new Response(MS('<d:response><d:href>/123/carddavhome/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response><d:response><d:href>/123/carddavhome/card/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype></d:prop></d:propstat></d:response>'), { status: 207 });
      if (p === '/123/carddavhome/card/') return new Response(MS(`<d:response><d:href>/123/carddavhome/card/abc.vcf</d:href><d:propstat><d:prop><d:getetag>"1"</d:getetag><card:address-data>${CARD.replace(/&/g, '&amp;')}</card:address-data></d:prop></d:propstat></d:response>`), { status: 207 });
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const c = await cardDavContacts('https://contacts.example.com/', 'me', 'app-pass', f);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ sourceId: 'abc-1', name: 'Sam Rivera' });
    expect(calls).toEqual(['PROPFIND /', 'PROPFIND /123/principal/', 'PROPFIND /123/carddavhome/', 'REPORT /123/carddavhome/card/']);
    await expect(cardDavContacts('https://contacts.example.com/', 'me', 'wrong', f)).rejects.toThrow(/app-specific password/);
  });
});

describe('Outlook sign-in', () => {
  it('keeps waiting while the code has not been entered, then takes the token', async () => {
    let n = 0;
    const f = (async () => (++n < 2 ? new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400 }) : new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600 })))) as unknown as typeof fetch;
    expect(await outlookDevicePoll('client', 'dc', f)).toBe('pending');
    expect(await outlookDevicePoll('client', 'dc', f)).toMatchObject({ access: 'a', refresh: 'r' });
  });
});

describe('contact sync', () => {
  function setup() {
    const dir = mkdtempSync(path.join(tmpdir(), 'contacts-'));
    const looked: string[] = [];
    const svc = new ContactService({ db: openDb(dir), dataDir: dir, online: () => true, geocode: (q) => { looked.push(q); return Promise.resolve(q.includes('Nowhere') ? [] : [{ lat: 35.2, lon: -111.6 }]); } });
    return { svc, looked };
  }
  const sam = { sourceId: 's1', name: 'Sam', org: null, phones: [{ number: '1', label: 'mobile' as const }], address: '1200 N Beaver St, Flagstaff' };

  it('adds, updates and removes to match the address book, and looks an address up only when it changes', async () => {
    const { svc, looked } = setup();
    svc.apply('google', [sam, { ...sam, sourceId: 's2', name: 'Pat', address: 'Nowhere Rd' }]);
    await svc.geocodePass();
    expect(svc.list().map((c) => [c.name, c.geocode])).toEqual([['Pat', 'not-found'], ['Sam', 'found']]);
    expect(looked).toHaveLength(2);
    // Same address, new phone: no new lookup. New address: looked up again.
    svc.apply('google', [{ ...sam, phones: [{ number: '2', label: 'mobile' }] }, { ...sam, sourceId: 's2', name: 'Pat', address: 'Nowhere Rd' }]);
    await svc.geocodePass();
    expect(looked).toHaveLength(2);
    expect(svc.list().find((c) => c.name === 'Sam')!.phones[0].number).toBe('2');
    svc.apply('google', [{ ...sam, address: '1 New St, Flagstaff' }]);
    expect(svc.list().map((c) => c.name)).toEqual(['Sam']);          // Pat was deleted in the address book
    expect(svc.list()[0].geocode).toBe('pending');
    await svc.geocodePass();
    expect(looked.at(-1)).toBe('1 New St, Flagstaff');
    expect(svc.places()).toMatchObject([{ name: 'Sam', kind: 'friend', contactId: expect.any(Number) }]);
  });

  it('keeps each address book separate and drops one when disconnected', () => {
    const { svc } = setup();
    svc.apply('google', [sam]);
    svc.apply('carddav:x', [{ ...sam, name: 'Sam (iCloud)' }]);
    expect(svc.list()).toHaveLength(2);
    expect(() => svc.remove('nope')).toThrow();
    svc.remove('google');
    expect(svc.list().map((c) => c.name)).toEqual(['Sam (iCloud)']);
  });

  it('asks for the client id before a Microsoft sign-in, and rejects an old Google attempt', async () => {
    const { svc } = setup();
    await expect(svc.outlookStart()).rejects.toThrow(/client\) id/);
    svc.setClients({ googleClientId: 'abc123.apps.googleusercontent.com', googleSecret: 'shh-secret' });
    svc.googleUrl('http://127.0.0.1:8080/api/contacts/google/callback');
    await expect(svc.googleFinish('http://127.0.0.1:8080/api/contacts/google/callback?code=x&state=old', 'r')).rejects.toThrow(/older attempt/);
    expect(svc.view()).toMatchObject({ googleClientId: 'abc123.apps.googleusercontent.com', googleSecretSet: true });
  });
});
