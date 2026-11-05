// MQTT link to the local Mosquitto. Never throws into the app: a missing
// broker is a status in /api/health, not a crash.
import mqtt, { type MqttClient } from 'mqtt';

export type MqttStatus = 'connected' | 'connecting' | 'disconnected' | 'disabled';

export class MqttLink {
  status: MqttStatus = 'disabled';
  lastError: string | null = null;
  private client: MqttClient | null = null;
  private subs = new Set<string>();
  private onMsg: (topic: string, payload: string) => void = () => {};
  private onUp: () => void = () => {};
  private loggedErr = '';

  private url: string;
  private statusTopic: string;

  constructor(url: string, statusTopic: string) { this.url = url; this.statusTopic = statusTopic; }

  start(onMessage: (topic: string, payload: string) => void, onConnect: () => void) {
    this.onMsg = onMessage;
    this.onUp = onConnect;
    this.status = 'connecting';
    try {
      this.client = mqtt.connect(this.url, {
        clientId: `slate-brain-${Math.random().toString(16).slice(2, 8)}`,
        reconnectPeriod: 5000,
        connectTimeout: 5000,
        queueQoSZero: false, // don't pile up state messages in RAM while the broker is away
        will: { topic: this.statusTopic, payload: Buffer.from('offline'), retain: true, qos: 1 },
      });
    } catch (e) {
      this.status = 'disconnected';
      this.lastError = (e as Error).message;
      console.warn(`[mqtt] ${this.url}: ${this.lastError}`);
      return;
    }
    const c = this.client;
    c.on('connect', () => {
      this.status = 'connected'; this.lastError = null; this.loggedErr = '';
      console.log(`[mqtt] connected to ${this.url}`);
      c.publish(this.statusTopic, 'online', { retain: true, qos: 1 });
      if (this.subs.size) c.subscribe([...this.subs], { qos: 0 });
      try { this.onUp(); } catch (e) { console.error('[mqtt] onConnect', e); }
    });
    c.on('reconnect', () => { this.status = 'connecting'; });
    c.on('close', () => {
      if (this.status === 'disabled') return;
      this.warnOnce(this.lastError ?? 'no broker answering');
      this.status = 'disconnected';
    });
    c.on('offline', () => { this.status = 'disconnected'; });
    c.on('error', (e) => {
      const code = (e as NodeJS.ErrnoException).code;
      this.lastError = e.message || code || 'connection failed';
      this.warnOnce(this.lastError);
    });
    c.on('message', (topic, buf) => {
      try { this.onMsg(topic, buf.toString('utf8')); } catch (e) { console.error(`[mqtt] handler for ${topic}`, e); }
    });
  }

  /** One line per outage, not one per retry. Reset when the broker answers. */
  private warnOnce(why: string) {
    if (this.loggedErr) return;
    this.loggedErr = why;
    console.warn(`[mqtt] ${this.url}: ${why}; retrying every 5 s (everything else keeps working)`);
  }

  get connected() { return this.status === 'connected'; }

  /** Replace the subscription set (truck id or HA entity changed). */
  setSubscriptions(topics: string[]) {
    const next = new Set(topics);
    const drop = [...this.subs].filter((t) => !next.has(t));
    const add = topics.filter((t) => !this.subs.has(t));
    this.subs = next;
    if (this.client && this.connected) {
      if (drop.length) this.client.unsubscribe(drop);
      if (add.length) this.client.subscribe(add, { qos: 0 });
    }
  }

  publish(topic: string, payload: string, opts: { retain?: boolean; qos?: 0 | 1 } = {}) {
    if (!this.client || !this.connected) return false;
    this.client.publish(topic, payload, { retain: opts.retain ?? false, qos: opts.qos ?? 0 });
    return true;
  }

  async stop(): Promise<void> {
    const c = this.client;
    if (!c) return;
    if (this.connected) await new Promise<void>((r) => c.publish(this.statusTopic, 'offline', { retain: true, qos: 1 }, () => r()));
    this.status = 'disabled';
    await new Promise<void>((r) => c.end(false, {}, () => r()));
  }
}
