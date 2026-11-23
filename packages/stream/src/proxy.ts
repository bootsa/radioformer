import type { Duplex, Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { IcyRewriter } from './icy.ts';
import { getTransformer } from './transformers.ts';
import { openUpstream, type OpenOptions } from './upstream.ts';

export interface StreamRequest {
  url: string;
  /** Transformer id from `transformers`. */
  transformer: string;
  /** The client sent `Icy-MetaData: 1`. */
  wantMeta: boolean;
  signal?: AbortSignal;
  open?: OpenOptions;
  onTitle?: (title: string) => void;
}

export interface StreamResult {
  contentType: string;
  /** Present only if the client asked for metadata and the upstream provides it. */
  metaint: number | null;
  name: string;
  /** Pipes the audio into `out`; resolves when either side ends. */
  pump(out: Writable): Promise<void>;
  close(): void;
}

/** Connects upstream and returns headers for the client plus a `pump` that forwards the audio. */
export async function connectStream(req: StreamRequest): Promise<StreamResult> {
  const up = await openUpstream(req.url, { ...req.open, ...(req.signal ? { signal: req.signal } : {}) });
  const metaint = Number(up.headers['icy-metaint'] ?? 0) || 0;
  const source: Readable = up.socket;
  if (up.rest.length > 0) source.unshift(up.rest);
  const rewriter: Duplex | null =
    metaint > 0
      ? new IcyRewriter({
          metaint,
          emitMeta: req.wantMeta,
          transform: getTransformer(req.transformer),
          ...(req.onTitle ? { onTitle: req.onTitle } : {}),
        })
      : null;
  return {
    contentType: up.headers['content-type'] ?? 'audio/mpeg',
    metaint: rewriter && req.wantMeta ? metaint : null,
    name: up.headers['icy-name'] ?? '',
    async pump(out) {
      source.resume();
      try {
        if (rewriter) await pipeline(source, rewriter, out);
        else await pipeline(source, out);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ERR_STREAM_PREMATURE_CLOSE' && code !== 'ECONNRESET' && code !== 'EPIPE') throw err;
      }
    },
    close: () => up.socket.destroy(),
  };
}
