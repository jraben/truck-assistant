// Track C HTTP: cameras, dashcam clips, the Truck page and its API, remote
// settings, alerts, viewers/sleep. Everything here goes through `guard`
// (auth.ts): the cockpit itself (loopback) is trusted, anyone else needs the
// remote token. See docs/contract.md "Track C: Cameras and remote".
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { WebSocket as WsSocket } from 'ws';
import { config } from '../config.ts';
import { allowed, COOKIE } from './auth.ts';
import { remoteConfig } from './config.ts';
import { maskRemote, RemoteSettingsError } from './store.ts';
import type { RemoteService } from './service.ts';

const PLAYER_FILES = new Set(['video-stream.js', 'video-rtc.js']);

export async function registerRemote(app: FastifyInstance, remote: RemoteService) {
  const token = () => remote.store.get().remote.token;
  const guard = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!allowed(req, token(), remoteConfig.trustedNets)) {
      return reply.code(401).send({ error: 'This needs the remote link from /settings > Remote (it carries a token).' });
    }
  };
  const viewerId = (req: FastifyRequest) => String((req.body as { id?: unknown } | null)?.id ?? req.ip).slice(0, 64);

  // ---- the Truck page ---------------------------------------------------------
  const truckHtml = path.join(config.uiDir, 'truck.html');
  app.get<{ Querystring: { token?: string } }>('/truck', async (req, reply) => {
    if (!allowed(req, token(), remoteConfig.trustedNets)) {
      return reply.code(401).type('text/html').send('<!doctype html><meta name="viewport" content="width=device-width"><body style="font:16px system-ui;background:#0b0f12;color:#dfe7ec;padding:24px"><h2>Slate truck</h2><p>Open this page with the link from the cockpit\'s <b>Settings &gt; Remote</b> (it carries a token). Once opened, this browser remembers it.</p>');
    }
    const t = req.query.token;
    if (t && t === token()) {
      const secure = req.protocol === 'https';
      // SameSite=None (https only) so the page also works inside an HA / WOPR iframe.
      reply.header('set-cookie', `${COOKIE}=${encodeURIComponent(t)}; Path=/; Max-Age=31536000; HttpOnly; ${secure ? 'SameSite=None; Secure' : 'SameSite=Lax'}`);
    }
    if (!existsSync(truckHtml)) return reply.code(503).type('text/plain').send(`Truck page not built (looked for ${truckHtml}). Run "npm run build".`);
    return (reply as unknown as { sendFile: (f: string) => unknown }).sendFile('truck.html');
  });

  app.get('/api/truck', { preHandler: guard }, async () => remote.snapshot());
  app.post('/api/truck/relay', { preHandler: guard }, async (req, reply) => {
    const b = (req.body ?? {}) as { id?: unknown; on?: unknown };
    if (typeof b.id !== 'string' || typeof b.on !== 'boolean') return reply.code(400).send({ error: 'body is {id: "relay_1", on: true}' });
    const r = remote.relay(b.id, b.on);
    return r.ok ? r : reply.code(409).send({ error: r.error ?? 'not sent' });
  });

  // ---- remote settings ------------------------------------------------------------
  app.get('/api/remote/settings', { preHandler: guard }, async () => maskRemote(remote.store.get()));
  app.put('/api/remote/settings', { preHandler: guard }, async (req, reply) => {
    try { return maskRemote(remote.store.update(req.body ?? {})); }
    catch (e) { if (e instanceof RemoteSettingsError) return reply.code(400).send({ error: e.message }); throw e; }
  });
  /** The full link (with the token) for a phone. Same guard: the cockpit screen, or someone who has it already. */
  app.get('/api/remote/link', { preHandler: guard }, async (req) => {
    const host = req.headers.host ?? `localhost:${config.port}`;
    return { token: token() ?? null, path: `/truck?token=${encodeURIComponent(token() ?? '')}`, url: `${req.protocol}://${host}/truck?token=${encodeURIComponent(token() ?? '')}` };
  });
  app.post('/api/remote/viewer', { preHandler: guard }, async (req) => { remote.power.ping(viewerId(req)); return remote.powerStatus(); });
  app.post('/api/remote/wake', { preHandler: guard }, async (req) => remote.wake(viewerId(req)));
  app.post('/api/remote/sleep', { preHandler: guard }, async () => { remote.sleep('asked to from the Truck page'); return remote.powerStatus(); });
  app.get('/api/remote/power', { preHandler: guard }, async () => remote.powerStatus());

  // ---- alerts --------------------------------------------------------------------
  app.get<{ Querystring: { limit?: string } }>('/api/alerts', { preHandler: guard }, async (req) => remote.alerts(Math.max(1, Math.min(500, Number(req.query.limit ?? 50) || 50))));
  app.post('/api/alerts/test', { preHandler: guard }, async () => remote.testAlert());

  // ---- cameras -------------------------------------------------------------------
  app.get('/api/cams', { preHandler: guard }, async () => ({ ...remote.camStatus(), serverTime: Date.now() }));

  app.get<{ Params: { id: string } }>('/api/cams/:id/mjpeg', { preHandler: guard }, async (req, reply) => {
    const id = req.params.id;
    if (!remote.cams.camera(id)) return reply.code(404).send({ error: `no enabled camera "${id}"` });
    if (remote.cams.backend === 'go2rtc') {
      // go2rtc can do MJPEG too (it transcodes); the cockpit uses WebRTC/MSE instead.
      return reply.redirect(`/api/cams/${encodeURIComponent(id)}/go2rtc-mjpeg`);
    }
    const res = reply.raw;
    let busy = false;
    const unsub = remote.cams.subscribe(id, (f) => {
      if (busy) return;   // the viewer is behind: drop frames rather than queue them
      const head = `--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${f.jpeg.length}\r\nX-Frame-Time: ${f.at}\r\n\r\n`;
      const ok = res.write(head) && res.write(f.jpeg) && res.write('\r\n');
      if (!ok) { busy = true; res.once('drain', () => { busy = false; }); }
    });
    if (!unsub) return reply.code(503).send({ error: remote.cams.why ?? 'camera not available' });
    reply.hijack();
    res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame', 'cache-control': 'no-store', connection: 'close', 'x-accel-buffering': 'no' });
    const closed = remote.power.openStream();
    req.raw.on('close', () => { unsub(); closed(); });
  });

  app.get<{ Params: { id: string } }>('/api/cams/:id/go2rtc-mjpeg', { preHandler: guard }, async (req, reply) => {
    const api = remote.cams.go2rtcApi;
    if (!api || !remote.cams.camera(req.params.id)) return reply.code(404).send({ error: 'no such go2rtc stream' });
    const up = await fetch(`${api}/api/stream.mjpeg?src=${encodeURIComponent(req.params.id)}`).catch(() => null);
    if (!up?.ok || !up.body) return reply.code(502).send({ error: 'go2rtc did not answer' });
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': up.headers.get('content-type') ?? 'multipart/x-mixed-replace', 'cache-control': 'no-store' });
    const closed = remote.power.openStream();
    const rd = up.body.getReader();
    req.raw.on('close', () => { void rd.cancel(); closed(); });
    for (;;) { const { done, value } = await rd.read().catch(() => ({ done: true, value: undefined })); if (done || !value) break; reply.raw.write(value); }
    reply.raw.end();
  });

  app.get<{ Params: { id: string } }>('/api/cams/:id/snapshot.jpg', { preHandler: guard }, async (req, reply) => {
    const jpeg = await remote.cams.snapshot(req.params.id);
    if (!jpeg) return reply.code(503).send({ error: 'no picture from that camera right now' });
    return reply.header('cache-control', 'no-store').type('image/jpeg').send(jpeg);
  });

  // go2rtc's WebSocket (WebRTC signalling and MSE), proxied so the token covers it and the page needs one origin.
  app.get<{ Querystring: { src?: string } }>('/api/cams/ws', { websocket: true, preHandler: guard }, (socket: WsSocket, req) => {
    const api = remote.cams.go2rtcApi;
    const src = req.query.src ?? '';
    if (!api || !remote.cams.camera(src)) { socket.close(4004, 'no such stream'); return; }
    const up = new WebSocket(`${api.replace(/^http/, 'ws')}/api/ws?src=${encodeURIComponent(src)}`);
    up.binaryType = 'arraybuffer';
    const queue: (string | Buffer)[] = [];
    const closed = remote.power.openStream();
    up.onopen = () => { for (const m of queue.splice(0)) up.send(m); };
    up.onmessage = (e) => { if (socket.readyState === 1) socket.send(typeof e.data === 'string' ? e.data : Buffer.from(e.data as ArrayBuffer)); };
    up.onclose = () => { try { socket.close(); } catch { /* gone */ } };
    up.onerror = () => { try { socket.close(1011, 'go2rtc not answering'); } catch { /* gone */ } };
    socket.on('message', (m: Buffer, isBinary: boolean) => { const msg = isBinary ? m : m.toString(); if (up.readyState === 1) up.send(msg); else queue.push(msg); });
    socket.on('close', () => { closed(); try { up.close(); } catch { /* gone */ } });
  });

  // go2rtc's own player (video-stream.js imports ./video-rtc.js), from the pinned go2rtc.
  app.get<{ Params: { file: string } }>('/go2rtc/:file', { preHandler: guard }, async (req, reply) => {
    const api = remote.cams.go2rtcApi;
    if (!PLAYER_FILES.has(req.params.file)) return reply.code(404).send({ error: 'not a player file' });
    if (!api) return reply.code(404).send({ error: 'go2rtc is not running here' });
    const r = await fetch(`${api}/${req.params.file}`).catch(() => null);
    if (!r?.ok) return reply.code(502).send({ error: 'go2rtc did not answer' });
    return reply.type('application/javascript').header('cache-control', 'max-age=3600').send(await r.text());
  });

  // ---- dashcam -------------------------------------------------------------------
  app.post('/api/cams/clip', { preHandler: guard }, async (req, reply) => {
    const cam = (req.body as { camera?: unknown } | null)?.camera;
    const clips = remote.saveClip(typeof cam === 'string' ? cam : undefined);
    if (!clips.length) return reply.code(409).send({ error: remote.cams.recordedCameras().length ? 'that camera is not recorded' : 'the dashcam is not recording any camera (Settings > Cameras)' });
    return reply.code(202).send(clips);
  });
  app.get<{ Querystring: { limit?: string } }>('/api/cams/clips', { preHandler: guard }, async (req) => remote.clips(Math.max(1, Math.min(500, Number(req.query.limit ?? 100) || 100))));
  app.delete<{ Params: { id: string } }>('/api/cams/clips/:id', { preHandler: guard }, async (req, reply) => (remote.dashcam.deleteClip(req.params.id) ? reply.code(204).send() : reply.code(404).send({ error: 'no such clip' })));
  app.get<{ Params: { file: string } }>('/api/cams/clips/:file', { preHandler: guard }, async (req, reply) => {
    const id = req.params.file.replace(/\.mp4$/, '');
    const f = remote.dashcam.clipFile(id);
    if (!f) return reply.code(404).send({ error: 'no such clip (or it is still being cut)' });
    return sendRange(req, reply, f);
  });
  /** Motion from outside the brain (a test, or an HA automation). */
  app.post('/api/cams/motion', { preHandler: guard }, async (req) => {
    const b = (req.body ?? {}) as { camera?: unknown; how?: unknown };
    remote.onMotion(typeof b.camera === 'string' ? b.camera : null, typeof b.how === 'string' ? b.how.slice(0, 80) : 'Motion (reported)');
    return { ok: true };
  });
}

/** An MP4 with Range support, so <video> can seek. */
function sendRange(req: FastifyRequest, reply: FastifyReply, file: string) {
  const size = statSync(file).size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  reply.header('accept-ranges', 'bytes').type('video/mp4');
  if (!m) return reply.header('content-length', size).send(createReadStream(file));
  let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
  let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1;
  if (!(start >= 0) || start >= size) return reply.code(416).header('content-range', `bytes */${size}`).send();
  end = Math.min(end, size - 1);
  start = Math.max(0, start);
  return reply.code(206).header('content-range', `bytes ${start}-${end}/${size}`).header('content-length', end - start + 1).send(createReadStream(file, { start, end }));
}
