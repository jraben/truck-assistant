// The Drive screen (docs/drive-v2.md §1): three fixed zones on the 1920x720 bar.
// Left = speed, centre = range and battery, right = 2-3 context cards.
// One number dominates each zone; zones are split by space and a hairline,
// never boxes in boxes. Every colour is a theme token.
import { useState } from 'preact/hooks';
import { SPEEDO_STYLES, type SpeedoStyle } from '../../../brain/src/drive/types.ts';
import { api, putDriver, toast, useStore, type State } from '../lib/brain.ts';
import { nowPlayingStore } from '../carplay/controller.ts';
import { V, whyGps, whySoc, whyTruck } from '../components/common.tsx';
import { socLabel, type WP } from '../components/drive.tsx';
import { fmtTime } from '../lib/fmt.ts';
import { driverDrive, speedoStyle, truckOf, useActiveDriver } from './hooks.ts';
import { overLimit, pickCards } from './logic.ts';
import { WIcon } from './icons.tsx';
import { Speedo, SPEEDO_LABELS } from './Speedo.tsx';
import { TiltPair } from './Tilt.tsx';
import { openWeather } from './weatherStore.ts';
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

function EnergyZone({ s, go }: { s: State | null; go: WP['go'] }) {
  const d = s?.drive ?? null;
  const soc = s?.soc ?? null;
  const mode = d?.mode ?? 'city';
  const other = mode === 'city' ? 'highway' : 'city';
  const cur = d ? d.range.current : s?.rangeMi ?? null;
  const tone = soc === null ? '' : soc < 15 ? 'bad' : soc < 30 ? 'warn' : 'ok';
  const w = d?.weather;
  return (
    <section class="dz dz-energy" aria-label="Range and battery">
      <div class="lbl">Range · {MODE_LABEL[mode]}{d?.override === 'auto' && d.avgMph2min !== null ? <span class="dimmable"> · {Math.round(d.avgMph2min)} mph avg</span> : null}</div>
      <div class="hero num"><V v={cur === null ? null : String(cur)} why={soc === null ? whySoc(s) : 'Not known'} /><small>mi</small></div>
      <div class="otherrange dimmable num">{MODE_LABEL[other]} <b>{d?.range[other] ?? '—'}</b> mi</div>
      <div class="seg" role="group" aria-label="Range mode">
        {(['auto', 'city', 'highway'] as const).map((m) => <button type="button" aria-pressed={(d?.override ?? 'auto') === m} onClick={() => void setMode(m)}>{m === 'auto' ? 'Auto' : m === 'city' ? 'City' : 'Hwy'}</button>)}
      </div>
      <button type="button" class="socline" onClick={() => go('charge')} title={soc === null ? whySoc(s) : 'Tap to set the charge level'}>
        <span class={`socbar ${tone}`}><i style={{ width: `${soc ?? 0}%` }} /></span>
        <span class="num socpct"><V v={soc === null ? null : `${Math.round(soc)}%`} why={whySoc(s)} /></span>
        <span class={`tag ${s?.socSource === 'estimate' ? 'warn' : s?.socSource ? 'ok' : 'dim'}`}>{socLabel(s?.socSource ?? null)}</span>
      </button>
      <button type="button" class="templine dimmable" onClick={openWeather}>
        {w ? <><WIcon icon={w.icon} day={w.isDay} size={26} /><span>Outside <b class="num">{w.tempF ?? '—'}°</b></span></> : <span>Outside <V v={null} why={d?.weatherWhy ?? 'No weather yet'} /></span>}
        <span>Cabin <b class="num"><V v={s?.cabinTempF?.toFixed(0)} why={whyTruck(s, 'cabin temperature')} />°</b></span>
      </button>
    </section>
  );
}

// ---- context cards ----------------------------------------------------------------

function NowPlayingCard({ go }: { go: WP['go'] }) {
  const np = useStore(nowPlayingStore);
  if (!np) return null;
  return (
    <button type="button" class="ccard np-card" onClick={() => go('carplay')}>
      {np.art ? <img src={np.art} alt="" /> : <span class="noart" aria-hidden="true">♪</span>}
      <span class="grow ccol"><span class="lbl">Now playing</span><b class="ellip">{np.title ?? '—'}</b><span class="ellip dimtxt">{np.artist ?? ''}</span></span>
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
  const lvl = s?.drive?.tilt.level ?? null;
  const bed = Object.values(s?.relays ?? {}).find((r) => /bed light/i.test(r.name))?.on === true;
  return (
    <div class={`ccard tiltcard ${lvl === 'danger' ? 'danger' : lvl === 'warn' ? 'warn' : ''}`}>
      <span class="lbl">Tilt{lvl === 'danger' ? ' · TOO STEEP' : lvl === 'warn' ? ' · STEEP' : ''}</span>
      <TiltPair tilt={s?.tilt ?? null} truck={truckOf(settings)} limits={s?.drive?.tilt} bedLightsOn={bed} compact />
    </div>
  );
}

function Cards({ s, go }: { s: State | null; go: WP['go'] }) {
  const np = useStore(nowPlayingStore);
  const cards = pickCards(s, !!np);
  return (
    <section class={`dz dz-cards n${cards.length}`} aria-label="Context">
      {cards.map((c) => c === 'np' ? <NowPlayingCard go={go} /> : c === 'since' ? <SinceChargeCard s={s} go={go} /> : c === 'trip' ? <TripCard s={s} go={go} /> : <TiltCard s={s} />)}
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
        <EnergyZone s={s} go={go} />
        <Cards s={s} go={go} />
      </div>
    </div>
  );
}
