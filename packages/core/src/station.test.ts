import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Station } from './station.ts';

test('a minimal station gets sensible defaults', () => {
  const s = Station.parse({ id: 1, name: 'FIP', streamUrl: 'https://icecast.radiofrance.fr/fip-hifi.aac' });
  assert.equal(s.proxyMode, 'auto');
  assert.equal(s.transformer, 'none');
  assert.deepEqual(s.tags, []);
});

test('only http and https stream URLs are accepted', () => {
  assert.throws(() => Station.parse({ id: 1, name: 'x', streamUrl: 'file:///etc/passwd' }));
});
