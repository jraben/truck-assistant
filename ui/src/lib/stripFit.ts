// The top strip drops whole items, least useful first, until the rest fits.
// It never truncates a word. styles.css says what each level hides:
//   1 the stop/area pill · 2 the wind · 3 the brand name · 4 the network extras
//   5 the weather's place name · 6 the status pills' words (dots stay)
import { type RefObject } from 'preact';
import { useEffect, useLayoutEffect } from 'preact/hooks';

export const STRIP_FIT_MAX = 6;

/** Pure (tested): the lowest level at which the strip stops overflowing, or the max. */
export function fitLevel(overflowsAt: (level: number) => boolean, max = STRIP_FIT_MAX): number {
  for (let l = 0; l < max; l++) if (!overflowsAt(l)) return l;
  return max;
}

function apply(el: HTMLElement, level: number) {
  if (level) el.setAttribute('data-fit', String(level));
  else el.removeAttribute('data-fit');
}

export function fitStrip(el: HTMLElement | null) {
  if (!el) return;
  const level = fitLevel((l) => { apply(el, l); return el.scrollWidth > el.clientWidth + 1; });
  apply(el, level);
}

/** Refit after every render (the pills' words change) and on resize or font load. */
export function useStripFit(ref: RefObject<HTMLElement>) {
  useLayoutEffect(() => fitStrip(ref.current));
  useEffect(() => {
    const f = () => fitStrip(ref.current);
    window.addEventListener('resize', f);
    void document.fonts?.ready.then(f);
    return () => window.removeEventListener('resize', f);
  }, []);
}
