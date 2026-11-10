import { useEffect, useRef, useState } from 'preact/hooks';
import { putDriver, toast, type Driver } from '../lib/brain.ts';
import { allThemes, checkContrast, COLOR_KEYS, FONTS, MIN_CONTRAST, PRESETS, themeVars, type ColorKey, type Theme } from '../lib/theme.ts';
import { Ring } from '../components/drive.tsx';

const LABELS: Record<ColorKey, string> = {
  bg: 'Background', panel: 'Panel', panel2: 'Panel 2', line: 'Lines', fg: 'Text', dim: 'Dim text',
  accent: 'Accent', accentInk: 'Text on accent', ok: 'OK', warn: 'Warning', bad: 'Alert',
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'theme';
function uniqueId(base: string, taken: Set<string>) {
  let id = slug(base), n = 2;
  while (taken.has(id)) id = `${slug(base)}-${n++}`;
  return id;
}

/** Edits one driver's themes (themes are per driver). */
export function ThemeEditor({ driver }: { driver: Driver }) {
  const ts = driver.theme;
  const themes = allThemes(ts);
  const [baseId, setBaseId] = useState(ts.active);
  const [draft, setDraft] = useState<Theme>(() => structuredClone(themes.find((t) => t.id === ts.active) ?? PRESETS[0]));
  const [io, setIo] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const isPreset = PRESETS.some((p) => p.id === draft.id);
  const isSaved = ts.custom.some((c) => c.id === draft.id);
  const checks = checkContrast(draft);

  const pick = (id: string) => { setBaseId(id); setDraft(structuredClone(themes.find((t) => t.id === id) ?? PRESETS[0])); setMsg(null); };
  const duplicate = () => {
    const taken = new Set(themes.map((t) => t.id));
    setDraft({ ...structuredClone(draft), id: uniqueId(`${draft.name} custom`, taken), name: `${draft.name} (mine)` });
    setMsg({ ok: true, text: 'Copy made. Change it, then Save.' });
  };

  const put = (theme: Partial<Driver['theme']>) => putDriver(driver.id, { theme });
  const save = async () => {
    try {
      const custom = [...ts.custom.filter((c) => c.id !== draft.id), draft];
      await put({ custom });
      setBaseId(draft.id);
      setMsg({ ok: true, text: `Saved "${draft.name}".` });
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const use = async () => {
    try {
      if (!isPreset && !isSaved) await put({ custom: [...ts.custom, draft] });
      await put({ active: draft.id, auto: { ...ts.auto, enabled: false } });
      toast(`Using ${draft.name}`);
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };
  const remove = async () => {
    if (!confirm(`Delete the theme "${draft.name}"?`)) return;
    // Anything that pointed at the deleted theme falls back to the matching preset.
    const or = (id: string, fb: string) => (id === draft.id ? fb : id);
    try {
      await put({ custom: ts.custom.filter((c) => c.id !== draft.id), active: or(ts.active, 'night'), auto: { ...ts.auto, day: or(ts.auto.day, 'day'), night: or(ts.auto.night, 'night') } });
      pick('night');
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); }
  };

  const exportJson = () => {
    const text = JSON.stringify(draft, null, 2);
    setIo(text);
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = `slate-theme-${draft.id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch { /* the textarea has it */ }
  };
  const importJson = (text: string) => {
    try {
      const t = JSON.parse(text) as Theme;
      for (const k of COLOR_KEYS) if (!/^#[0-9a-f]{6}$/i.test(t.colors?.[k] ?? '')) throw new Error(`colors.${k} must be #rrggbb`);
      const taken = new Set(themes.map((x) => x.id));
      const fonts = {
        display: (FONTS.display as readonly string[]).includes(t.fonts?.display) ? t.fonts.display : 'Saira Semi Condensed',
        body: (FONTS.body as readonly string[]).includes(t.fonts?.body) ? t.fonts.body : 'IBM Plex Sans',
        mono: (FONTS.mono as readonly string[]).includes(t.fonts?.mono) ? t.fonts.mono : 'IBM Plex Mono',
      };
      const name = String(t.name || 'Imported').slice(0, 40);
      setDraft({ id: taken.has(t.id) || !/^[a-z0-9][a-z0-9-]*$/.test(t.id ?? '') ? uniqueId(name, taken) : t.id, name, colors: { ...t.colors }, fonts, radius: Math.min(2, Math.max(0, Number(t.radius ?? 1))), glow: Math.min(1, Math.max(0, Number(t.glow ?? 0))) });
      setMsg({ ok: true, text: `Imported "${name}". Save to keep it.` });
    } catch (e) { setMsg({ ok: false, text: `Not a theme: ${(e as Error).message}` }); }
  };

  const setColor = (k: ColorKey, v: string) => setDraft({ ...draft, colors: { ...draft.colors, [k]: v } });

  return (
    <div class="form">
      <div class="row wrap">
        <label class="f grow" style="min-width:220px"><span>Start from</span>
          <select value={baseId} onChange={(e) => pick((e.target as HTMLSelectElement).value)}>
            <optgroup label="Presets">{PRESETS.map((p) => <option value={p.id}>{p.name}</option>)}</optgroup>
            {ts.custom.length > 0 && <optgroup label="Yours">{ts.custom.map((p) => <option value={p.id}>{p.name}</option>)}</optgroup>}
          </select>
        </label>
        <button class="btn" type="button" onClick={duplicate}>Duplicate</button>
        <button class="btn primary" type="button" onClick={() => void use()}>Use this theme</button>
      </div>

      <ThemePreview theme={draft} />

      <div class="row wrap">
        {checks.map((c) => <span class={`tag ${c.ok ? 'ok' : 'warn'}`} title={`WCAG contrast; ${MIN_CONTRAST}:1 is the minimum for body text`}>{c.pair}: {c.ratio.toFixed(1)}:1{c.ok ? '' : ' — too low'}</span>)}
      </div>
      {checks.some((c) => !c.ok) && <div class="banner">Some text will be hard to read, especially in sun. Aim for at least {MIN_CONTRAST}:1.</div>}

      {isPreset && <p class="help">Presets can't be changed. Press Duplicate to make your own copy.</p>}
      <fieldset disabled={isPreset} style="border:0;padding:0;margin:0;display:grid;gap:var(--s15)">
        <label class="f"><span>Name</span><input type="text" value={draft.name} onInput={(e) => setDraft({ ...draft, name: (e.target as HTMLInputElement).value })} /></label>
        <div class="colors">
          {COLOR_KEYS.map((k) => (
            <label><input type="color" value={draft.colors[k]} onInput={(e) => setColor(k, (e.target as HTMLInputElement).value)} /><span>{LABELS[k]}<br /><code style="font-size:11px">{draft.colors[k]}</code></span></label>
          ))}
        </div>
        <div class="fields">
          {(['display', 'body', 'mono'] as const).map((k) => (
            <label class="f"><span>{k} font</span>
              <select value={draft.fonts[k]} onChange={(e) => setDraft({ ...draft, fonts: { ...draft.fonts, [k]: (e.target as HTMLSelectElement).value } })}>
                {FONTS[k].map((f) => <option value={f}>{f}</option>)}
              </select>
            </label>
          ))}
          <label class="f"><span>Corners {draft.radius.toFixed(1)}</span><input type="range" min="0" max="2" step="0.1" value={draft.radius} onInput={(e) => setDraft({ ...draft, radius: Number((e.target as HTMLInputElement).value) })} /></label>
          <label class="f"><span>Glow {draft.glow.toFixed(2)}</span><input type="range" min="0" max="1" step="0.05" value={draft.glow} onInput={(e) => setDraft({ ...draft, glow: Number((e.target as HTMLInputElement).value) })} /></label>
        </div>
      </fieldset>

      <div class="row wrap">
        <button class="btn primary" type="button" disabled={isPreset} onClick={() => void save()}>Save theme</button>
        {isSaved && <button class="btn danger" type="button" onClick={() => void remove()}>Delete</button>}
        <button class="btn" type="button" onClick={exportJson}>Export JSON</button>
        <label class="btn">Import file<input type="file" accept="application/json,.json" hidden onChange={async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) importJson(await f.text()); }} /></label>
        <button class="btn" type="button" onClick={() => importJson(io)} disabled={!io.trim()}>Import pasted</button>
      </div>
      {msg && <div class={msg.ok ? 'okmsg' : 'err'}>{msg.text}</div>}
      <label class="f"><span>Theme JSON (paste to import, or copy after export)</span><textarea value={io} onInput={(e) => setIo((e.target as HTMLTextAreaElement).value)} spellcheck={false} /></label>
    </div>
  );
}

/** The cockpit's Drive view in miniature, at true 1920x720 proportions. */
export function ThemePreview({ theme }: { theme: Theme }) {
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.4);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 1920));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const vars = themeVars(theme);
  const box = 'background:var(--panel);border:1px solid var(--line);border-radius:calc(14px * var(--r));padding:16px;display:flex;flex-direction:column;gap:10px;color:var(--fg);min-width:0';
  return (
    <div class="preview-frame" ref={frame} aria-label={`Preview of ${theme.name}`}>
      <div class="scale" style={{ ...vars, transform: `scale(${scale})`, background: 'var(--bg)', color: 'var(--fg)', fontFamily: 'var(--body)', display: 'grid', gridTemplateColumns: '96px 1fr', gridTemplateRows: '44px 1fr' }}>
        <div style="grid-column:1/-1;display:flex;align-items:center;gap:var(--s2);padding:0 var(--s2);background:var(--panel);border-bottom:1px solid var(--line);font-family:var(--mono);font-size:var(--fs-body-sm);color:var(--dim)">
          <span style="font-family:var(--display);font-weight:800;font-size:var(--fs-body);letter-spacing:.14em;color:var(--fg)">SLATE</span>
          <span class="pill"><span class="dot ok" />Brain</span><span class="pill"><span class="dot warn" />Truck box offline</span>
          <span style="flex:1" /><span style="font-family:var(--display);font-size:var(--fs-section);font-weight:600;color:var(--fg)">4:20 PM</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:var(--s05);padding:var(--s1);background:var(--panel);border-right:1px solid var(--line)">
          {['DRIVE', 'CARPLAY', 'CONTROL', 'CHARGE', 'TRIPS', 'CAMS'].map((l, i) => (
            <div style={`min-height:60px;border-radius:calc(12px * var(--r));display:grid;place-items:center;font-family:var(--display);font-weight:600;font-size:12px;letter-spacing:.1em;${i === 0 ? 'background:var(--accent);color:var(--accent-ink);box-shadow:0 0 calc(18px * var(--glow)) var(--accent)' : 'color:var(--dim)'}`}>{l}</div>
          ))}
        </div>
        <div style="display:grid;grid-template-columns:1.3fr 1fr 1.2fr;gap:var(--s1);padding:var(--s1);min-height:0">
          <div style={box}>
            <span class="lbl">Speed</span>
            <div style="font-family:var(--display);font-weight:800;font-size:200px;line-height:.9">43<small style="font-size:36px;color:var(--dim);margin-left:var(--s1)">MPH</small></div>
            <div style="display:flex;gap:var(--s1)">{['P', 'R', 'N', 'D'].map((g) => <div style={`flex:1;min-height:56px;border-radius:calc(12px * var(--r));border:1px solid var(--line);display:grid;place-items:center;font-family:var(--display);font-size:26px;font-weight:800;${g === 'D' ? 'background:var(--fg);color:var(--bg)' : 'color:var(--dim)'}`}>{g}</div>)}</div>
          </div>
          <div style={box}>
            <span class="lbl">Battery</span>
            <Ring soc={64} size={150} />
            <div style="font-family:var(--display);font-weight:800;font-size:54px">118<small style="font-size:var(--fs-section);color:var(--dim)"> mi</small></div>
            <div style="display:flex;gap:var(--s1)"><span class="tag ok">MANUAL</span><span class="tag warn">LOW TIRE</span><span class="tag" style="color:var(--bad)">ALERT</span></div>
          </div>
          <div style={box}>
            <span class="lbl">Next charger</span>
            <div style="font-family:var(--display);font-size:30px;font-weight:600">Tempe Marketplace</div>
            <div style="color:var(--dim);font-size:var(--fs-body)">Electrify America · 2.1 mi · 150 kW · arrive ~58%</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--s1);margin-top:auto">
              <div style="min-height:96px;border-radius:calc(14px * var(--r));background:var(--accent);color:var(--accent-ink);padding:var(--s2);font-family:var(--display);font-size:var(--fs-title);font-weight:600">Bed lights<br /><span style="font-family:var(--mono);font-size:var(--fs-caption)">ON</span></div>
              <div style="min-height:96px;border-radius:calc(14px * var(--r));background:var(--panel-2);border:1px solid var(--line);padding:var(--s2);font-family:var(--display);font-size:var(--fs-title);font-weight:600">Light bar<br /><span style="font-family:var(--mono);font-size:var(--fs-caption);color:var(--dim)">OFF</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
