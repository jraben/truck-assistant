// Dev runner: the brain with SIM=1 (simulated truck) plus Vite's dev server,
// which proxies /api and /ws to the brain. No extra dependencies, so it works
// the same on Windows and on the Pi. Ctrl+C stops both.
import { spawn, spawnSync } from 'node:child_process';

const procs = [
  ['brain', ['run', 'dev', '-w', 'brain'], { SIM: process.env.SIM ?? '1' }],
  ['ui', ['run', 'dev', '-w', 'ui'], {}],
].map(([name, args, env]) => {
  // One command string through the shell: works for npm.cmd on Windows and npm on Linux.
  const p = spawn(`npm ${args.join(' ')}`, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env }, shell: true });
  const tag = (s) => s.toString().split(/\r?\n/).filter(Boolean).map((l) => `[${name}] ${l}`).join('\n') + '\n';
  p.stdout.on('data', (d) => process.stdout.write(tag(d)));
  p.stderr.on('data', (d) => process.stderr.write(tag(d)));
  p.on('exit', (code) => { console.log(`[${name}] exited ${code}`); stop(); });
  return p;
});

let stopping = false;
function stop() {
  if (stopping) return; stopping = true;
  for (const p of procs) {
    try {
      // With shell: true, p is the shell; on Windows kill its whole tree or the brain and Vite outlive it.
      if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
      else p.kill();
    } catch {}
  }
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
