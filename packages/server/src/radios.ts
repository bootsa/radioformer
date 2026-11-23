import { RadioControl, type RadioStatus } from '@radioformer/fsapi';
import type { SqliteLibrary } from './library.ts';

/** Keeps one `RadioControl` (one polite session) per radio and rebuilds it when the settings change. */
export class RadioManager {
  readonly #library: SqliteLibrary;
  readonly #controls = new Map<number, { key: string; control: RadioControl }>();

  constructor(library: SqliteLibrary) {
    this.#library = library;
  }

  /** The control for a radio, or null when the radio is unknown or has no address yet. */
  get(id: number): RadioControl | null {
    const radio = this.#library.getRadio(id);
    if (!radio || !radio.host) return null;
    const key = `${radio.host}|${radio.pin}`;
    const existing = this.#controls.get(id);
    if (existing?.key === key) return existing.control;
    void existing?.control.close();
    const [host = '', port] = radio.host.split(':');
    const control = new RadioControl({ host, pin: radio.pin, idleCloseMs: 45_000, ...(port ? { port: Number(port) } : {}) });
    this.#controls.set(id, { key, control });
    return control;
  }

  readonly #watchers = new Map<number, { subs: Set<(e: { status?: RadioStatus; error?: string }) => void>; timer: NodeJS.Timeout; last: string }>();

  /** Streams status changes while at least one listener is subscribed (polls the radio every 2 seconds). */
  subscribe(id: number, cb: (e: { status?: RadioStatus; error?: string }) => void): () => void {
    let w = this.#watchers.get(id);
    if (!w) {
      const watcher = { subs: new Set<typeof cb>(), last: '', timer: undefined as unknown as NodeJS.Timeout };
      const tick = async () => {
        const control = this.get(id);
        if (!control) return;
        try {
          const status = await control.status();
          const json = JSON.stringify(status);
          if (json === watcher.last) return;
          watcher.last = json;
          for (const s of watcher.subs) s({ status });
        } catch (err) {
          const msg = (err as Error).message;
          if (msg !== watcher.last) {
            watcher.last = msg;
            for (const s of watcher.subs) s({ error: msg });
          }
        }
      };
      watcher.timer = setInterval(() => void tick(), 2000);
      watcher.timer.unref();
      void tick();
      w = watcher;
      this.#watchers.set(id, w);
    } else if (w.last) {
      // a new listener gets the latest known state straight away
      try {
        cb({ status: JSON.parse(w.last) as RadioStatus });
      } catch {
        cb({ error: w.last });
      }
    }
    w.subs.add(cb);
    return () => {
      w.subs.delete(cb);
      if (w.subs.size === 0) {
        clearInterval(w.timer);
        this.#watchers.delete(id);
      }
    };
  }

  async closeAll(): Promise<void> {
    for (const w of this.#watchers.values()) clearInterval(w.timer);
    this.#watchers.clear();
    await Promise.all([...this.#controls.values()].map((c) => c.control.close()));
    this.#controls.clear();
  }
}
