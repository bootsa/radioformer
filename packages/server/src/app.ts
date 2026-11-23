import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { APP_NAME } from '@radioformer/core';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.ts';

export const VERSION = '0.0.0';

export async function buildApp(config: Pick<Config, 'WEB_DIR' | 'LOG_LEVEL'>): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.LOG_LEVEL === 'silent' ? false : { level: config.LOG_LEVEL } });

  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/api/v1/version', async () => ({ name: APP_NAME, version: VERSION }));

  const webDir = resolve(config.WEB_DIR);
  if (existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir, wildcard: false });
    // Single-page app: unknown non-API paths get the app shell.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not found' });
    });
  }
  return app;
}
