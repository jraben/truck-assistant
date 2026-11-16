import { render } from 'preact';
import '../lib/theme.ts';
import '../styles.css';
import '../cams.css';
import { TruckApp } from './TruckApp.tsx';
import { App } from '../components/App.tsx';
import { connect, pollSettings } from '../lib/brain.ts';
import { PROJECT } from '../../../brain/src/project.ts';

document.title = `${PROJECT.name} · Truck`;
const framed = (() => { try { return window.self !== window.top; } catch { return true; } })();
if (framed) {
  // Inside a Home Assistant panel or WOPR: just the truck, as before.
  render(<TruckApp />, document.getElementById('app')!);
} else {
  // Opened on its own: inside the cockpit, like every other page.
  connect();
  pollSettings(60_000);
  render(<App page={{ id: '@truck', label: 'Truck', node: <TruckApp embedded /> }} />, document.getElementById('app')!);
}
