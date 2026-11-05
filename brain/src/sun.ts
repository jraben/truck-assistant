// Sunrise and sunset from a position and date. NOAA's simplified solar
// equations; good to a few minutes, no network. Shared with the UI's auto theme.

const rad = Math.PI / 180;

/**
 * Sunrise and sunset for the local calendar day of `date` at lat/lon (east positive).
 * Returns absolute instants. null during polar day or polar night.
 */
export function sunTimes(date: Date, lat: number, lon: number): { rise: Date; set: Date } | null {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate();
  const doy = Math.round((Date.UTC(y, m, d) - Date.UTC(y, 0, 0)) / 86_400_000);
  const g = ((2 * Math.PI) / 365) * (doy - 1);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
  if (cosH > 1 || cosH < -1) return null;
  const ha = Math.acos(cosH) / rad;
  const mid = Date.UTC(y, m, d);
  return {
    rise: new Date(mid + (720 - 4 * (lon + ha) - eqt) * 60_000),
    set: new Date(mid + (720 - 4 * (lon - ha) - eqt) * 60_000),
  };
}

/** Is it daytime at this position? Without a position: 07:00-19:00 local. */
export function isDaytime(now: Date, pos: { lat: number; lon: number } | null): boolean {
  if (pos) {
    const t = sunTimes(now, pos.lat, pos.lon);
    if (t) return now >= t.rise && now < t.set;
    // Polar: summer is all day, winter all night (northern hemisphere sense).
    const summer = now.getMonth() >= 3 && now.getMonth() <= 8;
    return pos.lat >= 0 ? summer : !summer;
  }
  const h = now.getHours();
  return h >= 7 && h < 19;
}
