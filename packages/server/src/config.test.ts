import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from './config.ts';

test('defaults are sensible', () => {
  const c = loadConfig({});
  assert.equal(c.PORT, 8080);
  assert.equal(c.ALLOW_PRIVATE_UPSTREAMS, false);
  assert.equal(c.ADMIN_TOKEN, undefined);
});

test('empty strings from compose files count as unset', () => {
  const c = loadConfig({ ADMIN_TOKEN: '', PUBLIC_URL: '' });
  assert.equal(c.ADMIN_TOKEN, undefined);
  assert.equal(c.PUBLIC_URL, undefined);
});

test('a short admin token is refused', () => {
  assert.throws(() => loadConfig({ ADMIN_TOKEN: 'short' }));
});
