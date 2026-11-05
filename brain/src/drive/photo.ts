// The owner's photo of the truck (docs/contract.md "Track A", /api/vehicle/photo).
// One file, DATA_DIR/vehicle-photo.<jpg|png|webp>, recorded in Settings.truck.photo.
// Uploaded as raw image bytes, or fetched once from an https image URL. The
// type comes from the file's magic bytes, never from a header or a name.
import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { SettingsStore } from '../settings.ts';

export const PHOTO_MAX = 6 * 1024 * 1024;
export const PHOTO_TIMEOUT_MS = 15_000;
export type PhotoExt = 'jpg' | 'png' | 'webp';
export const PHOTO_TYPES: Record<PhotoExt, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const EXTS = Object.keys(PHOTO_TYPES) as PhotoExt[];

export class PhotoError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

/** JPEG, PNG or WebP by magic bytes; null for anything else. Pure. */
export function sniffImage(b: Uint8Array): PhotoExt | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return 'png';
  if (b.length >= 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'webp';
  return null;
}

/** An upload's bytes: an image, at most PHOTO_MAX. Pure; throws PhotoError. */
export function checkPhotoBytes(b: Uint8Array | null | undefined): PhotoExt {
  if (!b || b.length === 0) throw new PhotoError('no image in the request body');
  if (b.length > PHOTO_MAX) throw new PhotoError(`the photo is over ${PHOTO_MAX / 1024 / 1024} MB`, 413);
  const ext = sniffImage(b);
  if (!ext) throw new PhotoError('not a JPEG, PNG or WebP image');
  return ext;
}

/** A photo URL: https only, no credentials. Pure; throws PhotoError. */
export function checkPhotoUrl(v: unknown): URL {
  if (typeof v !== 'string' || !v.trim() || v.length > 2000) throw new PhotoError('url is required');
  let u: URL;
  try { u = new URL(v.trim()); } catch { throw new PhotoError('url is not a valid address'); }
  if (u.protocol !== 'https:') throw new PhotoError('the image URL must start with https://');
  if (u.username || u.password) throw new PhotoError('the image URL must not carry a login');
  return u;
}

type Fetch = typeof fetch;

/** Fetch an image: https at every hop (redirects followed by hand, at most 3), image/* content type, ≤ PHOTO_MAX, within the timeout. */
export async function fetchPhoto(url: string, fetchImpl: Fetch = fetch, timeoutMs = PHOTO_TIMEOUT_MS): Promise<{ bytes: Uint8Array; ext: PhotoExt }> {
  let u = checkPhotoUrl(url);
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    for (let hop = 0; ; hop++) {
      const res = await fetchImpl(u, { redirect: 'manual', signal, headers: { accept: 'image/jpeg,image/png,image/webp' } });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc || hop >= 3) throw new PhotoError('the image URL redirects too many times');
        const next = new URL(loc, u);
        if (next.protocol !== 'https:') throw new PhotoError('the image URL redirects to a non-https address');
        u = checkPhotoUrl(next.toString());
        continue;
      }
      if (!res.ok) throw new PhotoError(`the image URL answered ${res.status}`, 502);
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!type.startsWith('image/')) throw new PhotoError(`the URL is not an image (${type || 'no content type'})`);
      const len = Number(res.headers.get('content-length') ?? NaN);
      if (Number.isFinite(len) && len > PHOTO_MAX) throw new PhotoError(`the photo is over ${PHOTO_MAX / 1024 / 1024} MB`, 413);
      if (!res.body) throw new PhotoError('the image URL sent nothing', 502);
      const chunks: Uint8Array[] = [];
      let n = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.length;
        if (n > PHOTO_MAX) { await reader.cancel().catch(() => {}); throw new PhotoError(`the photo is over ${PHOTO_MAX / 1024 / 1024} MB`, 413); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(n);
      let o = 0;
      for (const c of chunks) { bytes.set(c, o); o += c.length; }
      return { bytes, ext: checkPhotoBytes(bytes) };
    }
  } catch (e) {
    if (e instanceof PhotoError) throw e;
    if ((e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError') throw new PhotoError(`the image URL took longer than ${timeoutMs / 1000} s`, 504);
    throw new PhotoError(`could not fetch the image: ${(e as Error).message}`, 502);
  }
}

/** GET/POST/DELETE /api/vehicle/photo. POST and DELETE sit behind the /settings login (ops needsAuth); GET is open so the dash and /truck can show it. */
export async function registerVehiclePhoto(app: FastifyInstance, settings: SettingsStore, dataDir: string, fetchImpl: Fetch = fetch) {
  const fileOf = (ext: PhotoExt) => path.join(dataDir, `vehicle-photo.${ext}`);
  const save = (bytes: Uint8Array, ext: PhotoExt, source: 'upload' | 'url') => {
    const tmp = fileOf(ext) + '.tmp';
    writeFileSync(tmp, bytes, { mode: 0o644 });
    renameSync(tmp, fileOf(ext));
    for (const x of EXTS) if (x !== ext) { try { unlinkSync(fileOf(x)); } catch { /* not there */ } }
    return settings.setTruckPhoto({ file: `vehicle-photo.${ext}`, updatedAt: new Date().toISOString(), source }).truck.photo;
  };
  const fail = (e: unknown, reply: import('fastify').FastifyReply) => {
    if (e instanceof PhotoError) return reply.code(e.status).send({ error: e.message });
    throw e;
  };

  await app.register(async (r) => {
    r.addContentTypeParser(['image/jpeg', 'image/png', 'image/webp', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: PHOTO_MAX }, (_req, body, done) => done(null, body));

    r.get<{ Querystring: { v?: string } }>('/api/vehicle/photo', async (req, reply) => {
      const p = settings.get().truck.photo;
      const file = p ? path.join(dataDir, p.file) : null;
      if (!p || !file || !existsSync(file)) return reply.code(404).send({ error: 'no truck photo' });
      const st = statSync(file);
      const etag = `"${Date.parse(p.updatedAt).toString(36)}-${st.size.toString(36)}"`;
      // ?v=<updatedAt> (what the UI asks for) is a fixed version: cache it; the bare URL revalidates.
      reply.header('cache-control', req.query.v && req.query.v === p.updatedAt ? 'public, max-age=86400' : 'no-cache');
      reply.header('etag', etag).header('last-modified', new Date(p.updatedAt).toUTCString()).header('x-content-type-options', 'nosniff');
      if (req.headers['if-none-match'] === etag) return reply.code(304).send();
      const ext = p.file.split('.').pop() as PhotoExt;
      return reply.type(PHOTO_TYPES[ext]).send(readFileSync(file));
    });

    r.post('/api/vehicle/photo', async (req, reply) => {
      try {
        const body = req.body as unknown;
        if (Buffer.isBuffer(body)) return { photo: save(body, checkPhotoBytes(body), 'upload') };
        const url = (body as { url?: unknown } | null)?.url;
        if (url === undefined) throw new PhotoError('send the image bytes (Content-Type image/jpeg, image/png or image/webp) or JSON {"url": "https://…"}');
        const { bytes, ext } = await fetchPhoto(String(checkPhotoUrl(url)), fetchImpl);
        return { photo: save(bytes, ext, 'url') };
      } catch (e) { return fail(e, reply); }
    });

    r.delete('/api/vehicle/photo', async () => {
      for (const x of EXTS) { try { unlinkSync(fileOf(x)); } catch { /* not there */ } }
      settings.setTruckPhoto(null);
      return { photo: null };
    });
  });
}
