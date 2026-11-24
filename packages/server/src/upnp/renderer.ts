import { randomUUID } from 'node:crypto';
import { httpRequest } from './http.ts';

/**
 * A UPnP/DLNA media renderer that stands in front of the radio's own renderer, so apps such as Music Assistant
 * talk to Radioformer and Radioformer keeps control of the radio. Playback commands are passed on to the radio's
 * renderer; the radio is switched to its music player first, and track details are left out because the radio's
 * renderer does not cope with them.
 */

const SERVICES = [
  { type: 'urn:schemas-upnp-org:service:AVTransport:1', id: 'urn:upnp-org:serviceId:AVTransport', dir: 'AVTransport' },
  { type: 'urn:schemas-upnp-org:service:ConnectionManager:1', id: 'urn:upnp-org:serviceId:ConnectionManager', dir: 'ConnectionManager' },
  { type: 'urn:schemas-upnp-org:service:RenderingControl:1', id: 'urn:upnp-org:serviceId:RenderingControl', dir: 'RenderingControl' },
] as const;
export type ServiceDir = (typeof SERVICES)[number]['dir'];

export const RENDERER_PREFIX = '/upnp';
const UPSTREAM_SUB_SECONDS = 300;
const DOWNSTREAM_SUB_SECONDS = 1800;

export interface RendererOptions {
  /** Address of the radio's own device description, e.g. http://192.168.222.223:8080/dd.xml. */
  upstream: () => string | null;
  uuid: string;
  /** Name apps see. */
  name: string;
  /** Address apps use to reach this face (used for the radio's event callbacks). Default: the Host header of the request. */
  publicBase?: string | undefined;
  /** Called before a new track is handed to the radio: switch it to its music player. */
  prepare?: (() => Promise<void>) | undefined;
  log?: (msg: string) => void;
  /** Tests make renewals quick. */
  renewMs?: number;
}

export interface FaceRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  host: string;
}
export interface FaceResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface Upstream {
  base: string;
  services: Map<ServiceDir, { control: string; event: string; scpd: string }>;
}

interface Subscriber {
  callbacks: string[];
  seq: number;
  expires: number;
}

interface EventState {
  upstreamSid: string | null;
  upstreamTimer: NodeJS.Timeout | null;
  lastBody: string | null;
  subs: Map<string, Subscriber>;
}

const xmlText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const header = (h: FaceRequest['headers'], name: string) => {
  const v = h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};
const xml = (status: number, body: string, contentType = 'text/xml; charset="utf-8"'): FaceResponse => ({ status, headers: { 'Content-Type': contentType }, body });
const empty = (status: number, headers: Record<string, string> = {}): FaceResponse => ({ status, headers, body: '' });

/** Takes the track details out of a request that sets a new address, leaving the address itself alone. */
export function blankTrackDetails(body: string): string {
  return body.replace(/(<(?:\w+:)?(?:Current|Next)URIMetaData\b[^>]*>)[\s\S]*?(<\/(?:\w+:)?(?:Current|Next)URIMetaData>)/g, '$1$2');
}

export function soapAction(h: FaceRequest['headers']): string {
  const raw = (header(h, 'soapaction') ?? '').replace(/"/g, '');
  return raw.split('#')[1] ?? '';
}

export function deviceDescription(opts: { uuid: string; name: string; modelName: string; manufacturer: string }): string {
  const services = SERVICES.map(
    (s) =>
      `<service><serviceType>${s.type}</serviceType><serviceId>${s.id}</serviceId><SCPDURL>${RENDERER_PREFIX}/${s.dir}/scpd.xml</SCPDURL><controlURL>${RENDERER_PREFIX}/${s.dir}/control</controlURL><eventSubURL>${RENDERER_PREFIX}/${s.dir}/event</eventSubURL></service>`,
  ).join('');
  return `<?xml version="1.0" encoding="utf-8"?>
<root xmlns="urn:schemas-upnp-org:device-1-0" xmlns:dlna="urn:schemas-dlna-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><device><deviceType>urn:schemas-upnp-org:device:MediaRenderer:1</deviceType><friendlyName>${xmlText(opts.name)}</friendlyName><manufacturer>${xmlText(opts.manufacturer)}</manufacturer><modelName>${xmlText(opts.modelName)}</modelName><modelDescription>Radioformer front door</modelDescription><UDN>uuid:${opts.uuid}</UDN><dlna:X_DLNADOC>DMR-1.50</dlna:X_DLNADOC><serviceList>${services}</serviceList></device></root>`;
}

export class RendererFace {
  readonly #opts: RendererOptions;
  #upstream: { at: number; value: Upstream } | null = null;
  readonly #scpd = new Map<string, { at: number; text: string }>();
  readonly #events = new Map<ServiceDir, EventState>();
  #base: string | undefined;
  #identity: { manufacturer: string; modelName: string } = { manufacturer: 'Roberts Radio Limited', modelName: 'Radioformer' };

  constructor(opts: RendererOptions) {
    this.#opts = opts;
    for (const s of SERVICES) this.#events.set(s.dir, { upstreamSid: null, upstreamTimer: null, lastBody: null, subs: new Map() });
  }

  #log(msg: string) {
    this.#opts.log?.(msg);
  }

  async #discover(): Promise<Upstream> {
    if (this.#upstream && Date.now() - this.#upstream.at < 10 * 60_000) return this.#upstream.value;
    const url = this.#opts.upstream();
    if (!url) throw new Error('the radio has no address yet');
    const res = await httpRequest(url);
    if (res.status !== 200) throw new Error(`the radio's description answered ${res.status}`);
    const services = new Map<ServiceDir, { control: string; event: string; scpd: string }>();
    for (const m of res.body.matchAll(/<service>([\s\S]*?)<\/service>/g)) {
      const block = m[1] ?? '';
      const type = /<serviceType>([^<]+)</.exec(block)?.[1] ?? '';
      const dir = SERVICES.find((s) => s.type === type)?.dir;
      const pick = (tag: string) => new URL(new RegExp(`<${tag}>([^<]*)<`).exec(block)?.[1] ?? '', url).toString();
      if (dir) services.set(dir, { control: pick('controlURL'), event: pick('eventSubURL'), scpd: pick('SCPDURL') });
    }
    this.#identity = {
      manufacturer: /<manufacturer>([^<]*)</.exec(res.body)?.[1] ?? this.#identity.manufacturer,
      modelName: /<modelName>([^<]*)</.exec(res.body)?.[1] ?? this.#identity.modelName,
    };
    const value = { base: url, services };
    this.#upstream = { at: Date.now(), value };
    return value;
  }

  async handle(req: FaceRequest): Promise<FaceResponse> {
    try {
      if (req.method === 'GET' && req.path === `${RENDERER_PREFIX}/desc.xml`) {
        await this.#discover().catch(() => undefined);
        return xml(200, deviceDescription({ uuid: this.#opts.uuid, name: this.#opts.name, ...this.#identity }));
      }
      const m = new RegExp(`^${RENDERER_PREFIX}/(AVTransport|ConnectionManager|RenderingControl)/(scpd\\.xml|control|event|notify)$`).exec(req.path);
      if (!m) return empty(404);
      const dir = m[1] as ServiceDir;
      switch (m[2]) {
        case 'scpd.xml':
          return await this.#scpdOf(dir);
        case 'control':
          return await this.#control(dir, req);
        case 'event':
          return await this.#subscription(dir, req);
        default:
          return this.#notified(dir, req);
      }
    } catch (e) {
      this.#log(`renderer face: ${String(e)}`);
      return empty(503);
    }
  }

  async #scpdOf(dir: ServiceDir): Promise<FaceResponse> {
    const cached = this.#scpd.get(dir);
    if (cached && Date.now() - cached.at < 3_600_000) return xml(200, cached.text);
    const up = await this.#discover();
    const res = await httpRequest(up.services.get(dir)?.scpd ?? '');
    if (res.status !== 200) return empty(503);
    this.#scpd.set(dir, { at: Date.now(), text: res.body });
    return xml(200, res.body);
  }

  async #control(dir: ServiceDir, req: FaceRequest): Promise<FaceResponse> {
    if (req.method !== 'POST') return empty(405);
    const up = await this.#discover();
    const target = up.services.get(dir)?.control;
    if (!target) return empty(404);
    const action = soapAction(req.headers);
    let body = req.body;
    if (dir === 'AVTransport' && (action === 'SetAVTransportURI' || action === 'SetNextAVTransportURI')) {
      body = blankTrackDetails(body);
      if (action === 'SetAVTransportURI' && this.#opts.prepare) {
        try {
          await this.#opts.prepare();
        } catch (e) {
          this.#log(`could not switch the radio to its music player: ${String(e)}`);
        }
      }
    }
    const res = await httpRequest(target, {
      method: 'POST',
      headers: { 'Content-Type': header(req.headers, 'content-type') ?? 'text/xml; charset="utf-8"', SOAPACTION: header(req.headers, 'soapaction') ?? '' },
      body,
      timeoutMs: 15_000,
    });
    return xml(res.status, res.body, String(res.headers['content-type'] ?? 'text/xml; charset="utf-8"'));
  }

  // ---- events: one subscription to the radio per service, shared by all apps ----

  #callbackBase(host: string): string {
    return (this.#opts.publicBase ?? this.#base ?? `http://${host}`).replace(/\/$/, '');
  }

  async #subscription(dir: ServiceDir, req: FaceRequest): Promise<FaceResponse> {
    const ev = this.#events.get(dir)!;
    const sid = header(req.headers, 'sid');
    if (req.method === 'UNSUBSCRIBE') {
      if (!sid || !ev.subs.delete(sid)) return empty(412);
      if (ev.subs.size === 0) void this.#dropUpstream(dir);
      return empty(200);
    }
    if (req.method !== 'SUBSCRIBE') return empty(405);
    const requested = Number(/Second-(\d+)/.exec(header(req.headers, 'timeout') ?? '')?.[1] ?? DOWNSTREAM_SUB_SECONDS);
    const seconds = Math.max(60, Math.min(requested || DOWNSTREAM_SUB_SECONDS, DOWNSTREAM_SUB_SECONDS));
    if (sid) {
      const sub = ev.subs.get(sid);
      if (!sub) return empty(412);
      sub.expires = Date.now() + seconds * 1000;
      return empty(200, { SID: sid, TIMEOUT: `Second-${seconds}` });
    }
    const callbacks = [...(header(req.headers, 'callback') ?? '').matchAll(/<([^>]+)>/g)].map((m) => m[1] ?? '').filter((c) => c.startsWith('http://'));
    if (callbacks.length === 0) return empty(412);
    if (!this.#opts.publicBase && !this.#base) this.#base = `http://${req.host}`;
    const newSid = `uuid:${randomUUID()}`;
    ev.subs.set(newSid, { callbacks, seq: 0, expires: Date.now() + seconds * 1000 });
    void this.#ensureUpstream(dir, req.host).catch((e) => this.#log(`could not subscribe to the radio's ${dir} events: ${String(e)}`));
    // the first event carries the full state: send what we last heard once the answer has gone out
    if (ev.lastBody !== null) setTimeout(() => void this.#deliver(dir, newSid), 20).unref();
    return empty(200, { SID: newSid, TIMEOUT: `Second-${seconds}` });
  }

  async #ensureUpstream(dir: ServiceDir, host: string): Promise<void> {
    const ev = this.#events.get(dir)!;
    if (ev.upstreamSid) return;
    const up = await this.#discover();
    const url = up.services.get(dir)?.event;
    if (!url) return;
    const res = await httpRequest(url, {
      method: 'SUBSCRIBE',
      headers: { CALLBACK: `<${this.#callbackBase(host)}${RENDERER_PREFIX}/${dir}/notify>`, NT: 'upnp:event', TIMEOUT: `Second-${UPSTREAM_SUB_SECONDS}` },
    });
    const sid = res.headers['sid'];
    if (res.status !== 200 || typeof sid !== 'string') throw new Error(`the radio answered ${res.status} to a subscription`);
    ev.upstreamSid = sid;
    ev.upstreamTimer = setInterval(() => void this.#renew(dir, host), this.#opts.renewMs ?? (UPSTREAM_SUB_SECONDS * 1000) / 2);
    ev.upstreamTimer.unref();
  }

  async #renew(dir: ServiceDir, host: string): Promise<void> {
    const ev = this.#events.get(dir)!;
    const now = Date.now();
    for (const [sid, sub] of ev.subs) if (sub.expires < now) ev.subs.delete(sid);
    if (ev.subs.size === 0) return void this.#dropUpstream(dir);
    try {
      const url = (await this.#discover()).services.get(dir)?.event ?? '';
      const res = await httpRequest(url, { method: 'SUBSCRIBE', headers: { SID: ev.upstreamSid ?? '', TIMEOUT: `Second-${UPSTREAM_SUB_SECONDS}` } });
      if (res.status === 200) return;
    } catch {
      /* fall through: start again */
    }
    await this.#dropUpstream(dir, false);
    await this.#ensureUpstream(dir, host).catch((e) => this.#log(`could not renew the radio's ${dir} events: ${String(e)}`));
  }

  async #dropUpstream(dir: ServiceDir, tell = true): Promise<void> {
    const ev = this.#events.get(dir)!;
    if (ev.upstreamTimer) clearInterval(ev.upstreamTimer);
    const sid = ev.upstreamSid;
    ev.upstreamTimer = null;
    ev.upstreamSid = null;
    if (sid && tell) {
      const url = this.#upstream?.value.services.get(dir)?.event;
      if (url) await httpRequest(url, { method: 'UNSUBSCRIBE', headers: { SID: sid } }).catch(() => undefined);
    }
    if (ev.subs.size === 0) ev.lastBody = null;
  }

  /** The radio announced a change: pass it on to every app that subscribed. */
  #notified(dir: ServiceDir, req: FaceRequest): FaceResponse {
    if (req.method !== 'NOTIFY') return empty(405);
    const ev = this.#events.get(dir)!;
    ev.lastBody = req.body;
    for (const sid of ev.subs.keys()) void this.#deliver(dir, sid);
    return empty(200);
  }

  async #deliver(dir: ServiceDir, sid: string): Promise<void> {
    const ev = this.#events.get(dir)!;
    const sub = ev.subs.get(sid);
    if (!sub || ev.lastBody === null) return;
    const seq = sub.seq++;
    for (const cb of sub.callbacks) {
      try {
        const res = await httpRequest(cb, {
          method: 'NOTIFY',
          headers: { 'Content-Type': 'text/xml; charset="utf-8"', NT: 'upnp:event', NTS: 'upnp:propchange', SID: sid, SEQ: String(seq) },
          body: ev.lastBody,
          timeoutMs: 5000,
        });
        if (res.status === 412) ev.subs.delete(sid); // the app no longer wants these
        return;
      } catch {
        /* try the next address */
      }
    }
    // nobody listens at any address: forget the subscription
    ev.subs.delete(sid);
  }

  async close(): Promise<void> {
    await Promise.all(SERVICES.map((s) => this.#dropUpstream(s.dir)));
    for (const ev of this.#events.values()) ev.subs.clear();
  }
}
