import http from 'node:http';
import { FsapiFacade } from '@radioformer/fsapi';
import type { RadioManager } from './radios.ts';

export interface FacadeServerOptions {
  port: number;
  host: string;
  pin: string;
  radioId: number;
  /** Name apps see; empty means the radio's name plus "+". */
  name: string;
  manager: RadioManager;
  log: (msg: string) => void;
}

/**
 * Serves the radio's control interface (FSAPI) on its own port: apps such as Home Assistant or UNDOK are
 * pointed here instead of at the radio, and Radioformer keeps the only real session.
 */
export function startFacade(opts: FacadeServerOptions): { close(): Promise<void> } {
  const facade = new FsapiFacade({ upstream: () => opts.manager.get(opts.radioId)?.client ?? null, pin: opts.pin, friendlyName: opts.name });

  const refreshIdentity = async () => {
    try {
      const v = await opts.manager.get(opts.radioId)?.client.getMany(['netRemote.sys.info.friendlyName', 'netRemote.sys.info.version']);
      if (v) facade.learn(String(v['netRemote.sys.info.friendlyName'] ?? ''), String(v['netRemote.sys.info.version'] ?? ''));
    } catch {
      /* the radio may be off; try again later */
    }
  };
  const identityTimer = setInterval(() => void refreshIdentity(), 10 * 60_000);
  identityTimer.unref();
  void refreshIdentity();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    facade
      .handle({ path: url.pathname, query: url.searchParams, host: req.headers.host ?? `${opts.host}:${opts.port}` })
      .then((r) => {
        res.writeHead(r.status, { 'Content-Type': r.contentType, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
        res.end(r.body);
      })
      .catch(() => {
        res.writeHead(500).end();
      });
  });
  server.listen(opts.port, opts.host, () => opts.log(`radio control face listening on ${opts.host}:${opts.port} for radio ${opts.radioId}`));

  return {
    close: async () => {
      clearInterval(identityTimer);
      facade.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
