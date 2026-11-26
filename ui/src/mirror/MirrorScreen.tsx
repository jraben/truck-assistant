// The Mirror screen (/?mirror): for a 1920×720 touch bar display over the rear-view mirror,
// on the Pi's second HDMI port. The rear camera full width, flipped like a mirror; the side
// cameras slide in on a turn signal; speed, gear and the clock at the edges. Tap to cycle:
// rear → rear + both sides → off (black glass, woken by reverse or a signal).
import { useEffect, useState } from 'preact/hooks';
import { activeDriver, settingsStore, stateStore, useStore } from '../lib/brain.ts';
import { camByRole, rearCamera, useCamStatus, useViewerHeartbeat, type CamInfo } from '../lib/cams.ts';
import { CamPlayer } from '../components/camplayer.tsx';
import { paintTheme, pickTheme } from '../lib/theme.ts';
import { mirrorView, nextMode, type MirrorMode } from './logic.ts';
import '../cams.css';
import './mirror.css';

const MODE_KEY = 'slate.mirror.mode', FLIP_KEY = 'slate.mirror.flip';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

/** embedded: inside the dash (a rail screen), which paints its own theme. */
export function MirrorScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const s = useStore(stateStore);
  const settings = useStore(settingsStore);
  const [mode, setMode] = useState<MirrorMode>(() => (read(MODE_KEY) as MirrorMode) || 'rear');
  const [flip, setFlip] = useState(() => read(FLIP_KEY) !== '0');
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15_000); return () => clearInterval(t); }, []);
  // The driver's theme, day or night like the dash.
  const driver = activeDriver(settings, s);
  useEffect(() => { if (embedded) return; paintTheme(pickTheme(driver?.theme, s?.gps?.fix ? { lat: s.gps.lat, lon: s.gps.lon } : null, now)); }, [driver?.theme, now.getHours()]);

  const { status, error } = useCamStatus(15_000);
  const v = mirrorView(mode, s);
  useViewerHeartbeat(!v.dark);
  const cams = status?.cameras ?? [];
  const rear = rearCamera(cams);
  const left = camByRole(cams, 'left'), right = camByRole(cams, 'right');
  const show = (c: CamInfo, guides: boolean) => status && <CamPlayer cam={{ ...c, mirror: flip, guides }} backend={status.backend} guides={status.guides} big />;

  const cycle = () => { const m = nextMode(mode); setMode(m); write(MODE_KEY, m); };
  const mph = s?.speedMph ?? null;
  const sig = s?.turnSignals;
  return (
    <div class={`mirror ${embedded ? 'embedded' : ''} ${v.dark ? 'dark' : ''} ${flip ? 'flipped' : ''}`} onClick={cycle} role="button" aria-label={`Mirror: ${mode}. Tap to change.`}>
      {/* A left signal shows the LEFT camera on the left, as in the glass (the image itself is flipped). */}
      <div class={`mr-row ${v.left && left ? 'has-l' : ''} ${v.right && right ? 'has-r' : ''}`}>
        {v.left && left && <div class="mr-side l">{show(left, false)}</div>}
        {v.rear && (rear ? <div class="mr-rear">{show(rear, v.guides)}</div>
          : <div class="mr-none">{status ? 'No rear camera yet: Settings › Cameras' : error ? `Cameras unavailable: ${error}` : 'Loading cameras…'}</div>)}
        {v.right && right && <div class="mr-side r">{show(right, false)}</div>}
      </div>
      {!v.dark && (
        <>
          <div class="mr-hud l">
            <b class="num">{mph === null ? '—' : Math.round(mph)}</b><small>MPH</small>
            {s?.reverse ? <span class="mr-gear r">R</span> : s?.gear ? <span class="mr-gear">{s.gear}</span> : null}
          </div>
          <div class="mr-hud r"><span class="num">{now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
          {sig?.left && <span class="mr-arrow l" aria-label="Left signal">◀</span>}
          {sig?.right && <span class="mr-arrow r" aria-label="Right signal">▶</span>}
        </>
      )}
      <button type="button" class="mr-flip" onClick={(e) => { e.stopPropagation(); setFlip(!flip); write(FLIP_KEY, flip ? '0' : '1'); }} aria-pressed={flip} title="Flip the picture like a mirror">⇋</button>
    </div>
  );
}

/** The dash's Mirror screen (only on the rail while the setting is on). */
export const MIRROR_WIDGETS = { mirror: () => <MirrorScreen embedded /> };
