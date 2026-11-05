// The CarPlay panel and the now-playing widgets. The panel's canvas belongs to
// the CarPlay controller (ui/src/carplay), which keeps running across views.
import { useEffect, useRef, useState } from 'preact/hooks';
import { stateStore, useStore } from '../lib/brain.ts';
import { NowPlayingMiniAny } from '../media/nowplaying.tsx';
import { carplay, carplayStore, nowPlayingStore, type CarPlayState } from '../carplay/controller.ts';
import { fmtClock, livePosition, type NowPlaying } from '../carplay/media.ts';
import { Card } from './common.tsx';
import type { WP } from './drive.tsx';

function useHealthSim() {
  const [sim, setSim] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch('/api/health').then((r) => r.json()).then((h) => { if (alive) setSim(h?.gps === 'sim'); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return sim;
}

function useNow(ms = 1000) {
  const [, f] = useState(0);
  useEffect(() => { const id = setInterval(() => f((n) => n + 1), ms); return () => clearInterval(id); }, [ms]);
  return Date.now();
}

const simHref = () => { const u = new URL(location.href); u.searchParams.set('carplaySim', '1'); u.hash = 'carplay'; return u.toString(); };

function Overlay({ cp }: { cp: CarPlayState }) {
  const brainSim = useHealthSim();
  const now = useNow();
  const simButton = brainSim && !cp.sim ? <a class="btn" href={simHref()}>Run the simulator</a> : null;
  if (!cp.webCodecs) {
    return <div class="cpover"><h2>No video decoder</h2><p>This browser has no WebCodecs (VideoDecoder), so CarPlay's picture can't be shown. Chromium 94 or newer has it; the Pi kiosk does.</p></div>;
  }
  switch (cp.status) {
    case 'no-webusb':
      return (
        <div class="cpover">
          <h2>CarPlay needs WebUSB</h2>
          <p>This browser can't reach the dongle. The Pi's Chromium kiosk can; on a desk, open the cockpit in Chrome or Edge on <code>localhost</code>, or use the simulator (<code>?carplaySim=1</code>).</p>
          <div class="row wrap">{simButton}</div>
        </div>
      );
    case 'no-dongle':
      return (
        <div class="cpover">
          <h2>Plug in the CarPlay dongle</h2>
          <p>{cp.reason === 'the dongle was unplugged' ? 'The dongle was unplugged. ' : ''}No Carlinkit dongle is connected or allowed yet. On the Pi it is found by itself (Chromium policy); here, connect it once.</p>
          <div class="row wrap"><button class="btn primary" type="button" onClick={() => void carplay.connectDongle()}>Connect dongle</button>{simButton}</div>
        </div>
      );
    case 'connecting':
      return <div class="cpover"><h2>Opening the dongle…</h2></div>;
    case 'waiting-phone':
      return (
        <div class="cpover">
          <h2>Waiting for the iPhone</h2>
          <p>The dongle is ready. Turn on the phone's Bluetooth and Wi-Fi; the first time, pair it with the dongle in the phone's Bluetooth settings and allow CarPlay.</p>
        </div>
      );
    case 'failed': {
      const wait = cp.retryAt ? Math.max(0, Math.ceil((cp.retryAt - now) / 1000)) : null;
      return (
        <div class="cpover">
          <h2>CarPlay stopped</h2>
          <p>{cp.reason ?? 'Unknown error'}{wait !== null ? ` Trying again in ${wait} s.` : ''}</p>
          <div class="row wrap"><button class="btn primary" type="button" onClick={() => carplay.retry()}>Retry now</button>{simButton}</div>
        </div>
      );
    }
    case 'connected':
      if (!cp.video?.width) return <div class="cpover"><h2>Connected</h2><p>Waiting for the first picture from the phone…</p></div>;
      return null;
    default:
      return null;
  }
}

export function CarPlay(_: WP) {
  const ref = useRef<HTMLDivElement>(null);
  const cp = useStore(carplayStore);
  useEffect(() => {
    const el = ref.current!;
    carplay.attach(el);
    return () => carplay.detach(el);
  }, []);
  return (
    <div class="cphost" data-status={cp.status}>
      <div class="cpvideo" ref={ref} />
      <Overlay cp={cp} />
      <div class="cpchips">
        {cp.sim && <span class="tag warn" title="Playing ui/public/carplay-sim/test.h264; touches show as dots">SIMULATOR</span>}
        {cp.mic && <span class="tag accent">MIC</span>}
        {cp.micError && <span class="tag bad" title={cp.micError}>MIC ✕</span>}
        {cp.soundBlocked && <button class="tag accent" type="button" onClick={() => carplay.unlockSound()}>TAP FOR SOUND</button>}
      </div>
    </div>
  );
}

function Progress({ np }: { np: NowPlaying }) {
  const now = useNow();
  const pos = livePosition(np, now);
  if (!np.durationMs || pos === null) return null;
  return (
    <div class="npbar" role="progressbar" aria-valuemin={0} aria-valuemax={np.durationMs} aria-valuenow={pos}>
      <i style={{ width: `${Math.min(100, (pos / np.durationMs) * 100)}%` }} />
      <span class="num">{fmtClock(pos)} / {fmtClock(np.durationMs)}</span>
    </div>
  );
}

function why(cp: CarPlayState) {
  if (cp.status === 'connected') return 'Nothing playing on the phone';
  if (cp.status === 'waiting-phone') return 'CarPlay: waiting for the phone';
  if (cp.status === 'no-webusb') return 'CarPlay not available in this browser';
  if (cp.status === 'failed') return 'CarPlay stopped';
  return 'CarPlay not connected';
}

/** Drive view media widget. */
export function NowPlayingW({ go }: WP) {
  const np = useStore(nowPlayingStore);
  const cp = useStore(carplayStore);
  return (
    <Card class="nowplaying" label="Now playing" right={<button class="tag accent" type="button" onClick={() => go('carplay')}>CARPLAY</button>}>
      {np ? (
        <button type="button" class="np" onClick={() => go('carplay')}>
          {np.art ? <img src={np.art} alt="" /> : <span class="noart" aria-hidden="true">♪</span>}
          <span class="grow npt">
            <b class="ellip">{np.title ?? '—'}</b>
            <span class="ellip dimtxt">{[np.artist, np.album].filter(Boolean).join(' · ')}</span>
            {np.app && <span class="lbl ellip">{np.app}</span>}
          </span>
        </button>
      ) : <div class="dimtxt">{why(cp)}</div>}
      {np && <Progress np={np} />}
    </Card>
  );
}

/** The slim strip beside the CarPlay panel: whatever is playing, from any source (media/nowplaying.tsx). */
export function NowPlayingMini() {
  const s = useStore(stateStore);
  return <NowPlayingMiniAny s={s} />;
}

/** The Waze modal's line about CarPlay. */
export function CarPlayWazeHint() {
  const cp = useStore(carplayStore);
  if (cp.status !== 'connected') return <div class="dimtxt">Scan with the phone camera, and Waze opens with the route.</div>;
  return <div class="banner ok">CarPlay is connected: scan with the iPhone and the route opens in Waze on the phone, then shows in the CarPlay view.</div>;
}
