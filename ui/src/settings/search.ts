// Settings search: pure matching (tested in ui/test/settingsSearch.test.ts) plus reading the
// sections off the page. Indexing the rendered DOM means every section, in whichever file it is
// written, is searchable without a second list of titles to keep in step.

export type SectionEntry = {
  /** The section's element id (its #anchor); '' when it has none. */
  id: string;
  /** data-key the fold logic gave it; always set. */
  key: string;
  tab: string;
  title: string;
  /** Its one-line help (the <p class="help"> right under the title). */
  help: string;
  /** Extra words people might search for that the text doesn't use (data-keywords). */
  keywords: string;
  /** Field labels, check boxes and sub-headings. */
  labels: string[];
  /** Everything else it says. */
  text: string;
};

export type SearchHit = { entry: SectionEntry; score: number; /** what to show under the title */ snippet: string };

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
/** Whole-word-start match scores above a match inside a word ("gas" in "Gas price" over "Vegas"). */
const wordStart = (hay: string, t: string) => new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(hay);

/** Sections matching every word of `q`, best first. Title and keywords count most, then help, labels, body. */
export function searchSections(entries: readonly SectionEntry[], q: string, limit = 8): SearchHit[] {
  const terms = norm(q).split(' ').filter((t) => t.length > 0);
  if (!terms.length || (terms.length === 1 && terms[0].length < 2)) return [];
  const hits: SearchHit[] = [];
  for (const e of entries) {
    const title = norm(e.title), kw = norm(e.keywords), help = norm(e.help), body = norm(e.text);
    const labels = e.labels.map(norm);
    let score = 0;
    let labelHit: string | null = null;
    let all = true;
    for (const t of terms) {
      let s = 0;
      if (title.includes(t)) s = wordStart(title, t) ? 12 : 8;
      if (kw.includes(t)) s = Math.max(s, wordStart(kw, t) ? 10 : 6);
      if (help.includes(t)) s = Math.max(s, wordStart(help, t) ? 5 : 3);
      const li = labels.findIndex((l) => l.includes(t));
      if (li >= 0) { const ls = wordStart(labels[li], t) ? 4 : 2; if (ls > s) { s = ls; } labelHit ??= e.labels[li]; }
      if (!s && body.includes(t)) s = wordStart(body, t) ? 1.5 : 1;
      if (!s) { all = false; break; }
      score += s;
    }
    if (!all) continue;
    if (title.startsWith(terms.join(' '))) score += 4;
    const helpHas = terms.some((t) => help.includes(t));
    const snippet = labelHit && !helpHas && !terms.some((t) => title.includes(t)) ? labelHit : e.help;
    hits.push({ entry: e, score, snippet });
  }
  return hits.sort((a, b) => b.score - a.score || a.entry.title.localeCompare(b.entry.title)).slice(0, limit);
}

/** Read every settings section on the page. Tabs that aren't showing are still in the DOM (hidden). */
export function readSections(root: ParentNode): SectionEntry[] {
  const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  return [...root.querySelectorAll<HTMLElement>('[data-tab] section.card')].map((sec) => {
    const h = sec.querySelector(':scope > h2');
    const help = sec.querySelector(':scope > h2 + p.help');
    const labels = [...sec.querySelectorAll('.f > span, label.check, h3, summary, button')]
      .map((el) => clean(el.textContent)).filter((s) => s && s.length < 80);
    return {
      id: sec.id,
      key: sec.dataset.key ?? sec.id,
      tab: sec.closest('[data-tab]')?.getAttribute('data-tab') ?? '',
      title: clean(h?.textContent),
      help: clean(help?.textContent),
      keywords: sec.dataset.keywords ?? '',
      labels: [...new Set(labels)],
      text: clean(sec.textContent),
    };
  });
}

/** Short words for the status chips in the header; the raw text goes in the tooltip. */
export function chipLabel(kind: 'mqtt' | 'gps' | 'ha', raw: string): { text: string; level: 'ok' | 'warn' } {
  const r = raw.toLowerCase();
  if (kind === 'mqtt') {
    if (r === 'connected') return { text: 'MQTT', level: 'ok' };
    if (r === 'disabled') return { text: 'MQTT off', level: 'warn' };
    if (r.startsWith('connecting')) return { text: 'MQTT connecting', level: 'warn' };
    return { text: 'MQTT offline', level: 'warn' };
  }
  if (kind === 'gps') {
    if (r === 'fix') return { text: 'GPS', level: 'ok' };
    if (r === 'sim') return { text: 'GPS (sim)', level: 'ok' };
    if (r === 'tablet') return { text: 'GPS (tablet)', level: 'ok' };
    if (r === 'no gpsd') return { text: 'No GPS', level: 'warn' };
    return { text: 'GPS no fix', level: 'warn' };
  }
  if (r === 'connected') return { text: 'HA', level: 'ok' };
  if (r === 'not configured') return { text: 'HA not set up', level: 'warn' };
  if (r === 'not checked yet') return { text: 'HA checking', level: 'warn' };
  return { text: 'HA offline', level: 'warn' };
}
