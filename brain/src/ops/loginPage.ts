// The /login page: plain HTML, no bundle, so it works even if the UI build is missing.
import { PROJECT } from '../project.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Only same-site paths: never //host or a scheme. */
export const safeNext = (n: unknown) => (typeof n === 'string' && /^\/(?!\/)[\w\-./?=&#%]*$/.test(n) ? n : '/settings');

export function loginPage(next: string, passwordSet: boolean): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><title>${esc(PROJECT.name)} · log in</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f14;color:#e6edf3;font:16px/1.4 system-ui,sans-serif}
form{width:min(380px,calc(100vw - 32px));display:grid;gap:14px;background:#121821;border:1px solid #233041;border-radius:14px;padding:24px}
h1{margin:0;font-size:22px;letter-spacing:.1em}input{min-height:48px;padding:8px 12px;border-radius:10px;border:1px solid #233041;background:#0b0f14;color:inherit;font:inherit}
button{min-height:52px;border:0;border-radius:10px;background:#4fc3d9;color:#04161b;font-weight:700;font-size:16px;cursor:pointer}
.err{color:#ff6b6b;min-height:1.4em;font-size:14px}.dim{color:#8a99a5;font-size:13px}
</style></head><body>
<form id="f"><h1>${esc(PROJECT.shortName)} · LOG IN</h1>
${passwordSet ? '<input id="pw" type="password" autocomplete="current-password" placeholder="Password" required autofocus>' : '<p>No password is set yet. Set one on the cockpit screen (setup) or in Settings, Security.</p>'}
${passwordSet ? '<button type="submit">Log in</button>' : `<a href="${esc(next)}" style="color:#4fc3d9">Continue</a>`}
<div class="err" id="e" role="alert"></div>
<div class="dim">${esc(PROJECT.notice)}</div></form>
<script>
const next=${JSON.stringify(next)};
document.getElementById('f').addEventListener('submit',async(ev)=>{ev.preventDefault();const e=document.getElementById('e');e.textContent='';
try{const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})});
if(r.ok){location.href=next;return}const b=await r.json().catch(()=>({}));e.textContent=b.error||('Error '+r.status)}catch(x){e.textContent='The truck did not answer'}});
</script></body></html>`;
}
