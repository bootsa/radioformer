import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { APP_NAME, Station } from '@radioformer/core';
import { handleXml } from '@radioformer/protocol-xml';
import { connectStream } from '@radioformer/stream';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import type { Config } from './config.ts';
import { convertRadioApi } from './import-radioapi.ts';
import { NewStation, type SqliteLibrary } from './library.ts';
import { assertPublicUpstream } from './net-guard.ts';

export const VERSION = '0.1.0';

const DEFAULT_LOGO = readFileSync(new URL('../assets/default.png', import.meta.url));

type AppConfig = Pick<Config, 'WEB_DIR' | 'LOG_LEVEL' | 'ADMIN_TOKEN' | 'PUBLIC_URL' | 'ALLOW_PRIVATE_UPSTREAMS' | 'MAX_STREAMS'>;

function baseUrl(req: FastifyRequest, config: AppConfig): string {
  if (config.PUBLIC_URL) return config.PUBLIC_URL.replace(/\/$/, '');
  return `http://${req.headers.host ?? 'localhost'}`;
}

function isAdmin(req: FastifyRequest, token: string | undefined): boolean {
  if (!token) return false;
  const given = Buffer.from((req.headers.authorization ?? '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function buildApp(config: AppConfig, library: SqliteLibrary): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.LOG_LEVEL === 'silent' ? false : { level: config.LOG_LEVEL } });
  let active = 0;

  const proxyThis = (s: Station): boolean => s.proxyMode === 'proxy' || (s.proxyMode === 'auto' && s.transformer !== 'none');

  // ---- radio protocol (older radios, XML) ----
  app.addHook('onRequest', async (req, reply) => {
    const url = new URL(req.url, 'http://x');
    const base = baseUrl(req, config);
    const res = handleXml(url.pathname, url.searchParams, {
      library,
      url: (p) => `${base}${p}`,
      streamUrl: (s) => (proxyThis(s) ? `${base}/s/${s.id}` : s.streamUrl),
      logoUrl: () => `${base}/media/default.png`,
      radioSeen: (mac) => {
        if (/^[0-9a-f]{28,40}$/.test(mac)) library.touchRadio(mac, req.ip);
      },
    });
    if (!res) return;
    return reply
      .code(res.status)
      .header('Content-Type', res.contentType)
      .header('Cache-Control', 'no-store, no-cache, must-revalidate')
      .header('Pragma', 'no-cache')
      .send(res.body);
  });

  app.get('/media/default.png', async (_req, reply) => reply.type('image/png').header('Cache-Control', 'public, max-age=86400').send(DEFAULT_LOGO));

  // ---- stream proxy ----
  app.get<{ Params: { id: string } }>('/s/:id', async (req, reply) => {
    const station = /^\d+$/.test(req.params.id) ? library.getStation(Number(req.params.id)) : null;
    if (!station) return reply.code(404).send({ error: 'unknown station' });
    if (active >= config.MAX_STREAMS) return reply.code(503).header('Retry-After', '5').send({ error: 'too many streams' });
    try {
      await assertPublicUpstream(station.streamUrl, config.ALLOW_PRIVATE_UPSTREAMS);
    } catch (err) {
      req.log.warn({ station: station.id, err: String(err) }, 'upstream refused');
      return reply.code(502).send({ error: 'upstream not allowed' });
    }
    const wantMeta = req.headers['icy-metadata'] === '1';
    const ac = new AbortController();
    req.raw.on('close', () => ac.abort());
    active++;
    try {
      const up = await connectStream({ url: station.streamUrl, transformer: station.transformer, wantMeta, signal: ac.signal });
      reply.hijack();
      const headers: Record<string, string> = {
        'Content-Type': up.contentType,
        'icy-name': station.name,
        'Cache-Control': 'no-store',
      };
      if (up.metaint) headers['icy-metaint'] = String(up.metaint);
      reply.raw.writeHead(200, headers);
      req.raw.on('close', () => up.close());
      await up.pump(reply.raw);
    } catch (err) {
      req.log.warn({ station: station.id, err: String(err) }, 'stream failed');
      if (!reply.sent && !reply.raw.headersSent) return reply.code(502).send({ error: 'upstream unavailable' });
    } finally {
      active--;
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });

  // ---- API ----
  app.get('/healthz', { logLevel: 'silent' }, async () => ({ status: 'ok' }));
  app.get('/api/v1/version', async () => ({ name: APP_NAME, version: VERSION }));
  app.get('/api/v1/stations', async () => library.listStations());
  app.get<{ Params: { id: string } }>('/api/v1/stations/:id', async (req, reply) => {
    const s = /^\d+$/.test(req.params.id) ? library.getStation(Number(req.params.id)) : null;
    return s ?? reply.code(404).send({ error: 'not found' });
  });
  app.get('/api/v1/radios', async () => library.listRadios());

  const requireAdmin = (req: FastifyRequest): string | null => {
    if (!config.ADMIN_TOKEN) return 'the API is read-only: set ADMIN_TOKEN to enable changes';
    return isAdmin(req, config.ADMIN_TOKEN) ? null : 'missing or wrong token';
  };

  app.post('/api/v1/stations', async (req, reply) => {
    const denied = requireAdmin(req);
    if (denied) return reply.code(config.ADMIN_TOKEN ? 401 : 403).send({ error: denied });
    const parsed = NewStation.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    return reply.code(201).send(library.createStation(parsed.data));
  });
  app.put<{ Params: { id: string } }>('/api/v1/stations/:id', async (req, reply) => {
    const denied = requireAdmin(req);
    if (denied) return reply.code(config.ADMIN_TOKEN ? 401 : 403).send({ error: denied });
    const parsed = NewStation.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    const s = /^\d+$/.test(req.params.id) ? library.updateStation(Number(req.params.id), parsed.data) : null;
    return s ?? reply.code(404).send({ error: 'not found' });
  });
  app.delete<{ Params: { id: string } }>('/api/v1/stations/:id', async (req, reply) => {
    const denied = requireAdmin(req);
    if (denied) return reply.code(config.ADMIN_TOKEN ? 401 : 403).send({ error: denied });
    return /^\d+$/.test(req.params.id) && library.deleteStation(Number(req.params.id)) ? reply.code(204).send() : reply.code(404).send({ error: 'not found' });
  });
  app.post('/api/v1/import/radioapi', async (req, reply) => {
    const denied = requireAdmin(req);
    if (denied) return reply.code(config.ADMIN_TOKEN ? 401 : 403).send({ error: denied });
    const { stations, skipped } = convertRadioApi(req.body);
    const created = stations.map((s) => library.createStation(s));
    return { imported: created.length, skipped };
  });
  app.setErrorHandler((err, _req, reply) => {
    const e = err as { statusCode?: number; message?: string };
    return reply.code(e.statusCode ?? 500).send({ error: e.statusCode && e.statusCode < 500 ? e.message : 'internal error' });
  });

  // ---- web app ----
  const webDir = resolve(config.WEB_DIR);
  if (existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not found' });
    });
  }
  return app;
}
