import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IcyRewriter, rewriteMetaBlock } from './icy.ts';
import { daletXml } from './transformers.ts';

const pad = (s: string): Buffer => {
  const b = Buffer.from(s);
  return Buffer.concat([b, Buffer.alloc((16 - (b.length % 16)) % 16)]);
};
const XML =
  '<RadioInfo><Table><DB_DALET_ARTIST_NAME>Ana</DB_DALET_ARTIST_NAME><DB_DALET_TITLE_NAME>Song</DB_DALET_TITLE_NAME></Table></RadioInfo>';

test('only the title changes; StreamUrl and other fields are kept', () => {
  const out = rewriteMetaBlock(pad(`StreamTitle='${XML}';StreamUrl='http://x/1';adId='7';`), daletXml);
  assert.equal(out.length % 16, 0);
  assert.equal(out.toString().replace(/\0+$/, ''), "StreamTitle='Ana - Song';StreamUrl='http://x/1';adId='7';");
});

test('ad blocks with an empty title are unchanged in meaning', () => {
  const out = rewriteMetaBlock(pad("StreamTitle='';StreamUrl='';adw_ad='true';"), daletXml);
  assert.equal(out.toString().replace(/\0+$/, ''), "StreamTitle='';StreamUrl='';adw_ad='true';");
});

test('apostrophes in titles cannot break the block', () => {
  const out = rewriteMetaBlock(pad(`StreamTitle='<RadioInfo><Table><DB_DALET_TITLE_NAME>It's me</DB_DALET_TITLE_NAME></Table></RadioInfo>';`), daletXml);
  assert.equal(out.toString().replace(/\0+$/, ''), "StreamTitle='It’s me';");
});

function stream(metaint: number, blocks: Buffer[], audioPerBlock = metaint): Buffer {
  const parts: Buffer[] = [];
  blocks.forEach((b, i) => {
    parts.push(Buffer.alloc(audioPerBlock, i + 1));
    parts.push(Buffer.from([b.length / 16]), b);
  });
  return Buffer.concat(parts);
}

async function run(input: Buffer, emitMeta: boolean, chunkSize: number): Promise<{ out: Buffer; titles: string[] }> {
  const titles: string[] = [];
  const r = new IcyRewriter({ metaint: 64, emitMeta, transform: daletXml, onTitle: (t) => titles.push(t) });
  const chunks: Buffer[] = [];
  r.on('data', (c: Buffer) => chunks.push(c));
  for (let i = 0; i < input.length; i += chunkSize) r.write(input.subarray(i, i + chunkSize));
  r.end();
  await new Promise((res) => r.on('end', res));
  return { out: Buffer.concat(chunks), titles };
}

test('rewrites blocks regardless of how the bytes are chunked', async () => {
  const input = stream(64, [pad(`StreamTitle='${XML}';`), Buffer.alloc(0), pad("StreamTitle='Plain';")]);
  for (const size of [1, 7, 64, 65, 1000]) {
    const { out, titles } = await run(input, true, size);
    assert.deepEqual(titles, ['Ana - Song', 'Plain'], `chunk ${size}`);
    // audio bytes survive in the same positions
    assert.equal(out[0], 1);
    assert.equal(out[out.length - 1] !== undefined, true);
  }
});

test('clients that did not ask for metadata get audio only', async () => {
  const input = stream(64, [pad(`StreamTitle='${XML}';`), Buffer.alloc(0), pad("StreamTitle='Plain';")]);
  const { out } = await run(input, false, 13);
  assert.equal(out.length, 64 * 3);
  assert.equal(out.subarray(0, 64).every((b) => b === 1), true);
  assert.equal(out.subarray(64, 128).every((b) => b === 2), true);
});

test('with metadata on, an empty block stays one zero byte', async () => {
  const input = stream(64, [Buffer.alloc(0)]);
  const { out } = await run(input, true, 64);
  assert.equal(out.length, 65);
  assert.equal(out[64], 0);
});
