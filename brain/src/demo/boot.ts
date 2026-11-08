// DEMO=1: imported first by src/index.ts, so the integration gate is in place
// before any module that talks to the network has loaded (some capture fetch
// when they are constructed). Does nothing unless DEMO=1.
import { config } from '../config.ts';
import { demoBackend, makeDemoServices, type DemoServices } from './backend.ts';
import { installDemoGate } from './gate.ts';

export const demoServices: DemoServices | null = config.demo ? makeDemoServices() : null;
if (demoServices) installDemoGate(demoBackend(demoServices));
