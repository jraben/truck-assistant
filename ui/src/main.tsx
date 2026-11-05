import { render } from 'preact';
import './lib/theme.ts';
import './styles.css';
import { App } from './components/App.tsx';
import { connect, pollSettings } from './lib/brain.ts';

connect();
pollSettings();
render(<App />, document.getElementById('app')!);

// Keep the screen on where the browser allows it (kiosk Chromium does).
try { (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<unknown> } }).wakeLock?.request('screen').catch(() => {}); } catch { /* not supported */ }
