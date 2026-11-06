// Slate Cockpit brain: entry point.
import { Brain } from './brain.ts';
import { config } from './config.ts';
import { openDb } from './db.ts';
import { buildServer } from './server.ts';
import { SettingsStore } from './settings.ts';
import { RemoteService } from './remote/service.ts';
import { registerRemote } from './remote/routes.ts';
import { applyPendingRestore } from './ops/backup.ts';
import { registerParked } from './parkedRoutes.ts';
import { registerSim } from './simRoutes.ts';

async function main() {
  console.log(`[brain] v${config.version}, data in ${config.dataDir}${config.sim ? ', SIM=1' : ''}`);
  applyPendingRestore(config.dataDir); // a restore staged from /settings, before anything opens the files
  const db = openDb(config.dataDir, { sim: config.sim });
  const settings = new SettingsStore(config.dataDir);
  const brain = new Brain(db, settings);
  const app = await buildServer(brain);
  const remote = new RemoteService(brain, db, config.dataDir, config.sim);   // Track C: cameras, dashcam, alerts, remote
  await registerRemote(app, remote);
  registerParked(app, brain, db, remote, (app as unknown as { trackb: { plex: import('./media/plex.ts').PlexService } }).trackb.plex);   // video/games/karaoke, camp/pet, trailers, light show
  registerSim(app, brain, remote);   // the test panel (SIM=1 only)
  brain.start();
  await app.listen({ port: config.port, host: config.host });
  await remote.start();
  console.log(`[brain] listening on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);

  let stopping = false;
  const stop = async (sig: string) => {
    if (stopping) return; stopping = true;
    console.log(`[brain] ${sig}, shutting down`);
    const force = setTimeout(() => process.exit(1), 5000);
    try { await app.close(); remote.stop(); await brain.stop(); db.close(); } catch (e) { console.error(e); }
    clearTimeout(force);
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}

process.on('unhandledRejection', (e) => console.error('[brain] unhandled rejection', e));

main().catch((e) => { console.error('[brain] failed to start', e); process.exit(1); });
