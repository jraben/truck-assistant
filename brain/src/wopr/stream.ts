// WOPR's reply stream, cleaned the way WOPR's own clients clean it
// (app/components/WoprChat.tsx and lib/mobileActions.ts in the WOPR repo).
// Pure, no Node APIs: the brain strips the markers off the stream it relays,
// and the cockpit UI imports the same functions for actions and sentences.

/** Streamed when a web search starts (WOPR app/api/WOPR/route.ts SEARCH_MARKER). */
export const SEARCH_MARKER = '[[WOPR_SEARCH]]';
/** Streamed after 15 s of silence so a proxy doesn't cut the line (KEEPALIVE_MARKER). */
export const KEEPALIVE_MARKER = '[[WOPR_KEEPALIVE]]';

/**
 * Both markers removed, plus a marker cut in half at the very end of the text
 * so far ("[[WOP"), exactly as WoprChat.stripMarkers does. Call it on the whole
 * accumulated text, not on one chunk.
 */
export function stripMarkers(t: string): string {
  return t.split(SEARCH_MARKER).join('').split(KEEPALIVE_MARKER).join('')
    .replace(/\[\[(W(O(P(R(_[A-Z]*\]?)?)?)?)?)?$/, '');
}

export type WoprAction = Record<string, unknown> & { action?: unknown };

/**
 * Every {"action"...} block taken out of the text (brace-matched, like
 * WOPR's splitActions). An unterminated block at the end (still streaming)
 * is cut from view; malformed JSON is dropped from view either way.
 */
export function splitActions(text: string): { clean: string; actions: WoprAction[] } {
  const actions: WoprAction[] = [];
  let result = text;
  for (;;) {
    const start = result.indexOf('{"action"');
    if (start === -1) break;
    let depth = 0, end = -1;
    for (let i = start; i < result.length; i++) {
      if (result[i] === '{') depth++;
      else if (result[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) { result = result.slice(0, start).trimEnd(); break; }
    try { actions.push(JSON.parse(result.slice(start, end + 1)) as WoprAction); } catch { /* malformed */ }
    result = result.slice(0, start) + result.slice(end + 1);
  }
  return { clean: result.replace(/\n{3,}/g, '\n\n').trim(), actions };
}

/**
 * Relays a chunked stream with the markers removed. A chunk that ends partway
 * into what could be a marker holds those characters back until the next chunk
 * says whether they were one. `searching` turns true when a search marker
 * passes, so the UI can say "Searching the web".
 */
export class MarkerStripper {
  private held = '';
  searching = false;

  /** Feed one chunk; returns the text that is safe to pass on now. */
  push(chunk: string): string {
    let s = this.held + chunk;
    this.held = '';
    if (s.includes(SEARCH_MARKER)) this.searching = true;
    s = s.split(SEARCH_MARKER).join('').split(KEEPALIVE_MARKER).join('');
    const m = /\[\[(W(O(P(R(_[A-Z]*\]?)?)?)?)?)?$/.exec(s);
    if (m) { this.held = m[0]; s = s.slice(0, m.index); }
    return s;
  }

  /** End of stream: whatever was held back was not a marker after all. */
  end(): string {
    const h = this.held;
    this.held = '';
    // A dangling "[[WOPR_SEA" at the very end is a cut marker, not prose.
    return /^\[\[(W(O(P(R(_[A-Z]*\]?)?)?)?)?)?$/.test(h) ? '' : h;
  }
}

/**
 * Complete sentences from `fromIdx` on, for the speech queue. Same rule as
 * WOPR's voice loop: split after . ! ? … or a blank line; a 200-character run
 * with no sentence end is flushed at a word boundary so speech doesn't starve.
 */
export function extractSentences(text: string, fromIdx: number): { sentences: string[]; newIdx: number } {
  const sentences: string[] = [];
  const re = /[.!?…]+(?=\s|$)|\n{2,}/g;
  re.lastIndex = fromIdx;
  let lastEnd = fromIdx;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const end = m.index + m[0].length;
    const chunk = text.slice(lastEnd, end).trim();
    if (chunk.length >= 2) { sentences.push(chunk); lastEnd = end; }
  }
  const pending = text.slice(lastEnd);
  if (pending.length >= 200) {
    const cutAt = pending.lastIndexOf(' ', 200);
    const cut = cutAt > 50 ? cutAt + 1 : 200;
    const chunk = pending.slice(0, cut).trim();
    if (chunk.length >= 2) { sentences.push(chunk); lastEnd += cut; }
  }
  return { sentences, newIdx: lastEnd };
}

/** Markdown out before speech: code blocks gone, list items joined, emphasis and links reduced to their words. */
export function speakable(text: string): string {
  let s = text.replace(/```[\s\S]*?```/g, '');
  s = s.replace(/^[-*_]{3,}\s*$/gm, '... ');
  s = s.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '');
  s = s.replace(/^#{1,6}\s+/gm, '');
  s = s.replace(/\[([^\]]+)\]\((?:https?:\/\/)?[^)\s]+\)/g, '$1');
  s = s.replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(\*|_)(\S.*?)\1/g, '$2').replace(/`([^`]+)`/g, '$1');
  s = s.replace(/https?:\/\/\S+/g, 'the link');
  return s.replace(/\s+/g, ' ').trim();
}

/** The line shown in the subtitle when WOPR asked for something the truck can't do. */
export function notDoneLine(actions: WoprAction[]): string | null {
  if (!actions.length) return null;
  const names = [...new Set(actions.map((a) => String(a.action ?? 'that')))];
  return `Not done from the truck: ${names.join(', ')}. Use the WOPR app for changes.`;
}
