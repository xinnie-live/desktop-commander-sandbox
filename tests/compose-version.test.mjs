import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isComposeVersionSupported, MINIMUM_COMPOSE_VERSION } from '../scripts/compose-version.mjs';

test('accepts the minimum Compose release and newer versions', () => {
  assert.equal(MINIMUM_COMPOSE_VERSION, '2.24.1');
  assert.equal(isComposeVersionSupported('v2.24.1'), true);
  assert.equal(isComposeVersionSupported('2.24.2'), true);
  assert.equal(isComposeVersionSupported('v2.25.0'), true);
  assert.equal(isComposeVersionSupported('Docker Compose version v3.0.0'), true);
});

test('rejects Compose releases older than build.extra_hosts support', () => {
  assert.equal(isComposeVersionSupported('v2.24.0'), false);
  assert.equal(isComposeVersionSupported('v2.23.99'), false);
  assert.equal(isComposeVersionSupported('v1.29.2'), false);
});

test('rejects missing or unparseable Compose versions', () => {
  assert.equal(isComposeVersionSupported(''), false);
  assert.equal(isComposeVersionSupported('not installed'), false);
});
