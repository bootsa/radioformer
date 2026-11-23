import { randomInt } from 'node:crypto';
import { FsapiError, type FsapiClient } from './client.ts';
import { NAV, navFor } from './nav.ts';
import { parseMultiple } from './xml.ts';

export interface FacadeOptions {
  /** The one real connection to the radio (a getter, because the owner may rebuild it). */
  upstream: () => FsapiClient | null;
  /** PIN that apps must use to talk to the virtual radio. */
  pin: string;
  /** The name apps see. Default: the real radio's name followed by "+", so the two are never confused. */
  friendlyName?: string;
  version?: string;
  /** Virtual sessions idle for this long are dropped. */
  sessionTtlMs?: number;
  /** How long a read may be answered from memory. */
  cacheMs?: number;
  /** How often the real session is poked while someone is connected (it expires when idle). */
  keepAliveMs?: number;
  /** Changes picture addresses before apps see them (the radio's own addresses only resolve through its DNS). */
  rewriteUri?: (uri: string) => string;
}

export interface FacadeRequest {
  path: string; // e.g. "/fsapi/GET/netRemote.sys.power" or "/device"
  query: URLSearchParams;
  /** The Host header, so the answer can point back at the address the app used. */
  host: string;
}

export interface FacadeResponse {
  status: number;
  contentType: string;
  body: string;
}

interface Session {
  lastSeen: number;
  queue: { node: string; xml: string }[];
  waiters: Set<() => void>;
}

const XML = 'text/xml';
const NAME_NODE = 'netremote.sys.info.friendlyname';
const PICTURE_NODE = 'netremote.play.info.graphicuri';
const MODE_NODE = 'netremote.sys.mode';
const lower = (n: string) => n.toLowerCase();
const ok = (inner = ''): FacadeResponse => ({ status: 200, contentType: XML, body: `<fsapiResponse>\n<status>FS_OK</status>\n${inner}</fsapiResponse>\n` });
const status = (code: string): FacadeResponse => ({ status: 200, contentType: XML, body: `<fsapiResponse><status>${code}</status></fsapiResponse>\n` });
const text = (code: number, body = ''): FacadeResponse => ({ status: code, contentType: XML, body });
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The radio's limit for one GET_MULTIPLE (measured on a Roberts Stream 94i: nothing comes back above 9). */
const MAX_MULTIPLE = 8;

/**
 * The radio's control interface as seen by other apps. Radioformer owns the single real session; every app
 * that connects here gets its own virtual session, reads are shared, writes go through in order, and the
 * radio's change notifications are delivered to every app.
 */
export class FsapiFacade {
  readonly #o: Required<Omit<FacadeOptions, 'upstream'>> & { upstream: () => FsapiClient | null };
  readonly #sessions = new Map<string, Session>();
  readonly #cache = new Map<string, { xml: string; at: number }>();
  #loop = false;
  #sweeper: NodeJS.Timeout | undefined;
  #keepAlive: NodeJS.Timeout | undefined;
  #closed = false;
  #name = '';
  #version = '';

  constructor(opts: FacadeOptions) {
    this.#o = { friendlyName: '', version: 'radioformer', sessionTtlMs: 10 * 60_000, cacheMs: 1000, keepAliveMs: 10_000, rewriteUri: (u: string) => u, ...opts };
  }

  get sessionCount(): number {
    return this.#sessions.size;
  }

  async handle(req: FacadeRequest): Promise<FacadeResponse> {
    if (req.path === '/device') return this.#device(req.host);
    if (!req.path.startsWith('/fsapi/')) return text(404, '404 Error');
    const rest = req.path.slice('/fsapi/'.length);
    if (req.query.get('pin') !== this.#o.pin) return text(403);
    if (rest === 'CREATE_SESSION') return this.#create();
    const sid = req.query.get('sid') ?? '';
    const session = this.#sessions.get(sid);
    if (!session) return text(404, '404 Error');
    session.lastSeen = Date.now();
    const up = this.#o.upstream();
    if (rest === 'DELETE_SESSION') {
      this.#sessions.delete(sid);
      if (up) void navFor(up).forget(sid);
      this.#maybeStop();
      return ok();
    }
    if (!up) return status('FS_FAIL');
    try {
      const navResponse = await this.#nav(sid, up, rest, req.query);
      if (navResponse) return navResponse;
      if (rest === 'GET_NOTIFIES') return await this.#notifies(session);
      if (rest === 'GET_MULTIPLE') return await this.#multiple(up, req.query.getAll('node'));
      if (rest.startsWith('GET/')) return await this.#get(up, rest);
      if (rest.startsWith('SET/')) return await this.#set(up, rest, req.query);
      const params: Record<string, string> = {};
      for (const [k, v] of req.query) if (k !== 'pin' && k !== 'sid') params[k] = v;
      const r = await up.raw(rest, params); // LIST_GET_NEXT, LIST_GET and anything else, passed through
      return { status: r.status === 404 ? 200 : r.status, contentType: XML, body: r.status === 404 ? status('FS_FAIL').body : r.body };
    } catch (e) {
      return e instanceof FsapiError && e.code === 'FS_NODE_BLOCKED' ? status('FS_NODE_BLOCKED') : status('FS_TIMEOUT');
    }
  }

  /**
   * Menu commands. Each app has its own menu position; Radioformer puts the radio's menu back where the app
   * left it before running the app's command (see NavMultiplexer).
   */
  async #nav(sid: string, up: FsapiClient, rest: string, query: URLSearchParams): Promise<FacadeResponse | null> {
    const nav = navFor(up);
    const slash = rest.indexOf('/');
    const verb = slash === -1 ? rest : rest.slice(0, slash);
    const node = slash === -1 ? '' : rest.slice(slash + 1);
    const key = lower(node.split('/')[0] ?? '');
    try {
      if (verb === 'GET' && key === lower(NAV.state)) return ok(`<value><u8>${nav.isEnabled(sid) ? 1 : 0}</u8></value>\n`);
      if (verb === 'GET' && key === lower(NAV.numItems)) return this.#raw(await nav.run(sid, (c) => c.raw(rest)));
      if (verb === 'LIST_GET_NEXT' && (key === lower(NAV.list) || key === lower(NAV.presets))) {
        const params: Record<string, string> = {};
        for (const [k, v] of query) if (k !== 'pin' && k !== 'sid') params[k] = v;
        return this.#raw(await nav.run(sid, (c) => c.raw(rest, params)));
      }
      if (verb === 'SET') {
        const value = query.get('value') ?? '';
        if (key === lower(NAV.state)) {
          await (value === '0' ? nav.disable(sid) : nav.enable(sid));
          return ok();
        }
        if (key === lower(NAV.navigate)) {
          await nav.navigate(sid, Number(value));
          return ok();
        }
        if (key === lower(NAV.selectItem) || key === lower(NAV.selectPreset)) {
          await nav.run(sid, (c) => c.set(node, Number(value)));
          return ok();
        }
        if (key === MODE_NODE) {
          const r = await up.raw(rest, { value });
          this.#cache.clear();
          await nav.modeChanged();
          return this.#raw(r);
        }
      }
    } catch (e) {
      if (e instanceof FsapiError) return status(e.code === 'FS_NODE_BLOCKED' ? 'FS_NODE_BLOCKED' : 'FS_FAIL');
      throw e;
    }
    return null;
  }

  #picture(xml: string): string {
    return xml.replace(/<c8_array>([\s\S]*?)<\/c8_array>/, (_m, uri: string) => `<c8_array>${escapeXml(this.#o.rewriteUri(uri.replace(/&amp;/g, '&')))}</c8_array>`);
  }

  #raw(r: { status: number; body: string }): FacadeResponse {
    return r.status === 404 ? status('FS_FAIL') : { status: r.status, contentType: XML, body: r.body };
  }

  /** What apps are told the radio is called. */
  get virtualName(): string {
    return this.#virtualName;
  }

  get #virtualName(): string {
    return this.#o.friendlyName || (this.#name ? `${this.#name}+` : 'Radio+');
  }

  #device(host: string): FacadeResponse {
    return {
      status: 200,
      contentType: XML,
      body: `<netRemote>\n<friendlyName>${escapeXml(this.#virtualName)}</friendlyName>\n<version>${escapeXml(this.#version || this.#o.version)}</version>\n<webfsapi>http://${host}/fsapi</webfsapi>\n</netRemote>\n`,
    };
  }

  #create(): FacadeResponse {
    const sid = String(randomInt(100_000_000, 999_999_999));
    this.#sessions.set(sid, { lastSeen: Date.now(), queue: [], waiters: new Set() });
    this.#start();
    return ok(`<sessionId>${sid}</sessionId>\n`);
  }

  async #get(up: FsapiClient, rest: string): Promise<FacadeResponse> {
    const key = rest.slice(4).toLowerCase();
    if (key === NAME_NODE) return ok(`<value><c8_array>${escapeXml(this.#virtualName)}</c8_array></value>\n`);
    const hit = this.#cache.get(key);
    if (hit && Date.now() - hit.at < this.#o.cacheMs) return { status: 200, contentType: XML, body: hit.xml };
    const r = await up.raw(rest);
    if (r.status !== 200) return status('FS_FAIL');
    const body = key === PICTURE_NODE ? this.#picture(r.body) : r.body;
    this.#cache.set(key, { xml: body, at: Date.now() });
    return { status: 200, contentType: XML, body };
  }

  async #set(up: FsapiClient, rest: string, query: URLSearchParams): Promise<FacadeResponse> {
    if (rest.slice(4).toLowerCase() === NAME_NODE) return status('FS_FAIL'); // the radio's real name is not for apps to change
    const r = await up.raw(rest, { value: query.get('value') ?? '' });
    this.#cache.delete(rest.slice(4).toLowerCase());
    return r.status === 200 ? { status: 200, contentType: XML, body: r.body } : status('FS_FAIL');
  }

  /** Splits big batched reads into pieces the radio accepts and joins the answers. */
  async #multiple(up: FsapiClient, nodes: string[]): Promise<FacadeResponse> {
    const parts: string[] = [];
    for (let i = 0; i < nodes.length; i += MAX_MULTIPLE) {
      const r = await up.raw('GET_MULTIPLE', { node: nodes.slice(i, i + MAX_MULTIPLE) });
      for (const [node, resp] of parseMultiple(r.body)) {
        const m = new RegExp(`<fsapiResponse>(?:(?!</fsapiResponse>)[\\s\\S])*<node>${node.replace(/\./g, '\\.')}</node>[\\s\\S]*?</fsapiResponse>`).exec(r.body);
        const entry = m ? m[0] : null;
        if (entry && lower(node) === PICTURE_NODE) {
          parts.push(this.#picture(entry));
          continue;
        }
        if (entry && node.toLowerCase() === NAME_NODE) {
          parts.push(entry.replace(/<c8_array>[\s\S]*?<\/c8_array>/, `<c8_array>${escapeXml(this.#virtualName)}</c8_array>`));
          continue;
        }
        parts.push(m ? m[0] : `<fsapiResponse>\n<node>${node}</node>\n<status>${resp.status}</status>\n</fsapiResponse>`);
      }
    }
    return { status: 200, contentType: XML, body: `<fsapiGetMultipleResponse>\n<fsapiResponse>\n<status>FS_PACKET_BAD</status>\n</fsapiResponse>\n${parts.join('\n')}\n</fsapiGetMultipleResponse>\n` };
  }

  /** Hands out this session's pending changes; holds the request for a while when there are none. */
  async #notifies(session: Session): Promise<FacadeResponse> {
    if (session.queue.length === 0) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          session.waiters.delete(done);
          resolve();
        };
        const timer = setTimeout(done, 20_000);
        timer.unref();
        session.waiters.add(done);
      });
    }
    const items = session.queue.splice(0);
    if (items.length === 0) return status('FS_TIMEOUT');
    return ok(items.map((n) => n.xml).join(''));
  }

  // ---- shared work against the real radio ----

  #start(): void {
    if (this.#closed) return;
    this.#sweeper ??= setInterval(() => this.#sweep(), 30_000);
    this.#sweeper.unref();
    this.#keepAlive ??= setInterval(() => void this.#o.upstream()?.get('netRemote.sys.power').catch(() => {}), this.#o.keepAliveMs);
    this.#keepAlive.unref();
    if (!this.#loop) {
      this.#loop = true;
      void this.#notifyLoop();
    }
  }

  #maybeStop(): void {
    if (this.#sessions.size > 0) return;
    clearInterval(this.#sweeper);
    clearInterval(this.#keepAlive);
    this.#sweeper = this.#keepAlive = undefined;
  }

  #sweep(): void {
    const limit = Date.now() - this.#o.sessionTtlMs;
    for (const [sid, s] of this.#sessions) {
      if (s.lastSeen < limit) {
        this.#sessions.delete(sid);
        const up = this.#o.upstream();
        if (up) void navFor(up).forget(sid);
        for (const w of s.waiters) w();
      }
    }
    this.#maybeStop();
  }

  async #notifyLoop(): Promise<void> {
    while (!this.#closed && this.#sessions.size > 0) {
      const up = this.#o.upstream();
      if (!up) {
        await new Promise((r) => setTimeout(r, 2000).unref());
        continue;
      }
      try {
        const started = Date.now();
        const notes = await up.waitNotifications();
        for (const n of notes) this.#fanOut(n.node, n.value);
        // a radio that answers at once with nothing would make this a busy loop
        if (Date.now() - started < 300) await new Promise((r) => setTimeout(r, 500).unref());
      } catch {
        await new Promise((r) => setTimeout(r, 2000).unref());
      }
    }
    this.#loop = false;
  }

  #fanOut(node: string, value: number | string | undefined): void {
    this.#cache.delete(node.toLowerCase());
    if (node.toLowerCase() === 'netremote.sys.info.friendlyname' && typeof value === 'string') this.#name = value;
    const shown = typeof value === 'string' && lower(node) === PICTURE_NODE ? this.#o.rewriteUri(value) : value;
    const typed = shown === undefined ? '' : typeof shown === 'number' ? `<u32>${shown}</u32>` : `<c8_array>${escapeXml(shown)}</c8_array>`;
    const xml = `<notify node="${node}"><value>${typed}</value>\n</notify>\n`;
    for (const s of this.#sessions.values()) {
      s.queue.push({ node, xml });
      if (s.queue.length > 200) s.queue.shift();
      for (const w of s.waiters) w();
    }
  }

  /** Remembers the real radio's name and version for the `/device` answer. */
  learn(name: string, version: string): void {
    if (name) this.#name = name;
    if (version) this.#version = version;
  }

  close(): void {
    this.#closed = true;
    clearInterval(this.#sweeper);
    clearInterval(this.#keepAlive);
    for (const s of this.#sessions.values()) for (const w of s.waiters) w();
    this.#sessions.clear();
  }
}
