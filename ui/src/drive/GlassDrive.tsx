// The Glass Drive layout (ideas from GlassDash, an iPad car display): the truck and
// its speed on the left third, the live map on the right two thirds, a dock along the
// bottom with what's playing and the apps. Parked, the truck is shown side-on with
// its pack; moving, from behind on a road whose lane marks run with the speed, the
// speed-limit sign beside it. One huge number (the speed) with a thin bar under it
// against the limit, instead of a dial. Calm at speed: the dock's apps that lock
// while moving are dimmed, the map never asks for anything.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import type { State } from '../../../brain/src/types.ts';
import { V, whyGps, whySoc } from '../components/common.tsx';
import { useStore } from '../lib/brain.ts';
import { playerStore } from '../media/player.ts';
import { PlayerControls } from '../media/MediaView.tsx';
import type { WP } from '../components/drive.tsx';
import { SOURCE_LABEL, useAnyNowPlaying } from '../media/nowplaying.tsx';
import { MapPane } from '../map/MapView.tsx';
import { driverDrive, truckOf, useActiveDriver } from './hooks.ts';
import { estimateDriveKw, overLimit } from './logic.ts';
import { TruckRear, TruckSide } from './TruckArt.tsx';
import { laneSeconds, speedBar } from './glassLogic.ts';
import { compassPoint } from '../gauges/logic.ts';

/** The truck from behind on a road: lanes that run with the speed, a blue path ahead, the
 *  limit on a red-ring roundel beside it, brake lamps lit while slowing. */
function ChaseView({ s, limit }: { s: State | null; limit: number | null }) {
  const { settings } = useActiveDriver();
  const t = truckOf(settings);
  const mph = s?.speedMph ?? null;
  const sec = laneSeconds(mph);
  const prev = useRef<number | null>(null);
  const braking = mph !== null && prev.current !== null && mph < prev.current - 0.8;
  useEffect(() => { prev.current = mph; }, [mph]);
  return (
    <div class="g-chase" aria-hidden="true">
      <svg viewBox="0 0 300 220" class="g-road" preserveAspectRatio="xMidYMax meet">
        <defs>
          <linearGradient id="g-asphalt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="asph-far" /><stop offset="1" class="asph-near" /></linearGradient>
          <linearGradient id="g-carpet" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f6bff" stop-opacity="0" /><stop offset="1" stop-color="#2f6bff" stop-opacity=".45" /></linearGradient>
        </defs>
        <path d="M118 40 L182 40 L300 220 L0 220 Z" fill="url(#g-asphalt)" class="road" />
        <path d="M140 40 L160 40 L208 220 L92 220 Z" fill="url(#g-carpet)" />
        <path d="M121 40 L52 220 M179 40 L248 220" class="edge" />
        <path d="M150 40 L150 220" class={`lane ${sec ? 'run' : ''}`} style={sec ? { animationDuration: `${sec}s` } : undefined} />
        {limit !== null && (
          <g class="roundel" transform="translate(262 70)">
            <line x1="0" y1="16" x2="0" y2="62" />
            <circle r="17" class="r-ring" /><circle r="12.5" class="r-face" />
            <text y="5" text-anchor="middle">{limit}</text>
          </g>
        )}
      </svg>
      <div class="g-chase-truck"><TruckRear t={t} id="glass-rear" braking={braking} /></div>
    </div>
  );
}

const Icon = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>;
const DOCK: { view: string; label: string; d: string; lockedWhileMoving?: boolean }[] = [
  { view: 'media', label: 'Media', d: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z' },
  { view: 'carplay', label: 'CarPlay', d: 'M4 5h16v12H4zM8 21h8M12 17v4M9 11h6M12 8v6' },
  { view: 'charge', label: 'Charge', d: 'M13 2 4 14h7l-1 8 9-12h-7z' },
  { view: 'cams', label: 'Cams', d: 'M3 7h12v10H3zM15 10l6-3v10l-6-3' },
  { view: 'roadtrip', label: 'Trip', d: 'M4 19c4-1 4-6 8-7s4-6 8-7M4 19h.01M20 5h.01' },
  { view: 'parked', label: 'Parked', d: 'M4 4h16v12H4zM9 20h6M12 16v4', lockedWhileMoving: true },
];

function Dock({ s, go }: { s: State | null; go: WP['go'] }) {
  const np = useAnyNowPlaying(s);
  const moving = !!s?.drive?.lockout.locked && !s.drive.lockout.passenger;
  return (
    <nav class="g-dock" aria-label="Apps">
      <button type="button" class="g-np" onClick={() => go(np?.source === 'carplay' ? 'carplay' : 'media')} aria-label={np ? `Now playing: ${[np.title, np.artist].filter(Boolean).join(' by ')}` : 'Media'}>
        <span class="g-np-art">{np?.art ? <img src={np.art} alt="" /> : <span aria-hidden="true">♪</span>}</span>
        <span class="g-np-txt"><b class="ellip">{np?.title ?? np?.artist ?? 'Nothing playing'}</b><span class="ellip dimtxt">{np ? [np.artist, SOURCE_LABEL[np.source] ?? np.app].filter(Boolean).join(' · ') : 'Tap for music'}</span></span>
      </button>
      <span class="g-dock-apps">
        {DOCK.map((a) => (
          <button type="button" class={`g-app ${moving && a.lockedWhileMoving ? 'locked' : ''}`} onClick={() => go(a.view)} aria-label={a.label} title={moving && a.lockedWhileMoving ? 'Parked only' : a.label}>
            <Icon d={a.d} /><span>{a.label}</span>
          </button>
        ))}
      </span>
    </nav>
  );
}

function BatteryIcon({ pct }: { pct: number | null }) {
  const w = pct === null ? 0 : Math.max(0, Math.min(100, pct)) / 100 * 18;
  return (
    <svg viewBox="0 0 26 12" width="26" height="12" aria-hidden="true" class={`g-batt ${pct !== null && pct < 20 ? 'low' : ''}`}>
      <rect x="0.75" y="0.75" width="21.5" height="10.5" rx="2.5" class="b-case" /><rect x="23" y="4" width="2" height="4" rx="1" class="b-tip" />
      <rect x="2.5" y="2.5" width={w} height="7" rx="1.2" class="b-fill" />
    </svg>
  );
}

function Stat({ label, icon, children }: { label: string; icon: string; children: ComponentChildren }) {
  return (
    <div class="g-stat">
      <span class="g-stat-lbl"><svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d={icon} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>{label}</span>
      <b class="num">{children}</b>
    </div>
  );
}

function NowPlayingCard({ s, go }: { s: State | null; go: WP['go'] }) {
  const np = useAnyNowPlaying(s);
  const p = useStore(playerStore);
  const ours = !!p.current && np?.source === p.current.source;
  return (
    <div class="g-npcard">
      <button type="button" class="g-np" onClick={() => go(np?.source === 'carplay' ? 'carplay' : 'media')} aria-label={np ? `Now playing: ${[np.title, np.artist].filter(Boolean).join(' by ')}` : 'Media'}>
        <span class="g-np-art">{np?.art ? <img src={np.art} alt="" /> : <span aria-hidden="true">♪</span>}</span>
        <span class="g-np-txt"><b class="ellip">{np?.title ?? np?.artist ?? 'Nothing playing'}</b><span class="ellip dimtxt">{np ? [np.artist, SOURCE_LABEL[np.source] ?? np.app].filter(Boolean).join(' · ') : 'Tap for music'}</span></span>
      </button>
      {(ours || (p.current && !np)) && <div class="g-np-ctl"><PlayerControls /></div>}
    </div>
  );
}

export function GlassDrive({ s, go, toggle }: WP & { toggle: ComponentChildren }) {
  const { driver, settings } = useActiveDriver();
  const dd = driverDrive(driver);
  const t = truckOf(settings);
  const mph = s?.speedMph ?? null;
  const limit = s?.drive?.speedLimit?.mph ?? null;
  const over = overLimit(mph, limit, dd);
  const bar = speedBar(mph, limit, over);
  const moving = (mph ?? 0) >= 3 || !!s?.drive?.lockout.locked;
  const soc = s?.soc ?? null;
  const range = s?.drive?.range.current ?? s?.rangeMi ?? null;
  const gear = s?.gear ?? null;
  const kw = mph === null ? null : Math.round(estimateDriveKw(mph, 0));
  return (
    <div class={`glass ${moving ? 'moving' : 'parked'}`}>
      <section class="g-car" aria-label="Speed and truck">
        <div class="g-top">
          <span class="g-gears" aria-label={gear ? `Gear ${gear}` : 'Gear unknown'}>
            {(['P', 'R', 'N', 'D'] as const).map((g) => <span class={gear === g ? 'on' : ''}>{g}</span>)}
            {s?.ignition === true && <span class="ready">READY</span>}
          </span>
          <span class="g-topr">
          {s?.gps?.headingDeg != null && <span class="g-head" aria-label={`Heading ${compassPoint(s.gps.headingDeg)}`}><svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" style={{ transform: `rotate(${s.gps.headingDeg}deg)` }}><path d="M6 1 10 11 6 8.5 2 11z" /></svg>{compassPoint(s.gps.headingDeg)}</span>}
          <button type="button" class="g-soc" onClick={() => go('charge')} aria-label={`Charge ${soc === null ? 'unknown' : `${Math.round(soc)}%`}`}>
            <span class="num"><V v={soc === null ? null : `${Math.round(soc)}%`} why={whySoc(s)} /></span><BatteryIcon pct={soc} />
          </button>
          </span>
        </div>
        <div class="g-speed">
          <b class={`num ${over ? 'over' : ''}`}><V v={mph === null ? null : String(Math.round(mph))} why={whyGps(s)} /></b>
          <span class="g-unit">MPH</span>
        </div>
        <div class={`g-bar ${bar.tone}`} role="img" aria-label={limit ? `Speed against the ${limit} mph limit` : 'Speed'}><i style={{ width: `${Math.round(bar.fill * 100)}%` }} />{limit !== null && <em style={{ left: `${100 / 1.25}%` }} />}</div>
        <div class="g-barlbl"><span class="num">{kw !== null && kw > 0 ? `${kw} KW` : '0 KW'}</span><span>{limit !== null ? `LIMIT ${limit}` : moving ? '' : 'IDLE'}</span></div>
        <div class="g-truck">
          {moving ? <ChaseView s={s} limit={limit} /> : <div class="g-side"><TruckSide t={t} id="glass-side" /></div>}
        </div>
        <div class="g-caption">MY TRUCK</div>
        <div class="g-stats">
          <Stat label="TRIP" icon="M4 19 9 5M20 19 15 5M12 7v2M12 12v2M12 17v2">{s?.trip ? <>{s.trip.miles.toFixed(1)}<small> mi</small></> : <V v={null} why="No trip yet: it starts when you drive" />}</Stat>
          <Stat label="GEAR" icon="M6 4v16M18 4v16M6 12h12">{gear ?? <V v={null} why="Only reverse is wired" />}</Stat>
          <Stat label="RANGE" icon="M13 2 4 14h7l-1 8 9-12h-7z">{range === null ? <V v={null} why={whySoc(s)} /> : <>{Math.round(range)}<small> mi</small></>}</Stat>
        </div>
        <NowPlayingCard s={s} go={go} />
        {!moving && <div class="g-toggle">{toggle}</div>}
      </section>
      <section class="g-map" aria-label="Map"><MapPane s={s} go={go} props={{ type: 'map', glass: true }} /></section>
      <Dock s={s} go={go} />
    </div>
  );
}
