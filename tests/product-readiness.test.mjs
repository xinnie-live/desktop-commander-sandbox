import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, posix } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { extractAuthorizationUrl } from '../scripts/run-log-security.mjs';
import { isSupportedAuthorizationUrl } from '../web/authorization-url.mjs';

const ROOT = new URL('../', import.meta.url);

test('Docker context keeps every local source referenced by the fixed Dockerfile', async () => {
  const [dockerfile, dockerignore] = await Promise.all([
    readFile(new URL('Dockerfile', ROOT), 'utf8'),
    readFile(new URL('.dockerignore', ROOT), 'utf8'),
  ]);
  const exceptions = new Set(dockerignore.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('!')).map((line) => line.slice(1)));
  const sources = dockerfile.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('COPY ') && !line.includes('--from='))
    .flatMap((line) => line.slice('COPY '.length).split(/\s+/).slice(0, -1));
  assert.ok(sources.length > 0, 'Dockerfile should contain local COPY sources');
  for (const source of sources) assert.ok(exceptions.has(source), `Docker ignore rules must include Dockerfile source: ${source}`);
});

test('extracts only supported official Remote Device authorization links', () => {
  const current = 'https://mcp.desktopcommander.app/verify-device?verify_device=true&user_code=AB12-CD34';
  const legacy = 'https://mcp.desktopcommander.app/device/verify?user_code=EF56-GH78';
  assert.equal(extractAuthorizationUrl(`Verify here: ${current}`), current);
  assert.equal(extractAuthorizationUrl(`Verify here: ${legacy}`), legacy);
  assert.equal(isSupportedAuthorizationUrl(current), true);
  assert.equal(isSupportedAuthorizationUrl(legacy), true);
  assert.equal(isSupportedAuthorizationUrl('https://mcp.desktopcommander.app/verify-device?user_code=AB12-CD34'), false);
  assert.equal(extractAuthorizationUrl('https://evil.invalid/verify-device?verify_device=true&user_code=AB12-CD34'), null);
  assert.equal(extractAuthorizationUrl('https://mcp.desktopcommander.app/verify-device?user_code=AB12-CD34'), null);
  assert.equal(extractAuthorizationUrl('http://mcp.desktopcommander.app/device/verify?user_code=AB12-CD34'), null);
});


test('launcher checks prerequisites before opening dashboard and preserves failure status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dcs launcher '));
  try {
    await mkdir(join(root, 'scripts'));
    await copyFile(new URL('../scripts/launch.mjs', import.meta.url), join(root, 'scripts/launch.mjs'));
    await copyFile(new URL('../scripts/node-version.mjs', import.meta.url), join(root, 'scripts/node-version.mjs'));
    await writeFile(join(root, 'scripts/console.mjs'), `
      console.log(process.argv[2]);
      if (process.argv[2] === 'doctor') process.exit(Number(process.env.TRIAL_DOCTOR_EXIT));
    `);
    for (const code of [0, 1]) {
      const result = spawnSync(process.execPath, [join(root, 'scripts/launch.mjs')], {
        cwd: tmpdir(), env: { ...process.env, TRIAL_DOCTOR_EXIT: String(code) }, encoding: 'utf8', timeout: 10000,
      });
      assert.equal(result.status, code, result.stderr);
      assert.deepEqual(result.stdout.trim().split(/\r?\n/), code === 0 ? ['doctor', 'dashboard'] : ['doctor']);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('release allowlist includes local module dependencies and every regression suite', async () => {
  const packager = await readFile(new URL('scripts/package-release.mjs', ROOT), 'utf8');
  const list = packager.match(/const CONTENTS = \[([\s\S]*?)\];/);
  assert.ok(list, 'release packager must declare its allowlist');
  const files = new Set([...list[1].matchAll(/'([^']+)'/g)].map(match => match[1]));
  for (const file of files) {
    if (!/\.(?:mjs|js)$/.test(file)) continue;
    const source = await readFile(new URL(file, ROOT), 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const dependency = posix.normalize(posix.join(posix.dirname(file), match[1]));
      assert.ok(files.has(dependency), `${file} imports missing archive module ${dependency}`);
    }
  }
  for (const suite of await readdir(new URL('tests/', ROOT))) {
    if (suite.endsWith('.test.mjs')) assert.ok(files.has(`tests/${suite}`), `Missing regression suite: ${suite}`);
  }
});
