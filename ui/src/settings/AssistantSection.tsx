// Settings portal: which AI answers the voice button, and how speech gets in
// and out. Keys are write-only (masked back), like every other key here.
import { useState } from 'preact/hooks';
import { api } from '../lib/brain.ts';
import type { MaskedMediaSettings } from '../../../brain/src/media/types.ts';
import { OPENAI_PRESETS, type AssistantProvider } from '../../../brain/src/assistant/types.ts';

type Msg = { ok: boolean; text: string } | null;
const Note = ({ m }: { m: Msg }) => (m ? <span class={m.ok ? 'okmsg' : 'err'}>{m.text}</span> : null);

function Key({ label, set, value, onInput, onClear }: { label: string; set: string | undefined; value: string; onInput: (v: string) => void; onClear: () => void }) {
  return (
    <div class="form" style="gap:var(--s1)">
      <label class="f"><span>{label}</span>
        <input type="password" autocomplete="off" value={value} placeholder={set ? `set (${set}); type to replace` : 'not set'} onInput={(e) => onInput((e.target as HTMLInputElement).value)} />
      </label>
      {set && <button class="btn sm danger" type="button" onClick={onClear}>Remove</button>}
    </div>
  );
}

const CHOICES: { id: AssistantProvider; name: string; help: string }[] = [
  { id: 'wopr', name: 'WOPR', help: 'Your home AI (set up in the WOPR section below). Knows your calendar, archive and memory.' },
  { id: 'claude', name: 'Claude', help: 'Anthropic’s Claude, with an API key from console.anthropic.com.' },
  { id: 'openai', name: 'ChatGPT, Gemini, Groq, Ollama…', help: 'Any OpenAI-compatible service, including a model running on your own computer.' },
  { id: 'homeassistant', name: 'Home Assistant Assist', help: 'HA’s own assistant (uses the Home Assistant connection above). It can control your house, and whichever AI you set up in HA answers.' },
];

export function AssistantSection({ m, put }: { m: MaskedMediaSettings; put: (p: Record<string, unknown>) => Promise<Msg> }) {
  const a = m.assistant;
  const [provider, setProvider] = useState<AssistantProvider>(a.provider);
  const [preset, setPreset] = useState(a.openai.preset);
  const [baseUrl, setBaseUrl] = useState(a.openai.baseUrl);
  const [model, setModel] = useState(a.openai.model);
  const [okey, setOkey] = useState('');
  const [cmodel, setCmodel] = useState(a.claude.model);
  const [ckey, setCkey] = useState('');
  const [agent, setAgent] = useState(a.homeassistant.agentId ?? '');
  const [stt, setStt] = useState(a.voice.stt);
  const [tts, setTts] = useState(a.voice.tts);
  const [vurl, setVurl] = useState(a.voice.baseUrl);
  const [vkey, setVkey] = useState('');
  const [sttModel, setSttModel] = useState(a.voice.sttModel);
  const [ttsModel, setTtsModel] = useState(a.voice.ttsModel);
  const [ttsVoice, setTtsVoice] = useState(a.voice.ttsVoice);
  const [msg, setMsg] = useState<Msg>(null);
  const [test, setTest] = useState<Msg>(null);
  const p = OPENAI_PRESETS.find((x) => x.id === preset);

  const save = async () => {
    setMsg(await put({ assistant: {
      provider,
      openai: { preset, baseUrl: baseUrl.trim(), model: model.trim(), ...(okey ? { apiKey: okey } : {}) },
      claude: { model: cmodel.trim(), ...(ckey ? { apiKey: ckey } : {}) },
      homeassistant: { agentId: agent.trim() || null },
      voice: { stt, tts, baseUrl: vurl.trim(), sttModel: sttModel.trim(), ttsModel: ttsModel.trim(), ttsVoice: ttsVoice.trim(), ...(vkey ? { apiKey: vkey } : {}) },
    } }));
    setOkey(''); setCkey(''); setVkey('');
  };
  const run = async () => { setTest({ ok: true, text: 'Asking…' }); try { const r = await api<{ ok: boolean; message: string }>('/api/assistant/test', { method: 'POST' }); setTest({ ok: r.ok, text: r.message }); } catch (e) { setTest({ ok: false, text: (e as Error).message }); } };
  const clear = (part: 'openai' | 'claude' | 'voice') => void put({ assistant: { [part]: { apiKey: '' } } }).then(setMsg);

  return (
    <section class="card" id="assistant">
      <h2>Assistant</h2>
      <p class="help">Who answers the voice button on the rail. WOPR’s calendar, gate codes and mailbox keep working whichever you pick. Your truck’s live state (speed, battery, place) goes with each question; WOPR’s private context never goes to another service.</p>
      <div class="form asst-choices">
        {CHOICES.map((c) => (
          <label class="f radio"><input type="radio" name="asst" checked={provider === c.id} onChange={() => setProvider(c.id)} /><span><b>{c.name}</b> <span class="help">{c.help}</span></span></label>
        ))}
      </div>

      {provider === 'claude' && (
        <div class="fields form">
          <Key label="Claude API key" set={a.claude.apiKey} value={ckey} onInput={setCkey} onClear={() => clear('claude')} />
          <label class="f"><span>Model</span><input type="text" value={cmodel} placeholder="claude-opus-5-5" onInput={(e) => setCmodel((e.target as HTMLInputElement).value)} /></label>
          <p class="help">claude-opus-5-5 is the most capable; claude-haiku-5-5 answers faster and costs far less. If Claude declines a question, it is retried on Anthropic’s recommended fallback model automatically.</p>
        </div>
      )}

      {provider === 'openai' && (
        <div class="fields form">
          <label class="f"><span>Service</span>
            <select value={preset} onChange={(e) => { const id = (e.target as HTMLSelectElement).value; setPreset(id); const np = OPENAI_PRESETS.find((x) => x.id === id); if (np && np.baseUrl) setBaseUrl(np.baseUrl); }}>
              {OPENAI_PRESETS.map((x) => <option value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <label class="f"><span>Address</span><input type="url" value={baseUrl} placeholder="https://…/v1" onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)} /></label>
          <label class="f"><span>Model</span><input type="text" value={model} placeholder="the model name, as the service lists it" onInput={(e) => setModel((e.target as HTMLInputElement).value)} /></label>
          <Key label={`API key${p?.needsKey ? '' : ' (if it needs one)'}`} set={a.openai.apiKey} value={okey} onInput={setOkey} onClear={() => clear('openai')} />
          {p && <p class="help">{p.note}{p.keyUrl && <> Get a key: <a href={p.keyUrl} target="_blank" rel="noreferrer">{new URL(p.keyUrl).host}</a>.</>}</p>}
        </div>
      )}

      {provider === 'homeassistant' && (
        <div class="fields form">
          <label class="f"><span>Conversation agent (optional)</span><input type="text" value={agent} placeholder="HA's default agent" onInput={(e) => setAgent((e.target as HTMLInputElement).value)} /></label>
          <p class="help">Leave empty for HA’s preferred agent, or give an agent id such as conversation.chatgpt. Works away from home only if your Home Assistant is reachable from the internet (Nabu Casa, or your own address).</p>
        </div>
      )}

      <h3>Voice</h3>
      <div class="fields form">
        <label class="f"><span>Hearing you (speech to text)</span>
          <select value={stt} onChange={(e) => setStt((e.target as HTMLSelectElement).value as typeof stt)}>
            <option value="wopr">Through WOPR (needs WOPR set up)</option>
            <option value="openai">An OpenAI-compatible speech service (OpenAI, Groq…)</option>
          </select>
        </label>
        <label class="f"><span>Speaking back</span>
          <select value={tts} onChange={(e) => setTts((e.target as HTMLSelectElement).value as typeof tts)}>
            <option value="wopr">Through WOPR</option>
            <option value="openai">An OpenAI-compatible speech service</option>
            <option value="tablet">The tablet’s own voice (free, works offline)</option>
          </select>
        </label>
        {(stt === 'openai' || tts === 'openai') && <>
          <label class="f"><span>Speech service address</span><input type="url" value={vurl} placeholder="https://api.openai.com/v1" onInput={(e) => setVurl((e.target as HTMLInputElement).value)} /></label>
          <Key label="Speech service API key" set={a.voice.apiKey} value={vkey} onInput={setVkey} onClear={() => clear('voice')} />
          {stt === 'openai' && <label class="f"><span>Speech-to-text model</span><input type="text" value={sttModel} placeholder="whisper-1 (OpenAI) or whisper-large-v3-turbo (Groq)" onInput={(e) => setSttModel((e.target as HTMLInputElement).value)} /></label>}
          {tts === 'openai' && <>
            <label class="f"><span>Text-to-speech model</span><input type="text" value={ttsModel} placeholder="tts-1" onInput={(e) => setTtsModel((e.target as HTMLInputElement).value)} /></label>
            <label class="f"><span>Voice</span><input type="text" value={ttsVoice} placeholder="alloy" onInput={(e) => setTtsVoice((e.target as HTMLInputElement).value)} /></label>
          </>}
        </>}
      </div>

      <div class="row wrap">
        <button class="btn primary" type="button" onClick={() => void save()}>Save assistant</button>
        <button class="btn" type="button" onClick={() => void run()}>Test</button>
        <Note m={msg} /><Note m={test} />
      </div>
    </section>
  );
}
