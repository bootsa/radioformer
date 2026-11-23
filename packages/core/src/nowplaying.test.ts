import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderTitle, type NowPlaying } from './nowplaying.ts';

const track = (title: string, artist: string, extra = {}) => ({ title, artist, album: '', year: null, label: '', cover: '', start: 0, end: 1, ...extra });
const np: NowPlaying = {
  title: 'Jane Birkin - Di doo dah',
  track: track('Di doo dah', 'Jane Birkin', { album: 'Quoi', year: 1973, label: 'PHILIPS' }),
  programme: { title: 'Club Jazzafip', start: 0, end: 1 },
  previous: [track('I can’t help it', 'Michael Jackson')],
  next: track('Only', 'Lydia Kitto'),
  fetchedAt: 0,
};

test('without a template the broadcaster title is used', () => {
  assert.equal(renderTitle(np, ''), 'Jane Birkin - Di doo dah');
});

test('values are filled in', () => {
  assert.equal(renderTitle(np, '{artist}: {title} ({album}, {year})'), 'Jane Birkin: Di doo dah (Quoi, 1973)');
});

test('optional parts appear only when all their values exist', () => {
  const t = '{track}[ · On air: {programme}][ · Next: {next}][ · Label: {label}]';
  assert.equal(renderTitle(np, t), 'Jane Birkin - Di doo dah · On air: Club Jazzafip · Next: Lydia Kitto - Only · Label: PHILIPS');
  assert.equal(renderTitle({ ...np, programme: null, next: null }, t), 'Jane Birkin - Di doo dah · Label: PHILIPS');
});

test('an empty result falls back to the broadcaster title', () => {
  assert.equal(renderTitle({ ...np, track: null, title: 'Club Jazzafip' }, '{artist} - {title}'), 'Club Jazzafip');
});

test('previous and unknown names', () => {
  assert.equal(renderTitle(np, '{track}[ (before: {previous})]'), 'Jane Birkin - Di doo dah (before: Michael Jackson - I can’t help it)');
  assert.equal(renderTitle(np, '{track}{nonsense}'), 'Jane Birkin - Di doo dah');
});
