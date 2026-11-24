import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDirectoryList, searchDirectory } from './directory.ts';

const xml = `<ListOfItems><ItemCount>3</ItemCount>
<Item><ItemType>Previous</ItemType></Item>
<Item><ItemType>Station</ItemType><StationId>4779848458711058</StationId><StationName>FIP Jazz &amp; more</StationName><StationFormat>Jazz</StationFormat><StationLocation>France &gt; Paris</StationLocation><Logo>http://assets.wifiradiofrontier.com/x.png</Logo></Item>
<Item><ItemType>Station</ItemType><StationId>12</StationId><StationName>Not a directory id</StationName></Item>
</ListOfItems>`;

test('only stations with directory-style ids are listed, with text unescaped', () => {
  assert.deepEqual(parseDirectoryList(xml), [
    { id: '4779848458711058', name: 'FIP Jazz & more', format: 'Jazz', location: 'France > Paris', logo: 'http://assets.wifiradiofrontier.com/x.png' },
  ]);
});

test('a search names no radio and asks for a name search', async () => {
  let asked = '';
  const found = await searchDirectory('FIP Jazz', async (_h, p) => {
    asked = p;
    return { status: 200, contentType: 'text/xml', body: Buffer.from(xml) };
  });
  assert.equal(found?.length, 1);
  assert.match(asked, /sSearchtype=2&Search=FIP%20Jazz&mac=0{32}&/);
  assert.equal(await searchDirectory('x', async () => null), null);
  assert.deepEqual(await searchDirectory('  ', async () => assert.fail('no request for an empty query')), []);
});
