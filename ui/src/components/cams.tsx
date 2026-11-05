// The Cams view: every camera in a grid, or one big; the rear camera by itself
// (with guides) while in reverse; the dashcam's Save clip button and the clips.
import { useEffect, useRef, useState } from 'preact/hooks';
import '../cams.css';
import { toast } from '../lib/brain.ts';
import { deleteClip, fmtBytes, listClips, rearCamera, saveClip, useCamStatus, useViewerHeartbeat, withToken, type CamInfo, type Clip } from '../lib/cams.ts';
import { Modal } from './common.tsx';
import { CamPlayer } from './camplayer.tsx';
import type { WP } from './drive.tsx';

const LAYOUT_KEY = 'slate.cams.layout';
const readPref = () => { try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null') as { mode: 'grid' | 'single'; cam: string | null } | null; } catch { return null; } };

export function CamsView({ s }: WP) {
  const { status, error } = useCamStatus();
  const [pref, setPref] = useState(readPref);
  const [clipsOpen, setClipsOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  useViewerHeartbeat();
  const remember = (p: { mode: 'grid' | 'single'; cam: string | null }) => { setPref(p); try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(p)); } catch { /* private mode */ } };

  if (!status) return <div class="card cams-wrap"><span class="lbl">Cameras</span><div class="dimtxt">{error ? `Cameras unavailable: ${error}` : 'Loading cameras…'}</div></div>;
  const cams = status.cameras.filter((c) => c.enabled);
  const reverse = s?.reverse === true && status.autoRear;
  const rear = rearCamera(status.cameras);
  const mode = reverse ? 'single' : pref?.mode ?? status.defaultLayout;
  const one = reverse ? rear : cams.find((c) => c.id === pref?.cam) ?? cams[0] ?? null;
  const rec = status.recording;

  const doSave = async () => {
    setSaving(true);
    try { const c = await saveClip(); toast(`Saving ${c.length} clip${c.length > 1 ? 's' : ''}: last ${Math.round(c[0].durationS * 2 / 3)} s and the next few`); }
    catch (e) { toast(`Clip not saved: ${(e as Error).message}`); }
    finally { setSaving(false); }
  };

  return (
    <div class="cams-wrap">
      <div class="cams-bar">
        {reverse ? <span class="tag warn">REVERSE · REAR CAMERA</span> : (
          <>
            <button type="button" class={`btn sm ${mode === 'grid' ? 'primary' : ''}`} onClick={() => remember({ mode: 'grid', cam: pref?.cam ?? null })}>Grid</button>
            {cams.map((c) => <button type="button" class={`btn sm ${mode === 'single' && one?.id === c.id ? 'primary' : ''}`} onClick={() => remember({ mode: 'single', cam: c.id })}>{c.name}</button>)}
          </>
        )}
        <span class="sp" />
        {status.backend === 'fallback' && <span class="tag dim" title={status.why ?? ''}>DESK MJPEG</span>}
        <span class={`tag ${rec.cameras.length ? 'rec' : 'dim'}`} title={rec.error ?? `${rec.segments} segments, ${fmtBytes(rec.bytes)} of ${fmtBytes(rec.capBytes)}`}>{rec.cameras.length ? `● REC ${rec.cameras.length}` : 'NOT RECORDING'}</span>
        <button type="button" class="btn sm" disabled={!rec.cameras.length || saving} onClick={() => void doSave()}>Save clip</button>
        <button type="button" class="btn sm" onClick={() => setClipsOpen(true)}>Clips</button>
      </div>
      {!cams.length ? <div class="card"><span class="lbl">No cameras</span><div class="dimtxt">Add cameras in Settings &gt; Cameras.</div></div>
        : mode === 'single' && one ? <div class="cams-single"><CamPlayer cam={one} backend={status.backend} guides={status.guides} big /></div>
        : (
          <div class={`cams-grid n${Math.min(cams.length, 6)}`}>
            {cams.map((c) => <div class="cams-cell" onClick={() => remember({ mode: 'single', cam: c.id })}><CamPlayer cam={c} backend={status.backend} guides={status.guides} /></div>)}
          </div>
        )}
      {status.backend === 'off' && <div class="banner">{status.why}</div>}
      {clipsOpen && <ClipsModal cams={status.cameras} onClose={() => setClipsOpen(false)} />}
    </div>
  );
}

/** One camera on its own (the older `cam` widget in saved layouts): by props.camera id, else by label. */
export function CamTile({ props }: WP) {
  const { status } = useCamStatus(15_000);
  useViewerHeartbeat();
  const want = String(props?.camera ?? props?.label ?? '');
  const cam = status?.cameras.find((c) => c.enabled && (c.id === want || c.name.toLowerCase() === want.toLowerCase())) ?? null;
  if (!status || !cam) return <div class="cam"><span class="lbl">{want || 'Camera'} · {status ? 'not set up (Settings > Cameras)' : 'loading'}</span></div>;
  return <CamPlayer cam={{ ...cam, guides: cam.guides || !!props?.guides }} backend={status.backend} guides={status.guides} />;
}

export function ClipsModal({ cams, onClose }: { cams: CamInfo[]; onClose: () => void }) {
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [playing, setPlaying] = useState<Clip | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () => listClips().then(setClips).catch((e) => setErr((e as Error).message));
  useEffect(() => { void load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, []);
  const name = (id: string) => cams.find((c) => c.id === id)?.name ?? id;
  const del = async (c: Clip) => { if (!confirm(`Delete the ${name(c.camera)} clip from ${new Date(c.startedAt).toLocaleString()}?`)) return; try { await deleteClip(c.id); if (playing?.id === c.id) setPlaying(null); void load(); } catch (e) { toast((e as Error).message); } };
  return (
    <Modal title="Dashcam clips" onClose={onClose}>
      {err && <div class="err">{err}</div>}
      {playing && <ClipPlayer clip={playing} label={name(playing.camera)} />}
      {clips === null ? <div class="dimtxt">Loading…</div> : !clips.length ? <div class="dimtxt">No clips yet. Tap Save clip on the Cams view: it keeps the minute before and 30 seconds after.</div> : (
        <div class="clips">
          {clips.map((c) => (
            <div class={`clip ${playing?.id === c.id ? 'sel' : ''}`}>
              <button type="button" class="clip-main" disabled={c.state !== 'ready'} onClick={() => setPlaying(c)}>
                <b>{new Date(c.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })}</b>
                <span>{name(c.camera)} · {c.reason === 'motion' ? 'motion' : 'saved'} · {c.state === 'ready' ? `${c.durationS} s, ${fmtBytes(c.bytes)}` : c.state === 'recording' ? 'recording…' : `failed: ${c.error}`}</span>
              </button>
              {c.state === 'ready' && <a class="btn sm" href={withToken(`/api/cams/clips/${c.id}.mp4`)} download={`${c.id}.mp4`}>Download</a>}
              <button type="button" class="btn sm danger" onClick={() => void del(c)}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function ClipPlayer({ clip, label }: { clip: Clip; label: string }) {
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => { void v.current?.play().catch(() => {}); }, [clip.id]);
  return (
    <div class="clip-player">
      <video ref={v} src={withToken(`/api/cams/clips/${clip.id}.mp4`)} controls playsInline muted />
      <div class="dimtxt">{label} · {new Date(clip.startedAt).toLocaleString()}</div>
    </div>
  );
}
