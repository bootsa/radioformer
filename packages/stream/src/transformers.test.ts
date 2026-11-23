import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daletXml } from './transformers.ts';

// Samples captured from real Radio Comercial and M80 streams (shortened).
const SONG =
  '<?xml version="1.0" encoding="utf-8"?><RadioInfo><Table><DB_ALBUM_ID>38616</DB_ALBUM_ID><DB_DALET_ARTIST_NAME>Diana Castro</DB_DALET_ARTIST_NAME><DB_DALET_TITLE_NAME>O Amor Nunca Acaba</DB_DALET_TITLE_NAME><DB_FK_SITE_ID>1</DB_FK_SITE_ID></Table></RadioInfo>';
const PROGRAMME =
  '<?xml version="1.0" encoding="utf-8"?><RadioInfo><Table><DB_DALET_TITLE_NAME>A melhor musica, sempre</DB_DALET_TITLE_NAME><DB_RADIO_NAME>Rádio Comercial</DB_RADIO_NAME></Table><AnimadorInfo><TITLE>Manhãs da Comercial</TITLE><DESCRIPTION>Pedro, Vera</DESCRIPTION></AnimadorInfo></RadioInfo>';

test('a song becomes "Artist - Title"', () => {
  assert.equal(daletXml(SONG), 'Diana Castro - O Amor Nunca Acaba');
});

test('between songs the programme name leads', () => {
  assert.equal(daletXml(PROGRAMME), 'Manhãs da Comercial - A melhor musica, sempre');
});

test('XML entities are decoded', () => {
  const s = '<RadioInfo><Table><DB_DALET_ARTIST_NAME>Ana &amp; Rui</DB_DALET_ARTIST_NAME><DB_DALET_TITLE_NAME>A &lt;b&gt;</DB_DALET_TITLE_NAME></Table></RadioInfo>';
  assert.equal(daletXml(s), 'Ana & Rui - A <b>');
});

test('truncated XML still yields what is complete', () => {
  const s = '<?xml version="1.0"?><RadioInfo><Table><DB_DALET_ARTIST_NAME>Ana</DB_DALET_ARTIST_NAME><DB_DALET_TITLE_NAME>Song</DB_DALET_TITLE_NAME><DB_X>trunc';
  assert.equal(daletXml(s), 'Ana - Song');
});

test('plain titles and empty titles pass through', () => {
  assert.equal(daletXml('Cure - Friday I’m In Love'), 'Cure - Friday I’m In Love');
  assert.equal(daletXml(''), '');
});
