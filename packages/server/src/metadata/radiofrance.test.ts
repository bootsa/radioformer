import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseLivemeta } from './radiofrance.ts';

// A real answer for FIP (station 7), captured 23 Nov 2026.
const FIXTURE = JSON.parse(readFileSync(new URL('../../test-fixtures/radiofrance-fip-7.json', import.meta.url), 'utf8')) as {
  steps: Record<string, { start: number; end: number; title: string; authors: string; embedType: string }>;
};
const songs = Object.values(FIXTURE.steps).sort((a, b) => a.start - b.start);

test('a track in progress becomes "Artist - Title" with album details and cover', () => {
  const s = songs[3]!;
  const np = parseLivemeta(FIXTURE, s.start + 30);
  assert.equal(np.title, `${s.authors} - ${s.title}`);
  assert.equal(np.track?.title, s.title);
  assert.match(np.track?.cover ?? '', /^https:\/\/www\.radiofrance\.fr\/s3\//);
  assert.equal(np.previous.length, 3);
  assert.equal(np.previous[0]!.title, songs[2]!.title); // most recent first
  assert.equal(np.next?.title, songs[4]!.title);
  assert.equal(np.programme, null);
});

test('before any listed track starts, there is nothing to show', () => {
  const np = parseLivemeta(FIXTURE, songs[0]!.start - 10);
  assert.equal(np.title, '');
  assert.equal(np.track, null);
  assert.equal(np.next?.title, songs[0]!.title);
});

test('between tracks the programme title is shown when there is one', () => {
  const data = {
    steps: {
      a: { start: 100, end: 400, title: 'Club Jazzafip du lundi 23 novembre 2026', titleConcept: 'Club Jazzafip ', embedType: 'expression', depth: 1 },
      b: { start: 100, end: 200, title: 'Song', authors: 'Ana', embedType: 'song', depth: 3 },
    },
  };
  assert.equal(parseLivemeta(data, 150).title, 'Ana - Song');
  assert.equal(parseLivemeta(data, 300).title, 'Club Jazzafip');
});

test('garbage input does not throw', () => {
  assert.equal(parseLivemeta(null, 1).title, '');
  assert.equal(parseLivemeta({ steps: { x: { nope: true } } }, 1).title, '');
});
