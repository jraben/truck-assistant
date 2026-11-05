// Slate Cockpit brain: entry point.
import { Brain } from './brain.ts';
import { config } from './config.ts';
import { openDb } from './db.ts';
import { buildServer } from './server.ts';
import { SettingsStore } from './settings.ts';
import { applyPendingRestore } from './ops/backup.ts';

async function main() {
  console.log(`[brain] v${config.version}, data in ${config.dataDir}${config.sim ? ', SIM=1' : ''}`);
  applyPendingRestore(config.dataDir); // a restore staged from /settings, before anything opens the files
  const db = openDb(config.dataDir);
  const settings = new SettingsStore(config.dataDir);
  const brain = new Brain(db, settings);
  const app = await buildServer(brain);
  brain.start();
  await app.listen({ port: config.port, host: config.host });
  console.log(`[brain] listening on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);

  let stopping = false;
  const stop = async (sig: string) => {
    if (stopping) return; stopping = true;
    console.log(`[brain] ${sig}, shutting down`);
    const force = setTimeout(() => process.exit(1), 5000);
    try { await app.close(); await brain.stop(); db.close(); } catch (e) { console.error(e); }
    clearTimeout(force);
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('SIGTERM', () => void stop('SIGTERM'));
}

process.on('unhandledRejection', (e) => console.error('[brain] unhandled rejection', e));

main().catch((e) => { console.error('[brain] failed to start', e); process.exit(1); });
