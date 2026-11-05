// H.264 Annex-B helpers. Pure: no DOM, no WebCodecs, so vitest covers them.

export const NAL = { SLICE: 1, IDR: 5, SEI: 6, SPS: 7, PPS: 8, AUD: 9 } as const;

/**
 * Split an Annex-B byte stream into NAL units (start codes removed).
 * Accepts 3- and 4-byte start codes; bytes before the first start code are dropped.
 */
export function splitNals(buf: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = -1;
  const n = buf.length;
  let i = 0;
  while (i + 2 < n) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
      if (start >= 0) {
        // A 4-byte start code's leading zero belongs to it, not to the previous NAL.
        let end = i;
        while (end > start && buf[end - 1] === 0) end--;
        if (end > start) out.push(buf.subarray(start, end));
      }
      i += 3;
      start = i;
    } else {
      i++;
    }
  }
  if (start >= 0 && start < n) out.push(buf.subarray(start, n));
  return out;
}

export const nalType = (nal: Uint8Array) => (nal.length ? nal[0] & 0x1f : -1);

/** True if the access unit holds an IDR slice (a frame the decoder can start from). */
export function isKeyFrame(au: Uint8Array): boolean {
  return splitNals(au).some((n) => nalType(n) === NAL.IDR);
}

export function findNal(au: Uint8Array, type: number): Uint8Array | null {
  return splitNals(au).find((n) => nalType(n) === type) ?? null;
}

const hex2 = (v: number) => v.toString(16).padStart(2, '0');

/**
 * WebCodecs codec string from an SPS NAL (with its 1-byte header):
 * "avc1." + profile_idc + constraint flags + level_idc, as hex.
 */
export function codecFromSps(sps: Uint8Array): string | null {
  if (sps.length < 4 || nalType(sps) !== NAL.SPS) return null;
  return `avc1.${hex2(sps[1])}${hex2(sps[2])}${hex2(sps[3])}`;
}

/**
 * Split a whole Annex-B clip into access units (one per frame), for the simulator.
 * A new access unit starts at an AUD, or (a clip without AUDs) at a picture's
 * first slice or an SPS/PPS/SEI after a slice. Each AU is returned with 4-byte start codes.
 */
export function splitAccessUnits(clip: Uint8Array): Uint8Array[] {
  const nals = splitNals(clip);
  const units: Uint8Array[][] = [];
  let cur: Uint8Array[] = [];
  let hasSlice = false;
  // With AUDs, they alone mark frames (so multi-slice frames stay whole).
  const audOnly = nals.some((n) => nalType(n) === NAL.AUD);
  for (const nal of nals) {
    const t = nalType(nal);
    const isSlice = t === NAL.SLICE || t === NAL.IDR;
    // first_mb_in_slice is the slice header's first ue(v); a leading 1 bit means 0 = a new picture.
    const firstSlice = isSlice && nal.length > 1 && (nal[1] & 0x80) !== 0;
    const boundary = t === NAL.AUD || (!audOnly && hasSlice && (firstSlice || t === NAL.SPS || t === NAL.PPS || t === NAL.SEI));
    if (boundary && cur.length) { units.push(cur); cur = []; hasSlice = false; }
    cur.push(nal);
    if (isSlice) hasSlice = true;
  }
  if (cur.length) units.push(cur);
  return units.map(joinAnnexB);
}

export function joinAnnexB(nals: Uint8Array[]): Uint8Array {
  const len = nals.reduce((a, n) => a + 4 + n.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const n of nals) { out.set([0, 0, 0, 1], o); out.set(n, o + 4); o += 4 + n.length; }
  return out;
}
