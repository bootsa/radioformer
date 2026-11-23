import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import sharp from 'sharp';
import { fetchImage, getDefaultLogo, sha256, toRadioPng } from './logos.ts';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="250"><rect width="500" height="250" fill="#0a7"/></svg>';

test('any image becomes a 150x150 PNG without distortion', async () => {
  const { data, width, height } = await toRadioPng(Buffer.from(SVG));
  assert.deepEqual([width, height], [150, 150]);
  const meta = await sharp(data).metadata();
  assert.equal(meta.format, 'png');
  assert.deepEqual([meta.width, meta.height], [150, 150]);
  // wide image: letterboxed with white bars at the top
  const top = await sharp(data).extract({ left: 75, top: 2, width: 1, height: 1 }).raw().toBuffer();
  assert.deepEqual([...top].slice(0, 3), [255, 255, 255]);
});

test('the default logo is a 150x150 PNG', async () => {
  const meta = await sharp(await getDefaultLogo()).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ['png', 150, 150]);
});

test('hashes are stable', () => {
  assert.equal(sha256(Buffer.from('a')), 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
});

function server(handler: http.RequestListener): Promise<{ url: string; close: () => void }> {
  const s = http.createServer(handler);
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r({ url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, close: () => s.close() })));
}

test('fetchImage downloads an image, follows redirects, and refuses private hosts unless allowed', async () => {
  const s = await server((req, res) => {
    if (req.url === '/redir') return void res.writeHead(302, { Location: '/logo.svg' }).end();
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' }).end(SVG);
  });
  try {
    assert.equal((await fetchImage(`${s.url}/redir`, true)).toString(), SVG);
    await assert.rejects(fetchImage(`${s.url}/logo.svg`, false), /not public/);
  } finally {
    s.close();
  }
});

test('fetchImage refuses things that are not images, and huge downloads', async () => {
  const s = await server((req, res) => {
    if (req.url === '/big') return void res.writeHead(200, { 'Content-Type': 'image/png' }).end(Buffer.alloc(3 * 1024 * 1024));
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html></html>');
  });
  try {
    await assert.rejects(fetchImage(`${s.url}/page`, true), /not an image/);
    await assert.rejects(fetchImage(`${s.url}/big`, true), /too large/);
  } finally {
    s.close();
  }
});
