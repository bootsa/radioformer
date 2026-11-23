import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IcyInjector } from './inject.ts';

async function run(audio: Buffer, chunk: number, titles: string[]): Promise<Buffer> {
  let n = 0;
  const inj = new IcyInjector({ metaint: 32, getTitle: () => titles[Math.min(n++, titles.length - 1)]! });
  const out: Buffer[] = [];
  inj.on('data', (c: Buffer) => out.push(c));
  for (let i = 0; i < audio.length; i += chunk) inj.write(audio.subarray(i, i + chunk));
  inj.end();
  await new Promise((r) => inj.on('end', r));
  return Buffer.concat(out);
}

/** Splits an injected stream back into audio and blocks. */
function split(buf: Buffer, metaint: number): { audio: Buffer; blocks: string[] } {
  const audio: Buffer[] = [];
  const blocks: string[] = [];
  let i = 0;
  while (i < buf.length) {
    audio.push(buf.subarray(i, i + metaint));
    i += metaint;
    if (i >= buf.length) break;
    const len = buf[i++]! * 16;
    blocks.push(buf.subarray(i, i + len).toString().replace(/\0+$/, ''));
    i += len;
  }
  return { audio: Buffer.concat(audio), blocks };
}

test('audio passes through unchanged and the first block carries the title', async () => {
  const audio = Buffer.from(Array.from({ length: 32 * 5 }, (_, i) => i % 251));
  for (const chunk of [1, 7, 32, 33, 1000]) {
    const { audio: got, blocks } = split(await run(audio, chunk, ['Ana - Song']), 32);
    assert.deepEqual(got, audio, `chunk ${chunk}`);
    assert.equal(blocks[0], "StreamTitle='Ana - Song';");
    assert.deepEqual(blocks.slice(1), ['', '', '', '']); // unchanged title: empty blocks
  }
});

test('a changed title is announced once, at the next block', async () => {
  const audio = Buffer.alloc(32 * 5, 1);
  const { blocks } = split(await run(audio, 64, ['A', 'A', 'B', 'B', 'B']), 32);
  assert.deepEqual(blocks.map((b) => b.replace("StreamTitle='", '').replace("';", '')), ['A', '', 'B', '', '']);
});

test('apostrophes are replaced so a block cannot be cut short', async () => {
  const { blocks } = split(await run(Buffer.alloc(64, 1), 64, ["It's me"]), 32);
  assert.equal(blocks[0], "StreamTitle='It’s me';");
});
