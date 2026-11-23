import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from './app.ts';

test('health and version endpoints answer', async () => {
  const app = await buildApp({ WEB_DIR: '/does/not/exist', LOG_LEVEL: 'silent' });
  const health = await app.inject('/healthz');
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: 'ok' });
  const version = await app.inject('/api/v1/version');
  assert.equal(version.json().name, 'Radioformer');
  await app.close();
});

test('unknown API paths are 404 JSON, not the app shell', async () => {
  const app = await buildApp({ WEB_DIR: '/does/not/exist', LOG_LEVEL: 'silent' });
  const res = await app.inject('/api/v1/nope');
  assert.equal(res.statusCode, 404);
  await app.close();
});
