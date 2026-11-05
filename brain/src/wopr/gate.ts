// Gate code on arrival. WOPR's POST /api/where {lat, lon} answers in plain
// text (app/api/where/route.ts + describeCodes() in lib/places.ts):
//   "<name> — <label> <value>, <label> <value> · <how>"     codes found
//   "<name> (<how>) — no codes saved on that record yet."   a place, no codes
//   "Don't know this spot (…)" / "No location and nothing on the calendar …"
// Codes live in memory only: never written to disk, never in State, never on
// MQTT/HA, never logged.

export type GateCode = { label: string; value: string };
export type GateAnswer = {
  kind: 'codes' | 'no-codes' | 'unknown';
  place: string | null;
  codes: GateCode[];
  how: string | null;          // "from your calendar — Pickup now" or "30m away"
  text: string;                // WOPR's line, as sent
};

/** Read WOPR's /api/where text. */
export function parseWhere(raw: string): GateAnswer {
  const text = raw.trim().slice(0, 1000);
  if (/^don'?t know this spot|^no location/i.test(text)) return { kind: 'unknown', place: null, codes: [], how: null, text };
  const noCodes = /^(.*?)\s*\((.*)\)\s+—\s+no codes saved/i.exec(text);
  if (noCodes) return { kind: 'no-codes', place: noCodes[1].trim(), codes: [], how: noCodes[2].trim(), text };
  const dash = text.indexOf(' — ');
  if (dash < 0) return { kind: 'unknown', place: null, codes: [], how: null, text };
  const place = text.slice(0, dash).trim();
  let rest = text.slice(dash + 3);
  if (/^no codes saved/i.test(rest)) return { kind: 'no-codes', place, codes: [], how: null, text };
  let how: string | null = null;
  const dot = rest.lastIndexOf(' · ');
  if (dot >= 0) { how = rest.slice(dot + 3).trim() || null; rest = rest.slice(0, dot); }
  const codes: GateCode[] = [];
  for (const part of rest.split(/,\s+(?=[A-Za-z])/)) {
    const p = part.trim();
    if (!p) continue;
    // "Gate Code 1234#" -> label "Gate Code", value "1234#": the label runs to the
    // last code word that still has something after it (WOPR's CODE_FIELD words).
    const m = /^(.*\b(?:code|gate|garage|door|lockbox|keypad|alarm|access|entry)):?\s+(.+)$/i.exec(p);
    if (m) codes.push({ label: m[1].trim(), value: m[2].trim() });
    else { const sp = p.lastIndexOf(' '); codes.push(sp > 0 ? { label: p.slice(0, sp), value: p.slice(sp + 1) } : { label: 'Code', value: p }); }
  }
  return codes.length ? { kind: 'codes', place, codes, how, text } : { kind: 'no-codes', place, codes: [], how, text };
}
