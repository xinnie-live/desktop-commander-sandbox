import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReleaseMetadata } from '../scripts/validate-release.mjs';

function fixture(version = '0.1.0') {
  return { pkg: { version }, lock: { version, packages: { '': { version } } }, compose: `services:\n  remote-device:\n    image: ghcr.io/xinnie-live/desktop-commander-sandbox:${version}\n`, changelog: version.includes('-') ? '## [Unreleased]\n' : `## [${version}] - 2026-11-15\n` };
}

test('release gate rejects version, image, tag and changelog drift before publication', () => {
  const options = { tag: 'v0.1.0' };
  assert.equal(validateReleaseMetadata(fixture(), options), '0.1.0');
  for (const change of [data => { data.lock.version = '0.0.0-dev'; }, data => { data.lock.packages[''].version = '0.2.0'; }, data => { data.compose = data.compose.replace(':0.1.0', ':latest'); }, data => { data.changelog = '## [Unreleased]\n'; }]) {
    const data = fixture(); change(data);
    assert.throws(() => validateReleaseMetadata(data, options));
  }
  assert.throws(() => validateReleaseMetadata(fixture(), { tag: 'v0.2.0' }), /tag/);
  assert.throws(() => validateReleaseMetadata(fixture('0.0.0-dev'), { tag: 'v0.0.0-dev' }), /stable/);
});

test('development metadata is allowed only for a rehearsal, with all versions still consistent', () => {
  const data = fixture('0.0.0-dev');
  assert.equal(validateReleaseMetadata(data, { rehearsal: true }), '0.0.0-dev');
  data.lock.version = '0.1.0';
  assert.throws(() => validateReleaseMetadata(data, { rehearsal: true }), /package-lock/);
});
