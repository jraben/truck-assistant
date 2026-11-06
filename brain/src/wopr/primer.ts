// The primer for a WOPR turn from the truck. Same shape as WOPR's phone page
// (app/components/WoprChat.tsx): one user message carrying the time, what the
// channel can do and the live context, answered "Understood.", then the
// conversation. Pure: the brain gathers the inputs, this only formats them.
import type { Appointment } from './calendar.ts';

export type TruckContext = {
  now: Date;
  driver: string | null;
  /** Saved place / stop name when parked, null while driving or unnamed. */
  place: string | null;
  gps: { lat: number; lon: number } | null;
  speedMph: number | null;
  soc: number | null;
  socSource: 'manual' | 'estimate' | 'can' | null;
  rangeMi: number | null;
  next: Appointment | null;
  nowPlaying: { title: string | null; artist: string | null; source: string } | null;
  network: string | null;
  /** The on-peak charging warning (or the pre-peak heads-up), or null. */
  chargePeak?: string | null;
  /** "Truck payoff: $X of $Y (Z%)" from the payoff goal, or null. */
  payoff?: string | null;
  /** WOPR's own /api/mobile/context text (calendar, tasks, dinner), or ''. */
  woprContext: string;
};

export type ChatMsg = { role: 'user' | 'assistant'; content: string };

/** "Thursday, November 5, 2026 at 2:04 PM" in the truck's local time, built at send time. */
export function nowLine(now: Date): string {
  return now.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** WOPR's mobile context carries [id:…] tags for actions; the truck applies none, so they are only tokens. */
export function stripIds(ctx: string): string {
  return ctx.replace(/\s*\[id:[^\]]*\]/g, '').replace(/ \[[A-Za-z0-9_-]{6,}\]/g, '');
}

export const TRUCK_INSTRUCTIONS = 'Jeff is talking to you by voice from the dash of his Slate truck, usually while driving. '
  + 'Keep replies short and spoken: one to three sentences, nothing he has to read. '
  + 'You CANNOT change anything from the truck: calendar, tasks, lists and every other panel action are not applied here, '
  + 'so do not embed action JSON and never say you added, changed or removed something; if he asks for a change, say it needs the app or his phone. '
  + 'Answering from his calendar, archive, records and memory works as normal. The truck block below is live; anything marked unknown, say you do not know.';

/** The [TRUCK] block. Unknown values are said to be unknown, never guessed. */
export function truckBlock(c: TruckContext): string {
  const lines: string[] = [];
  lines.push(`  Driver: ${c.driver ?? 'unknown'}`);
  if (c.speedMph !== null && c.speedMph >= 3) lines.push(`  Driving, about ${Math.round(c.speedMph)} mph`);
  else if (c.place) lines.push(`  Parked at: ${c.place}`);
  else lines.push(c.speedMph === null ? '  Moving or parked: unknown' : '  Stopped (unnamed spot)');
  lines.push(c.gps ? `  Location: ${c.gps.lat.toFixed(4)}, ${c.gps.lon.toFixed(4)}` : '  Location: unknown (no GPS fix)');
  const socWhy = c.socSource === 'estimate' ? ' (estimated)' : c.socSource === 'manual' ? ' (set by hand)' : '';
  lines.push(c.soc === null ? '  Battery: unknown' : `  Battery: ${Math.round(c.soc)}%${socWhy}, range about ${c.rangeMi === null ? 'unknown' : `${Math.round(c.rangeMi)} miles`}`);
  if (c.next) lines.push(`  Next stop (calendar): ${fmtTime(c.next.start)} · ${c.next.title}${c.next.location ? ` @ ${c.next.location}` : ''}`);
  else lines.push('  Next stop: nothing on the calendar soon');
  if (c.nowPlaying && (c.nowPlaying.title || c.nowPlaying.artist)) lines.push(`  Playing (${c.nowPlaying.source}): ${[c.nowPlaying.title, c.nowPlaying.artist].filter(Boolean).join(' by ')}`);
  if (c.network) lines.push(`  Online via: ${c.network}`);
  if (c.chargePeak) lines.push(`  Charging alert: ${c.chargePeak}`);
  if (c.payoff) lines.push(`  ${c.payoff}`);
  return `[TRUCK — live]\n${lines.join('\n')}`;
}

export function buildPrimer(c: TruckContext): string {
  const ctx = stripIds(c.woprContext ?? '').trim();
  return `Current time: ${nowLine(c.now)}\n\n${TRUCK_INSTRUCTIONS}\n\n${truckBlock(c)}${ctx ? `\n\n${ctx}` : ''}`;
}

/** The most messages of history sent with a turn (WOPR's phone page sends 20). */
export const HISTORY = 12;

/**
 * [primer, "Understood.", ...history, question], alternating from a user turn
 * as the Claude API wants. History is trimmed to the last HISTORY messages and
 * any leading assistant lines are dropped.
 */
export function buildMessages(primer: string, history: ChatMsg[], question: string): ChatMsg[] {
  const tail = history.filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-HISTORY).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  while (tail.length && tail[0].role !== 'user') tail.shift();
  // two user lines in a row would break alternation: drop an unanswered question
  const out: ChatMsg[] = [];
  for (const m of tail) {
    if (out.length && out[out.length - 1].role === m.role) out[out.length - 1] = m; else out.push(m);
  }
  if (out.length && out[out.length - 1].role === 'user') out.pop();
  return [{ role: 'user', content: primer }, { role: 'assistant', content: 'Understood.' }, ...out, { role: 'user', content: question.trim().slice(0, 4000) }];
}
