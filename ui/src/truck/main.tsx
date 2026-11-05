import { render } from 'preact';
import '../lib/theme.ts';
import '../styles.css';
import '../cams.css';
import { TruckApp } from './TruckApp.tsx';

render(<TruckApp />, document.getElementById('app')!);
