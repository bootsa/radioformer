import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { buildApp } from './app.ts';
import { openDb } from './db.ts';
import { SqliteLibrary } from './library.ts';

const TOKEN = 'test-token-0123456789';
const XML = '<RadioInfo><Table><DB_DALET_ARTIST_NAME>Ana</DB_DALET_ARTIST_NAME><DB_DALET_TITLE_NAME>Song</DB_DALET_TITLE_NAME></Table></RadioInfo>';
const MAC = 'e011516159f8bb18bfdaae427f54ac93';

async function setup(extra: Partial<Parameters<typeof buildApp>[0]> = {}) {
  const library = new SqliteLibrary(openDb(':memory:'));
  const app = await buildApp(
    { WEB_DIR: '/does/not/exist', LOG_LEVEL: 'silent', ADMIN_TOKEN: TOKEN, ALLOW_PRIVATE_UPSTREAMS: false, MAX_STREAMS: 2, ...extra } as Parameters<typeof buildApp>[0],
    library,
  );
  return { app, library };
}
const auth = { authorization: `Bearer ${TOKEN}` };

test('health and version endpoints answer', async () => {
  const { app } = await setup();
  assert.deepEqual((await app.inject('/healthz')).json(), { status: 'ok' });
  assert.equal((await app.inject('/api/v1/version')).json().name, 'Radioformer');
  await app.close();
});

test('stations can be created, read, changed and deleted with the token', async () => {
  const { app } = await setup();
  const created = await app.inject({ method: 'POST', url: '/api/v1/stations', headers: auth, payload: { name: 'FIP', streamUrl: 'https://icecast.radiofrance.fr/fip-hifi.aac' } });
  assert.equal(created.statusCode, 201);
  const id = created.json().id as number;
  assert.equal(id, 1000);
  assert.equal((await app.inject('/api/v1/stations')).json().length, 1);
  const put = await app.inject({ method: 'PUT', url: `/api/v1/stations/${id}`, headers: auth, payload: { name: 'FIP Radio', streamUrl: 'https://icecast.radiofrance.fr/fip-hifi.aac', collection: 'France' } });
  assert.equal(put.json().collection, 'France');
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/stations/${id}`, headers: auth })).statusCode, 204);
  assert.equal((await app.inject(`/api/v1/stations/${id}`)).statusCode, 404);
  await app.close();
});

test('changes are refused without the token, or when no token is configured', async () => {
  const { app } = await setup();
  const payload = { name: 'x', streamUrl: 'http://x/y' };
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/stations', payload })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/stations', headers: { authorization: 'Bearer wrong-wrong-wrong-1' }, payload })).statusCode, 401);
  await app.close();
  const ro = await setup({ ADMIN_TOKEN: undefined } as never);
  assert.equal((await ro.app.inject({ method: 'POST', url: '/api/v1/stations', headers: auth, payload })).statusCode, 403);
  await ro.app.close();
});

test('invalid stations are rejected', async () => {
  const { app } = await setup();
  const res = await app.inject({ method: 'POST', url: '/api/v1/stations', headers: auth, payload: { name: 'x', streamUrl: 'file:///etc/passwd' } });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('a radio can log in, browse and fetch a station, and is remembered', async () => {
  const { app, library } = await setup();
  library.createStation({ name: 'FIP', streamUrl: 'https://icecast.radiofrance.fr/fip-hifi.aac', logoId: null, description: '', country: '', language: '', tags: [], transformer: 'none', proxyMode: 'auto', collection: '', metadataSource: '', titleTemplate: '', directoryId: '' });
  const host = { host: 'radio.wifiradiofrontier.com' };
  const login = await app.inject({ url: '/setupapp/Roberts/asp/BrowseXML/loginXML.asp?token=0', headers: host });
  assert.equal(login.body, '<EncryptedToken>3a3f5ac48a1dab4e</EncryptedToken>');
  const root = await app.inject({ url: `/setupapp/Roberts/asp/BrowseXML/loginXML.asp?gofile=&mac=${MAC}&dlang=eng&fver=8&ven=rob29`, headers: host });
  assert.match(root.body, /Radio stations/);
  assert.match(root.body, /http:\/\/radio\.wifiradiofrontier\.com\/list\?tid=1/);
  const list = await app.inject({ url: `/list?tid=1&startItems=1&endItems=100&mac=${MAC}`, headers: host });
  assert.match(list.body, /<StationName>FIP<\/StationName>/);
  const detail = await app.inject({ url: `/?sSearchtype=3&Search=1000&mac=${MAC}&play`, headers: host });
  assert.match(detail.body, /<StationUrl>https:\/\/icecast\.radiofrance\.fr\/fip-hifi\.aac<\/StationUrl>/);
  assert.equal(detail.headers['cache-control'], 'no-store, no-cache, must-revalidate');
  assert.equal((await app.inject({ url: '/api/v1/radios', headers: auth })).json()[0].mac, MAC);
  await app.close();
});

test('a station with a transformer is played through our proxy', async () => {
  const { app, library } = await setup();
  library.createStation({ name: 'M80', streamUrl: 'https://stream-icy.bauermedia.pt/m80.aac', logoId: null, description: '', country: '', language: '', tags: [], transformer: 'dalet-xml', proxyMode: 'auto', collection: '', metadataSource: '', titleTemplate: '', directoryId: '' });
  const detail = await app.inject({ url: `/?sSearchtype=3&Search=1000&mac=${MAC}`, headers: { host: 'radio.test:8080' } });
  assert.match(detail.body, /<StationUrl>http:\/\/radio\.test:8080\/s\/1000<\/StationUrl>/);
  await app.close();
});

test('the browser still gets the web app at / (no radio parameters)', async () => {
  const { app } = await setup();
  const res = await app.inject('/');
  assert.equal(res.statusCode, 404); // no web build in this test; the radio handler did not claim the request
  await app.close();
});

function fakeIcecast(): Promise<{ port: number; close: () => void }> {
  const server = net.createServer((sock) => {
    sock.on('error', () => {});
    sock.once('data', () => {
      const meta = Buffer.from(`StreamTitle='${XML}';`);
      const block = Buffer.concat([meta, Buffer.alloc((16 - (meta.length % 16)) % 16)]);
      sock.write('ICY 200 OK\r\nContent-Type: audio/aac\r\nicy-metaint: 32\r\n\r\n');
      sock.write(Buffer.alloc(32, 9));
      sock.write(Buffer.concat([Buffer.from([block.length / 16]), block]));
      sock.write(Buffer.alloc(32, 9));
      sock.end(Buffer.from([0]));
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close() })),
  );
}

test('the stream proxy cleans titles for radios that ask for metadata', async () => {
  const fake = await fakeIcecast();
  const { app, library } = await setup({ ALLOW_PRIVATE_UPSTREAMS: true } as never);
  library.createStation({ name: 'Test', streamUrl: `http://127.0.0.1:${fake.port}/live`, logoId: null, description: '', country: '', language: '', tags: [], transformer: 'dalet-xml', proxyMode: 'proxy', collection: '', metadataSource: '', titleTemplate: '', directoryId: '' });
  const res = await app.inject({ url: '/s/1000', headers: { 'icy-metadata': '1' } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['icy-metaint'], '32');
  assert.match(res.rawPayload.toString('latin1'), /StreamTitle='Ana - Song';/);
  const plain = await app.inject({ url: '/s/1000' });
  assert.equal(plain.headers['icy-metaint'], undefined);
  assert.equal(plain.rawPayload.length, 64);
  fake.close();
  await app.close();
});

test('the stream proxy refuses private upstreams by default', async () => {
  const fake = await fakeIcecast();
  const { app, library } = await setup();
  library.createStation({ name: 'Local', streamUrl: `http://127.0.0.1:${fake.port}/live`, logoId: null, description: '', country: '', language: '', tags: [], transformer: 'none', proxyMode: 'proxy', collection: '', metadataSource: '', titleTemplate: '', directoryId: '' });
  assert.equal((await app.inject('/s/1000')).statusCode, 502);
  assert.equal((await app.inject('/s/4242')).statusCode, 404);
  fake.close();
  await app.close();
});

test('Radio-API station lists can be imported', async () => {
  const { app } = await setup();
  const res = await app.inject({
    method: 'POST', url: '/api/v1/import/radioapi', headers: auth,
    payload: [
      { name: 'NDR Info', url: 'http://www.ndr.de/ndrinfo_sh.m3u', logo: 'empty', desc: 'News', proxy: false, category: 'Nachrichten' },
      { name: 'Needs proxy', url: 'https://x.example/stream', proxy: true },
      { name: 'Broken', url: 'ftp://x' },
    ],
  });
  assert.equal(res.json().imported, 2);
  assert.equal(res.json().skipped.length, 1);
  const list = (await app.inject('/api/v1/stations')).json() as { name: string; collection: string; proxyMode: string }[];
  assert.equal(list.find((s) => s.name === 'NDR Info')?.collection, 'Nachrichten');
  assert.equal(list.find((s) => s.name === 'Needs proxy')?.proxyMode, 'proxy');
  await app.close();
});

import http from 'node:http';

test('a station logo is fetched, resized, stored and served, and the radio is told where it is', async () => {
  const img = http.createServer((_q, res) => res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><circle cx="150" cy="150" r="100" fill="#c33"/></svg>'));
  await new Promise<void>((r) => img.listen(0, '127.0.0.1', r));
  const { app, library } = await setup({ ALLOW_PRIVATE_UPSTREAMS: true } as never);
  library.createStation({ name: 'FIP', streamUrl: 'http://x/y', logoId: null, description: '', country: '', language: '', tags: [], transformer: 'none', proxyMode: 'direct', collection: '', metadataSource: '', titleTemplate: '', directoryId: '' });
  try {
    const res = await app.inject({ method: 'POST', url: '/api/v1/stations/1000/logo', headers: auth, payload: { url: `http://127.0.0.1:${(img.address() as net.AddressInfo).port}/logo.svg` } });
    assert.equal(res.statusCode, 200);
    const { logoId } = res.json() as { logoId: number };
    const png = await app.inject(`/logo/${logoId}.png`);
    assert.equal(png.headers['content-type'], 'image/png');
    assert.equal(png.rawPayload.subarray(1, 4).toString(), 'PNG');
    const detail = await app.inject({ url: `/?sSearchtype=3&Search=1000&mac=${MAC}`, headers: { host: 'radio.test' } });
    assert.match(detail.body, new RegExp(`<Logo>http://radio\\.test/logo/${logoId}\\.png</Logo>`));
    const other = await app.inject({ method: 'POST', url: '/api/v1/stations/1000/logo', headers: auth, payload: { url: 'ftp://nope' } });
    assert.equal(other.statusCode, 422);
  } finally {
    img.close();
    await app.close();
  }
});

test('stations without a logo show the neutral default icon', async () => {
  const { app } = await setup();
  const res = await app.inject('/media/default.png');
  assert.equal(res.headers['content-type'], 'image/png');
  assert.equal(res.rawPayload.subarray(1, 4).toString(), 'PNG');
  await app.close();
});

import { MetadataHub } from './metadata/hub.ts';

function plainIcecast(bytes: number): Promise<{ port: number; close: () => void }> {
  const server = net.createServer((sock) => {
    sock.on('error', () => {});
    sock.once('data', () => {
      sock.write('HTTP/1.0 200 OK\r\nContent-Type: audio/aac\r\n\r\n');
      sock.end(Buffer.alloc(bytes, 5));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close() })));
}

test('a station with a metadata source gets its title injected into a stream that has none', async () => {
  const fake = await plainIcecast(40_000);
  const metadata = new MetadataHub({ providers: { fake: { fetch: async () => ({ title: 'Ana - Song', track: null, programme: null, previous: [], next: null, fetchedAt: 0 }) } } });
  const library = new SqliteLibrary(openDb(':memory:'));
  const app = await buildApp({ WEB_DIR: '/x', LOG_LEVEL: 'silent', ADMIN_TOKEN: TOKEN, ALLOW_PRIVATE_UPSTREAMS: true, MAX_STREAMS: 2 } as Parameters<typeof buildApp>[0], library, { metadata });
  library.createStation({ name: 'FIP', streamUrl: `http://127.0.0.1:${fake.port}/live`, logoId: null, description: '', country: '', language: '', tags: [], transformer: 'none', proxyMode: 'auto', collection: '', metadataSource: 'fake:7', titleTemplate: '', directoryId: '' });
  try {
  const res = await app.inject({ url: '/s/1000', headers: { 'icy-metadata': '1' } });
  assert.equal(res.headers['icy-metaint'], '16000');
  assert.match(res.rawPayload.toString('latin1'), /StreamTitle='Ana - Song';/);
  const plain = await app.inject('/s/1000');
  assert.equal(plain.headers['icy-metaint'], undefined);
  assert.equal(plain.rawPayload.length, 40_000);
  const detail = await app.inject({ url: `/?sSearchtype=3&Search=1000&mac=${MAC}`, headers: { host: 'radio.test' } });
  assert.match(detail.body, /<StationUrl>http:\/\/radio\.test\/s\/1000<\/StationUrl>/); // routed through us because of the source
  const np = await app.inject('/api/v1/stations/1000/now-playing');
  assert.equal(np.json().title, 'Ana - Song');
  assert.equal((await app.inject('/api/v1/stations/4242/now-playing')).statusCode, 404);
  } finally {
    fake.close();
    await app.close();
  }
});

test('an invalid metadata source is rejected', async () => {
  const { app } = await setup();
  const res = await app.inject({ method: 'POST', url: '/api/v1/stations', headers: auth, payload: { name: 'x', streamUrl: 'http://x/y', metadataSource: 'evil:1;drop' } });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test('an unknown metadata provider is rejected, a known one accepted', async () => {
  const { app } = await setup();
  const bad = await app.inject({ method: 'POST', url: '/api/v1/stations', headers: auth, payload: { name: 'x', streamUrl: 'http://x/y', metadataSource: 'bogus:1' } });
  assert.equal(bad.statusCode, 400);
  const good = await app.inject({ method: 'POST', url: '/api/v1/stations', headers: auth, payload: { name: 'FIP', streamUrl: 'http://x/y', metadataSource: 'radiofrance:7' } });
  assert.equal(good.statusCode, 201);
  assert.equal(good.json().metadataSource, 'radiofrance:7');
  await app.close();
});
