import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { FsapiError } from './client.ts';
import { FakeRadio } from './fake-radio.ts';
import { decodeCaps, RadioControl } from './radio.ts';

let radio: FakeRadio;
let stop: () => Promise<void>;
let control: RadioControl;
let port: number;

beforeEach(async () => {
  radio = new FakeRadio();
  const l = await radio.listen();
  port = l.port;
  stop = l.close;
  control = new RadioControl({ host: '127.0.0.1', port, pin: '1234', idleCloseMs: 0 });
});
afterEach(async () => {
  await control.close();
  await stop();
});

test('status gathers everything the Remote page shows, in a few batched requests', async () => {
  const s = await control.status();
  assert.equal(s.name, 'DanceHall');
  assert.equal(s.power, true);
  assert.equal(s.volume, 7);
  assert.equal(s.volumeSteps, 33);
  assert.equal(s.mode?.label, 'Internet radio');
  assert.equal(s.play.state, 'playing');
  assert.equal(s.play.text, 'Radio France - eclectic & fresh');
  assert.deepEqual([s.play.caps.stop, s.play.caps.next, s.play.caps.addPreset], [true, false, true]);
  assert.equal(s.eq.treble, -2);
  assert.ok(radio.log.filter((l) => l === 'GET_MULTIPLE').length <= 4); // a few small batches, not one request per node
});

test('capability bits decode as the radio defines them', () => {
  assert.deepEqual(Object.entries(decodeCaps(2050)).filter(([, v]) => v).map(([k]) => k), ['stop', 'addPreset']);
  assert.equal(decodeCaps(4 | 8 | 1).next, true);
});

test('commands write the right nodes and values', async () => {
  await control.setVolume(12);
  await control.setMute(true);
  await control.transport('pause');
  await control.setPower(false);
  await control.setSleep(1800);
  await control.setEq({ bass: 20, treble: -9, loudness: true });
  assert.equal(radio.nodes.get('netRemote.sys.audio.volume')?.v, 12);
  assert.equal(radio.nodes.get('netRemote.sys.audio.mute')?.v, 1);
  assert.equal(radio.nodes.get('netRemote.play.control')?.v, 2);
  assert.equal(radio.nodes.get('netRemote.sys.power')?.v, 0);
  assert.equal(radio.nodes.get('netRemote.sys.sleep')?.v, 1800);
  assert.equal(radio.nodes.get('netRemote.sys.audio.eqCustom.param0')?.v, 7); // clamped
  assert.equal(radio.nodes.get('netRemote.sys.audio.eqCustom.param1')?.v, -7);
});

test('modes and presets come back as clean lists (empty presets dropped, names trimmed)', async () => {
  assert.deepEqual((await control.modes()).map((m) => m.label), ['Internet radio', 'Spotify', 'Local Music']);
  assert.equal((await control.modes())[2]!.selectable, false);
  assert.deepEqual(await control.presets(), [{ key: 0, name: 'FIP' }, { key: 2, name: 'M80' }]);
  assert.equal(radio.nodes.get('netRemote.nav.state')?.v, 1); // the menu browser was opened first
});

test('browsing: pages are joined, folders and items are told apart, enter and back navigate', async () => {
  const items = await control.browse();
  assert.deepEqual(items.map((i) => [i.name, i.kind]), [['Radio stations', 'folder'], ['Portugal', 'folder'], ['FIP', 'item']]);
  await control.enter(1);
  await control.back();
  await control.play(2);
  assert.ok(radio.log.includes('SET/netRemote.nav.action.navigate=1'));
  assert.ok(radio.log.includes(`SET/netRemote.nav.action.navigate=${0xffffffff}`));
  assert.ok(radio.log.includes('SET/netRemote.nav.action.selectItem=2'));
});

test('a list the radio is still loading is retried', async () => {
  radio.blockedListReads = 1;
  const items = await control.browse();
  assert.equal(items.length, 3);
});

test('requests are one at a time, on one session', async () => {
  await Promise.all([control.status(), control.setVolume(3), control.status()]);
  assert.equal(radio.log.filter((l) => l === 'CREATE_SESSION').length, 1);
});

test('a forgotten session is replaced without the caller noticing', async () => {
  await control.setVolume(4);
  radio.sessions.clear(); // the radio drops it (e.g. another app took over)
  await control.setVolume(5);
  assert.equal(radio.nodes.get('netRemote.sys.audio.volume')?.v, 5);
  assert.equal(radio.log.filter((l) => l === 'CREATE_SESSION').length, 2);
});

test('closing ends the session on the radio', async () => {
  await control.setVolume(4);
  assert.equal(radio.sessions.size, 1);
  await control.close();
  assert.equal(radio.sessions.size, 0);
});

test('a wrong PIN is a clear error', async () => {
  const bad = new RadioControl({ host: '127.0.0.1', port, pin: '0000', idleCloseMs: 0 });
  await assert.rejects(bad.status(), (e: unknown) => e instanceof FsapiError && e.code === 'BAD_PIN');
});

test('change notifications are returned and consumed', async () => {
  await control.setVolume(1);
  radio.notify('netRemote.play.info.text', { t: 'c8_array', v: 'New title' });
  assert.deepEqual(await control.client.notifications(), [{ node: 'netremote.play.info.text', value: 'New title' }]);
  assert.deepEqual(await control.client.notifications(), []);
});
