import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pictureRewriter } from './facade-server.ts';

test('radio service addresses become reachable ones, other addresses stay', () => {
  const r = pictureRewriter('http://192.168.222.241:8081/');
  assert.equal(r('http://radio.wifiradiofrontier.com/logo/1.png'), 'http://192.168.222.241:8081/logo/1.png');
  assert.equal(r('http://roberts.wifiradiofrontier.com/media/default.png'), 'http://192.168.222.241:8081/media/default.png');
  assert.equal(r('https://www.radiofrance.fr/cover.jpg'), 'https://www.radiofrance.fr/cover.jpg');
  assert.equal(r('not a url'), 'not a url');
  assert.equal(pictureRewriter(undefined)('http://radio.wifiradiofrontier.com/x.png'), 'http://radio.wifiradiofrontier.com/x.png');
});
