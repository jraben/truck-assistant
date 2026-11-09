// Each driver's own photo, shown in place of their initials on the rail, the
// driver picker and /settings. One file per driver,
// DATA_DIR/driver-photos/<driver id>.<jpg|png|webp>, recorded in
// Driver.photo and set only here. The settings page crops and shrinks the
// picture to a small square JPEG before sending it; the type still comes from
// the file's magic bytes (drive/photo.ts).
//
// Unlike the truck photo these are people's faces, so they stay behind the
// /settings login from other devices (ops needsAuth); the dash on the Pi
// itself is local and sees them.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { SettingsStore } from '../settings.ts';
import type { Driver } from '../types.ts';
import { checkPhotoBytes, PHOTO_MAX, PHOTO_TYPES, PhotoError, type PhotoExt } from './photo.ts';

export const DRIVER_PHOTO_DIR = 'driver-photos';
const EXTS = Object.keys(PHOTO_TYPES) as PhotoExt[];

/** A stored record for driver `id`, or null for anything that isn't one (never throws). Pure. */
export function driverPhotoOf(v: unknown, id: string): Driver['photo'] {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const m = typeof o.file === 'string' ? /^([a-z0-9][a-z0-9-]{0,31})\.(jpg|png|webp)$/.exec(o.file) : null;
  if (!m || m[1] !== id || typeof o.updatedAt !== 'string' || !Number.isFinite(Date.parse(o.updatedAt))) return null;
  return { file: o.file as string, updatedAt: o.updatedAt };
}

/** What the cockpit loads for a driver's photo (versioned so a new one shows at once), or null. Pure. */
export const driverPhotoUrl = (d: Pick<Driver, 'id' | 'photo'>): string | null =>
  d.photo ? `/api/drivers/${encodeURIComponent(d.id)}/photo?v=${encodeURIComponent(d.photo.updatedAt)}` : null;

/** GET/POST/DELETE /api/drivers/:id/photo; a deleted driver's photo goes with them. */
export async function registerDriverPhotos(app: FastifyInstance, settings: SettingsStore, dataDir: string) {
  const dir = path.join(dataDir, DRIVER_PHOTO_DIR);
  const fileOf = (id: string, ext: PhotoExt) => path.join(dir, `${id}.${ext}`);
  const drop = (id: string) => { for (const x of EXTS) { try { unlinkSync(fileOf(id, x)); } catch { /* not there */ } } };
  settings.onChange((next, prev) => {
    for (const d of prev.drivers) if (!next.drivers.some((x) => x.id === d.id)) drop(d.id);
  });

  await app.register(async (r) => {
    r.addContentTypeParser(['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: PHOTO_MAX }, (_req, body, done) => done(null, body));

    r.get<{ Params: { id: string }; Querystring: { v?: string } }>('/api/drivers/:id/photo', async (req, reply) => {
      const d = settings.driver(req.params.id);
      const file = d?.photo ? path.join(dir, d.photo.file) : null;
      if (!d?.photo || !file || !existsSync(file)) return reply.code(404).send({ error: 'no photo for this driver' });
      const st = statSync(file);
      const etag = `"${Date.parse(d.photo.updatedAt).toString(36)}-${st.size.toString(36)}"`;
      reply.header('cache-control', req.query.v && req.query.v === d.photo.updatedAt ? 'private, max-age=86400' : 'no-cache');
      reply.header('etag', etag).header('x-content-type-options', 'nosniff');
      if (req.headers['if-none-match'] === etag) return reply.code(304).send();
      return reply.type(PHOTO_TYPES[d.photo.file.split('.').pop() as PhotoExt]).send(readFileSync(file));
    });

    r.post<{ Params: { id: string } }>('/api/drivers/:id/photo', async (req, reply) => {
      const d = settings.driver(req.params.id);
      if (!d) return reply.code(404).send({ error: 'no such driver' });
      try {
        const body = req.body as unknown;
        if (!Buffer.isBuffer(body)) throw new PhotoError('send the image bytes (Content-Type image/jpeg, image/png or image/webp)');
        const ext = checkPhotoBytes(body);
        mkdirSync(dir, { recursive: true });
        const tmp = fileOf(d.id, ext) + '.tmp';
        writeFileSync(tmp, body, { mode: 0o644 });
        renameSync(tmp, fileOf(d.id, ext));
        for (const x of EXTS) if (x !== ext) { try { unlinkSync(fileOf(d.id, x)); } catch { /* not there */ } }
        return { photo: settings.setDriverPhoto(d.id, { file: `${d.id}.${ext}`, updatedAt: new Date().toISOString() }) };
      } catch (e) {
        if (e instanceof PhotoError) return reply.code(e.status).send({ error: e.message });
        throw e;
      }
    });

    r.delete<{ Params: { id: string } }>('/api/drivers/:id/photo', async (req, reply) => {
      if (!settings.driver(req.params.id)) return reply.code(404).send({ error: 'no such driver' });
      drop(req.params.id);
      settings.setDriverPhoto(req.params.id, null);
      return { photo: null };
    });
  });
}
