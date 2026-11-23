import assert from 'node:assert/strict';
import net from 'node:net';
import { test } from 'node:test';
import { Writable } from 'node:stream';
import { connectStream } from './proxy.ts';

const XML = '<RadioInfo><Table><DB_DALET_ARTIST_NAME>Ana</DB_DALET_ARTIST_NAME><DB_DALET_TITLE_NAME>Song</DB_DALET_TITLE_NAME></Table></RadioInfo>';

/** A tiny fake Icecast server: ICY status line, metaint 32, three blocks, then closes. */
function fakeIcecast(statusLine = 'ICY 200 OK'): Promise<{ port: number; close: () => void }> {
  const server = net.createServer((sock) => {
    sock.once('data', () => {
      const meta = Buffer.from(`StreamTitle='${XML}';`);
      const block = Buffer.concat([meta, Buffer.alloc((16 - (meta.length % 16)) % 16)]);
      sock.write(`${statusLine}\r\nContent-Type: audio/aac\r\nicy-metaint: 32\r\nicy-name: Fake\r\n\r\n`);
      for (let i = 0; i < 3; i++) {
        sock.write(Buffer.alloc(32, 7));
        sock.write(i === 1 ? Buffer.concat([Buffer.from([block.length / 16]), block]) : Buffer.from([0]));
      }
      sock.end();
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ port: (server.address() as net.AddressInfo).port, close: () => server.close() }),
    ),
  );
}

async function collect(wantMeta: boolean, status?: string): Promise<{ body: Buffer; metaint: number | null; titles: string[] }> {
  const fake = await fakeIcecast(status);
  try {
    const titles: string[] = [];
    const res = await connectStream({
      url: `http://127.0.0.1:${fake.port}/live`,
      transformer: 'dalet-xml',
      wantMeta,
      onTitle: (t) => titles.push(t),
    });
    const chunks: Buffer[] = [];
    await res.pump(new Writable({ write: (c: Buffer, _e, cb) => (chunks.push(c), cb()) }));
    return { body: Buffer.concat(chunks), metaint: res.metaint, titles };
  } finally {
    fake.close();
  }
}

test('accepts an ICY status line and cleans the title', async () => {
  const { body, metaint, titles } = await collect(true);
  assert.equal(metaint, 32);
  assert.deepEqual(titles, ['Ana - Song']);
  assert.match(body.toString('latin1'), /StreamTitle='Ana - Song';/);
});

test('without wantMeta the client gets plain audio and no metaint', async () => {
  const { body, metaint } = await collect(false, 'HTTP/1.0 200 OK');
  assert.equal(metaint, null);
  assert.equal(body.length, 96);
});

test('a non-200 upstream is an error', async () => {
  const fake = await fakeIcecast('HTTP/1.0 404 Not Found');
  try {
    await assert.rejects(connectStream({ url: `http://127.0.0.1:${fake.port}/x`, transformer: 'none', wantMeta: true }), /404/);
  } finally {
    fake.close();
  }
});

import { parsePlaylist } from './proxy.ts';

test('playlists: M3U and PLS give the first stream address', () => {
  assert.equal(parsePlaylist('#EXTM3U\n#EXTINF:-1,NDR\nhttp://a.example/live.mp3\nhttp://b.example/x\n', 'http://p/'), 'http://a.example/live.mp3');
  assert.equal(parsePlaylist('[playlist]\nNumberOfEntries=1\nFile1=http://a.example/s.aac\nTitle1=X\nVersion=2\n', 'http://p/'), 'http://a.example/s.aac');
  assert.equal(parsePlaylist('#EXTM3U\n/live/a.mp3\n', 'http://host.example/pl/list.m3u'), 'http://host.example/live/a.mp3');
  assert.equal(parsePlaylist('#EXTM3U\nftp://x/y\n', 'http://p/'), null);
});

test('connectStream follows a playlist to the real stream', async () => {
  const fake = await fakeIcecast();
  const pl = net.createServer((sock) => {
    sock.on('error', () => {});
    sock.once('data', () => sock.end(`HTTP/1.0 200 OK\r\nContent-Type: audio/x-mpegurl\r\n\r\n#EXTM3U\nhttp://127.0.0.1:${fake.port}/live\n`));
  });
  await new Promise<void>((r) => pl.listen(0, '127.0.0.1', r));
  try {
    const res = await connectStream({ url: `http://127.0.0.1:${(pl.address() as net.AddressInfo).port}/list.m3u`, transformer: 'dalet-xml', wantMeta: true });
    const chunks: Buffer[] = [];
    await res.pump(new Writable({ write: (c: Buffer, _e, cb) => (chunks.push(c), cb()) }));
    assert.match(Buffer.concat(chunks).toString('latin1'), /StreamTitle='Ana - Song';/);
  } finally {
    pl.close();
    fake.close();
  }
});
