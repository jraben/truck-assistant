import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'node:path';

const brain = process.env.BRAIN_URL ?? 'http://localhost:8080';

/** In dev, /settings opens the portal page like it does when the brain serves the build. */
const settingsRoute = (): Plugin => ({
  name: 'settings-route',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/settings' || req.url === '/settings/') req.url = '/settings.html';
      else if (req.url && /^\/truck\/?(\?|$)/.test(req.url)) req.url = req.url.replace(/^\/truck\/?/, '/truck.html');
      next();
    });
  },
});

export default defineConfig({
  plugins: [preact(), settingsRoute()],
  build: {
    target: 'es2022',
    // Audio worklets load as their own files (addModule); never inline them as data: URLs.
    assetsInlineLimit: (file) => (/\.worklet\.js$/.test(file) ? false : undefined),
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), settings: resolve(__dirname, 'settings.html'), truck: resolve(__dirname, 'truck.html') } },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: brain, ws: true },
      '/go2rtc': brain,
      '/ws': { target: brain.replace(/^http/, 'ws'), ws: true },
    },
  },
});
