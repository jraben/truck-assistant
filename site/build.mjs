// Builds truck-assistant.com into _site/: the page, its CSS, CNAME, and the images
// it uses, copied from the repo (one copy of each screenshot lives in docs/).
// Run: node site/build.mjs   (GitHub Actions: .github/workflows/pages.yml)
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '_site');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'img'), { recursive: true });
for (const f of ['index.html', 'style.css', 'CNAME']) cpSync(join(root, 'site', f), join(out, f));
const IMAGES = {
  'ui/public/icon.svg': 'icon.svg',
  'ui/public/logo-lockup.svg': 'logo-lockup.svg',
  'docs/media/demo-poster.jpg': 'demo-poster.jpg',
  'docs/install/img/cockpit-drive.jpg': 'cockpit-drive.jpg',
  'docs/install/img/cockpit-carplay-sim.jpg': 'cockpit-carplay-sim.jpg',
  'docs/install/img/cockpit-cams.jpg': 'cockpit-cams.jpg',
  'docs/install/img/cockpit-control.jpg': 'cockpit-control.jpg',
  'docs/install/img/truck-layout.svg': 'truck-layout.svg',
};
for (const [from, to] of Object.entries(IMAGES)) cpSync(join(root, from), join(out, 'img', to));
console.log(`site built: ${out}`);
