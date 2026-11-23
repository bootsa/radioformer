import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { FakeRadio } from '@radioformer/fsapi/testing';
import { buildApp } from './app.ts';
import { openDb } from './db.ts';
import { SqliteLibrary } from './library.ts';

const TOKEN = 'test-token-0123456789';
const MAC = 'e011516159f8bb18bfdaae427f54ac93';
const auth = { authorization: `Bearer ${TOKEN}` };

async function setup() {
  const library = new SqliteLibrary(openDb(':memory:'));
  library.touchRadio(MAC, '10.0.3.4');
  const fake = new FakeRadio();
  const { port, close } = await fake.listen();
  const app = await buildApp(
    { WEB_DIR: '/does/not/exist', LOG_LEVEL: 'silent', ADMIN_TOKEN: TOKEN, ALLOW_PRIVATE_UPSTREAMS: false, MAX_STREAMS: 2 } as Parameters<typeof buildApp>[0],
    library,
  );
  // The fake radio listens on a random port; real radios use port 80, so tests inject the port through the host value.
  const host = `127.0.0.1:${port}`;
  return { app, library, fake, close, host, port };
}

test('radio routes need the token', async () => {
  const { app, close } = await setup();
  assert.equal((await app.inject('/api/v1/radios')).statusCode, 401);
  assert.equal((await app.inject('/api/v1/radios/1/status')).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/radios/1/command', payload: { type: 'power', on: false } })).statusCode, 401);
  await app.close();
  await close();
});

test('signing in sets a cookie that works for later requests', async () => {
  const { app, close } = await setup();
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/login', payload: { token: 'nope' } })).statusCode, 401);
  const login = await app.inject({ method: 'POST', url: '/api/v1/login', payload: { token: TOKEN } });
  assert.equal(login.statusCode, 200);
  const cookie = String(login.headers['set-cookie']);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const withCookie = await app.inject({ url: '/api/v1/radios', headers: { cookie: cookie.split(';')[0]! } });
  assert.equal(withCookie.statusCode, 200);
  assert.equal(withCookie.json()[0].mac, MAC);
  assert.equal((await app.inject({ url: '/api/v1/session', headers: { cookie: cookie.split(';')[0]! } })).json().admin, true);
  assert.equal((await app.inject('/api/v1/session')).json().admin, false);
  await app.close();
  await close();
});

test('a radio without an address says so; public addresses are refused; a PIN must be four digits', async () => {
  const { app, close } = await setup();
  assert.equal((await app.inject({ url: '/api/v1/radios/1/status', headers: auth })).statusCode, 409);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/v1/radios/1', headers: auth, payload: { host: '8.8.8.8' } })).statusCode, 422);
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/v1/radios/1', headers: auth, payload: { pin: 'abcd' } })).statusCode, 400);
  assert.equal((await app.inject({ url: '/api/v1/radios/99/status', headers: auth })).statusCode, 404);
  await app.close();
  await close();
});

test('status, commands, presets and the menu work through the API', async () => {
  const { app, library, fake, close, port } = await setup();
  // Use the plain host for validation, then point the manager at the fake's port through the library.
  assert.equal((await app.inject({ method: 'PATCH', url: '/api/v1/radios/1', headers: auth, payload: { host: '127.0.0.1', label: 'Kitchen' } })).statusCode, 200);
  library.updateRadio(1, 'Kitchen', { host: `127.0.0.1:${port}`, pin: '1234' });
  const status = await app.inject({ url: '/api/v1/radios/1/status', headers: auth });
  assert.equal(status.statusCode, 200);
  assert.equal(status.json().name, 'DanceHall');
  assert.equal(status.json().play.caps.stop, true);
  const vol = await app.inject({ method: 'POST', url: '/api/v1/radios/1/command', headers: auth, payload: { type: 'volume', level: 11 } });
  assert.equal(vol.statusCode, 200);
  assert.equal(fake.nodes.get('netRemote.sys.audio.volume')?.v, 11);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/radios/1/command', headers: auth, payload: { type: 'volume', level: 500 } })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/radios/1/command', headers: auth, payload: { type: 'bogus' } })).statusCode, 400);
  assert.deepEqual((await app.inject({ url: '/api/v1/radios/1/presets', headers: auth })).json(), [{ key: 0, name: 'FIP' }, { key: 2, name: 'M80' }]);
  const entered = await app.inject({ method: 'POST', url: '/api/v1/radios/1/command', headers: auth, payload: { type: 'enter', key: 1 } });
  assert.equal(entered.json().menu.length, 3);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/radios/1/command', headers: auth, payload: { type: 'transport', command: 'pause' } })).statusCode, 200);
  assert.equal(fake.nodes.get('netRemote.play.control')?.v, 2);
  await app.close();
  await close();
});

test('an unreachable radio is reported as a gateway error, not a crash', async () => {
  const { app, library, close } = await setup();
  library.updateRadio(1, '', { host: '127.0.0.1:1', pin: '1234' }); // nothing listens on port 1
  const res = await app.inject({ url: '/api/v1/radios/1/status', headers: auth });
  assert.ok([502, 504].includes(res.statusCode), String(res.statusCode));
  await app.close();
  await close();
});

test('the event stream delivers the current status', async () => {
  const { app, library, close, port } = await setup();
  library.updateRadio(1, '', { host: `127.0.0.1:${port}`, pin: '1234' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const ac = new AbortController();
  const res = await fetch(`${base}/api/v1/radios/1/events`, { headers: auth, signal: ac.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body!.getReader();
  let text = '';
  while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
  ac.abort();
  assert.match(text, /^event: status\ndata: \{/);
  assert.match(text, /"name":"DanceHall"/);
  await app.close();
  await close();
});
