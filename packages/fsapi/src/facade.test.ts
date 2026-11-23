import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { FsapiClient } from './client.ts';
import { FakeRadio } from './fake-radio.ts';
import { FsapiFacade } from './facade.ts';

let radio: FakeRadio;
let stop: () => Promise<void>;
let client: FsapiClient;
let facade: FsapiFacade;

beforeEach(async () => {
  radio = new FakeRadio();
  const l = await radio.listen();
  stop = l.close;
  client = new FsapiClient({ host: '127.0.0.1', port: l.port, pin: '1234', idleCloseMs: 0 });
  facade = new FsapiFacade({ upstream: () => client, pin: '4321', keepAliveMs: 60_000 });
});
afterEach(async () => {
  facade.close();
  await client.close();
  await stop();
});

const call = (path: string, query: Record<string, string | string[]> = {}, pin = '4321') => {
  const q = new URLSearchParams({ pin });
  for (const [k, v] of Object.entries(query)) for (const x of Array.isArray(v) ? v : [v]) q.append(k, x);
  return facade.handle({ path, query: q, host: 'radio.test:8082' });
};
const open = async (): Promise<string> => /<sessionId>(\d+)</.exec((await call('/fsapi/CREATE_SESSION')).body)![1]!;
const value = (body: string) => /<value><(?:u8|u32|s16|c8_array)>([^<]*)</.exec(body)?.[1];

test('the device document points apps at the virtual radio', async () => {
  facade.learn('DanceHall', 'ir-mmi-test');
  const r = await call('/device');
  assert.match(r.body, /<friendlyName>DanceHall<\/friendlyName>/);
  assert.match(r.body, /<webfsapi>http:\/\/radio\.test:8082\/fsapi<\/webfsapi>/);
});

test('sessions: wrong PIN refused, unknown session is a 404 like the radio, delete works', async () => {
  assert.equal((await call('/fsapi/CREATE_SESSION', {}, '0000')).status, 403);
  assert.equal((await call('/fsapi/GET/netRemote.sys.power', { sid: '1' })).status, 404);
  const sid = await open();
  assert.equal(value((await call('/fsapi/GET/netRemote.sys.audio.volume', { sid })).body), '7');
  await call('/fsapi/DELETE_SESSION', { sid });
  assert.equal((await call('/fsapi/GET/netRemote.sys.power', { sid })).status, 404);
});

test('many apps, one real session', async () => {
  const a = await open();
  const b = await open();
  const c = await open();
  for (const sid of [a, b, c]) await call('/fsapi/GET/netRemote.sys.power', { sid });
  assert.equal(radio.log.filter((l) => l === 'CREATE_SESSION').length, 1);
  assert.equal(radio.sessions.size, 1);
  assert.equal(facade.sessionCount, 3);
});

test('reads are shared for a moment and writes clear them', async () => {
  const sid = await open();
  const node = '/fsapi/GET/netRemote.sys.audio.volume';
  await call(node, { sid });
  await call(node, { sid });
  assert.equal(radio.log.filter((l) => l === 'GET/netRemote.sys.audio.volume').length, 1);
  assert.equal((await call('/fsapi/SET/netRemote.sys.audio.volume', { sid, value: '12' })).status, 200);
  assert.equal(value((await call(node, { sid })).body), '12');
});

test('a big GET_MULTIPLE is split for the radio and answered completely', async () => {
  const sid = await open();
  const nodes = [...radio.nodes.keys()].slice(0, 20);
  const r = await call('/fsapi/GET_MULTIPLE', { sid, node: nodes });
  for (const n of nodes) assert.ok(r.body.includes(`<node>${n}</node>`), n);
  assert.ok(radio.log.filter((l) => l === 'GET_MULTIPLE').length >= 3);
});

test('lists are passed through', async () => {
  const sid = await open();
  const r = await call('/fsapi/LIST_GET_NEXT/netRemote.sys.caps.validModes/-1', { sid, maxItems: '40' });
  assert.match(r.body, /Internet radio/);
});

test('a change on the radio reaches every app, once', async () => {
  const a = await open();
  const b = await open();
  const waitA = call('/fsapi/GET_NOTIFIES', { sid: a });
  const waitB = call('/fsapi/GET_NOTIFIES', { sid: b });
  await new Promise((r) => setTimeout(r, 100));
  radio.notify('netRemote.play.info.text', { t: 'c8_array', v: 'New title' });
  for (const r of await Promise.all([waitA, waitB])) {
    assert.match(r.body, /<notify node="netremote\.play\.info\.text">/);
    assert.match(r.body, /New title/);
  }
  assert.match((await call('/fsapi/GET_NOTIFIES', { sid: a })).body, /FS_TIMEOUT/); // consumed
});

test('a notification clears the shared read of that node', async () => {
  const sid = await open();
  const node = '/fsapi/GET/netRemote.sys.audio.volume';
  await call(node, { sid });
  radio.nodes.set('netRemote.sys.audio.volume', { t: 'u8', v: 20 });
  radio.notify('netRemote.sys.audio.volume', { t: 'u8', v: 20 });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(value((await call(node, { sid })).body), '20');
});

test('when the real radio is unreachable the app gets an FSAPI error, not a crash', async () => {
  const sid = await open();
  const dead = new FsapiFacade({ upstream: () => new FsapiClient({ host: '127.0.0.1', port: 1, pin: '1234', idleCloseMs: 0, timeoutMs: 500 }), pin: '4321' });
  const q = new URLSearchParams({ pin: '4321' });
  const created = await dead.handle({ path: '/fsapi/CREATE_SESSION', query: q, host: 'x' });
  const dsid = /<sessionId>(\d+)</.exec(created.body)![1]!;
  const r = await dead.handle({ path: '/fsapi/GET/netRemote.sys.power', query: new URLSearchParams({ pin: '4321', sid: dsid }), host: 'x' });
  assert.match(r.body, /FS_TIMEOUT/);
  dead.close();
  void sid;
});
