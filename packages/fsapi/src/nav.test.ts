import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { FsapiClient } from './client.ts';
import { FsapiFacade } from './facade.ts';
import { FakeRadio } from './fake-radio.ts';
import { RadioControl } from './radio.ts';

let radio: FakeRadio;
let stop: () => Promise<void>;
let client: FsapiClient;
let control: RadioControl;
let facade: FsapiFacade;

beforeEach(async () => {
  radio = new FakeRadio();
  const l = await radio.listen();
  stop = l.close;
  client = new FsapiClient({ host: '127.0.0.1', port: l.port, pin: '1234', idleCloseMs: 0 });
  control = new RadioControl(client, { tries: 4, delayMs: 5 }); // also creates the shared menu multiplexer
  facade = new FsapiFacade({
    upstream: () => client,
    pin: '4321',
    keepAliveMs: 60_000,
    rewriteUri: (u) => u.replace('http://radio.wifiradiofrontier.com', 'http://192.168.222.241:8081'),
  });
});
afterEach(async () => {
  facade.close();
  await client.close();
  await stop();
});

const call = (path: string, query: Record<string, string | string[]> = {}) => {
  const q = new URLSearchParams({ pin: '4321' });
  for (const [k, v] of Object.entries(query)) for (const x of Array.isArray(v) ? v : [v]) q.append(k, x);
  return facade.handle({ path, query: q, host: 'radio.test' });
};
const open = async (): Promise<string> => /<sessionId>(\d+)</.exec((await call('/fsapi/CREATE_SESSION')).body)![1]!;
const names = (body: string): string[] => [...body.matchAll(/<c8_array>([^<]*)<\/c8_array>/g)].map((m) => m[1]!).filter((n) => n !== '');
const set = (sid: string, node: string, value: number | string) => call(`/fsapi/SET/${node}`, { sid, value: String(value) });
/** Reads the whole menu list, page by page like an app does. */
async function list(sid: string): Promise<{ body: string }> {
  let all = '';
  let start = -1;
  for (let page = 0; page < 20; page++) {
    const r = await call(`/fsapi/LIST_GET_NEXT/netRemote.nav.list/${start}`, { sid, maxItems: '40' });
    all += r.body;
    const keys = [...r.body.matchAll(/<item key="(\d+)">/g)].map((m) => Number(m[1]));
    if (r.body.includes('<listend') || keys.length === 0) break;
    start = keys[keys.length - 1]!;
  }
  return { body: all };
}

test('each app keeps its own menu position on the one real session', async () => {
  const a = await open();
  const b = await open();
  await set(a, 'netRemote.nav.state', 1);
  await set(a, 'netRemote.nav.action.navigate', 1); // A enters "Portugal"
  await set(b, 'netRemote.nav.state', 1); // B starts at the root
  assert.deepEqual(names((await list(b)).body), ['Radio stations', 'Portugal', 'FIP']);
  assert.deepEqual(names((await list(a)).body), ['Rádio Comercial', 'M80', 'Radio Comercial Portugal']);
  await set(b, 'netRemote.nav.action.selectItem', 2);
  assert.equal(radio.selected, '2'); // FIP, at the root
  await set(a, 'netRemote.nav.action.selectItem', 1);
  assert.equal(radio.selected, '1/1'); // M80, inside Portugal, although B was in between
});

test('the web page and an app do not disturb each other', async () => {
  const ha = await open();
  await set(ha, 'netRemote.nav.state', 1);
  await set(ha, 'netRemote.nav.action.navigate', 0);
  assert.deepEqual((await control.browse()).map((i) => i.name), ['Radio stations', 'Portugal', 'FIP']); // web at the root
  await control.enter(1);
  assert.deepEqual(names((await list(ha)).body), ['Comercial', 'M80']); // the app's folder 0
  await control.play(2);
  assert.equal(radio.selected, '1/2');
  await set(ha, 'netRemote.nav.action.selectItem', 1);
  assert.equal(radio.selected, '0/1');
});

test('an app is told its own menu state, not the radio\'s', async () => {
  const a = await open();
  const c = await open();
  await set(a, 'netRemote.nav.state', 1);
  const state = async (sid: string) => /<u8>(\d)</.exec((await call('/fsapi/GET/netRemote.nav.state', { sid })).body)![1];
  assert.equal(await state(a), '1');
  assert.equal(await state(c), '0');
  await set(a, 'netRemote.nav.state', 0);
  assert.equal(await state(a), '0');
});

test('changing source starts every app\'s menu again', async () => {
  const a = await open();
  const b = await open();
  await set(a, 'netRemote.nav.state', 1);
  await set(a, 'netRemote.nav.action.navigate', 1);
  await set(b, 'netRemote.netRemote'.replace('netRemote.', ''), 0).catch(() => {});
  assert.equal((await set(b, 'netRemote.sys.mode', 3)).status, 200);
  const state = /<u8>(\d)</.exec((await call('/fsapi/GET/netRemote.nav.state', { sid: a })).body)![1];
  assert.equal(state, '0');
});

test('the menu commands of a closed app are forgotten', async () => {
  const a = await open();
  await set(a, 'netRemote.nav.state', 1);
  await call('/fsapi/DELETE_SESSION', { sid: a });
  const b = await open();
  assert.equal(/<u8>(\d)</.exec((await call('/fsapi/GET/netRemote.nav.state', { sid: b })).body)![1], '0');
});

test('picture addresses are rewritten so apps outside the radio\'s DNS can load them', async () => {
  const sid = await open();
  const node = 'netRemote.play.info.graphicUri';
  radio.nodes.set(node, { t: 'c8_array', v: 'http://radio.wifiradiofrontier.com/logo/1.png' });
  assert.match((await call(`/fsapi/GET/${node}`, { sid })).body, /http:\/\/192\.168\.222\.241:8081\/logo\/1\.png/);
  const multi = await call('/fsapi/GET_MULTIPLE', { sid, node: [node, 'netRemote.sys.power'] });
  assert.match(multi.body, /http:\/\/192\.168\.222\.241:8081\/logo\/1\.png/);
  const waiting = call('/fsapi/GET_NOTIFIES', { sid });
  await new Promise((r) => setTimeout(r, 50));
  radio.notify(node, { t: 'c8_array', v: 'http://radio.wifiradiofrontier.com/logo/2.png' });
  assert.match((await waiting).body, /http:\/\/192\.168\.222\.241:8081\/logo\/2\.png/);
});
