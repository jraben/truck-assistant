// Panel sizing, letterboxing and touch mapping. Pure, so vitest covers them.

export type Rect = { x: number; y: number; w: number; h: number };
export type Size = { w: number; h: number };

/** Largest rect of the video's aspect inside the box, centred (letterbox / pillarbox). */
export function fitRect(box: Size, video: Size): Rect {
  if (box.w <= 0 || box.h <= 0 || video.w <= 0 || video.h <= 0) return { x: 0, y: 0, w: Math.max(0, box.w), h: Math.max(0, box.h) };
  const s = Math.min(box.w / video.w, box.h / video.h);
  const w = video.w * s, h = video.h * s;
  return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
}

/**
 * A pointer at (px, py), relative to the element's top-left in CSS px, to the
 * dongle's touch space: 0..1 across the video picture (SendTouch scales by
 * 10000). Null when the pointer is on the letterbox bars.
 */
export function mapTouch(px: number, py: number, element: Size, video: Size): { x: number; y: number } | null {
  const r = fitRect(element, video);
  if (r.w <= 0 || r.h <= 0) return null;
  const x = (px - r.x) / r.w, y = (py - r.y) / r.h;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
}

/** Clamp a touch that slid onto the bars mid-drag back to the picture edge. */
export function mapTouchClamped(px: number, py: number, element: Size, video: Size): { x: number; y: number } {
  const r = fitRect(element, video);
  const c = (v: number) => Math.min(1, Math.max(0, v));
  return { x: Math.round(c((px - r.x) / (r.w || 1)) * 10000) / 10000, y: Math.round(c((py - r.y) / (r.h || 1)) * 10000) / 10000 };
}

const even = (v: number) => Math.max(2, Math.floor(v / 2) * 2);

/**
 * The size CarPlay is asked to render at: the panel's device pixels, rounded
 * down to even numbers (H.264 4:2:0 needs them), capped at what the dongle's
 * encoder handles (the CPC200-CCPA is happy to 1920 wide).
 */
export function dongleSize(cssW: number, cssH: number, dpr = 1, maxW = 1920, maxH = 1080): Size {
  let w = cssW * dpr, h = cssH * dpr;
  const s = Math.min(1, maxW / w, maxH / h);
  w *= s; h *= s;
  return { w: even(w), h: even(h) };
}

/** Pixel density of the 12.3" 1920x720 bar: sqrt(1920² + 720²) / 12.3 ≈ 167 ppi. */
export function panelPpi(pxW = 1920, pxH = 720, diagonalIn = 12.3): number {
  return Math.hypot(pxW, pxH) / diagonalIn;
}

/**
 * The dpi sent to the dongle. CarPlay picks its icon and text scale from it;
 * ~160 suits the bar from arm's length. Rounded to a multiple of 10 and kept
 * in the range firmware is known to accept.
 */
export function dongleDpi(ppi = panelPpi()): number {
  return Math.min(240, Math.max(120, Math.round(ppi / 10) * 10 - 10));
}
