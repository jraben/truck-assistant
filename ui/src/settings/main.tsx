import { render } from 'preact';
import '../lib/theme.ts';
import '../styles.css';
import { connect, pollSettings } from '../lib/brain.ts';
import { SettingsApp } from './SettingsApp.tsx';

connect();
pollSettings(60_000);
render(<SettingsApp />, document.getElementById('app')!);
