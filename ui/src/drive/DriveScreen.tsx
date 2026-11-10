// The Drive screen (docs/drive-v2.md §1): three fixed zones on the 1920x720 bar.
// Left = speed, centre = the truck with its range and battery, right = 1-2 context cards.
// One number dominates each zone; zones are split by space and a hairline,
// never boxes in boxes. Every colour is a theme token.
import { useEffect, useState } from 'preact/hooks';
import { SPEEDO_STYLES, type SpeedoStyle } from '../../../brain/src/drive/types.ts';
import { api, putDriver, toast, useStore, type State } from '../lib/brain.ts';
import { SOURCE_LABEL, useAnyNowPlaying } from '../media/nowplaying.tsx';
import { pollMediaStatus } from '../media/status.ts';
import { V, whyGps, whySoc, whyTruck } from '../components/common.tsx';
import { socLabel, type WP } from '../components/drive.tsx';
import { fmtTime } from '../lib/fmt.ts';
import { driverDrive, speedoStyle, truckOf, truckPhotoUrl, useActiveDriver } from './hooks.ts';
import { overLimit, pickCards, showTruckPhoto } from './logic.ts';
import { WIcon } from './icons.tsx';
import { Speedo, SPEEDO_LABELS } from './Speedo.tsx';
import { TiltPair } from './Tilt.tsx';
import { TruckRear, TruckSide } from './TruckArt.tsx';
import { openWeather } from './weatherStore.ts';
import { GoalDriveCard } from '../components/goal.tsx';
import { useGoal } from '../lib/data.ts';
import './drive.css';

const MODE_LABEL = { city: 'City', highway: 'Highway' } as const;

function Gears({ s }: { s: State | null }) {
  const gear = s?.gear ?? null;
  const why = gear === null ? (s?.truckbox ? 'P, N and D need the CAN bus; only R is wired (reverse lamp)' : whyTruck(s, 'reverse')) : '';
  return (
    <div class="gearstrip" role="group" aria-label={gear ? `Gear ${gear}` : `Gear unknown: ${why}`} title={why || undefined}>
      {(['P', 'R', 'N', 'D'] as const).map((g) => <span class={gear === g ? 'on' : ''}>{g}</span>)}
    </div>
  );
}

function SpeedZone({ s }: { s: State | null }) {
  const { driver } = useActiveDriver();
  const [pick, setPick] = useState(false);
  const dd = driverDrive(driver);
  const style = speedoStyle(driver);
  const limit = s?.drive?.speedLimit?.mph ?? null;
  const mph = s?.speedMph ?? null;
  const over = overLimit(mph, limit, dd);
  const parked = !s?.drive?.lockout.locked;
  const choose = async (v: 'auto' | SpeedoStyle) => {
    setPick(false);
    if (!driver) return;
    try { await putDriver(driver.id, { drive: { ...dd, speedo: v } }); } catch (e) { toast(`Not saved: ${(e as Error).message}`); }
  };
  return (
    <section class={`dz dz-speed st-${style}`} aria-label="Speed">
      <button type="button" class="speedo-host" onClick={() => parked ? setPick(!pick) : undefined} aria-label="Speedometer style (when parked)">
        <Speedo style={style} mph={mph} limit={limit} over={over} why={whyGps(s)} />
      </button>
      <div class="speedfoot">
        <Gears s={s} />
        {s?.drive?.speedLimit && <span class="lbl dimmable" title={s.drive.speedLimit.raw ?? ''}>{s.drive.speedLimit.road ?? 'Road'} · OSM</span>}
      </div>
      {pick && (
        <div class="stylepick" role="dialog" aria-label="Speedometer style">
          {(['auto', ...SPEEDO_STYLES] as const).map((v) => (
            <button type="button" class={dd.speedo === v ? 'sel' : ''} onClick={() => void choose(v)}>{v === 'auto' ? 'Theme' : SPEEDO_LABELS[v]}</button>
          ))}
        </div>
      )}
    </section>
  );
}

async function setMode(m: 'auto' | 'city' | 'highway') {
  try { await api('/api/drive/range-mode', { method: 'POST', body: JSON.stringify({ mode: m }) }); } catch (e) { toast(`Not changed: ${(e as Error).message}`); }
}

/** The pack, seen through the body between the wheel flares, filled to the charge level (TruckSide coordinates). */
function Pack({ soc, tone, charging }: { soc: number | null; tone: string; charging: boolean }) {
  const x = 158, y = 120, w = 140, h = 30;
  const fill = soc === null ? 0 : Math.max(0, Math.min(100, soc)) / 100;
  return (
    <g class={`pack ${tone} ${charging ? 'charging' : ''}`}>
      <rect class="pack-case" x={x} y={y} width={w} height={h} rx="5" />
      <rect class="pack-fill" x={x + 3} y={y + 3} width={(w - 6) * fill} height={h - 6} rx="3" />
      {[1, 2, 3, 4, 5, 6].map((i) => <path class="pack-cell" d={`M${x + (w / 7) * i} ${y + 4} V${y + h - 4}`} />)}
      {charging && <rect class="pack-flow" x={x + 3} y={y + 3} width={(w - 6) * fill} height={h - 6} rx="3" />}
    </g>
  );
}

/** Amber past the driver's warning angle, red past the danger angle. */
const tiltTone = (v: number | null, lim: { warnDeg: number; dangerDeg: number } | undefined) =>
  v === null || !lim ? '' : Math.abs(v) >= lim.dangerDeg ? 'danger' : Math.abs(v) >= lim.warnDeg ? 'warn' : '';

/**
 * The centre: the truck itself, large, with its pack glowing to the charge
 * level (Taycan / EQS style). Range above, charge over it. The side view pitches
 * and a small rear view rolls, each over a level line with its angle, so there
 * is no separate tilt card unless it warns.
 */
function HeroZone({ s, go }: { s: State | null; go: WP['go'] }) {
  const { settings } = useActiveDriver();
  const truck = truckOf(settings);
  const d = s?.drive ?? null;
  const soc = s?.soc ?? null;
  const mode = d?.mode ?? 'city';
  const other = mode === 'city' ? 'highway' : 'city';
  const cur = d ? d.range.current : s?.rangeMi ?? null;
  const tone = soc === null ? '' : soc < 15 ? 'bad' : soc < 30 ? 'warn' : 'ok';
  const cp = s?.chargePeak ?? null;
  const charging = cp?.charging === true;
  const tilt = s?.tilt ?? null;
  const p = tilt ? Math.max(-30, Math.min(30, tilt.pitch)) : 0;
  const r = tilt ? Math.max(-30, Math.min(30, tilt.roll)) : 0;
  const bed = Object.values(s?.relays ?? {}).find((r) => /bed light/i.test(r.name))?.on === true;
  const deg = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°`;
  const w = d?.weather;
  return (
    <section class="dz dz-hero" aria-label="Range and battery">
      <div class="herotop">
        <div>
          <div class="lbl">Range · {MODE_LABEL[mode]}{d?.override === 'auto' && d.avgMph2min !== null ? <span class="dimmable"> · {Math.round(d.avgMph2min)} mph avg</span> : null}</div>
          <div class="hero num"><V v={cur === null ? null : String(cur)} why={soc === null ? whySoc(s) : 'Not known'} /><small>mi</small></div>
        </div>
        <div class="heroside">
          <div class="seg quiet" role="group" aria-label="Range mode">
            {(['auto', 'city', 'highway'] as const).map((m) => <button type="button" aria-pressed={(d?.override ?? 'auto') === m} onClick={() => void setMode(m)}>{m === 'auto' ? 'Auto' : m === 'city' ? 'City' : 'Hwy'}</button>)}
          </div>
          <div class="otherrange dimmable num">{MODE_LABEL[other]} <b>{d?.range[other] ?? '—'}</b> mi</div>
        </div>
      </div>
      <button type="button" class="herotruck" onClick={() => go('charge')} title={soc === null ? whySoc(s) : 'Charging and the charge level'}>
        <span class={`herostage ${tilt ? '' : 'unknown'}`}>
          <span class="heroview side">
            <i class="herolevel" aria-hidden="true" />
            <span class="herotilt" style={{ transform: `rotate(${-p}deg)` }}>
              <TruckSide t={truck} id="hero-side" bedLightsOn={bed}><Pack soc={soc} tone={tone} charging={charging} /></TruckSide>
            </span>
            <span class={`tiltread ${tiltTone(tilt?.pitch ?? null, d?.tilt)}`} title={tilt ? 'Nose up is +' : whyTruck(s, 'tilt')}><span class="lbl">Pitch</span><b class="num">{tilt ? deg(tilt.pitch) : '—'}</b></span>
          </span>
          <span class="heroview rear">
            <i class="herolevel" aria-hidden="true" />
            <span class="herotilt" style={{ transform: `rotate(${r}deg)` }}><TruckRear t={truck} id="hero-rear" /></span>
            <span class={`tiltread ${tiltTone(tilt?.roll ?? null, d?.tilt)}`} title={tilt ? 'Right side down is +' : whyTruck(s, 'tilt')}><span class="lbl">Roll</span><b class="num">{tilt ? deg(tilt.roll) : '—'}</b></span>
          </span>
        </span>
        <span class={`socchip ${tone}`}>
          {charging && <span class="bolt" aria-hidden="true">⚡</span>}
          <b class="num"><V v={soc === null ? null : `${Math.round(soc)}%`} why={whySoc(s)} /></b>
          {charging && cp?.powerKw != null && <span class="num">{cp.powerKw.toFixed(1)} kW</span>}
          <span class={`tag ${s?.socSource === 'estimate' ? 'warn' : s?.socSource ? 'ok' : 'dim'}`}>{socLabel(s?.socSource ?? null)}</span>
        </span>
      </button>
      <div class="herofoot dimmable">
        <button type="button" onClick={openWeather}>
          {w ? <><WIcon icon={w.icon} day={w.isDay} size={22} /><span>Outside <b class="num">{w.tempF ?? '—'}°</b></span></> : <span>Outside <V v={null} why={d?.weatherWhy ?? 'No weather yet'} /></span>}
        </button>
        <span>Cabin <b class="num"><V v={s?.cabinTempF?.toFixed(0)} why={whyTruck(s, 'cabin temperature')} />°</b></span>
      </div>
    </section>
  );
}

// ---- context cards ----------------------------------------------------------------

/** Whatever is playing, from any source (the same pick as the Media view): CarPlay, radio, FM, Plex, Spotify, files. */
function NowPlayingCard({ s, go }: { s: State | null; go: WP['go'] }) {
  const np = useAnyNowPlaying(s);
  if (!np) return null;
  const radio = np.source === 'radio' || np.source === 'fm';
  return (
    <button type="button" class="ccard np-card" onClick={() => go(np.source === 'carplay' ? 'carplay' : 'media')}>
      {np.art ? <img src={np.art} alt="" /> : <span class="noart" aria-hidden="true">{radio ? '📻' : '♪'}</span>}
      <span class="grow ccol"><span class="lbl">Now playing · {SOURCE_LABEL[np.source] ?? 'Media'}</span><b class="ellip">{np.title ?? '—'}</b><span class="ellip dimtxt">{np.artist ?? ''}</span></span>
    </button>
  );
}

function SinceChargeCard({ s, go }: { s: State | null; go: WP['go'] }) {
  const sc = s?.drive?.sinceCharge ?? null;
  return (
    <button type="button" class="ccard" onClick={() => go('charge')}>
      <span class="grow ccol">
        <span class="lbl">Since charge{sc ? ` · ${fmtTime(sc.since)}` : ''}</span>
        {sc ? (
          <>
            <span class="cbig num">{sc.miles.toFixed(1)}<small>mi</small></span>
            <span class="cfacts num dimmable">
              <span>{sc.kwh === null ? '—' : `${sc.kwhSource === 'miles' ? '~' : ''}${sc.kwh.toFixed(1)}`} kWh</span>
              <span>{sc.miPerKwh?.toFixed(1) ?? '—'} mi/kWh</span>
              <span>{sc.pctUsed === null ? '—' : `${sc.kwhSource === 'miles' ? '~' : ''}${sc.pctUsed.toFixed(0)}%`} used</span>
              <span>{sc.costPerMile === null ? '—' : `$${sc.costPerMile.toFixed(3)}`}/mi</span>
            </span>
          </>
        ) : <span class="dimtxt">{s?.drive?.sinceChargeWhy ?? 'Not known yet'}</span>}
      </span>
    </button>
  );
}

function TripCard({ s, go }: { s: State | null; go: WP['go'] }) {
  if (!s?.trip) return null;
  return (
    <button type="button" class="ccard" onClick={() => go('trips')}>
      <span class="grow ccol">
        <span class="lbl">This trip · since {fmtTime(s.trip.startedAt)}</span>
        <span class="cbig num">{s.trip.miles.toFixed(1)}<small>mi</small></span>
      </span>
    </button>
  );
}

function TiltCard({ s }: { s: State | null }) {
  const { settings } = useActiveDriver();
  const truck = truckOf(settings);
  const photo = truckPhotoUrl(truck);
  const [broken, setBroken] = useState<string | null>(null);
  const lvl = s?.drive?.tilt.level ?? null;
  const bed = Object.values(s?.relays ?? {}).find((r) => /bed light/i.test(r.name))?.on === true;
  const tilt = s?.tilt ?? null;
  const deg = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°`;
  if (photo && broken !== photo && showTruckPhoto(s, true)) {
    return (
      <div class="ccard tiltcard photocard">
        <span class="photoframe"><img src={photo} alt="Your truck" onError={() => setBroken(photo)} /></span>
        <span class="photonums num dimmable"><span class="lbl">Tilt</span> Pitch <b>{tilt ? deg(tilt.pitch) : '—'}</b> · Roll <b>{tilt ? deg(tilt.roll) : '—'}</b></span>
      </div>
    );
  }
  return (
    <div class={`ccard tiltcard ${lvl === 'danger' ? 'danger' : lvl === 'warn' ? 'warn' : ''}`}>
      <span class="lbl">Tilt{lvl === 'danger' ? ' · TOO STEEP' : lvl === 'warn' ? ' · STEEP' : ''}</span>
      <TiltPair tilt={tilt} truck={truck} limits={s?.drive?.tilt} bedLightsOn={bed} compact />
    </div>
  );
}

function Cards({ s, go }: { s: State | null; go: WP['go'] }) {
  const np = useAnyNowPlaying(s);
  useEffect(() => pollMediaStatus(false), []); // Spotify's art and words
  const { g } = useGoal();
  const cards = pickCards(s, !!np, !!g?.startDate);
  return (
    <section class={`dz dz-cards n${cards.length}`} aria-label="Context">
      {cards.map((c) => c === 'np' ? <NowPlayingCard s={s} go={go} /> : c === 'since' ? <SinceChargeCard s={s} go={go} /> : c === 'trip' ? <TripCard s={s} go={go} /> : c === 'goal' ? <GoalDriveCard go={go} /> : <TiltCard s={s} />)}
    </section>
  );
}

function Banners({ s }: { s: State | null }) {
  const a = s?.drive?.weather?.alerts ?? [];
  const heat = s?.drive?.heat;
  if (!a.length && !heat?.message) return null;
  return (
    <div class="dbanners">
      {heat?.message && <div class={`dbanner ${heat.level === 'ok' || heat.level === 'throttle' ? 'warn' : 'bad'}`} role="alert">{heat.message}</div>}
      {a.slice(0, 2).map((x) => (
        <button type="button" class={`dbanner ${x.severity === 'Extreme' || x.severity === 'Severe' ? 'bad' : 'warn'}`} onClick={openWeather}>
          <b>{x.event}</b>{x.expires && <span> · until {fmtTime(x.expires)}</span>}
        </button>
      ))}
    </div>
  );
}

export function DriveScreen({ s, go }: WP) {
  const night = !!s?.drive?.brightness.night;
  return (
    <div class={`drive ${night ? 'is-night' : ''}`}>
      <Banners s={s} />
      <div class="zones">
        <SpeedZone s={s} />
        <HeroZone s={s} go={go} />
        <Cards s={s} go={go} />
      </div>
    </div>
  );
}
