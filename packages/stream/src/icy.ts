import { Transform, type TransformCallback } from 'node:stream';
import type { TitleTransformer } from './transformers.ts';

const MAX_META = 255 * 16;

/** Replace only the `StreamTitle` value of an ICY metadata block; other fields (StreamUrl, ad markers) stay. */
export function rewriteMetaBlock(block: Buffer, transform: TitleTransformer): Buffer {
  const text = block.toString('utf8').replace(/\0+$/, '');
  let m = /StreamTitle='(.*?)';(?=\w+=|$)/s.exec(text);
  let tail = '';
  if (m) {
    tail = text.slice(m.index + m[0].length);
  } else {
    m = /StreamTitle='(.*)$/s.exec(text); // truncated block
    if (!m) return block;
  }
  const title = transform(m[1] ?? '').replaceAll("'", '’');
  let out = Buffer.from(`StreamTitle='${title}';${tail}`, 'utf8');
  if (out.length > MAX_META - 1) out = Buffer.from(`StreamTitle='${title}';`, 'utf8').subarray(0, MAX_META - 1);
  const pad = (16 - (out.length % 16)) % 16;
  return Buffer.concat([out, Buffer.alloc(pad)]);
}

export interface IcyOptions {
  /** `icy-metaint` of the upstream stream. */
  metaint: number;
  /** Does the client want metadata? If not, blocks are removed. */
  emitMeta: boolean;
  transform: TitleTransformer;
  /** Called with the cleaned title whenever it changes. */
  onTitle?: (title: string) => void;
}

/**
 * Stream transform that forwards audio untouched and rewrites (or drops) the ICY metadata blocks that
 * appear after every `metaint` bytes of audio.
 */
export class IcyRewriter extends Transform {
  readonly #opts: IcyOptions;
  #state: 'audio' | 'length' | 'meta' = 'audio';
  #remaining: number;
  #metaParts: Buffer[] = [];
  #lastTitle = '';

  constructor(opts: IcyOptions) {
    super();
    this.#opts = opts;
    this.#remaining = opts.metaint;
  }

  override _transform(chunk: Buffer, _enc: BufferEncoding, cb: TransformCallback): void {
    let pos = 0;
    while (pos < chunk.length) {
      if (this.#state === 'audio') {
        const n = Math.min(this.#remaining, chunk.length - pos);
        this.push(chunk.subarray(pos, pos + n));
        pos += n;
        this.#remaining -= n;
        if (this.#remaining === 0) this.#state = 'length';
      } else if (this.#state === 'length') {
        const blocks = chunk[pos++]!;
        if (blocks === 0) {
          if (this.#opts.emitMeta) this.push(Buffer.from([0]));
          this.#state = 'audio';
          this.#remaining = this.#opts.metaint;
        } else {
          this.#state = 'meta';
          this.#remaining = blocks * 16;
          this.#metaParts = [];
        }
      } else {
        const n = Math.min(this.#remaining, chunk.length - pos);
        this.#metaParts.push(chunk.subarray(pos, pos + n));
        pos += n;
        this.#remaining -= n;
        if (this.#remaining === 0) {
          this.#finishMeta(Buffer.concat(this.#metaParts));
          this.#state = 'audio';
          this.#remaining = this.#opts.metaint;
        }
      }
    }
    cb();
  }

  #finishMeta(block: Buffer): void {
    const rewritten = rewriteMetaBlock(block, this.#opts.transform);
    const title = /StreamTitle='(.*?)';/s.exec(rewritten.toString('utf8'))?.[1] ?? '';
    if (title !== this.#lastTitle) {
      this.#lastTitle = title;
      this.#opts.onTitle?.(title);
    }
    if (this.#opts.emitMeta) this.push(Buffer.concat([Buffer.from([rewritten.length / 16]), rewritten]));
  }
}
