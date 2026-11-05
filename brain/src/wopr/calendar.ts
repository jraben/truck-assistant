// The next calendar appointment, from WOPR's GET /api/calendar
// ({connected, events: [{id, title, start, end, allDay, location?}]}, Outlook
// via Microsoft Graph). Pure helpers; the fetching lives in service.ts.

export type CalEvent = { id: string; title: string; start: string; end: string; allDay: boolean; location?: string };
export type Appointment = { id: string; title: string; start: string; end: string; location: string | null; wazeUrl: string | null };

/** An appointment that started this recently still counts as "next" (running a bit late). */
export const STARTED_GRACE_MS = 15 * 60_000;

/** Graph sends "2026-11-05T21:00:00.0000000Z": seven fractional digits, which Date.parse can't always read. */
export function parseGraphTime(s: string): number {
  const t = Date.parse(s);
  if (Number.isFinite(t)) return t;
  return Date.parse(s.replace(/(\.\d{3})\d+/, '$1'));
}

/** Waze from a typed address: `q=` searches it (the Charge view's links use exact coordinates instead). */
export const wazeSearchUrl = (q: string) => `https://waze.com/ul?q=${encodeURIComponent(q)}&navigate=yes`;

/** A location that is only a Teams/Zoom link or "Microsoft Teams Meeting" isn't somewhere to drive. */
export function drivableLocation(loc: string | undefined | null): string | null {
  const l = (loc ?? '').trim();
  if (!l) return null;
  if (/^https?:\/\//i.test(l) || /teams meeting|zoom|google meet|webex|^online$|^virtual$|^phone$/i.test(l)) return null;
  return l.slice(0, 200);
}

/**
 * The first timed event that hasn't ended and didn't start more than
 * STARTED_GRACE_MS ago. All-day events are skipped (they aren't places to be
 * at a time). Events with a drivable location win over ones without only when
 * they start at the same time.
 */
export function pickNextAppointment(events: CalEvent[], now = Date.now()): Appointment | null {
  const cands = events
    .filter((e) => e && !e.allDay && typeof e.start === 'string' && typeof e.end === 'string')
    .map((e) => ({ e, s: parseGraphTime(e.start), en: parseGraphTime(e.end), loc: drivableLocation(e.location) }))
    .filter((x) => Number.isFinite(x.s) && Number.isFinite(x.en) && x.en > now && x.s >= now - STARTED_GRACE_MS)
    .sort((a, b) => a.s - b.s || Number(!!b.loc) - Number(!!a.loc));
  const x = cands[0];
  if (!x) return null;
  return {
    id: x.e.id, title: (x.e.title ?? '').trim() || '(no title)',
    start: new Date(x.s).toISOString(), end: new Date(x.en).toISOString(),
    location: x.loc, wazeUrl: x.loc ? wazeSearchUrl(x.loc) : null,
  };
}

/** "Next: 2:00 pm · Pickup Barney · WestWorld of Scottsdale" */
export function appointmentLine(a: Appointment, locale = 'en-US'): string {
  const t = new Date(a.start).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return `Next: ${t} · ${a.title}${a.location ? ` · ${a.location}` : ''}`;
}

/** GET /api/wopr/next. */
export type NextStatus = { configured: boolean; online: boolean; next: Appointment | null; fetchedAt: string | null; message: string | null };
