import http from 'node:http';
import type { RadioManager } from '../radios.ts';
import { RendererFace } from './renderer.ts';

export interface UpnpFaceOptions {
  port: number;
  host: string;
  radioId: number;
  uuid: string;
  /** Name apps see (empty: the radio's name plus "+"). */
  name: string;
  /** Pattern for the label of the mode that plays streams sent by apps. */
  modePattern: RegExp;
  publicBase?: string | undefined;
  manager: RadioManager;
  /** The radio's own renderer, e.g. http://192.168.222.223:8080/dd.xml (default: derived from the radio's address). */
  upstreamUrl?: string | undefined;
  radioHost: () => string | null;
  log: (msg: string) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Puts the radio in the mode that plays what apps send, and waits until it has got there. */
export async function switchToPlayerMode(manager: RadioManager, radioId: number, pattern: RegExp, log: (m: string) => void): Promise<void> {
  const control = manager.get(radioId);
  if (!control) return;
  let status = await control.status();
  if (!status.power) {
    log('upnp: turning the radio on for a cast');
    await control.setPower(true);
  }
  const target = (await control.modes()).find((m) => pattern.test(m.label));
  if (!target) throw new Error(`no mode matches ${String(pattern)}`);
  if (status.mode?.key === target.key) return;
  log(`upnp: switching the radio to ${target.label}`);
  await control.setMode(target.key);
  for (let i = 0; i < 12; i++) {
    await sleep(500);
    status = await control.status();
    if (status.mode?.key === target.key) return;
  }
  throw new Error(`the radio did not switch to ${target.label}`);
}

export function startUpnpFace(opts: UpnpFaceOptions): { close(): Promise<void> } {
  const face = new RendererFace({
    upstream: () => {
      if (opts.upstreamUrl) return opts.upstreamUrl;
      const h = opts.radioHost()?.split(':')[0];
      return h ? `http://${h}:8080/dd.xml` : null;
    },
    uuid: opts.uuid,
    name: opts.name,
    publicBase: opts.publicBase,
    prepare: () => switchToPlayerMode(opts.manager, opts.radioId, opts.modePattern, opts.log),
    log: opts.log,
  });
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x');
      face
        .handle({ method: req.method ?? 'GET', path: url.pathname, headers: req.headers, body: Buffer.concat(chunks).toString('utf8'), host: req.headers.host ?? `${opts.host}:${opts.port}` })
        .then((r) => {
          res.writeHead(r.status, { ...r.headers, 'Content-Length': Buffer.byteLength(r.body), Server: 'FOS/1.0 UPnP/1.0 Radioformer/0.1' });
          res.end(r.body);
        })
        .catch(() => res.writeHead(500).end());
    });
  });
  server.listen(opts.port, opts.host, () => opts.log(`upnp renderer face listening on ${opts.host}:${opts.port} for radio ${opts.radioId}`));
  return {
    close: async () => {
      await face.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
