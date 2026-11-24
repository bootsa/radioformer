import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { APP_NAME, renderTitle, Station } from '@radioformer/core';
import { handleXml } from '@radioformer/protocol-xml';
import { connectStream } from '@radioformer/stream';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { clearSessionCookie, constantTimeEqual, isAdmin, setSessionCookie } from './auth.ts';
import type { Config } from './config.ts';
import { convertRadioApi } from './import-radioapi.ts';
import { NewStation, type SqliteLibrary } from './library.ts';
import { MetadataHub } from './metadata/hub.ts';
import { fetchImage, getDefaultLogo, sha256, toRadioPng } from './logos.ts';
import { assertPublicUpstream } from './net-guard.ts';
import { searchDirectory } from './directory.ts';
import { isRadioHost, passthrough } from './passthrough.ts';
import { startFacade } from './facade-server.ts';
import { startUpnpFace } from './upnp/server.ts';
import { rendererUuid } from './ssdp.ts';
import { registerRadioRoutes } from './radio-routes.ts';
import { RadioManager } from './radios.ts';

export const VERSION = '0.1.0';

type AppConfig = Pick<Config, 'WEB_DIR' | 'LOG_LEVEL' | 'ADMIN_TOKEN' | 'PUBLIC_URL' | 'ALLOW_PRIVATE_UPSTREAMS' | 'MAX_STREAMS'> &
  Partial<Pick<Config, 'FSAPI_FACE_PORT' | 'FSAPI_FACE_PIN' | 'FSAPI_FACE_RADIO' | 'FSAPI_FACE_NAME' | 'FSAPI_FACE_ASSET_URL' | 'UPNP_FACE_PORT' | 'UPNP_FACE_NAME' | 'UPNP_FACE_RADIO' | 'UPNP_FACE_UUID' | 'UPNP_FACE_PUBLIC_URL' | 'UPNP_FACE_MODE'>>;

function baseUrl(req: FastifyRequest, config: AppConfig): string {
  if (config.PUBLIC_URL) return config.PUBLIC_URL.replace(/\/$/, '');
  return `http://${req.headers.host ?? 'localhost'}`;
}

export async function buildApp(config: AppConfig, library: SqliteLibrary, deps: { metadata?: MetadataHub } = {}): Promise<FastifyInstance> {
  const metadata = deps.metadata ?? new MetadataHub();
  const app = Fastify({ logger: config.LOG_LEVEL === 'silent' ? false : { level: config.LOG_LEVEL } });
  let active = 0;

  const proxyThis = (s: Station): boolean => s.proxyMode === 'proxy' || (s.proxyMode === 'auto' && (s.transformer !== 'none' || s.metadataSource !== ''));

  // ---- radio protocol (older radios, XML) ----
  app.addHook('onRequest', async (req, reply) => {
    const url = new URL(req.url, 'http://x');
    const base = baseUrl(req, config);
    // Presets and stations from the radio's original directory use long ids we don't own.
    // They, and any other request to the radio cloud we don't handle, go to the real service.
    const search = url.searchParams.get('Search');
    const foreignStation = !!search && /^\d+$/.test(search) && !(/^\d{10,19}$/.test(search) ? library.getStationByDirectoryId(search) : library.getStation(Number(search)));
    const res = foreignStation ? null : handleXml(url.pathname, url.searchParams, {
      library,
      url: (p) => `${base}${p}`,
      streamUrl: (s) => (proxyThis(s) ? `${base}/s/${s.id}` : s.streamUrl),
      logoUrl: (s) => (s.logoId ? `${base}/logo/${s.logoId}.png` : `${base}/media/default.png`),
      radioSeen: (mac) => {
        if (/^[0-9a-f]{28,40}$/.test(mac)) library.touchRadio(mac, req.ip);
      },
    });
    if (!res) {
      if (isRadioHost(req.headers.host) && (foreignStation || url.pathname.startsWith('/vtuner/') || url.pathname.startsWith('/setupapp/'))) {
        const real = await passthrough(req.headers.host!, req.url);
        if (real) {
          req.log.info({ path: url.pathname, status: real.status }, 'answered by the real radio service');
          reply.code(real.status).header('Content-Type', real.contentType).header('Cache-Control', 'no-store');
          if (real.location) reply.header('Location', real.location);
          return reply.send(real.body);
        }
        if (foreignStation) {
          return reply.code(200).header('Content-Type', 'text/plain;charset=UTF-8').send(
            handleXml(url.pathname, new URLSearchParams({ sSearchtype: '3', Search: '0' }), { library, url: (p) => `${base}${p}`, streamUrl: (x) => x.streamUrl, logoUrl: () => '' })?.body ?? '',
          );
        }
      }
      return;
    }
    return reply
      .code(res.status)
      .header('Content-Type', res.contentType)
      .header('Cache-Control', 'no-store, no-cache, must-revalidate')
      .header('Pragma', 'no-cache')
      .send(res.body);
  });

  // Station pictures of the radio's original directory (see passthrough); cached in memory
  const assetCache = new Map<string, { type: string; data: Buffer }>();
  app.get<{ Params: { '*': string } }>('/assets/*', async (req, reply) => {
    const path = `/assets/${req.params['*']}`;
    if (!/^\/assets\/[\w./-]{1,200}$/.test(path) || path.includes('..')) return reply.code(404).send({ error: 'not found' });
    let hit = assetCache.get(path);
    if (!hit) {
      const real = await passthrough('assets.wifiradiofrontier.com', path);
      if (!real || real.status !== 200 || !real.contentType.startsWith('image/')) return reply.code(404).send({ error: 'not found' });
      hit = { type: real.contentType, data: real.body };
      if (assetCache.size >= 500) assetCache.delete(assetCache.keys().next().value!);
      assetCache.set(path, hit);
    }
    return reply.type(hit.type).header('Cache-Control', 'public, max-age=604800').send(hit.data);
  });

  app.get('/media/default.png', async (_req, reply) => reply.type('image/png').header('Cache-Control', 'public, max-age=86400').send(await getDefaultLogo()));
  app.get<{ Params: { id: string } }>('/logo/:id.png', async (req, reply) => {
    const data = /^\d+$/.test(req.params.id) ? library.getLogo(Number(req.params.id)) : null;
    if (!data) return reply.code(404).send({ error: 'unknown logo' });
    return reply.type('image/png').header('Cache-Control', 'public, max-age=604800, immutable').send(data);
  });

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
    const lease = station.metadataSource ? await metadata.acquire(station.metadataSource).catch(() => null) : null;
    try {
      const up = await connectStream({
        url: station.streamUrl,
        transformer: station.transformer,
        wantMeta,
        signal: ac.signal,
        ...(lease ? { titleSource: () => { const np = lease.current(); return np ? renderTitle(np, station.titleTemplate) : ''; } } : {}),
      });
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
      lease?.release();
      active--;
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  });

  // ---- API ----
  app.get('/healthz', { logLevel: 'silent' }, async () => ({ status: 'ok' }));
  app.get<{ Params: { id: string } }>('/api/v1/stations/:id/now-playing', async (req, reply) => {
    const s = /^\d+$/.test(req.params.id) ? library.getStation(Number(req.params.id)) : null;
    if (!s) return reply.code(404).send({ error: 'not found' });
    if (!s.metadataSource) return reply.code(404).send({ error: 'this station has no metadata source' });
    const np = await metadata.peek(s.metadataSource);
    return np ?? reply.code(503).send({ error: 'the feed is not answering' });
  });
  app.addHook('onClose', async () => metadata.close());
  app.get('/api/v1/version', async () => ({ name: APP_NAME, version: VERSION }));
  app.get('/api/v1/stations', async () => library.listStations());
  app.get<{ Params: { id: string } }>('/api/v1/stations/:id', async (req, reply) => {
    const s = /^\d+$/.test(req.params.id) ? library.getStation(Number(req.params.id)) : null;
    return s ?? reply.code(404).send({ error: 'not found' });
  });

  const requireAdmin = (req: FastifyRequest): string | null => {
    if (!config.ADMIN_TOKEN) return 'the API is read-only: set ADMIN_TOKEN to enable changes';
    return isAdmin(req, config.ADMIN_TOKEN) ? null : 'missing or wrong token';
  };

  /** Sends 401/403 and returns false when the caller may not use admin routes. */
  const guard = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const denied = requireAdmin(req);
    if (denied) void reply.code(config.ADMIN_TOKEN ? 401 : 403).send({ error: denied });
    return denied === null;
  };

  const manager = new RadioManager(library);
  registerRadioRoutes(app, { library, manager, guard });
  app.addHook('onClose', async () => manager.closeAll());
  if (config.FSAPI_FACE_PORT) {
    const face = startFacade({
      port: config.FSAPI_FACE_PORT,
      host: '0.0.0.0',
      pin: config.FSAPI_FACE_PIN ?? '1234',
      radioId: config.FSAPI_FACE_RADIO ?? 1,
      name: config.FSAPI_FACE_NAME ?? '',
      assetUrl: config.FSAPI_FACE_ASSET_URL,
      manager,
      log: (m) => app.log.info(m),
    });
    app.addHook('onClose', async () => face.close());
  }
  if (config.UPNP_FACE_PORT) {
    const radioId = config.UPNP_FACE_RADIO ?? 1;
    const label = library.getRadio(radioId)?.label ?? '';
    const upnp = startUpnpFace({
      port: config.UPNP_FACE_PORT,
      host: '0.0.0.0',
      radioId,
      uuid: config.UPNP_FACE_UUID ?? rendererUuid(radioId),
      name: config.UPNP_FACE_NAME || (label ? `${label}+` : 'Radioformer'),
      modePattern: new RegExp(config.UPNP_FACE_MODE ?? 'music player', 'i'),
      publicBase: config.UPNP_FACE_PUBLIC_URL,
      manager,
      radioHost: () => library.getRadio(radioId)?.host || null,
      log: (m) => app.log.info(m),
    });
    app.addHook('onClose', async () => upnp.close());
  }

  // ---- sign-in for the web app ----
  app.get('/api/v1/session', async (req) => ({ admin: isAdmin(req, config.ADMIN_TOKEN), writable: Boolean(config.ADMIN_TOKEN) }));
  app.post('/api/v1/login', async (req, reply) => {
    if (!config.ADMIN_TOKEN) return reply.code(403).send({ error: 'sign-in is off: set ADMIN_TOKEN' });
    const token = (req.body as { token?: unknown } | null)?.token;
    if (typeof token !== 'string' || !constantTimeEqual(token, config.ADMIN_TOKEN)) return reply.code(401).send({ error: 'wrong token' });
    setSessionCookie(reply, config.ADMIN_TOKEN);
    return { admin: true };
  });
  app.post('/api/v1/logout', async (_req, reply) => {
    clearSessionCookie(reply);
    return { admin: false };
  });

  // Counterparts of a station in the radio's original directory, to give it the same id
  app.get<{ Querystring: { q?: string } }>('/api/v1/directory/search', async (req, reply) => {
    const denied = requireAdmin(req);
    if (denied) return reply.code(config.ADMIN_TOKEN ? 401 : 403).send({ error: denied });
    const found = await searchDirectory(req.query.q ?? '');
    return found ?? reply.code(502).send({ error: 'the original directory did not answer' });
  });
  app.post('/api/v1/stations', async (req, reply) => {
    const denied = requireAdmin(req);
    if (denied) return reply.code(config.ADMIN_TOKEN ? 401 : 403).send({ error: denied });
    const parsed = NewStation.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    if (parsed.data.metadataSource && !metadata.knows(parsed.data.metadataSource)) return reply.code(400).send({ error: 'unknown metadata source' });
    return reply.code(201).send(library.createStation(parsed.data));
  });
  app.put<{ Params: { id: string } }>('/api/v1/stations/:id', async (req, reply) => {
    const denied = requireAdmin(req);
    if (denied) return reply.code(config.ADMIN_TOKEN ? 401 : 403).send({ error: denied });
    const parsed = NewStation.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues });
    if (parsed.data.metadataSource && !metadata.knows(parsed.data.metadataSource)) return reply.code(400).send({ error: 'unknown metadata source' });
    const s = /^\d+$/.test(req.params.id) ? library.updateStation(Number(req.params.id), parsed.data) : null;
    return s ?? reply.code(404).send({ error: 'not found' });
  });
  app.delete<{ Params: { id: string } }>('/api/v1/stations/:id', async (req, reply) => {
    const denied = requireAdmin(req);
    if (denied) return reply.code(config.ADMIN_TOKEN ? 401 : 403).send({ error: denied });
    return /^\d+$/.test(req.params.id) && library.deleteStation(Number(req.params.id)) ? reply.code(204).send() : reply.code(404).send({ error: 'not found' });
  });
  app.post<{ Params: { id: string } }>('/api/v1/stations/:id/logo', async (req, reply) => {
    const denied = requireAdmin(req);
    if (denied) return reply.code(config.ADMIN_TOKEN ? 401 : 403).send({ error: denied });
    const id = /^\d+$/.test(req.params.id) ? Number(req.params.id) : NaN;
    if (!library.getStation(id)) return reply.code(404).send({ error: 'not found' });
    const url = (req.body as { url?: unknown } | null)?.url;
    if (typeof url !== 'string') return reply.code(400).send({ error: 'body must be {"url": "<image address>"}' });
    try {
      const png = await toRadioPng(await fetchImage(url, config.ALLOW_PRIVATE_UPSTREAMS));
      const logoId = library.saveLogo(sha256(png.data), png.width, png.height, png.data, url);
      library.setStationLogo(id, logoId);
      return { logoId, url: `/logo/${logoId}.png` };
    } catch (err) {
      return reply.code(422).send({ error: `could not use that image: ${(err as Error).message}` });
    }
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
