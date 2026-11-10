// Who's driving: big tap targets on the Drive view (after ignition) and from the rail.
import { api, pickDriver, settingsStore, stateStore, useStore, type Driver } from '../lib/brain.ts';

type BadgeDriver = { id?: string; initials: string; color: string; photo?: string | { updatedAt: string } | null };
/** The photo URL: the live state carries it ready-made; a settings Driver carries the record. Pure. */
export const badgePhoto = (d: BadgeDriver | null): string | null => {
  const p = d?.photo;
  if (!p) return null;
  if (typeof p === 'string') return p;
  return d?.id ? `/api/drivers/${encodeURIComponent(d.id)}/photo?v=${encodeURIComponent(p.updatedAt)}` : null;
};

/** The driver's photo in a ring of their colour, or their initials on it. */
export function DriverBadge({ d, size = 40 }: { d: BadgeDriver | null; size?: number }) {
  const src = badgePhoto(d);
  if (src) return <img class="dbadge photo" src={src} alt="" width={size} height={size} style={{ width: `${size}px`, height: `${size}px`, borderColor: d?.color }} aria-hidden="true" />;
  return (
    <span class="dbadge" style={{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.4)}px`, background: d?.color ?? 'var(--panel-2)' }} aria-hidden="true">
      {d?.initials ?? '?'}
    </span>
  );
}

/** The grid of drivers. Picking during a trip only re-labels that trip; the brain never switches on its own mid-trip. */
export function DriverGrid({ onPicked }: { onPicked?: () => void }) {
  const settings = useStore(settingsStore);
  const s = useStore(stateStore);
  const drivers: Driver[] = settings?.drivers ?? [];
  const cur = s?.driver?.id;
  const sug = s?.driverSuggestion?.id;
  return (
    <div class="dgrid" role="group" aria-label="Pick the driver">
      {drivers.map((d) => (
        <button type="button" class={`dbtn ${d.id === cur ? 'sel' : ''}`} aria-pressed={d.id === cur}
          onClick={async () => { await pickDriver(d.id); onPicked?.(); }}>
          <DriverBadge d={d} size={64} />
          <b>{d.name}</b>
          <span class="dimtxt" style="font-size:var(--fs-caption)">{d.id === sug && d.id === cur ? 'suggested' : d.guest ? 'no history kept' : d.id === cur ? 'driving' : ''}</span>
        </button>
      ))}
    </div>
  );
}

/** Shown on the Drive view when the ignition comes on, until a driver is picked or it's dismissed. */
export function DriverPrompt() {
  const s = useStore(stateStore);
  const sug = s?.driverSuggestion;
  if (!sug) return null;
  return (
    <div class="card dprompt" role="dialog" aria-label="Who's driving?">
      <div class="row between">
        <div>
          <div class="lbl">Who's driving?</div>
          <div class="dimtxt" style="font-size:var(--fs-body-sm)">{sug.reason}</div>
        </div>
        <button class="btn" type="button" onClick={() => void api('/api/driver/dismiss', { method: 'POST' })}>{sug.name}, go</button>
      </div>
      <DriverGrid onPicked={() => void api('/api/driver/dismiss', { method: 'POST' })} />
    </div>
  );
}

export function DriverPanel({ onClose }: { onClose: () => void }) {
  return (
    <div class="card picker dpanel" role="dialog" aria-label="Driver">
      <div class="row between"><span class="lbl">Driver</span><button class="btn sm" type="button" onClick={onClose}>Close</button></div>
      <DriverGrid onPicked={onClose} />
      <a class="btn" href="/settings#drivers">Edit profiles…</a>
    </div>
  );
}
