// A driver's photo, made small before it leaves the phone: the middle square of
// the picture, turned the right way up (EXIF), scaled to `size` px and saved as
// JPEG. A 4 MB phone photo becomes ~20 KB, which the dash shows at 30-64 px.

/** Where to crop: the centred square of a w×h picture. Pure. */
export function centreSquare(w: number, h: number): { sx: number; sy: number; side: number } {
  const side = Math.min(w, h);
  return { sx: Math.round((w - side) / 2), sy: Math.round((h - side) / 2), side };
}

export async function squareJpeg(file: Blob, size = 256, quality = 0.85): Promise<Blob> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('This browser can’t read that picture (an iPhone HEIC photo on a computer?). Try a JPG or PNG.'); }
  const { sx, sy, side } = centreSquare(bmp.width, bmp.height);
  const out = Math.min(size, side);
  const c = document.createElement('canvas');
  c.width = out; c.height = out;
  const g = c.getContext('2d');
  if (!g) throw new Error('No canvas to resize the picture');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, sx, sy, side, side, 0, 0, out, out);
  bmp.close();
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make a JPEG'))), 'image/jpeg', quality));
}
