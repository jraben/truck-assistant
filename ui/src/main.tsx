import { render } from 'preact';
import './lib/theme.ts';
import './styles.css';
import { App } from './components/App.tsx';
import { connect, pollSettings } from './lib/brain.ts';
import { carplay } from './carplay/controller.ts';
import { PROJECT } from '../../brain/src/project.ts';

document.title = PROJECT.name;

connect();
pollSettings();
render(<App />, document.getElementById('app')!);
// CarPlay runs for the page's life (audio keeps playing on other views); ?carplaySim=1 = simulator.
carplay.init();

// Keep the screen on where the browser allows it (kiosk Chromium does).
try { (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<unknown> } }).wakeLock?.request('screen').catch(() => {}); } catch { /* not supported */ }
