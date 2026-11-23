import { parseMultiple, parseResponse, type FsItem, type FsResponse, type FsValue } from './xml.ts';

export class FsapiError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'FsapiError';
    this.code = code;
  }
}

export interface FsapiOptions {
  host: string;
  pin: string;
  port?: number;
  timeoutMs?: number;
  /** Close the session after this long without requests, so other apps (UNDOK, Home Assistant) can connect. */
  idleCloseMs?: number;
  fetch?: typeof fetch;
}

/**
 * A client for one radio that keeps a single session open and sends one request at a time (the radios
 * misbehave when hit in parallel). Recreates the session when the radio forgets it and closes it politely
 * after a quiet period.
 */
export class FsapiClient {
  readonly #opts: Required<Omit<FsapiOptions, 'fetch'>> & { fetch: typeof fetch };
  #sid: string | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #idleTimer: NodeJS.Timeout | undefined;

  constructor(opts: FsapiOptions) {
    this.#opts = { port: 80, timeoutMs: 10_000, idleCloseMs: 60_000, fetch, ...opts };
  }

  get host(): string {
    return this.#opts.host;
  }

  /** Runs `task` after everything queued before it. */
  #serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(task, task);
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #http(path: string, params: Record<string, string | number | string[]> = {}, withSession = true): Promise<{ status: number; body: string }> {
    const url = new URL(`http://${this.#opts.host}:${this.#opts.port}/fsapi/${path}`);
    url.searchParams.set('pin', this.#opts.pin);
    if (withSession && this.#sid) url.searchParams.set('sid', this.#sid);
    for (const [k, v] of Object.entries(params)) for (const x of Array.isArray(v) ? v : [v]) url.searchParams.append(k, String(x));
    const res = await this.#opts.fetch(url, { signal: AbortSignal.timeout(this.#opts.timeoutMs) });
    return { status: res.status, body: await res.text() };
  }

  async #ensureSession(): Promise<void> {
    if (this.#sid) return;
    const { status, body } = await this.#http('CREATE_SESSION', {}, false);
    if (status === 403) throw new FsapiError('the radio refused the PIN', 'BAD_PIN');
    const sid = parseResponse(body).sessionId;
    if (!sid) throw new FsapiError('the radio did not open a session', 'NO_SESSION');
    this.#sid = sid;
  }

  #touch(): void {
    clearTimeout(this.#idleTimer);
    if (this.#opts.idleCloseMs > 0) {
      this.#idleTimer = setTimeout(() => void this.close(), this.#opts.idleCloseMs);
      this.#idleTimer.unref();
    }
  }

  /** One request with a single transparent retry on a lost session. */
  async #call(path: string, params: Record<string, string | number | string[]> = {}): Promise<{ status: number; body: string }> {
    await this.#ensureSession();
    let res = await this.#http(path, params);
    if (res.status === 404 || res.status === 403) {
      this.#sid = null;
      await this.#ensureSession();
      res = await this.#http(path, params);
    }
    this.#touch();
    return res;
  }

  #check(r: FsResponse, what: string): FsResponse {
    if (r.status !== 'FS_OK' && r.status !== 'FS_LIST_END') throw new FsapiError(`${what}: ${r.status}`, r.status);
    return r;
  }

  get(node: string): Promise<FsValue | undefined> {
    return this.#serial(async () => this.#check(parseResponse((await this.#call(`GET/${node}`)).body), `GET ${node}`).value);
  }

  set(node: string, value: number | string): Promise<void> {
    return this.#serial(async () => void this.#check(parseResponse((await this.#call(`SET/${node}`, { value })).body), `SET ${node}`));
  }

  /** Several nodes in one request; missing or unsupported nodes are simply absent from the result. */
  getMany(nodes: string[]): Promise<Record<string, FsValue>> {
    return this.#serial(async () => {
      const map = parseMultiple((await this.#call('GET_MULTIPLE', { node: nodes })).body);
      const out: Record<string, FsValue> = {};
      for (const [node, r] of map) if (r.status === 'FS_OK' && r.value !== undefined) out[node] = r.value;
      return out;
    });
  }

  /** Reads a whole list node; `blockedRetries` covers lists the radio is still loading. */
  list(node: string, blockedRetries = 6): Promise<FsItem[]> {
    return this.#serial(async () => {
      for (let attempt = 0; ; attempt++) {
        const items: FsItem[] = [];
        let start = -1;
        let blocked = false;
        for (let page = 0; page < 50; page++) {
          const r = parseResponse((await this.#call(`LIST_GET_NEXT/${node}/${start}`, { maxItems: 40 })).body);
          if (r.status === 'FS_NODE_BLOCKED') {
            blocked = true;
            break;
          }
          this.#check(r, `LIST ${node}`);
          items.push(...(r.items ?? []));
          if (r.listEnd || !r.items?.length) break;
          start = r.items[r.items.length - 1]!.key;
        }
        const loading = items.some((i) => i.fields['type'] === 255);
        if (!blocked && !loading) return items;
        if (attempt >= blockedRetries) throw new FsapiError(`${node} is still loading`, 'FS_NODE_BLOCKED');
        await new Promise((r) => setTimeout(r, 1000));
      }
    });
  }

  /** Pending change notifications from the radio (node names come back in lower case). */
  notifications(): Promise<{ node: string; value: FsValue | undefined }[]> {
    return this.#serial(async () => this.#check(parseResponse((await this.#call('GET_NOTIFIES')).body), 'GET_NOTIFIES').notifies ?? []);
  }

  /** Ends the session so the radio is free for other apps. Safe to call at any time. */
  close(): Promise<void> {
    clearTimeout(this.#idleTimer);
    return this.#serial(async () => {
      if (!this.#sid) return;
      try {
        await this.#http('DELETE_SESSION');
      } catch {
        /* the radio may already be gone */
      }
      this.#sid = null;
    });
  }
}
