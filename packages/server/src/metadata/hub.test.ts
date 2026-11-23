import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NowPlaying } from '@radioformer/core';
import { MetadataHub } from './hub.ts';

const np = (title: string): NowPlaying => ({ title, track: null, programme: null, previous: [], next: null, fetchedAt: 0 });

test('listeners share one feed, which is polled only while somebody listens', async () => {
  let calls = 0;
  const hub = new MetadataHub({ providers: { fake: { fetch: async (ref) => np(`${ref}:${++calls}`) } }, intervalMs: 20 });
  const a = await hub.acquire('fake:7');
  const b = await hub.acquire('fake:7');
  assert.equal(a?.current()?.title, 'fake:7'.replace('fake:', '') + ':1');
  await new Promise((r) => setTimeout(r, 70));
  assert.ok(calls >= 3);
  assert.equal(b?.current()?.title.startsWith('7:'), true);
  a?.release();
  await new Promise((r) => setTimeout(r, 50));
  const during = calls;
  assert.ok(during > 3); // b is still listening
  b?.release();
  await new Promise((r) => setTimeout(r, 30));
  const after = calls;
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(calls, after); // nobody listening: polling stopped
  hub.close();
});

test('unknown sources are refused and failing feeds keep the last good answer', async () => {
  let fail = false;
  const hub = new MetadataHub({
    providers: { fake: { fetch: async () => { if (fail) throw new Error('down'); return np('ok'); } } },
    intervalMs: 20,
  });
  assert.equal(await hub.acquire('nope:1'), null);
  const lease = await hub.acquire('fake:1');
  fail = true;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(lease?.current()?.title, 'ok');
  lease?.release();
  hub.close();
});

test('peek is cached for a short while', async () => {
  let calls = 0;
  const hub = new MetadataHub({ providers: { fake: { fetch: async () => np(String(++calls)) } }, cacheMs: 1000 });
  assert.equal((await hub.peek('fake:1'))?.title, '1');
  assert.equal((await hub.peek('fake:1'))?.title, '1');
  assert.equal(calls, 1);
  hub.close();
});
