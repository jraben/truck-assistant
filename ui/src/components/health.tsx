// System health in the top strip: one button, a four-segment gauge and four icons
// (brain, truck box, GPS, network), each green when fine and red when not. Tap for
// the plain-words panel; the network row opens the network picker.
import type { State } from '../lib/brain.ts';
import { fmtBytes } from './network.tsx';

type Tone = 'ok' | 'bad' | 'unknown';
type Check = { id: string; name: string; icon: string; tone: Tone; say: string };

const I = {
  brain: 'M12 5.5a3 3 0 0 0-5.2-2 3 3 0 0 0-2.6 4 3.2 3.2 0 0 0-.6 5.4 3.2 3.2 0 0 0 2.1 4.6A3 3 0 0 0 12 19.5zM12 5.5a3 3 0 0 1 5.2-2 3 3 0 0 1 2.6 4 3.2 3.2 0 0 1 .6 5.4 3.2 3.2 0 0 1-2.1 4.6 3 3 0 0 1-6.3 2zM12 5.5v14M8 9.5a2 2 0 0 1 2 2M16 9.5a2 2 0 0 0-2 2',
  // Raspberry Pi: two leaves over a berry.
  pi: 'M12 7c-1-2.4-3-3.4-5-3.2.3 2 2 3.2 5 3.2zM12 7c1-2.4 3-3.4 5-3.2-.3 2-2 3.2-5 3.2zM12 7.5c-3.6 0-6 2.4-6 5.6C6 17 8.8 21 12 21s6-4 6-7.9c0-3.2-2.4-5.6-6-5.6zM9.5 11.5a1.2 1.2 0 1 0 0 .01M14.5 11.5a1.2 1.2 0 1 0 0 .01M12 14.5a1.2 1.2 0 1 0 0 .01M9.5 17.3a1.2 1.2 0 1 0 0 .01M14.5 17.3a1.2 1.2 0 1 0 0 .01',
  gps: 'M12 21s-6.5-5.8-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21zM12 7.3a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5',
  net: 'M2.5 9a14 14 0 0 1 19 0M5.5 12.4a9.5 9.5 0 0 1 13 0M8.6 15.8a5 5 0 0 1 6.8 0M12 19.2h.01',
};

export function healthChecks(s: State | null, connected: boolean): Check[] {
  const live = connected && !!s;
  const n = s?.network;
  const phone = n && (n.link === 'hotspot' || n.link === 'bt');
  const u = (ok: boolean): Tone => (live ? (ok ? 'ok' : 'bad') : 'unknown');
  return [
    { id: 'brain', name: 'Brain', icon: I.brain, tone: connected ? 'ok' : 'bad', say: connected ? 'Connected' : 'Reconnecting…' },
    { id: 'truckbox', name: 'Truck box', icon: I.pi, tone: u(!!s?.truckbox), say: !live ? 'Unknown while the brain is away' : s?.truckbox ? 'Online' : 'Offline: relays and sensors unavailable' },
    { id: 'gps', name: 'GPS', icon: I.gps, tone: u(!!s?.gps?.fix), say: !live ? 'Unknown while the brain is away' : s?.gps?.fix ? 'Fix' : 'No fix' },
    { id: 'net', name: 'Network', icon: I.net, tone: u(!!n && n.link !== 'offline'), say: !live ? 'Unknown while the brain is away' : !n || n.link === 'offline' ? (n?.error ?? 'Offline') : `${n.label}${n.ssid ? ` (${n.ssid})` : ''}${n.signal != null ? ` · ${n.signal}%` : ''}${phone ? ` · ${fmtBytes(n.bytesThisTrip)} this trip` : ''}` },
  ];
}

const Svg = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;

/** A half-ring split into one segment per check. */
function Gauge({ checks }: { checks: Check[] }) {
  const n = checks.length, gap = 0.1, r = 9, cx = 12, cy = 13;
  const pt = (a: number) => `${(cx - r * Math.cos(a)).toFixed(2)} ${(cy - r * Math.sin(a)).toFixed(2)}`;
  return (
    <svg class="hgauge" viewBox="0 0 24 15" aria-hidden="true">
      {checks.map((c, i) => {
        const a0 = (Math.PI * i) / n + gap / 2, a1 = (Math.PI * (i + 1)) / n - gap / 2;
        return <path class={c.tone} d={`M${pt(a0)}A${r} ${r} 0 0 1 ${pt(a1)}`} />;
      })}
    </svg>
  );
}

export function HealthButton({ s, connected, open, onClick }: { s: State | null; connected: boolean; open: boolean; onClick: () => void }) {
  const checks = healthChecks(s, connected);
  const bad = checks.filter((c) => c.tone === 'bad').length;
  const label = bad ? `${bad} of ${checks.length} systems have a problem` : 'All systems fine';
  return (
    <button type="button" class={`pill health ${bad ? 'has-bad' : ''}`} aria-expanded={open} onClick={onClick} aria-label={label} title={checks.map((c) => `${c.name}: ${c.say}`).join('\n')}>
      <Gauge checks={checks} />
      {checks.map((c) => <span class={`hico ${c.tone}`}><Svg d={c.icon} /></span>)}
    </button>
  );
}

export function HealthPanel({ s, connected, onClose, onNetwork }: { s: State | null; connected: boolean; onClose: () => void; onNetwork: () => void }) {
  const checks = healthChecks(s, connected);
  return (
    <div class="card netpanel healthpanel" role="dialog" aria-label="System health">
      <div class="row between"><span class="lbl">System health</span><button class="btn sm" type="button" onClick={onClose}>Close</button></div>
      <div class="list">
        {checks.map((c) => (
          <div class="item row between">
            <span class={`hico ${c.tone}`}><Svg d={c.icon} /></span>
            <div class="grow"><b>{c.name}</b><div class="dimtxt" style="font-size:var(--fs-caption)">{c.say}</div></div>
            {c.id === 'net' && <button class="btn sm" type="button" onClick={onNetwork}>Networks</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
