// Now playing from whichever source is active: the brain's State.nowPlaying
// (CarPlay, the Media view's player, Spotify on the truck) for the words, and
// the art each source keeps in the UI. The Drive card, the CarPlay strip and
// the Media view all show this; Home Assistant gets the same words over MQTT.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useStore, type State } from '../lib/brain.ts';
import { carplayStore, nowPlayingStore } from '../carplay/controller.ts';
import { Card } from '../components/common.tsx';
import type { WP } from '../components/drive.tsx';
import { playerStore } from './player.ts';
import { PlayerControls } from './MediaView.tsx';
import { mediaStatusStore, pollMediaStatus } from './status.ts';

export const SOURCE_LABEL: Record<string, string> = { carplay: 'CarPlay', spotify: 'Spotify', radio: 'Radio', fm: 'AM/FM', plex: 'Plex', local: 'Files' };

export type AnyNowPlaying = { title: string | null; artist: string | null; album: string | null; source: string; art: string | null; app: string | null };

/** What to show: the brain's pick, with art from the source that owns it. Falls back to CarPlay's own report before the brain answers. */
export function useAnyNowPlaying(s: State | null): AnyNowPlaying | null {
  const cp = useStore(nowPlayingStore);
  const p = useStore(playerStore);
  const ms = useStore(mediaStatusStore);
  const np = s?.nowPlaying ?? null;
  if (!np) return cp ? { title: cp.title, artist: cp.artist, album: cp.album, source: 'carplay', art: cp.art, app: cp.app } : null;
  let art: string | null = null, app: string | null = null;
  if (np.source === 'carplay') { art = cp?.art ?? null; app = cp?.app ?? null; }
  else if (np.source === 'spotify') art = ms?.spotify.playback?.art ?? null;
  else if (p.current && p.current.source === np.source) art = p.current.art;
  return { ...np, art, app };
}

function why(s: State | null, cpStatus: string) {
  if (!s) return 'Not connected to the brain';
  if (cpStatus === 'connected') return 'Nothing playing';
  return 'Nothing playing: pick a source in Media';
}

const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** Where Spotify is in the song: its last report, run forward by the clock while it plays. */
export function SpotifyProgress() {
  const p = useStore(mediaStatusStore)?.spotify.playback ?? null;
  const base = useMemo(() => ({ at: Date.now(), pos: p?.positionMs ?? 0 }), [p?.positionMs, p?.title, p?.playing]);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!p?.playing) return; const id = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, [p?.playing]);
  if (!p?.durationMs || p.positionMs === null) return null;
  const pos = Math.min(p.durationMs, base.pos + (p.playing ? Math.max(0, now - base.at) : 0));
  return (
    <div class="np-progress" role="progressbar" aria-valuemin={0} aria-valuemax={p.durationMs} aria-valuenow={pos}>
      <span class="num">{mmss(pos)}</span><i><b style={{ width: `${(pos / p.durationMs) * 100}%` }} /></i><span class="num">{mmss(p.durationMs)}</span>
    </div>
  );
}

/** Drive view media widget ("nowPlaying"): any source; tap opens the Media view. */
export function NowPlayingAny({ s, go }: WP) {
  const np = useAnyNowPlaying(s);
  const cp = useStore(carplayStore);
  const p = useStore(playerStore);
  useEffect(() => pollMediaStatus(false), []);
  const ours = !!p.current && np?.source === p.current.source;
  return (
    <Card class="nowplaying" label="Now playing" right={<button class="tag accent" type="button" onClick={() => go(np?.source === 'carplay' ? 'carplay' : 'media')}>{np ? SOURCE_LABEL[np.source] ?? 'MEDIA' : 'MEDIA'}</button>}>
      {np ? (
        <button type="button" class="np" onClick={() => go(np.source === 'carplay' ? 'carplay' : 'media')}>
          {np.art ? <img src={np.art} alt="" /> : <span class="noart" aria-hidden="true">{np.source === 'radio' || np.source === 'fm' ? '📻' : '♪'}</span>}
          <span class="grow npt">
            <b class="clamp2">{np.title ?? "—"}</b>
            <span class="ellip dimtxt">{[np.artist, np.album].filter(Boolean).join(' · ')}</span>
            {np.app && <span class="lbl ellip">{np.app}</span>}
          </span>
        </button>
      ) : <div class="dimtxt">{p.current && p.error ? p.error : why(s, cp.status)}</div>}
      {np?.source === 'spotify' && <SpotifyProgress />}
      {(ours || (p.current && !np)) && <PlayerControls />}
    </Card>
  );
}

/** The slim strip beside the CarPlay panel. */
export function NowPlayingMiniAny({ s }: { s: State | null }) {
  const np = useAnyNowPlaying(s);
  if (!np) return null;
  return (
    <Card label={`Playing · ${SOURCE_LABEL[np.source] ?? ''}`}>
      <div class="np mini">
        {np.art && <img src={np.art} alt="" />}
        <span class="grow npt"><b class="ellip">{np.title ?? '—'}</b><span class="ellip dimtxt">{np.artist ?? ''}</span></span>
      </div>
    </Card>
  );
}
