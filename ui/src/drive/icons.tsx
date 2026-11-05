// Weather icons: line art in the theme's colours (sun = warn, rain = accent, storm = bad).
import type { WeatherIcon } from '../../../brain/src/drive/types.ts';

const SUN = <g class="wi-sun"><circle cx="12" cy="12" r="4.2" />{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <path d="M12 3.2v2" transform={`rotate(${a} 12 12)`} />)}</g>;
const MOON = <path class="wi-sun" d="M15.5 4.5a7.5 7.5 0 1 0 4 11.6A6 6 0 0 1 15.5 4.5z" />;
const CLOUD = (y = 0) => <path class="wi-cloud" transform={`translate(0 ${y})`} d="M7.5 18.5h9.2a3.6 3.6 0 0 0 .4-7.2 5.2 5.2 0 0 0-10-1A4.2 4.2 0 0 0 7.5 18.5z" />;
const SMALL_SUN = (day: boolean) => <g transform="translate(-3.5 -3.5) scale(.75)">{day ? SUN : MOON}</g>;

export function WIcon({ icon, day = true, size = 28 }: { icon: WeatherIcon; day?: boolean; size?: number }) {
  let body;
  switch (icon) {
    case 'clear': case 'hot': body = day ? SUN : MOON; break;
    case 'few': case 'partly': body = <>{SMALL_SUN(day)}{CLOUD(1.5)}</>; break;
    case 'cloudy': body = CLOUD(-1); break;
    case 'rain': case 'showers': body = <>{CLOUD(-3)}<g class="wi-rain"><path d="M9 18.5l-1 3M13 18.5l-1 3M17 18.5l-1 3" /></g></>; break;
    case 'storm': body = <>{CLOUD(-3)}<path class="wi-bolt" d="M12.5 15.5l-2.5 4h3l-2 4" /></>; break;
    case 'snow': case 'sleet': case 'cold': body = <>{CLOUD(-3)}<g class="wi-rain"><path d="M9 19.5h.01M13 21h.01M17 19.5h.01M11 22.5h.01M15 23h.01" /></g></>; break;
    case 'fog': case 'haze': case 'smoke': body = <g class="wi-cloud"><path d="M4 9h16M3 13h18M5 17h14" /></g>; break;
    case 'dust': body = <g class="wi-dust"><path d="M3 9c4-2 7 2 11 0s5-1 7 0M3 13c4-2 7 2 11 0s5-1 7 0M3 17c4-2 7 2 11 0" /></g>; break;
    case 'wind': body = <g class="wi-cloud"><path d="M3 9h11a2.5 2.5 0 1 0-2.5-2.5M3 13h15a2.5 2.5 0 1 1-2.5 2.5M3 17h8" /></g>; break;
    default: body = <g class="wi-cloud"><path d="M9 9a3 3 0 1 1 4.5 2.6c-.9.5-1.5 1.2-1.5 2.4M12 18h.01" /></g>;
  }
  return <svg class="wicon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">{body}</svg>;
}
