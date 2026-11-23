import { FsapiError, type FsapiClient } from './client.ts';
import type { FsItem } from './xml.ts';

export const NAV = {
  state: 'netRemote.nav.state',
  navigate: 'netRemote.nav.action.navigate',
  selectItem: 'netRemote.nav.action.selectItem',
  selectPreset: 'netRemote.nav.action.selectPreset',
  list: 'netRemote.nav.list',
  presets: 'netRemote.nav.presets',
  numItems: 'netRemote.nav.numItems',
} as const;

/** "Go to the parent folder", as the radios define it. */
export const NAV_PARENT = 0xffffffff;

export interface RetryOptions {
  /** How many times a menu command that the radio reports as "blocked" is tried. */
  tries?: number;
  delayMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The radio answers menu commands with FS_NODE_BLOCKED while it is still loading the menu, for example just
 * after a mode switch or the first time the menu is opened. Waiting a moment and trying again works.
 */
export async function whenReady<T>(fn: () => Promise<T>, retry: Required<RetryOptions>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof FsapiError) || e.code !== 'FS_NODE_BLOCKED' || attempt >= retry.tries) throw e;
      await sleep(retry.delayMs);
    }
  }
}

interface Context {
  enabled: boolean;
  path: number[];
}

/**
 * The radio keeps one menu position per session, but several apps (the web page, Home Assistant, UNDOK) share
 * Radioformer's single real session. This keeps a menu position for each app and, before an app's menu
 * command, puts the radio's menu back where that app left it.
 */
export class NavMultiplexer {
  readonly #client: FsapiClient;
  readonly #retry: Required<RetryOptions>;
  readonly #contexts = new Map<string, Context>();
  #current: string | null = null;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(client: FsapiClient, retry: RetryOptions = {}) {
    this.#client = client;
    this.#retry = { tries: 8, delayMs: 700, ...retry };
  }

  #ctx(owner: string): Context {
    let c = this.#contexts.get(owner);
    if (!c) {
      c = { enabled: false, path: [] };
      this.#contexts.set(owner, c);
    }
    return c;
  }

  #lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(fn, fn);
    this.#tail = run.catch(() => undefined);
    return run;
  }

  #set(node: string, value: number): Promise<void> {
    return whenReady(() => this.#client.set(node, value), this.#retry);
  }

  /** Makes the radio's menu match this app's: from the root, down the folders the app has entered. */
  async #sync(owner: string): Promise<void> {
    if (this.#current === owner) return;
    const ctx = this.#ctx(owner);
    this.#current = null;
    await this.#set(NAV.state, 0);
    if (ctx.enabled) {
      await this.#set(NAV.state, 1);
      for (const key of ctx.path) await this.#set(NAV.navigate, key);
    }
    this.#current = owner;
  }

  isEnabled(owner: string): boolean {
    return this.#contexts.get(owner)?.enabled ?? false;
  }

  path(owner: string): readonly number[] {
    return this.#ctx(owner).path;
  }

  /** The app turns the menu browser on (at the root). */
  enable(owner: string): Promise<void> {
    return this.#lock(async () => {
      const ctx = this.#ctx(owner);
      if (!ctx.enabled) {
        ctx.enabled = true;
        ctx.path = [];
        this.#current = null; // the radio's own state is unknown: start from the root
      }
      await this.#sync(owner); // already on and current: nothing to do; on but displaced: restore its place
    });
  }

  /** The app turns the menu browser off. */
  disable(owner: string): Promise<void> {
    return this.#lock(async () => {
      const ctx = this.#ctx(owner);
      ctx.enabled = false;
      ctx.path = [];
      if (this.#current === owner) await this.#set(NAV.state, 0);
    });
  }

  /** Enter a folder (a key) or go up (`NAV_PARENT`) in this app's menu. */
  navigate(owner: string, key: number): Promise<void> {
    return this.#lock(async () => {
      const ctx = this.#ctx(owner);
      if (!ctx.enabled) throw new FsapiError('the menu browser is not on', 'FS_FAIL');
      await this.#sync(owner);
      await this.#set(NAV.navigate, key);
      if (key === NAV_PARENT) ctx.path.pop();
      else ctx.path.push(key);
    });
  }

  /** Runs a menu read or command in this app's menu position. */
  run<T>(owner: string, fn: (client: FsapiClient) => Promise<T>): Promise<T> {
    return this.#lock(async () => {
      if (!this.#ctx(owner).enabled) throw new FsapiError('the menu browser is not on', 'FS_FAIL');
      await this.#sync(owner);
      return whenReady(() => fn(this.#client), this.#retry);
    });
  }

  /** The radio changed source: every app's menu starts again from nothing. */
  modeChanged(): Promise<void> {
    return this.#lock(async () => {
      for (const c of this.#contexts.values()) {
        c.enabled = false;
        c.path = [];
      }
      this.#current = null;
    });
  }

  /** An app went away. */
  forget(owner: string): Promise<void> {
    return this.#lock(async () => {
      this.#contexts.delete(owner);
      if (this.#current === owner) this.#current = null;
    });
  }
}

const registry = new WeakMap<FsapiClient, NavMultiplexer>();

/** The one multiplexer of a client, shared by everything that uses that radio session. */
export function navFor(client: FsapiClient, retry?: RetryOptions): NavMultiplexer {
  let nav = registry.get(client);
  if (!nav) {
    nav = new NavMultiplexer(client, retry);
    registry.set(client, nav);
  }
  return nav;
}

export type { FsItem };
