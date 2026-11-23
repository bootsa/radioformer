import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertPublicUpstream, isPrivateAddress } from './net-guard.ts';

test('private and special addresses are recognised', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.222.241', '172.16.0.1', '172.31.255.255', '169.254.1.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:192.168.1.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '104.21.66.186', '2606:4700::1']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('literal private hosts are refused unless allowed', async () => {
  await assert.rejects(assertPublicUpstream('http://127.0.0.1:8080/x', false), /not public/);
  await assert.doesNotReject(assertPublicUpstream('http://127.0.0.1:8080/x', true));
  await assert.doesNotReject(assertPublicUpstream('http://8.8.8.8/x', false));
});

test('only http and https are allowed', async () => {
  await assert.rejects(assertPublicUpstream('file:///etc/passwd', true), /scheme/);
});
