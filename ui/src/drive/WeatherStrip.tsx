// One glanceable line next to the clock: place, icon, temperature, high/low, wind.
import { lazy, Suspense } from 'preact/compat';
import type { State } from '../lib/brain.ts';
import { useStore } from '../lib/brain.ts';
import { ago } from '../lib/data.ts';
import { WIcon } from './icons.tsx';
import { closeWeather, openWeather, weatherOpenStore } from './weatherStore.ts';

const WeatherView = lazy(() => import('./WeatherView.tsx'));

/** The header's few words when there's no weather; the full reason stays in the tooltip. Pure. */
export function shortWhy(why: string): string {
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|timed? ?out|aborted|offline|network/i.test(why)) return 'Weather offline';
  return why.length > 28 ? 'No weather yet' : why;
}

export function WeatherStrip({ s }: { s: State | null }) {
  const w = s?.drive?.weather ?? null;
  const why = s?.drive?.weatherWhy ?? 'No weather yet';
  const place = w?.place ?? null;
  return (
    <button type="button" class={`wxstrip ${w?.alerts.length ? 'alert' : ''}`} onClick={openWeather} title={w ? `${w.condition} · updated ${ago(w.fetchedAt)}${w.stale ? ' (old: offline?)' : ''}` : why}>
      {place && <span class="wxplace ellip">{place}</span>}
      {w ? (
        <>
          <WIcon icon={w.icon} day={w.isDay} size={26} />
          <b class="num">{w.tempF ?? '—'}°</b>
          <span class="num wxhl">H {w.highF ?? '—'}° L {w.lowF ?? '—'}°</span>
          {w.windMph !== null && <span class="num wxwind">{w.windDir ?? ''} {w.windMph} mph</span>}
          {w.stale && <span class="tag dim">{ago(w.fetchedAt)}</span>}
          {w.alerts.length > 0 && <span class="tag bad">{w.alerts[0].event}</span>}
        </>
      ) : <span class="dimtxt ellip">{shortWhy(why)}</span>}
    </button>
  );
}

/** The overlay host: loads the map code only when first opened. */
export function WeatherOverlay({ s }: { s: State | null }) {
  const open = useStore(weatherOpenStore);
  if (!open) return null;
  return <Suspense fallback={<div class="wxview"><div class="wxpanel">Loading the map…</div></div>}><WeatherView s={s} onClose={closeWeather} /></Suspense>;
}
