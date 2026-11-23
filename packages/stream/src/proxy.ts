import type { Duplex, Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { IcyRewriter } from './icy.ts';
import { IcyInjector } from './inject.ts';
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
  /**
   * Take the title from elsewhere (e.g. a broadcaster's "now playing" feed) instead of the stream's own
   * metadata. Metadata the stream carries is dropped; blocks are generated for clients that ask for them.
   */
  titleSource?: () => string;
}

const INJECT_METAINT = 16_000;

export interface StreamResult {
  contentType: string;
  /** Present only if the client asked for metadata and the upstream provides it. */
  metaint: number | null;
  name: string;
  /** Pipes the audio into `out`; resolves when either side ends. */
  pump(out: Writable): Promise<void>;
  close(): void;
}

const PLAYLIST_TYPES = /mpegurl|scpls|x-pls|audio\/m3u/i;

function isPlaylist(url: string, contentType: string | undefined): boolean {
  if (contentType && PLAYLIST_TYPES.test(contentType)) return true;
  return /\.(m3u|pls)(\?|$)/i.test(new URL(url).pathname + new URL(url).search);
}

async function readSmallBody(socket: Readable, first: Buffer, max = 65_536): Promise<string> {
  const parts: Buffer[] = [first];
  let size = first.length;
  socket.resume();
  for await (const chunk of socket as AsyncIterable<Buffer>) {
    parts.push(chunk);
    size += chunk.length;
    if (size > max) break;
  }
  return Buffer.concat(parts).toString('utf8');
}

/** First stream address in an M3U or PLS playlist (relative entries are resolved against `base`). */
export function parsePlaylist(text: string, base: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const m = /^(?:File\d+=)?(.+)$/i.exec(line);
    if (!m || line.startsWith('#') || line.startsWith('[') || /^(NumberOfEntries|Version|Title\d+|Length\d+)=/i.test(line)) continue;
    try {
      const u = new URL(m[1]!.trim(), base);
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
    } catch {
      /* not a URL, try the next line */
    }
  }
  return null;
}

/** Connects upstream and returns headers for the client plus a `pump` that forwards the audio. */
export async function connectStream(req: StreamRequest, depth = 0): Promise<StreamResult> {
  const up = await openUpstream(req.url, { ...req.open, ...(req.signal ? { signal: req.signal } : {}) });
  if (isPlaylist(req.url, up.headers['content-type'])) {
    if (depth >= 2) {
      up.socket.destroy();
      throw new Error('playlist inside playlist');
    }
    const target = parsePlaylist(await readSmallBody(up.socket, up.rest), req.url);
    up.socket.destroy();
    if (!target) throw new Error('playlist without a stream address');
    return connectStream({ ...req, url: target }, depth + 1);
  }
  const metaint = Number(up.headers['icy-metaint'] ?? 0) || 0;
  const source: Readable = up.socket;
  if (up.rest.length > 0) source.unshift(up.rest);
  const stages: Duplex[] = [];
  if (req.titleSource) {
    // strip whatever the stream carries, then announce the external title
    if (metaint > 0) stages.push(new IcyRewriter({ metaint, emitMeta: false, transform: getTransformer('none') }));
    if (req.wantMeta) stages.push(new IcyInjector({ metaint: INJECT_METAINT, getTitle: req.titleSource }));
  } else if (metaint > 0) {
    stages.push(
      new IcyRewriter({
        metaint,
        emitMeta: req.wantMeta,
        transform: getTransformer(req.transformer),
        ...(req.onTitle ? { onTitle: req.onTitle } : {}),
      }),
    );
  }
  const announcedMetaint = req.titleSource ? (req.wantMeta ? INJECT_METAINT : null) : metaint > 0 && req.wantMeta ? metaint : null;
  return {
    contentType: up.headers['content-type'] ?? 'audio/mpeg',
    metaint: announcedMetaint,
    name: up.headers['icy-name'] ?? '',
    async pump(out) {
      source.resume();
      try {
        await pipeline(source, ...stages, out);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'ERR_STREAM_PREMATURE_CLOSE' && code !== 'ECONNRESET' && code !== 'EPIPE') throw err;
      }
    },
    close: () => up.socket.destroy(),
  };
}
