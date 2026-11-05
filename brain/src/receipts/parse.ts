// Public charging receipts (Electrify America, ChargePoint, EVgo, Tesla
// Supercharger) -> the facts a ChargeSession needs. Email text or HTML in,
// best-effort fields out; anything not found stays null (never guessed).
// Pure.

export type Network = 'Electrify America' | 'ChargePoint' | 'EVgo' | 'Tesla';

export type ReceiptParse = {
  network: Network | null;
  stationName: string | null;
  address: string | null;
  startedAt: string | null;        // ISO
  endedAt: string | null;
  kwh: number | null;
  cost: number | null;             // USD total actually charged, fees and tax included
  confidence: 'high' | 'low';      // low: something important was missing or inferred
  missing: string[];               // fields that weren't found
};

/** A parsed receipt waiting for (or past) its confirm tap: GET /api/charges/drafts. */
export type ReceiptDraft = ReceiptParse & {
  id: number;
  createdAt: string;
  state: 'draft' | 'confirmed' | 'dismissed';
  sourceRef: string;               // messageId, or a hash of the body
  subject: string | null;
  sessionId: number | null;        // the ChargeSession it became
};

export type ReceiptInput = { text?: string; html?: string; subject?: string; from?: string; receivedAt?: string };

/** HTML email -> readable lines (tables become "cell: cell" rows). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d|table|section)>/gi, '\n')
    .replace(/<\/t[dh]>\s*<t[dh][^>]*>/gi, ': ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&#36;|&dollar;/gi, '$').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/:\s*:/g, ':')
    .trim();
}

export function detectNetwork(hay: string): Network | null {
  if (/electrify\s*america/i.test(hay)) return 'Electrify America';
  if (/chargepoint/i.test(hay)) return 'ChargePoint';
  if (/\bevgo\b/i.test(hay)) return 'EVgo';
  if (/supercharg|tesla/i.test(hay)) return 'Tesla';
  return null;
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
/** US time zone abbreviations -> UTC offset in hours. Arizona is MST all year. */
const TZ: Record<string, number> = { UTC: 0, GMT: 0, EST: -5, EDT: -4, CST: -6, CDT: -5, MST: -7, MDT: -6, PST: -8, PDT: -7, AKST: -9, AKDT: -8, HST: -10 };

type Ymd = { y: number; m: number; d: number };
export function parseDate(s: string): Ymd | null {
  let m = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/.exec(s);
  if (m) { const y = Number(m[3]); return { y: y < 100 ? 2000 + y : y, m: Number(m[1]) - 1, d: Number(m[2]) }; }
  m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(s);
  if (m) return { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) };
  m = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(s);
  if (m) return { y: Number(m[3]), m: MONTHS[m[1].toLowerCase()], d: Number(m[2]) };
  m = /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?,?\s+(\d{4})\b/i.exec(s);
  if (m) return { y: Number(m[3]), m: MONTHS[m[2].toLowerCase()], d: Number(m[1]) };
  return null;
}

/** "3:14 PM", "15:14", "3:14:08 pm" -> minutes after midnight, plus a trailing time zone if any. */
export function parseTime(s: string): { min: number; tz: string | null } | null {
  const m = /\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp]\.?[Mm]\.?)?(?:\s*\(?([A-Z]{2,4})\)?)?/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = m[3]?.toLowerCase().replace(/\./g, '');
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || Number(m[2]) > 59) return null;
  const tz = m[4] && m[4] in TZ ? m[4] : null;
  return { min: h * 60 + Number(m[2]), tz };
}

function toIso(d: Ymd, min: number, tz: string | null, defaultTz: string | null): string {
  const z = tz ?? defaultTz;
  if (z && z in TZ) return new Date(Date.UTC(d.y, d.m, d.d, 0, min) - TZ[z] * 3600_000).toISOString();
  return new Date(d.y, d.m, d.d, 0, min).toISOString();
}

/** "38 min", "1h 12m", "2 hr 7 min", "00:38:12" -> seconds. */
export function parseDuration(s: string): number | null {
  let m = /\b(\d{1,2}):(\d{2}):(\d{2})\b/.exec(s);
  if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  m = /(?:(\d+)\s*(?:hours?|hrs?|h)\b)?\s*(?:(\d+)\s*(?:minutes?|mins?|m)\b)?\s*(?:(\d+)\s*(?:seconds?|secs?|s)\b)?/i.exec(s);
  if (m && (m[1] || m[2] || m[3])) return (Number(m[1] ?? 0) * 3600) + (Number(m[2] ?? 0) * 60) + Number(m[3] ?? 0);
  return null;
}

const money = (s: string) => Number(s.replace(/,/g, ''));

/** The value after a label on the same line ("Total: $23.09", "Total Charged $17.89"). */
function after(lines: string[], label: RegExp): string | null {
  for (const l of lines) {
    const m = label.exec(l);
    if (m) {
      const rest = l.slice(m.index + m[0].length).replace(/^\s*[:\-–]\s*/, '').trim();
      if (rest) return rest;
    }
  }
  return null;
}

/** The amount charged: the last "Total …" line that isn't a subtotal, else "Amount charged/paid". */
export function findTotal(lines: string[]): number | null {
  let best: number | null = null;
  for (const l of lines) {
    if (/sub\s*-?total|before tax|per kwh|\/\s*kwh|\/\s*min/i.test(l)) continue;
    const m = /(?:^|\b)(?:grand\s+)?total(?:\s+(?:amount|charged|paid|due|cost|price))?(?:\s*\(USD\))?\s*[:\-–]?\s*(?:USD\s*)?\$\s*([\d,]+\.\d{2})/i.exec(l)
      ?? /\b(?:amount\s+(?:charged|paid)|you\s+paid|charged\s+to\s+your\s+\w+)\s*[:\-–]?\s*\$\s*([\d,]+\.\d{2})/i.exec(l);
    if (m) best = money(m[1]);
  }
  return best;
}

/** Energy delivered in kWh: a labelled value first, else the first "N kWh" that isn't a price. */
export function findKwh(lines: string[]): number | null {
  for (const l of lines) {
    if (/\$\s*[\d.]+\s*\/\s*kwh|per\s+kwh/i.test(l) && !/delivered|energy\s*[:\-]/i.test(l)) continue;
    const m = /\b(?:energy(?:\s+(?:delivered|used|added|consumed))?|kwh\s+(?:delivered|used|added)|total\s+energy)\s*[:\-–]?\s*(\d+(?:\.\d+)?)\s*(?:kwh)?/i.exec(l);
    if (m) return Number(m[1]);
  }
  for (const l of lines) {
    const m = /(?<![$\d.,])(\d+(?:\.\d+)?)\s*kWh\b(?!\s*\/)/i.exec(l);
    if (m && !/\$\s*$/.test(l.slice(0, m.index))) return Number(m[1]);
  }
  return null;
}

export function parseReceipt(input: ReceiptInput): ReceiptParse | null {
  const body = input.html ? htmlToText(input.html) : (input.text ?? '').replace(/\r/g, '');
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const hay = `${input.from ?? ''}\n${input.subject ?? ''}\n${body}`;
  const network = detectNetwork(hay);
  const cost = findTotal(lines);
  const kwh = findKwh(lines);
  if (cost === null && kwh === null) return null;
  const missing: string[] = [];

  // station and address
  const stationName = after(lines, /^(?:station(?!\s+address)(?:\s+name)?|location|site(?!\s+address)|supercharger(?:\s+location)?|charging\s+location)\b/i)?.replace(/\s+-\s+\d.*$/, '').slice(0, 120) ?? null;
  const address = after(lines, /^(?:station\s+)?address\b/i)?.slice(0, 160) ?? null;

  // times: a "start" line, an "end" line, or one "date ... time - time" line
  const tzAny = /\b(MST|MDT|PST|PDT|CST|CDT|EST|EDT|UTC|AKST|AKDT|HST)\b/.exec(body)?.[1] ?? null;
  const dateLine = after(lines, /^(?:date|session\s+date|charging\s+date|charging\s+session|session)\b/i);
  const startLine = after(lines, /^(?:session\s+)?(?:start(?:ed)?(?:\s+time)?|charging\s+started|plug\s*-?in(?:\s+time)?)\b/i);
  const endLine = after(lines, /^(?:session\s+)?(?:end(?:ed)?(?:\s+time)?|charging\s+ended|unplug(?:ged)?(?:\s+time)?|stop(?:ped)?(?:\s+time)?)\b/i);
  const day = parseDate(startLine ?? '') ?? parseDate(dateLine ?? '') ?? parseDate(body);
  let startedAt: string | null = null, endedAt: string | null = null;
  if (day) {
    const range = /(\d{1,2}:\d{2}\s*[AaPp]?\.?[Mm]?\.?)\s*(?:-|–|to)\s*(\d{1,2}:\d{2}\s*[AaPp]?\.?[Mm]?\.?(?:\s*[A-Z]{2,4})?)/.exec(dateLine ?? startLine ?? '');
    const st = startLine ? parseTime(startLine.replace(/^\S*\d{1,2}\/\d{1,2}\/\d{2,4}\s*/, '')) : range ? parseTime(range[1]) : null;
    const en = endLine ? parseTime(endLine.replace(/^\S*\d{1,2}\/\d{1,2}\/\d{2,4}\s*/, '')) : range ? parseTime(range[2]) : null;
    const tz = st?.tz ?? en?.tz ?? tzAny;
    if (st) startedAt = toIso(day, st.min, st.tz ?? tz, null);
    if (en) {
      const endDay = parseDate(endLine ?? '') ?? day;
      endedAt = toIso(endDay, en.min, en.tz ?? tz, null);
      if (startedAt && Date.parse(endedAt) < Date.parse(startedAt)) endedAt = new Date(Date.parse(endedAt) + 86400_000).toISOString(); // past midnight
    }
    if (!startedAt && !st) startedAt = toIso(day, 12 * 60, tz, null); // the day is known, the hour isn't
  }
  const durS = parseDuration(after(lines, /^(?:duration|charging\s+time|session\s+(?:length|duration)|time\s+charging|connected\s+time)\b/i) ?? '');
  if (startedAt && !endedAt && durS) endedAt = new Date(Date.parse(startedAt) + durS * 1000).toISOString();
  if (!startedAt && endedAt && durS) startedAt = new Date(Date.parse(endedAt) - durS * 1000).toISOString();
  let lowTime = false;
  if (!startedAt && input.receivedAt && Number.isFinite(Date.parse(input.receivedAt))) {
    startedAt = new Date(Date.parse(input.receivedAt)).toISOString(); lowTime = true;
  }

  if (!network) missing.push('network');
  if (cost === null) missing.push('cost');
  if (kwh === null) missing.push('kwh');
  if (!startedAt) missing.push('startedAt');
  if (!stationName && !address) missing.push('station');
  const confidence = cost !== null && kwh !== null && startedAt && !lowTime && network ? 'high' : 'low';
  return { network, stationName, address, startedAt, endedAt, kwh, cost, confidence, missing };
}
