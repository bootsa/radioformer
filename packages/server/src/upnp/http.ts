import http from 'node:http';

export interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** A small request helper that allows any method (SUBSCRIBE, NOTIFY, ...), which `fetch` is not happy to send. */
export function httpRequest(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const body = opts.body === undefined ? undefined : Buffer.from(opts.body, 'utf8');
    const req = http.request(
      { host: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: opts.method ?? 'GET', headers: { ...(body ? { 'Content-Length': String(body.length) } : {}), ...opts.headers }, timeout: opts.timeoutMs ?? 8000 },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`timeout talking to ${u.host}`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
