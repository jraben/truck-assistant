// Themes: token sets the cockpit and portal paint with. Shared by the brain
// (validation) and the UI (rendering, editor). Pure, no DOM.

export const COLOR_KEYS = ['bg', 'panel', 'panel2', 'line', 'fg', 'dim', 'accent', 'accentInk', 'ok', 'warn', 'bad'] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

/** The bundled fonts (shipped with the UI, so they work offline in the truck). */
export const FONTS = {
  display: ['Saira Semi Condensed', 'Barlow Condensed', 'Orbitron', 'System'],
  body: ['IBM Plex Sans', 'Inter', 'System'],
  mono: ['IBM Plex Mono', 'JetBrains Mono', 'System'],
} as const;

export type Theme = {
  id: string;
  name: string;
  colors: Record<ColorKey, string>;   // #rrggbb
  fonts: { display: string; body: string; mono: string };
  radius: number;                     // corner scale: 0 square .. 2 very round, 1 = default
  glow: number;                       // 0..1 accent glow on active controls, keep it subtle
  speedo?: 'digital' | 'ring' | 'sweep' | 'fifty-seven' | 'ribbon' | 'minimal';  // Track A: the speedometer this theme pairs with (a driver's "auto")
};

export type ThemeSettings = {
  active: string;
  auto: { enabled: boolean; day: string; night: string };
  custom: Theme[];
};

// Inter for body text in every preset: one clear, modern reading face; Saira stays for the big numbers.
const base = { fonts: { display: 'Saira Semi Condensed', body: 'Inter', mono: 'IBM Plex Mono' }, radius: 1, glow: 0 };

export const PRESETS: Theme[] = [
  { ...base, id: 'night', name: 'Night', colors: {
    bg: '#101417', panel: '#171c20', panel2: '#1f252a', line: '#2c343a', fg: '#e8edf0', dim: '#8d9aa3',
    accent: '#6bb7c4', accentInk: '#0a2227', ok: '#6ccf95', warn: '#e9b44c', bad: '#e66a62' } },
  { ...base, id: 'day', name: 'Day', colors: {
    bg: '#f2f4f6', panel: '#fbfcfd', panel2: '#eceff2', line: '#d5dbe0', fg: '#161b1f', dim: '#56636c',
    accent: '#16697a', accentInk: '#ffffff', ok: '#1d7442', warn: '#8a5600', bad: '#b3261e' } },
  { ...base, id: 'toolbox-red', name: 'Toolbox Red', colors: {
    bg: '#110b0b', panel: '#1b1212', panel2: '#251818', line: '#3d2828', fg: '#f5ecec', dim: '#ab9393',
    accent: '#d42a2d', accentInk: '#ffffff', ok: '#5fd08a', warn: '#f2b33d', bad: '#ff9f43' }, glow: 0.15 },
  { ...base, id: 'synthwave', name: 'Synthwave', fonts: { ...base.fonts, display: 'Barlow Condensed' }, colors: {
    bg: '#120a1f', panel: '#1c1030', panel2: '#26163f', line: '#3d2660', fg: '#f5e9ff', dim: '#ad95cc',
    accent: '#ff3fb4', accentInk: '#1a0010', ok: '#2de2e6', warn: '#ffd319', bad: '#ff5c5c' }, radius: 1.2, glow: 0.45 },
  { ...base, id: 'mint-emerald', name: 'Mint & Emerald', colors: {
    bg: '#07130f', panel: '#0e1f19', panel2: '#142a22', line: '#23443a', fg: '#e6f5ee', dim: '#8fb3a5',
    accent: '#6ee7b7', accentInk: '#04251a', ok: '#a3e635', warn: '#fbbf24', bad: '#f87171' }, radius: 1.3 },
  { ...base, id: 'tar-pit', name: 'Tar Pit', colors: {
    bg: '#0b0c0d', panel: '#121314', panel2: '#191a1c', line: '#28292b', fg: '#e6e6e6', dim: '#8c8c8c',
    accent: '#d9d9d9', accentInk: '#0b0c0d', ok: '#6fcf97', warn: '#e0b04a', bad: '#e5685e' }, radius: 0.5 },
  { ...base, id: 'wopr', name: 'WOPR', fonts: { ...base.fonts, mono: 'JetBrains Mono' }, colors: {
    bg: '#020814', panel: '#061226', panel2: '#0a1a33', line: '#173a6b', fg: '#d8e8ff', dim: '#7593bb',
    accent: '#2f8cff', accentInk: '#00101f', ok: '#3ddc97', warn: '#ffb84d', bad: '#ff5470' }, radius: 0.7, glow: 0.3 },
  { ...base, id: 'clean-slate', name: 'Clean Slate', fonts: { ...base.fonts, body: 'Inter' }, colors: {
    bg: '#eceff1', panel: '#f8f9fa', panel2: '#e3e7ea', line: '#c8cfd4', fg: '#1b2024', dim: '#58636b',
    accent: '#37474f', accentInk: '#ffffff', ok: '#2e7d32', warn: '#8a5c00', bad: '#c62828' }, radius: 1.2 },
  // Track A: cream and chrome, a turquoise accent and a red needle; pairs with the '57 speedometer.
  { ...base, id: 'bel-air', name: 'Bel Air', fonts: { ...base.fonts, display: 'Barlow Condensed' }, colors: {
    bg: '#e8dfc8', panel: '#f4eedd', panel2: '#ddd1b3', line: '#b4a27c', fg: '#2a1e15', dim: '#5e4f3d',
    accent: '#16726f', accentInk: '#ffffff', ok: '#2f6b3a', warn: '#8a5300', bad: '#b11f24' }, radius: 1.6, speedo: 'fifty-seven' },
];

export const defaultThemeSettings = (): ThemeSettings => ({ active: 'night', auto: { enabled: true, day: 'day', night: 'night' }, custom: [] });

export const allThemes = (t: ThemeSettings): Theme[] => [...PRESETS, ...t.custom];
export const findTheme = (t: ThemeSettings, id: string): Theme => allThemes(t).find((x) => x.id === id) ?? PRESETS[0];

// ---- contrast (WCAG 2.x) -------------------------------------------------------

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (s: unknown): s is string => typeof s === 'string' && HEX.test(s);

function luminance(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** WCAG contrast ratio, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const MIN_CONTRAST = 4.5;

export type ContrastCheck = { pair: string; ratio: number; ok: boolean };

/** The two pairs that carry text everywhere: fg on bg, and accentInk on accent (active buttons). */
export function checkContrast(t: Pick<Theme, 'colors'>): ContrastCheck[] {
  const pairs: [string, string, string][] = [['Text on background', t.colors.fg, t.colors.bg], ['Text on accent', t.colors.accentInk, t.colors.accent], ['Text on panels', t.colors.fg, t.colors.panel]];
  return pairs.map(([pair, a, b]) => {
    const ratio = Math.round(contrastRatio(a, b) * 100) / 100;
    return { pair, ratio, ok: ratio >= MIN_CONTRAST };
  });
}

// ---- validation (brain) ----------------------------------------------------------

export class ThemeError extends Error {}

export function validateTheme(t: unknown, i: number): Theme {
  const where = `theme.custom[${i}]`;
  if (typeof t !== 'object' || t === null) throw new ThemeError(`${where} must be an object`);
  const x = t as Record<string, any>;
  if (typeof x.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(x.id)) throw new ThemeError(`${where}.id: lowercase letters, digits and - only`);
  if (PRESETS.some((p) => p.id === x.id)) throw new ThemeError(`${where}.id "${x.id}" is a preset's id; pick another`);
  if (typeof x.name !== 'string' || !x.name.trim()) throw new ThemeError(`${where}.name is required`);
  const colors = {} as Record<ColorKey, string>;
  for (const k of COLOR_KEYS) {
    if (!isHex(x.colors?.[k])) throw new ThemeError(`${where}.colors.${k} must be #rrggbb`);
    colors[k] = x.colors[k].toLowerCase();
  }
  const fonts = { display: x.fonts?.display, body: x.fonts?.body, mono: x.fonts?.mono };
  for (const k of ['display', 'body', 'mono'] as const) {
    if (!(FONTS[k] as readonly string[]).includes(fonts[k])) throw new ThemeError(`${where}.fonts.${k} must be one of ${FONTS[k].join(', ')}`);
  }
  const radius = Number(x.radius ?? 1), glow = Number(x.glow ?? 0);
  if (!(radius >= 0 && radius <= 2)) throw new ThemeError(`${where}.radius must be 0 to 2`);
  if (!(glow >= 0 && glow <= 1)) throw new ThemeError(`${where}.glow must be 0 to 1`);
  const out: Theme = { id: x.id, name: x.name.trim().slice(0, 40), colors, fonts, radius, glow };
  if (['digital', 'ring', 'sweep', 'fifty-seven', 'ribbon', 'minimal'].includes(x.speedo)) out.speedo = x.speedo;
  return out;
}

export function validateThemeSettings(v: unknown): ThemeSettings {
  if (typeof v !== 'object' || v === null) throw new ThemeError('theme must be {active, auto, custom}');
  const t = v as Record<string, any>;
  if (!Array.isArray(t.custom)) throw new ThemeError('theme.custom must be a list');
  const custom = t.custom.map(validateTheme);
  if (new Set(custom.map((c) => c.id)).size !== custom.length) throw new ThemeError('theme.custom has two themes with the same id');
  const ids = new Set([...PRESETS, ...custom].map((x) => x.id));
  const known = (id: unknown, name: string) => { if (typeof id !== 'string' || !ids.has(id)) throw new ThemeError(`${name} "${id}" is not a known theme`); return id; };
  if (typeof t.auto !== 'object' || t.auto === null || typeof t.auto.enabled !== 'boolean') throw new ThemeError('theme.auto.enabled must be true or false');
  return {
    active: known(t.active, 'theme.active'),
    auto: { enabled: t.auto.enabled, day: known(t.auto.day, 'theme.auto.day'), night: known(t.auto.night, 'theme.auto.night') },
    custom,
  };
}

/** Settings written before themes were objects said 'night' | 'day' | 'auto'. */
export function migrateTheme(v: unknown): ThemeSettings | unknown {
  if (v === 'night' || v === 'day') return { ...defaultThemeSettings(), active: v, auto: { enabled: false, day: 'day', night: 'night' } };
  if (v === 'auto') return defaultThemeSettings();
  return v;
}
