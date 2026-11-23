import net from 'node:net';
import tls from 'node:tls';

export interface Upstream {
  socket: net.Socket;
  status: number;
  headers: Record<string, string>;
  /** Body bytes that arrived together with the headers. */
  rest: Buffer;
}

export interface OpenOptions {
  maxRedirects?: number;
  connectTimeoutMs?: number;
  headerTimeoutMs?: number;
  userAgent?: string;
  signal?: AbortSignal;
}

/**
 * Opens a stream with a hand-written HTTP/1.0 request. Node's own HTTP client rejects the `ICY 200 OK`
 * status line of old Shoutcast servers; HTTP/1.0 also keeps servers from using chunked encoding.
 */
export async function openUpstream(url: string, opts: OpenOptions = {}): Promise<Upstream> {
  const max = opts.maxRedirects ?? 3;
  let current = url;
  for (let i = 0; i <= max; i++) {
    const res = await request(current, opts);
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers['location']) {
      res.socket.destroy();
      current = new URL(res.headers['location'], current).toString();
      continue;
    }
    if (res.status !== 200) {
      res.socket.destroy();
      throw new Error(`upstream status ${res.status}`);
    }
    return res;
  }
  throw new Error('too many redirects');
}

function request(rawUrl: string, opts: OpenOptions): Promise<Upstream> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return Promise.reject(new Error('unsupported scheme'));
  const secure = url.protocol === 'https:';
  const port = Number(url.port) || (secure ? 443 : 80);
  return new Promise((resolve, reject) => {
    const socket: net.Socket = secure
      ? tls.connect({ host: url.hostname, port, servername: url.hostname })
      : net.connect({ host: url.hostname, port });
    let buf = Buffer.alloc(0);
    const connectTimer = setTimeout(() => fail(new Error('connect timeout')), opts.connectTimeoutMs ?? 10_000);
    let headerTimer: NodeJS.Timeout | undefined;
    const fail = (err: Error) => {
      clearTimeout(connectTimer);
      clearTimeout(headerTimer);
      socket.destroy();
      reject(err);
    };
    opts.signal?.addEventListener('abort', () => fail(new Error('aborted')), { once: true });
    socket.once('error', fail);
    socket.once(secure ? 'secureConnect' : 'connect', () => {
      clearTimeout(connectTimer);
      headerTimer = setTimeout(() => fail(new Error('header timeout')), opts.headerTimeoutMs ?? 10_000);
      socket.write(
        `GET ${url.pathname || '/'}${url.search} HTTP/1.0\r\nHost: ${url.host}\r\nIcy-MetaData: 1\r\n` +
          `User-Agent: ${opts.userAgent ?? 'radioformer/0'}\r\nAccept: */*\r\nConnection: close\r\n\r\n`,
      );
    });
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      const end = buf.indexOf('\r\n\r\n');
      if (end === -1) {
        if (buf.length > 16_384) fail(new Error('headers too large'));
        return;
      }
      socket.off('data', onData);
      socket.off('error', fail);
      clearTimeout(headerTimer);
      const [statusLine = '', ...lines] = buf.subarray(0, end).toString('latin1').split('\r\n');
      const status = Number(statusLine.split(' ')[1]);
      const headers: Record<string, string> = {};
      for (const l of lines) {
        const i = l.indexOf(':');
        if (i > 0) headers[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
      }
      socket.pause();
      resolve({ socket, status, headers, rest: buf.subarray(end + 4) });
    };
    socket.on('data', onData);
  });
}
