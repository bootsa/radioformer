import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { test } from 'node:test';
import { FSAPI_ST, notifyMessage, parseSearch, searchResponse, startSsdp, stableUuid } from './ssdp.ts';

const ad = { st: FSAPI_ST, location: (ip: string) => `http://${ip}:8082/device`, server: 'FOS/1.0 UPnP/1.0 Jupiter/6.5' };

test('searches are recognised, other datagrams are ignored', () => {
  assert.deepEqual(parseSearch('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n'), { st: 'ssdp:all' });
  assert.equal(parseSearch('NOTIFY * HTTP/1.1\r\nNT: x\r\n\r\n'), null);
  assert.equal(parseSearch('M-SEARCH * HTTP/1.1\r\nST: ssdp:all\r\n\r\n'), null); // no MAN header
});

test('the answer carries the address, search target and a stable identity', () => {
  const uuid = stableUuid('dancehall');
  assert.equal(uuid, stableUuid('dancehall'));
  assert.notEqual(uuid, stableUuid('other'));
  const r = searchResponse(ad, uuid, '192.168.222.241');
  assert.match(r, /^HTTP\/1\.1 200 OK\r\n/);
  assert.match(r, /LOCATION: http:\/\/192\.168\.222\.241:8082\/device/);
  assert.match(r, new RegExp(`ST: ${FSAPI_ST}`));
  assert.match(r, new RegExp(`USN: uuid:${uuid}::${FSAPI_ST}`));
  assert.match(notifyMessage(ad, uuid, '192.168.222.241', false), /NTS: ssdp:byebye/);
  assert.doesNotMatch(notifyMessage(ad, uuid, '192.168.222.241', false), /LOCATION/);
});

async function ask(port: number, st: string): Promise<string[]> {
  const client = dgram.createSocket('udp4');
  const got: string[] = [];
  client.on('message', (m) => got.push(m.toString()));
  await new Promise<void>((r) => client.bind(0, '127.0.0.1', r));
  client.send(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: ${st}\r\n\r\n`, port, '127.0.0.1');
  await new Promise((r) => setTimeout(r, 700));
  client.close();
  return got;
}

test('a running responder answers matching searches only', async () => {
  const port = 41900 + Math.floor(Math.random() * 500);
  const s = startSsdp({ uuid: stableUuid('t'), port, bindAddress: '127.0.0.1', multicast: false, localAddress: '127.0.0.1', advertisements: [ad] });
  await new Promise((r) => setTimeout(r, 100));
  try {
    const direct = await ask(port, FSAPI_ST);
    assert.equal(direct.length, 1);
    assert.match(direct[0]!, /LOCATION: http:\/\/127\.0\.0\.1:8082\/device/);
    assert.equal((await ask(port, 'ssdp:all')).length, 1);
    assert.equal((await ask(port, 'urn:schemas-upnp-org:device:MediaRenderer:1')).length, 0); // not what we are
  } finally {
    await s.close();
  }
});
