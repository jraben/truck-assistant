// A minimal ustar writer/reader for backups: regular files only, short names.
// Enough to make a .tar.gz any NAS or `tar xzf` opens, with no dependencies.

export type TarEntry = { name: string; data: Buffer; mtime?: number };

function octal(n: number, len: number): string { return n.toString(8).padStart(len - 1, '0') + '\0'; }

function header(name: string, size: number, mtime: number): Buffer {
  if (Buffer.byteLength(name) > 99 || !/^[\w./-]+$/.test(name) || name.includes('..') || name.startsWith('/')) throw new Error(`tar: bad name ${name}`);
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, 100, 'utf8');
  h.write(octal(0o600, 8), 100, 8, 'ascii');
  h.write(octal(0, 8), 108, 8, 'ascii');
  h.write(octal(0, 8), 116, 8, 'ascii');
  h.write(octal(size, 12), 124, 12, 'ascii');
  h.write(octal(Math.floor(mtime / 1000), 12), 136, 12, 'ascii');
  h.write('        ', 148, 8, 'ascii');
  h.write('0', 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii');
  h.write('00', 263, 2, 'ascii');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  return h;
}

export function writeTar(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    parts.push(header(e.name, e.data.length, e.mtime ?? Date.now()), e.data);
    const pad = (512 - (e.data.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

export function readTar(buf: Buffer): TarEntry[] {
  const out: TarEntry[] = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const name = h.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(h.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    const want = parseInt(h.subarray(148, 156).toString('ascii').replace(/\0.*$/s, '').trim(), 8);
    if (sum !== want) throw new Error('tar: bad header checksum (not a backup, or damaged)');
    if (!Number.isFinite(size) || size < 0 || off + 512 + size > buf.length) throw new Error('tar: truncated');
    const data = buf.subarray(off + 512, off + 512 + size);
    if (type === '0' || type === '\0') out.push({ name, data: Buffer.from(data) });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}
