// vCard (3.0 / 4.0) and CardDAV's XML, read just far enough for a contact's
// name, phone numbers and street address. Pure.
import type { ContactPhone } from './types.ts';

/** Undo line folding (a line starting with a space or tab continues the one before). */
export function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n').filter((l) => l.trim());
}

const unescape = (v: string) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').trim();

export type ParsedCard = { uid: string | null; name: string; org: string | null; phones: ContactPhone[]; address: string | null; rev: string | null };

/** One vCard → name, phones and the first address (home first). Null without a name. */
export function parseVCard(card: string): ParsedCard | null {
  let fn: string | null = null, n: string | null = null, org: string | null = null, uid: string | null = null, rev: string | null = null;
  const phones: ContactPhone[] = [];
  const adrs: { type: string; text: string }[] = [];
  for (const line of unfold(card)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const head = line.slice(0, i), value = line.slice(i + 1);
    const [rawName, ...params] = head.split(';');
    const name = rawName.replace(/^item\d+\./i, '').toUpperCase();
    const type = params.join(';').toLowerCase();
    if (name === 'FN') fn = unescape(value);
    else if (name === 'N') n = value.split(';').slice(0, 2).reverse().map(unescape).filter(Boolean).join(' ');
    else if (name === 'ORG') org = unescape(value.split(';')[0]) || null;
    else if (name === 'UID') uid = value.trim() || null;
    else if (name === 'REV') rev = value.trim() || null;
    else if (name === 'TEL') {
      const num = value.replace(/^tel:/i, '').trim();
      if (num) phones.push({ number: num, label: /cell|mobile|iphone/.test(type) ? 'mobile' : /work/.test(type) ? 'work' : /home/.test(type) ? 'home' : 'phone' });
    } else if (name === 'ADR') {
      // ;;street;city;region;postal;country
      const p = value.split(';').map(unescape);
      const text = [p[2], p[3], [p[4], p[5]].filter(Boolean).join(' '), p[6]].filter((x) => x && x.trim()).join(', ').replace(/\n/g, ', ');
      if (text) adrs.push({ type, text });
    }
  }
  const name = fn || n || org;
  if (!name) return null;
  const adr = adrs.find((a) => /home/.test(a.type)) ?? adrs[0] ?? null;
  return { uid, name, org: org && org !== name ? org : null, phones, address: adr?.text ?? null, rev };
}

/** Every BEGIN:VCARD … END:VCARD block in a text. */
export function splitVCards(text: string): string[] {
  return text.match(/BEGIN:VCARD[\s\S]*?END:VCARD/gi) ?? [];
}

// ---- CardDAV XML (WebDAV multistatus) ------------------------------------------------

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#13;/g, '\r').replace(/&#10;/g, '\n').replace(/&amp;/g, '&');
const tag = (name: string) => new RegExp(`<(?:[A-Za-z0-9_-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_-]+:)?${name}>`, 'i');

export type DavResponse = { href: string; body: string };

/** The <response> blocks of a multistatus, each with its href and raw inner XML. */
export function davResponses(xml: string): DavResponse[] {
  const out: DavResponse[] = [];
  const re = /<(?:[A-Za-z0-9_-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?response>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const href = tag('href').exec(m[1])?.[1]?.trim();
    if (href) out.push({ href: decode(href), body: m[1] });
  }
  return out;
}

/** The href inside a named property (current-user-principal, addressbook-home-set). */
export function davHrefIn(body: string, prop: string): string | null {
  const inner = tag(prop).exec(body)?.[1];
  const href = inner ? tag('href').exec(inner)?.[1] : null;
  return href ? decode(href.trim()) : null;
}

export const isAddressBook = (body: string) => /<(?:[A-Za-z0-9_-]+:)?resourcetype\b[\s\S]*?<(?:[A-Za-z0-9_-]+:)?addressbook\b/i.test(body);
export const addressData = (body: string): string | null => { const d = tag('address-data').exec(body)?.[1]; return d ? decode(d) : null; };
export const etagOf = (body: string): string | null => { const e = tag('getetag').exec(body)?.[1]; return e ? decode(e).replace(/"/g, '') : null; };
