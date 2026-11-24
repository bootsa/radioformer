import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Station, type LibraryReader } from '@radioformer/core';
import { handleXml, type XmlContext } from './index.ts';

const stations: Station[] = [
  Station.parse({ id: 1000, name: 'FIP', streamUrl: 'https://icecast.radiofrance.fr/fip-hifi.aac', description: 'Eclectic & fresh' }),
  Station.parse({ id: 1002, name: 'FIP Jazz', streamUrl: 'https://icecast.radiofrance.fr/fipjazz-hifi.aac', directoryId: '4779848458711058' }),
  Station.parse({ id: 1001, name: 'M80', streamUrl: 'https://stream-icy.bauermedia.pt/m80.aac', collection: 'Portugal' }),
];
const library: LibraryReader = {
  listStations: (c) => stations.filter((s) => !c || s.collection === c).sort((a, b) => a.name.localeCompare(b.name)),
  getStation: (id) => stations.find((s) => s.id === id) ?? null,
  getStationByDirectoryId: (d) => stations.find((s) => s.directoryId === d) ?? null,
  listCollections: () => ['Portugal'],
};
const seen: string[] = [];
const ctx: XmlContext = {
  library,
  url: (p) => `http://radio.test:8080${p}`,
  streamUrl: (s) => `http://radio.test:8080/s/${s.id}`,
  logoUrl: () => 'http://radio.test:8080/media/default.png',
  radioSeen: (m) => seen.push(m),
};
const q = (s: string) => new URLSearchParams(s);

test('login without a mac returns the fixed token', () => {
  const r = handleXml('/setupapp/Roberts/asp/BrowseXML/loginXML.asp', q('token=0'), ctx)!;
  assert.equal(r.body, '<EncryptedToken>3a3f5ac48a1dab4e</EncryptedToken>');
  assert.equal(r.contentType, 'text/plain;charset=UTF-8');
});

test('login with a mac returns the root menu and remembers the radio', () => {
  const r = handleXml('/setupapp/Roberts/asp/BrowseXML/loginXML.asp', q('gofile=&mac=e011516159f8bb18bfdaae427f54ac93&dlang=eng&fver=8&ven=rob29'), ctx)!;
  assert.match(r.body, /<ItemCount>1<\/ItemCount>/);
  assert.match(r.body, /<Title>Radio stations<\/Title>/);
  assert.match(r.body, /<UrlDir>http:\/\/radio\.test:8080\/list\?tid=1<\/UrlDir>/);
  assert.deepEqual(seen, ['e011516159f8bb18bfdaae427f54ac93']);
});

test('the list shows collections first, then stations that are in no collection', () => {
  const r = handleXml('/list', q('tid=1&startItems=1&endItems=100&mac=aa'), ctx)!;
  assert.match(r.body, /<ItemType>Previous<\/ItemType>/);
  assert.match(r.body, /<Title>Portugal<\/Title>/);
  assert.match(r.body, /<StationName>FIP<\/StationName>/);
  assert.doesNotMatch(r.body, /M80/);
  assert.doesNotMatch(r.body, /StationUrl/); // list entries are summaries
});

test('a collection lists its stations', () => {
  const r = handleXml('/list', q('tid=1&cat=Portugal'), ctx)!;
  assert.match(r.body, /<StationName>M80<\/StationName>/);
});

test('a station detail request carries the playable URL, escaped', () => {
  const r = handleXml('/', q('sSearchtype=3&Search=1000&mac=aa&play'), ctx)!;
  assert.match(r.body, /<StationUrl>http:\/\/radio\.test:8080\/s\/1000<\/StationUrl>/);
  assert.match(r.body, /<StationDesc>Eclectic &amp; fresh<\/StationDesc>/);
  assert.match(r.body, /<Logo>http:\/\/radio\.test:8080\/media\/default\.png<\/Logo>/);
});

test('an unknown station id gives a polite list, not an error status', () => {
  const r = handleXml('/', q('sSearchtype=3&Search=99999&mac=aa'), ctx)!;
  assert.equal(r.status, 200);
  assert.match(r.body, /No item found/);
});

test('long lists are paged to protect the radio', () => {
  const many: Station[] = Array.from({ length: 450 }, (_, i) => Station.parse({ id: 2000 + i, name: `S${String(i).padStart(3, '0')}`, streamUrl: 'http://x/y' }));
  const big: XmlContext = { ...ctx, library: { ...library, listStations: () => many, listCollections: () => [] } };
  const first = handleXml('/list', q('tid=1&startItems=1&endItems=500'), big)!;
  assert.equal((first.body.match(/<ItemType>Station<\/ItemType>/g) ?? []).length, 200);
  assert.match(first.body, /<ItemCount>450<\/ItemCount>/);
  const third = handleXml('/list', q('tid=1&startItems=401&endItems=500'), big)!;
  assert.equal((third.body.match(/<ItemType>Station<\/ItemType>/g) ?? []).length, 50);
});

test('paths of other protocols are not ours', () => {
  assert.equal(handleXml('/api/v1/stations', q(''), ctx), null);
});

test('a station with a directory id is shown, and found, under that id', () => {
  const list = handleXml('/list', q('tid=1'), ctx)!.body;
  assert.match(list, /<StationId>4779848458711058<\/StationId>/);
  assert.doesNotMatch(list, /<StationId>1002<\/StationId>/);
  const detail = handleXml('/setupapp/Roberts/asp/BrowseXML/Search.asp', q('sSearchtype=3&Search=4779848458711058&mac=e011516159f8bb18bfdaae427f54ac93'), ctx)!.body;
  assert.match(detail, /FIP Jazz/);
  assert.match(detail, /<StationId>4779848458711058<\/StationId>/);
});
