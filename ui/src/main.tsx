import { render } from 'preact';
import './lib/theme.ts';
import './styles.css';
import { App } from './components/App.tsx';
import { connect, pollSettings } from './lib/brain.ts';
import { carplay } from './carplay/controller.ts';
import { keepScreenAwakeWhileCharging } from './lib/screenAwake.ts';
import { PROJECT } from '../../brain/src/project.ts';

document.title = PROJECT.name;

connect();
pollSettings();
render(<App />, document.getElementById('app')!);
// CarPlay runs for the page's life (audio keeps playing on other views); ?carplaySim=1 = simulator.
carplay.init();

// Keep the screen on while the truck is on (charging), not on battery (lib/screenAwake.ts).
try { keepScreenAwakeWhileCharging(); } catch { /* not supported */ }
