// The /login page: plain HTML, no bundle, so it works even if the UI build is missing.
import { PROJECT } from '../project.ts';
import { PRESETS, type Theme } from '../themes.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Only same-site paths: never //host or a scheme. */
export const safeNext = (n: unknown) => (typeof n === 'string' && /^\/(?!\/)[\w\-./?=&#%]*$/.test(n) ? n : '/settings');

/** The colours and faces to log in with: the cockpit's own theme, so /login looks like the same app. */
export type LoginLook = Pick<Theme, 'colors' | 'fonts'>;
const NIGHT: LoginLook = PRESETS.find((t) => t.id === 'night') ?? PRESETS[0];

export function loginPage(next: string, passwordSet: boolean, look: LoginLook = NIGHT): string {
  const c = look.colors;
  const face = (f: string, fallback: string) => (f && f !== 'System' ? `"${f.replace(/"/g, '')}", ${fallback}` : fallback);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(PROJECT.name)} · Log in</title>
<style>
*{box-sizing:border-box}
:root{--bg:${c.bg};--panel:${c.panel};--panel2:${c.panel2};--line:${c.line};--fg:${c.fg};--dim:${c.dim};--accent:${c.accent};--ink:${c.accentInk};--bad:${c.bad};
--display:${face(look.fonts.display, '"Arial Narrow", system-ui, sans-serif')};--body:${face(look.fonts.body, 'system-ui, sans-serif')}}
html,body{height:100%}body{margin:0;display:grid;grid-template-rows:auto 1fr;background:var(--bg);color:var(--fg);font:16px/1.4 var(--body)}
.strip{display:flex;align-items:center;gap:16px;min-height:56px;padding:0 16px;border-bottom:1px solid var(--line);background:var(--panel)}
.brand{display:inline-flex;align-items:center;gap:8px;font-family:var(--display);font-weight:800;font-size:20px;letter-spacing:.14em;white-space:nowrap}
.brand img{width:32px;height:32px;border-radius:8px}
.title{font-family:var(--display);font-weight:600;font-size:22px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);white-space:nowrap}
main{display:grid;place-items:center;padding:16px}
form{width:min(400px,100%);display:grid;gap:14px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:24px}
input{min-height:48px;padding:8px 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:inherit;font:inherit}
button{min-height:52px;border:0;border-radius:10px;background:var(--accent);color:var(--ink);font-weight:700;font-size:16px;cursor:pointer;font-family:var(--body)}
a{color:var(--accent)}.err{color:var(--bad);min-height:1.4em;font-size:14px}.dim{color:var(--dim);font-size:13px}
.ver{position:fixed;left:12px;bottom:6px;font-size:13px;color:var(--dim);padding:2px 10px;border-radius:999px;background:var(--panel)}
@media (max-width:480px){.brand span{display:none}}
</style></head><body>
<header class="strip"><span class="brand"><img src="/icon.svg" alt=""><span>${esc(PROJECT.shortName)}</span></span><span class="title">Log in</span></header>
<main><form id="f">
${passwordSet ? '<input id="pw" type="password" autocomplete="current-password" placeholder="Password" required autofocus>' : '<p>No password is set yet. Set one on the cockpit screen (setup) or in Settings, Security.</p>'}
${passwordSet ? '<button type="submit">Log in</button>' : `<a href="${esc(next)}">Continue</a>`}
<div class="err" id="e" role="alert"></div>
<div class="dim">${esc(PROJECT.notice)}</div>
<a href="/">Back to cockpit</a></form></main>
<div class="ver" id="ver" hidden></div>
<script>
const next=${JSON.stringify(next)};
fetch('/api/update/version').then((r)=>r.ok?r.json():null).then((v)=>{if(!v)return;const b=v.sha?v.sha.slice(0,7):(v.tag||'').replace(/^main@/,'');
const d=v.installedAt?new Date(v.installedAt).toLocaleString([],{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}):'';
const el=document.getElementById('ver');el.textContent='TA_v'+v.version+(b?'+'+b:'')+(d?' · updated '+d:'');el.hidden=false}).catch(()=>{});
document.getElementById('f').addEventListener('submit',async(ev)=>{ev.preventDefault();const e=document.getElementById('e');e.textContent='';
try{const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})});
if(r.ok){location.href=next;return}const b=await r.json().catch(()=>({}));e.textContent=b.error||('Error '+r.status)}catch(x){e.textContent='The truck did not answer'}});
</script></body></html>`;
}
