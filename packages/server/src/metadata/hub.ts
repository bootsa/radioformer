import type { NowPlaying } from '@radioformer/core';
import { fetchRadioFrance } from './radiofrance.ts';

export interface MetadataProvider {
  fetch(ref: string): Promise<NowPlaying>;
}

export interface Lease {
  current(): NowPlaying | null;
  release(): void;
}

export interface HubOptions {
  providers?: Record<string, MetadataProvider>;
  /** How often a feed is polled while someone is listening. */
  intervalMs?: number;
  /** How long a one-off lookup (the API) may be served from cache. */
  cacheMs?: number;
  log?: (msg: string) => void;
}

const DEFAULT_PROVIDERS: Record<string, MetadataProvider> = { radiofrance: { fetch: (ref) => fetchRadioFrance(ref) } };

interface Entry {
  latest: NowPlaying | null;
  refs: number;
  timer: NodeJS.Timeout | undefined;
  inflight: Promise<void> | null;
  at: number;
}

/**
 * Shared polling of "now playing" feeds: one request per feed no matter how many radios listen, and only
 * while somebody does.
 */
export class MetadataHub {
  readonly #providers: Record<string, MetadataProvider>;
  readonly #intervalMs: number;
  readonly #cacheMs: number;
  readonly #log: (msg: string) => void;
  readonly #entries = new Map<string, Entry>();

  constructor(opts: HubOptions = {}) {
    this.#providers = opts.providers ?? DEFAULT_PROVIDERS;
    this.#intervalMs = opts.intervalMs ?? 15_000;
    this.#cacheMs = opts.cacheMs ?? 10_000;
    this.#log = opts.log ?? (() => {});
  }

  #provider(source: string): { provider: MetadataProvider; ref: string } | null {
    const i = source.indexOf(':');
    const provider = i > 0 ? this.#providers[source.slice(0, i)] : undefined;
    return provider ? { provider, ref: source.slice(i + 1) } : null;
  }

  #refresh(source: string, e: Entry): Promise<void> {
    const p = this.#provider(source);
    if (!p) return Promise.resolve();
    e.inflight ??= p.provider
      .fetch(p.ref)
      .then((np) => {
        e.latest = np;
        e.at = Date.now();
      })
      .catch((err: unknown) => this.#log(`metadata ${source}: ${String(err)}`))
      .finally(() => {
        e.inflight = null;
      });
    return e.inflight;
  }

  #entry(source: string): Entry {
    let e = this.#entries.get(source);
    if (!e) {
      e = { latest: null, refs: 0, timer: undefined, inflight: null, at: 0 };
      this.#entries.set(source, e);
    }
    return e;
  }

  /** Is there a provider for this source (`provider:ref`)? */
  knows(source: string): boolean {
    return this.#provider(source) !== null;
  }

  /** Starts (or joins) polling a feed. The first lookup is awaited for up to `waitMs`. Null for unknown sources. */
  async acquire(source: string, waitMs = 3000): Promise<Lease | null> {
    if (!this.#provider(source)) return null;
    const e = this.#entry(source);
    e.refs++;
    if (e.refs === 1) {
      e.timer = setInterval(() => void this.#refresh(source, e), this.#intervalMs);
      e.timer.unref();
    }
    if (!e.latest) await Promise.race([this.#refresh(source, e), new Promise((r) => setTimeout(r, waitMs).unref())]);
    let released = false;
    return {
      current: () => e.latest,
      release: () => {
        if (released) return;
        released = true;
        if (--e.refs === 0) {
          clearInterval(e.timer);
          e.timer = undefined;
        }
      },
    };
  }

  /** A single lookup for the API, cached briefly. */
  async peek(source: string): Promise<NowPlaying | null> {
    if (!this.#provider(source)) return null;
    const e = this.#entry(source);
    if (!e.latest || Date.now() - e.at > this.#cacheMs) await this.#refresh(source, e);
    return e.latest;
  }

  close(): void {
    for (const e of this.#entries.values()) clearInterval(e.timer);
    this.#entries.clear();
  }
}
