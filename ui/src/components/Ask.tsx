// The app's own "Are you sure?" and "Name it" dialogs, in place of the browser's
// confirm() and prompt(). Those look like another program, not this app, and a
// kiosk browser on the dash can block them without a word: the answer is then
// silently "no" and the tap seems to do nothing. Mount <AskHost /> once per page
// (App does; the bare Truck page does too).
import { useEffect, useRef, useState } from 'preact/hooks';
import { store, useStore } from '../lib/brain.ts';

type Pending =
  | { kind: 'confirm'; message: string; ok: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: 'text'; message: string; value: string; ok: string; resolve: (v: string | null) => void };

const askStore = store<Pending | null>(null);

/** Ask before doing something. Resolves true on OK, false on Cancel, Escape or a tap outside. */
export function ask(message: string, opts: { ok?: string; danger?: boolean } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    askStore.get()?.resolve(false as never);
    askStore.set({ kind: 'confirm', message, ok: opts.ok ?? 'OK', danger: opts.danger ?? /^(delete|remove|forget|revoke|restore|roll back|go back|unlock|make a new)/i.test(message), resolve });
  });
}

/** Ask for a line of text. Resolves the text on OK, null on Cancel. */
export function askText(message: string, value = '', ok = 'Save'): Promise<string | null> {
  return new Promise((resolve) => {
    askStore.get()?.resolve(null as never);
    askStore.set({ kind: 'text', message, value, ok, resolve });
  });
}

export function AskHost() {
  const a = useStore(askStore);
  const [text, setText] = useState('');
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!a) return;
    if (a.kind === 'text') { setText(a.value); setTimeout(() => inputRef.current?.select(), 0); } else setTimeout(() => okRef.current?.focus(), 0);
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [a]);
  if (!a) return null;
  const close = (yes: boolean) => {
    askStore.set(null);
    if (a.kind === 'confirm') a.resolve(yes); else a.resolve(yes ? text : null);
  };
  const [title, ...rest] = a.message.split('\n\n');
  return (
    <div class="scrim ask-scrim" onClick={(e) => { if (e.target === e.currentTarget) close(false); }}>
      <form class="modal ask" role="alertdialog" aria-modal="true" aria-label={title} onSubmit={(e) => { e.preventDefault(); close(true); }}>
        <h3 style="margin:0">{title}</h3>
        {rest.map((p) => <p class="help" style="margin:0;white-space:pre-line">{p}</p>)}
        {a.kind === 'text' && <input ref={inputRef} type="text" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} aria-label={title} />}
        <div class="row wrap" style="gap:var(--s1);justify-content:flex-end">
          <button type="button" class="btn" onClick={() => close(false)}>Cancel</button>
          <button ref={okRef} type="submit" class={`btn ${a.kind === 'confirm' && a.danger ? 'danger' : 'primary'}`}>{a.ok}</button>
        </div>
      </form>
    </div>
  );
}
