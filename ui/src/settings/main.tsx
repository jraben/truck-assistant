import { render } from 'preact';
import '../lib/theme.ts';
import '../styles.css';
import { connect, pollSettings } from '../lib/brain.ts';
import { SettingsApp } from './SettingsApp.tsx';
import { App } from '../components/App.tsx';
import { PROJECT } from '../../../brain/src/project.ts';

connect();
pollSettings(60_000);
document.title = `${PROJECT.name} · Settings`;
// Settings opens inside the cockpit: same top bar, rail and theme; only the stage is Settings.
render(<App page={{ id: '@settings', label: 'Settings', node: <SettingsApp embedded /> }} />, document.getElementById('app')!);
