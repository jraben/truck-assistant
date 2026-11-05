// SHOUTcast/Icecast in-band metadata ("ICY"). Asked for with `Icy-MetaData: 1`,
// a station that supports it says `icy-metaint: N` and then sends N audio
// bytes, one length byte L, L*16 bytes of metadata (StreamTitle='…';), and
// so on. The browser's <audio> can't read it, so the brain relays the stream
// and takes the metadata out on the way through.

/** Splits an ICY stream into audio (passed on) and titles. Feed it every chunk in order. */
export class IcyParser {
  private metaint: number;
  private left: number;           // audio bytes until the next length byte
  private metaLeft = -1;          // metadata bytes still to read; -1 = reading audio
  private meta: Buffer[] = [];
  private onTitle: (title: string) => void;

  constructor(metaint: number, onTitle: (title: string) => void) {
    this.metaint = metaint;
    this.left = metaint;
    this.onTitle = onTitle;
  }

  /** Returns the audio bytes in this chunk (metadata removed). */
  push(chunk: Buffer): Buffer {
    if (!(this.metaint > 0)) return chunk;
    const out: Buffer[] = [];
    let i = 0;
    while (i < chunk.length) {
      if (this.metaLeft > 0) {
        const n = Math.min(this.metaLeft, chunk.length - i);
        this.meta.push(chunk.subarray(i, i + n));
        this.metaLeft -= n; i += n;
        if (this.metaLeft === 0) { this.finishMeta(); this.metaLeft = -1; this.left = this.metaint; }
      } else if (this.left === 0) {
        const len = chunk[i] * 16; i++;
        if (len === 0) { this.left = this.metaint; } else { this.metaLeft = len; this.meta = []; }
      } else {
        const n = Math.min(this.left, chunk.length - i);
        out.push(chunk.subarray(i, i + n));
        this.left -= n; i += n;
      }
    }
    return out.length === 1 ? out[0] : Buffer.concat(out);
  }

  private finishMeta() {
    const t = parseStreamTitle(Buffer.concat(this.meta));
    this.meta = [];
    if (t !== null) this.onTitle(t);
  }
}

/** StreamTitle='Artist - Song'; from a metadata block (padded with NULs). Latin-1 when it isn't valid UTF-8. */
export function parseStreamTitle(b: Buffer): string | null {
  let s = b.toString('utf8');
  if (s.includes('�')) s = b.toString('latin1');
  s = s.replace(/\0+$/, '');
  const m = /StreamTitle='(.*?)';/s.exec(s) ?? /StreamTitle='(.*)'/s.exec(s);
  if (!m) return null;
  return m[1].replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
}

/** "Artist - Title" -> parts; a title with no " - " is all title. */
export function splitStreamTitle(t: string): { artist: string | null; title: string | null } {
  const s = t.trim();
  if (!s) return { artist: null, title: null };
  const i = s.indexOf(' - ');
  if (i <= 0) return { artist: null, title: s };
  return { artist: s.slice(0, i).trim() || null, title: s.slice(i + 3).trim() || null };
}
