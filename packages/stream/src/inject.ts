import { Transform, type TransformCallback } from 'node:stream';

const MAX_META = 255 * 16;

export interface InjectOptions {
  /** Audio bytes between metadata blocks. */
  metaint: number;
  /** The title to announce; called at every block, so it may change over time. */
  getTitle: () => string;
}

/**
 * Adds ICY metadata to a stream that has none: after every `metaint` audio bytes a block is written, empty
 * when the title is unchanged since the last block. Used for stations whose title comes from another feed.
 */
export class IcyInjector extends Transform {
  readonly #opts: InjectOptions;
  #remaining: number;
  #sent: string | null = null;

  constructor(opts: InjectOptions) {
    super();
    this.#opts = opts;
    this.#remaining = opts.metaint;
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    let pos = 0;
    while (pos < chunk.length) {
      const n = Math.min(this.#remaining, chunk.length - pos);
      this.push(chunk.subarray(pos, pos + n));
      pos += n;
      this.#remaining -= n;
      if (this.#remaining === 0) {
        this.push(this.#block());
        this.#remaining = this.#opts.metaint;
      }
    }
    cb();
  }

  #block(): Buffer {
    const title = this.#opts.getTitle();
    if (title === this.#sent) return Buffer.from([0]);
    this.#sent = title;
    let body = Buffer.from(`StreamTitle='${title.replaceAll("'", '’')}';`, 'utf8');
    if (body.length > MAX_META) body = body.subarray(0, MAX_META);
    const pad = (16 - (body.length % 16)) % 16;
    return Buffer.concat([Buffer.from([(body.length + pad) / 16]), body, Buffer.alloc(pad)]);
  }
}
