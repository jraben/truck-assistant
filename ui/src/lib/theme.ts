// Paints the active theme into CSS variables. Every colour in styles.css reads
// from these; nothing in a component carries a literal colour.
import { findTheme, type Theme, type ThemeSettings } from '../../../brain/src/themes.ts';
import { isDaytime } from '../../../brain/src/sun.ts';

import '@fontsource/saira-semi-condensed/400.css';
import '@fontsource/saira-semi-condensed/600.css';
import '@fontsource/saira-semi-condensed/800.css';
import '@fontsource/barlow-condensed/400.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/orbitron/600.css';
import '@fontsource/orbitron/800.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

export { PRESETS, allThemes, findTheme, checkContrast, FONTS, COLOR_KEYS, MIN_CONTRAST } from '../../../brain/src/themes.ts';
export type { Theme, ThemeSettings, ColorKey } from '../../../brain/src/themes.ts';

const STACK: Record<string, string> = {
  'Saira Semi Condensed': '"Saira Semi Condensed", "Arial Narrow", system-ui, sans-serif',
  'Barlow Condensed': '"Barlow Condensed", "Arial Narrow", system-ui, sans-serif',
  Orbitron: 'Orbitron, "Arial Narrow", system-ui, sans-serif',
  'IBM Plex Sans': '"IBM Plex Sans", system-ui, -apple-system, sans-serif',
  Inter: 'Inter, system-ui, -apple-system, sans-serif',
  'IBM Plex Mono': '"IBM Plex Mono", ui-monospace, Menlo, monospace',
  'JetBrains Mono': '"JetBrains Mono", ui-monospace, Menlo, monospace',
};
const SYSTEM = { display: 'system-ui, sans-serif', body: 'system-ui, -apple-system, sans-serif', mono: 'ui-monospace, Menlo, monospace' };

const VAR: Record<keyof Theme['colors'], string> = {
  bg: '--bg', panel: '--panel', panel2: '--panel-2', line: '--line', fg: '--fg', dim: '--dim',
  accent: '--accent', accentInk: '--accent-ink', ok: '--ok', warn: '--warn', bad: '--bad',
};

/** CSS variable map for a theme (used on :root, and on a preview element in the editor). */
export function themeVars(t: Theme): Record<string, string> {
  const v: Record<string, string> = {};
  for (const [k, name] of Object.entries(VAR)) v[name] = t.colors[k as keyof Theme['colors']];
  v['--display'] = STACK[t.fonts.display] ?? SYSTEM.display;
  v['--body'] = STACK[t.fonts.body] ?? SYSTEM.body;
  v['--mono'] = STACK[t.fonts.mono] ?? SYSTEM.mono;
  v['--r'] = String(t.radius);
  v['--glow'] = String(t.glow);
  return v;
}

/** Light or dark, so native controls (scrollbars, pickers) follow. */
export const isLight = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 150;
};

let painted = '';
export function paintTheme(t: Theme) {
  const key = JSON.stringify(t);
  if (key === painted) return;
  painted = key;
  const root = document.documentElement;
  for (const [k, v] of Object.entries(themeVars(t))) root.style.setProperty(k, v);
  root.style.colorScheme = isLight(t.colors.bg) ? 'light' : 'dark';
  root.dataset.theme = t.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.colors.panel);
}

/** Which theme should show now: auto (sunrise/sunset at the GPS position) or the active one. */
export function pickTheme(ts: ThemeSettings | undefined, gps: { lat: number; lon: number } | null, now = new Date()): Theme {
  if (!ts) return findTheme({ active: 'night', auto: { enabled: false, day: 'day', night: 'night' }, custom: [] }, 'night');
  if (ts.auto.enabled) return findTheme(ts, isDaytime(now, gps) ? ts.auto.day : ts.auto.night);
  return findTheme(ts, ts.active);
}
