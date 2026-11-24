import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRadioHost, passthrough } from './passthrough.ts';

test('only radio cloud hosts are forwarded', async () => {
  assert.equal(isRadioHost('roberts.wifiradiofrontier.com'), true);
  assert.equal(isRadioHost('evil.example.com'), false);
  assert.equal(await passthrough('evil.example.com', '/x', (async () => { throw new Error('no'); }) as never), null);
  assert.equal(await passthrough('roberts.wifiradiofrontier.com', '//evil', (async () => { throw new Error('no'); }) as never), null);
});

test('returns the upstream answer', async () => {
  const fake = (async () => new Response('hello', { status: 200, headers: { 'content-type': 'audio/x-mpegurl' } })) as never;
  const r = await passthrough('roberts.wifiradiofrontier.com', '/vtuner/play/station=1', fake);
  assert.equal(r?.status, 200);
  assert.equal(r?.contentType, 'audio/x-mpegurl');
  assert.equal(r?.body.toString(), 'hello');
});

test('a failing upstream gives null so the caller can fall back', async () => {
  const r = await passthrough('roberts.wifiradiofrontier.com', '/a', (async () => { throw new Error('down'); }) as never);
  assert.equal(r, null);
});
