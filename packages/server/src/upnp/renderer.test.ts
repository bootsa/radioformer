import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { httpRequest } from './http.ts';
import { RendererFace, blankTrackDetails, deviceDescription, soapAction } from './renderer.ts';

const DD = (port: number) => `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><device><manufacturer>Roberts</manufacturer><modelName>Stream94i</modelName><serviceList>
<service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><serviceId>urn:upnp-org:serviceId:AVTransport</serviceId><SCPDURL>AVTransport/scpd.xml</SCPDURL><controlURL>AVTransport/control</controlURL><eventSubURL>AVTransport/event</eventSubURL></service>
<service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><serviceId>x</serviceId><SCPDURL>RenderingControl/scpd.xml</SCPDURL><controlURL>RenderingControl/control</controlURL><eventSubURL>RenderingControl/event</eventSubURL></service>
</serviceList></device><!-- ${port} --></root>`;

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function listen(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void): Promise<{ server: http.Server; port: number; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString();
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      handler(req, body, res);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: (server.address() as AddressInfo).port, seen })));
}

const faceReq = (method: string, path: string, headers: Record<string, string> = {}, body = '') => ({ method, path, headers, body, host: '127.0.0.1:9' });

test('track details are removed, the address stays', () => {
  const soap = '<u:SetAVTransportURI><InstanceID>0</InstanceID><CurrentURI>http://x/a.mp3</CurrentURI><CurrentURIMetaData>&lt;DIDL-Lite&gt;&lt;/DIDL-Lite&gt;</CurrentURIMetaData></u:SetAVTransportURI>';
  const out = blankTrackDetails(soap);
  assert.match(out, /<CurrentURI>http:\/\/x\/a\.mp3<\/CurrentURI>/);
  assert.match(out, /<CurrentURIMetaData><\/CurrentURIMetaData>/);
  assert.equal(blankTrackDetails('<CurrentURIMetaData/>'), '<CurrentURIMetaData/>');
  assert.equal(soapAction({ soapaction: '"urn:schemas-upnp-org:service:AVTransport:1#Play"' }), 'Play');
});

test('the description names us, not the radio, and points at our own addresses', () => {
  const d = deviceDescription({ uuid: 'abc', name: 'Dancehall+ & co', modelName: 'M', manufacturer: 'R' });
  assert.match(d, /<friendlyName>Dancehall\+ &amp; co<\/friendlyName>/);
  assert.match(d, /<UDN>uuid:abc<\/UDN>/);
  assert.match(d, /<controlURL>\/upnp\/AVTransport\/control<\/controlURL>/);
  assert.match(d, /MediaRenderer:1/);
});

test('commands go to the radio after it has been prepared, and answers come back', async () => {
  const radio = await listen((req, _b, res) => {
    if (req.url === '/dd.xml') res.end(DD(0));
    else if (req.url === '/AVTransport/scpd.xml') res.end('<scpd/>');
    else res.writeHead(200, { 'Content-Type': 'text/xml' }).end('<ok/>');
  });
  const order: string[] = [];
  const face = new RendererFace({ upstream: () => `http://127.0.0.1:${radio.port}/dd.xml`, uuid: 'u', name: 'N', prepare: async () => void order.push('prepare') });
  try {
    const desc = await face.handle(faceReq('GET', '/upnp/desc.xml'));
    assert.equal(desc.status, 200);
    assert.match(desc.body, /<modelName>Stream94i<\/modelName>/);
    assert.equal((await face.handle(faceReq('GET', '/upnp/AVTransport/scpd.xml'))).body, '<scpd/>');

    const play = await face.handle(faceReq('POST', '/upnp/AVTransport/control', { soapaction: '"urn:schemas-upnp-org:service:AVTransport:1#Play"' }, '<Play/>'));
    assert.equal(play.status, 200);
    assert.deepEqual(order, []); // Play alone does not switch modes

    const set = await face.handle(
      faceReq('POST', '/upnp/AVTransport/control', { soapaction: '"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI"' }, '<CurrentURI>http://a/b</CurrentURI><CurrentURIMetaData>junk</CurrentURIMetaData>'),
    );
    assert.equal(set.status, 200);
    assert.deepEqual(order, ['prepare']);
    const forwarded = radio.seen.filter((s) => s.method === 'POST').at(-1)!;
    assert.equal(forwarded.url, '/AVTransport/control');
    assert.match(forwarded.body, /<CurrentURIMetaData><\/CurrentURIMetaData>/);
    assert.match(String(forwarded.headers['soapaction']), /SetAVTransportURI/);

    assert.equal((await face.handle(faceReq('GET', '/nowhere'))).status, 404);
  } finally {
    await face.close();
    radio.server.close();
  }
});

test('a failing preparation does not stop the command', async () => {
  const radio = await listen((req, _b, res) => (req.url === '/dd.xml' ? res.end(DD(0)) : res.end('<ok/>')));
  const face = new RendererFace({ upstream: () => `http://127.0.0.1:${radio.port}/dd.xml`, uuid: 'u', name: 'N', prepare: async () => Promise.reject(new Error('no mode')) });
  try {
    const r = await face.handle(faceReq('POST', '/upnp/AVTransport/control', { soapaction: '"x#SetAVTransportURI"' }, '<CurrentURI>a</CurrentURI>'));
    assert.equal(r.status, 200);
  } finally {
    await face.close();
    radio.server.close();
  }
});

test('events from the radio reach every subscribed app, and the radio is told when the last one leaves', async () => {
  const radio = await listen((req, _b, res) => {
    if (req.url === '/dd.xml') return void res.end(DD(0));
    if (req.method === 'SUBSCRIBE') return void res.writeHead(200, { SID: 'uuid:radio-sid', TIMEOUT: 'Second-300' }).end();
    res.writeHead(200).end();
  });
  const app = await listen((_r, _b, res) => res.writeHead(200).end());
  const face = new RendererFace({ upstream: () => `http://127.0.0.1:${radio.port}/dd.xml`, uuid: 'u', name: 'N', publicBase: 'http://127.0.0.1:7777' });
  try {
    const sub = await face.handle(faceReq('SUBSCRIBE', '/upnp/AVTransport/event', { callback: `<http://127.0.0.1:${app.port}/cb>`, nt: 'upnp:event', timeout: 'Second-120' }));
    assert.equal(sub.status, 200);
    assert.match(sub.headers['SID'] ?? '', /^uuid:/);
    assert.equal(sub.headers['TIMEOUT'], 'Second-120');
    await new Promise((r) => setTimeout(r, 150));
    const subscribe = radio.seen.find((s) => s.method === 'SUBSCRIBE')!;
    assert.equal(subscribe.url, '/AVTransport/event');
    assert.equal(subscribe.headers['callback'], '<http://127.0.0.1:7777/upnp/AVTransport/notify>');

    // the radio announces something
    assert.equal((await face.handle(faceReq('NOTIFY', '/upnp/AVTransport/notify', { sid: 'uuid:radio-sid' }, '<e:propertyset>one</e:propertyset>'))).status, 200);
    await new Promise((r) => setTimeout(r, 150));
    const got = app.seen.filter((s) => s.method === 'NOTIFY');
    assert.equal(got.length, 1);
    assert.equal(got[0]!.body, '<e:propertyset>one</e:propertyset>');
    assert.equal(got[0]!.headers['seq'], '0');
    assert.equal(got[0]!.headers['sid'], sub.headers['SID']);

    // a second app joining later gets the last state straight away, as its first event
    const sub2 = await face.handle(faceReq('SUBSCRIBE', '/upnp/AVTransport/event', { callback: `<http://127.0.0.1:${app.port}/cb2>` }));
    await new Promise((r) => setTimeout(r, 150));
    const late = app.seen.filter((s) => s.method === 'NOTIFY' && s.url === '/cb2');
    assert.equal(late.length, 1);
    assert.equal(late[0]!.headers['seq'], '0');

    // renewing and leaving
    assert.equal((await face.handle(faceReq('SUBSCRIBE', '/upnp/AVTransport/event', { sid: sub.headers['SID']! }))).status, 200);
    assert.equal((await face.handle(faceReq('SUBSCRIBE', '/upnp/AVTransport/event', { sid: 'uuid:nope' }))).status, 412);
    assert.equal((await face.handle(faceReq('UNSUBSCRIBE', '/upnp/AVTransport/event', { sid: sub.headers['SID']! }))).status, 200);
    assert.equal(radio.seen.some((s) => s.method === 'UNSUBSCRIBE'), false); // one app is still listening
    assert.equal((await face.handle(faceReq('UNSUBSCRIBE', '/upnp/AVTransport/event', { sid: sub2.headers['SID']! }))).status, 200);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(radio.seen.some((s) => s.method === 'UNSUBSCRIBE' && s.headers['sid'] === 'uuid:radio-sid'), true);
  } finally {
    await face.close();
    radio.server.close();
    app.server.close();
  }
});

test('subscribing without a callback is refused; an unreachable radio gives 503', async () => {
  const face = new RendererFace({ upstream: () => 'http://127.0.0.1:1/dd.xml', uuid: 'u', name: 'N' });
  assert.equal((await face.handle(faceReq('SUBSCRIBE', '/upnp/RenderingControl/event'))).status, 412);
  assert.equal((await face.handle(faceReq('POST', '/upnp/RenderingControl/control', {}, '<x/>'))).status, 503);
  const nothing = new RendererFace({ upstream: () => null, uuid: 'u', name: 'N' });
  assert.equal((await nothing.handle(faceReq('GET', '/upnp/AVTransport/scpd.xml'))).status, 503);
  await face.close();
  await httpRequest('http://127.0.0.1:1/', { timeoutMs: 200 }).catch(() => undefined);
});
