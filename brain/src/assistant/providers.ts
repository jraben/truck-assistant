// The non-WOPR assistants: an OpenAI-compatible chat API, Claude (Anthropic's
// SDK), and Home Assistant Assist; plus OpenAI-compatible speech in and out.
// Each chat yields text as it streams; errors are AssistantError with a kind
// the cockpit words the same way it words WOPR's.
import Anthropic from '@anthropic-ai/sdk';
import type { ChatMsg } from '../wopr/primer.ts';
import type { AssistantSettings } from './types.ts';

export class AssistantError extends Error {
  kind: 'not-configured' | 'offline' | 'auth' | 'http' | 'timeout' | 'refused';
  status: number;
  constructor(kind: AssistantError['kind'], message: string, status = 502) { super(message); this.kind = kind; this.status = status; }
}

const TIMEOUT_MS = 120_000;

function netError(e: unknown, who: string, url: string): AssistantError {
  const err = e as Error;
  if (err.name === 'TimeoutError') return new AssistantError('timeout', `${who} didn't answer in time.`, 504);
  if (err.name === 'AbortError') return new AssistantError('http', 'Cancelled.', 499);
  return new AssistantError('offline', `Can't reach ${who} at ${url} (${err.message}).`, 502);
}

async function httpError(res: Response, who: string): Promise<AssistantError> {
  if (res.status === 401 || res.status === 403) return new AssistantError('auth', `${who} refused the API key: check it on the settings page.`, 401);
  let detail = '';
  try {
    const t = await res.text();
    try { const j = JSON.parse(t) as { error?: { message?: string } | string; message?: string }; detail = typeof j.error === 'string' ? j.error : j.error?.message ?? j.message ?? ''; }
    catch { detail = /<html/i.test(t) ? '' : t; }
  } catch { /* none */ }
  return new AssistantError('http', `${who} answered ${res.status}${detail ? `: ${detail.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`, res.status >= 500 ? 502 : res.status);
}

/** Server-sent events: each `data:` line's payload, until [DONE]. */
async function* sse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      if (data) yield data;
    }
  }
}

/** OpenAI-compatible /chat/completions, streamed. The primer goes in as a system message. */
export async function* chatOpenAI(cfg: AssistantSettings['openai'], system: string, msgs: ChatMsg[], signal?: AbortSignal): AsyncGenerator<string> {
  if (!cfg.baseUrl || !cfg.model) throw new AssistantError('not-configured', 'Pick the service and type a model name on the settings page (Media and WOPR > Assistant).', 503);
  const url = `${cfg.baseUrl}/chat/completions`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}) },
      body: JSON.stringify({ model: cfg.model, stream: true, messages: [{ role: 'system', content: system }, ...msgs] }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) { throw netError(e, 'the AI service', cfg.baseUrl); }
  if (!res.ok) throw await httpError(res, 'The AI service');
  if (!res.body) throw new AssistantError('http', 'The AI service sent no reply.');
  for await (const data of sse(res.body)) {
    try {
      const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; error?: { message?: string } };
      if (j.error) throw new AssistantError('http', `The AI service: ${j.error.message ?? 'error'}`);
      const t = j.choices?.[0]?.delta?.content;
      if (t) yield t;
    } catch (e) { if (e instanceof AssistantError) throw e; /* a keep-alive or partial line */ }
  }
}

/**
 * Claude through Anthropic's SDK, streamed. Low effort: these are short spoken
 * answers. Server-side fallbacks are on ("default"), so a request a safety
 * classifier declines is re-run on Anthropic's recommended fallback model
 * instead of coming back empty; a refusal that survives is said plainly.
 */
export async function* chatClaude(cfg: AssistantSettings['claude'], system: string, msgs: ChatMsg[], signal?: AbortSignal): AsyncGenerator<string> {
  if (!cfg.apiKey) throw new AssistantError('not-configured', 'Add a Claude API key on the settings page (Media and WOPR > Assistant).', 503);
  const client = new Anthropic({ apiKey: cfg.apiKey, timeout: TIMEOUT_MS, maxRetries: 1 });
  try {
    const stream = client.beta.messages.stream({
      model: cfg.model,
      max_tokens: 16000,
      system,
      messages: msgs,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    }, { signal });
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') yield ev.delta.text;
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') throw new AssistantError('refused', 'Claude declined to answer that.', 200);
  } catch (e) {
    if (e instanceof AssistantError) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AssistantError('auth', 'Anthropic refused the API key: check it on the settings page.', 401);
    if (e instanceof Anthropic.NotFoundError) throw new AssistantError('http', `Anthropic doesn't know the model "${cfg.model}": check it on the settings page.`, 400);
    if (e instanceof Anthropic.RateLimitError) throw new AssistantError('http', 'Claude is rate-limited right now: try again in a moment.', 429);
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AssistantError('timeout', "Claude didn't answer in time.", 504);
    if (e instanceof Anthropic.APIConnectionError) throw new AssistantError('offline', `Can't reach Anthropic (${(e as Error).message}).`, 502);
    if (e instanceof Anthropic.APIError) throw new AssistantError('http', `Anthropic answered ${e.status ?? ''}: ${e.message}`.slice(0, 200), 502);
    throw e;
  }
}

/** OpenAI-compatible speech-to-text (/audio/transcriptions): OpenAI or Groq Whisper. */
export async function sttOpenAI(v: AssistantSettings['voice'], audio: Buffer, mime: string): Promise<{ text: string }> {
  if (!v.baseUrl || !v.sttModel) throw new AssistantError('not-configured', 'Set the speech service address and model on the settings page (Assistant > Voice).', 503);
  const form = new FormData();
  const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
  form.append('file', new Blob([new Uint8Array(audio)], { type: mime || 'audio/webm' }), `audio.${ext}`);
  form.append('model', v.sttModel);
  let res: Response;
  try { res = await fetch(`${v.baseUrl}/audio/transcriptions`, { method: 'POST', headers: v.apiKey ? { authorization: `Bearer ${v.apiKey}` } : {}, body: form, signal: AbortSignal.timeout(30_000) }); }
  catch (e) { throw netError(e, 'the speech service', v.baseUrl); }
  if (!res.ok) throw await httpError(res, 'The speech service');
  const j = await res.json() as { text?: string };
  return { text: String(j.text ?? '').trim() };
}

/** OpenAI-compatible text-to-speech (/audio/speech): one sentence in, mp3 out. */
export async function ttsOpenAI(v: AssistantSettings['voice'], text: string): Promise<Response> {
  if (!v.baseUrl || !v.ttsModel) throw new AssistantError('not-configured', 'Set the speech service address and voice model on the settings page (Assistant > Voice).', 503);
  let res: Response;
  try {
    res = await fetch(`${v.baseUrl}/audio/speech`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(v.apiKey ? { authorization: `Bearer ${v.apiKey}` } : {}) },
      body: JSON.stringify({ model: v.ttsModel, voice: v.ttsVoice || 'alloy', input: text.slice(0, 1000), response_format: 'mp3' }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) { throw netError(e, 'the speech service', v.baseUrl); }
  if (!res.ok) throw await httpError(res, 'The speech service');
  return res;
}
