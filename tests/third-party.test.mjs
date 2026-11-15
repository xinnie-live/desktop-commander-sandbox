import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { collectNotices } from '../scripts/third-party-notices.mjs';
import { verifyArtifact } from '../scripts/package-third-party.mjs';

test('source artifacts reject corruption and unsafe filenames', () => {
  const bytes = Buffer.from('synthetic source');
  const entry = { file: 'source-1.0.tar.gz', url: 'https://example.invalid/source', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  verifyArtifact(entry, bytes);
  verifyArtifact({ ...entry, file: 'crate-1.0.0+build.1.crate' }, bytes);
  assert.throws(() => verifyArtifact(entry, Buffer.from('tampered source!')), /checksum/);
  assert.throws(() => verifyArtifact({ ...entry, file: '../escape' }, bytes), /manifest/);
});

test('notice inventory retains original text, skips absent optional packages, and rejects unreviewed licenses or versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dcs-notices-'));
  const dir = join(root, 'node_modules/synthetic');
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ packages: { '': {}, 'node_modules/synthetic': { version: '1.0.0' }, 'node_modules/optional-platform': { version: '2.0.0', optional: true } } }));
    const pkg = { name: 'synthetic', version: '1.0.0', license: 'MIT' };
    await writeFile(join(dir, 'package.json'), JSON.stringify(pkg));
    await writeFile(join(dir, 'LICENSE'), 'Synthetic original copyright and license text');
    const result = await collectNotices(root);
    assert.equal(result.packages.length, 1);
    assert.match(result.notices, /Synthetic original copyright and license text/);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ ...pkg, version: '1.0.1' }));
    await assert.rejects(collectNotices(root), /differs from lock/);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ ...pkg, license: null }));
    await assert.rejects(collectNotices(root), /Missing license/);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'buffers', version: '0.1.1' }));
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/synthetic': { version: '0.1.1' } } }));
    await writeFile(join(dir, 'index.js'), 'synthetic modified implementation');
    await assert.rejects(collectNotices(root), /differs from the reviewed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('notice collection fails closed with pinned-toolchain recovery for missing required packages', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dcs-notices-missing-'));
  try {
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ packages: {
      'node_modules/archiver-utils/node_modules/brace-expansion': { version: '2.0.2' },
    } }));
    await assert.rejects(collectNotices(root), /Required locked package is missing:.*npm 10\.9\.4.*No required package was skipped/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
