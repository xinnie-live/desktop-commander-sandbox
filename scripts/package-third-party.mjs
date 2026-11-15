import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function verifyArtifact(entry, bytes) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(entry.file) || !/^https:\/\//.test(entry.url)
    || !/^[a-f0-9]{64}$/.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 1) throw new Error('Invalid source manifest entry');
  if (bytes.length !== entry.bytes || createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error(`Source checksum mismatch: ${entry.file}`);
}

async function main() {
  const manifest = JSON.parse(await readFile(join(ROOT, 'third-party/sources.lock.json'), 'utf8'));
  const version = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8')).version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid version');
  const dist = join(ROOT, 'dist');
  const cache = join(dist, 'third-party-cache');
  await mkdir(cache, { recursive: true });
  for (const directory of [dist, cache]) if ((await lstat(directory)).isSymbolicLink()) throw new Error('Source output must not be a symlink');
  const queue = [...manifest.artifacts];
  if (new Set(queue.map(e => e.file)).size !== queue.length) throw new Error('Duplicate source filename');
  async function worker() {
    while (queue.length) {
      const entry = queue.shift();
      // Validate paths before using a filename from the checked-in manifest.
      if (!/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(entry.file)) throw new Error('Invalid source filename');
      const file = join(cache, entry.file);
      try {
        if (!(await lstat(file)).isFile() || (await lstat(file)).isSymbolicLink()) throw new Error('Source cache must contain regular files');
        verifyArtifact(entry, await readFile(file));
        continue;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      let bytes;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await fetch(entry.url, { signal: AbortSignal.timeout(60000) });
          if (!response.ok) throw new Error(`Source HTTP ${response.status}: ${entry.file}`);
          bytes = Buffer.from(await response.arrayBuffer());
          verifyArtifact(entry, bytes);
          break;
        } catch (error) { if (attempt === 2) throw error; }
      }
      await writeFile(file, bytes, { flag: 'wx' });
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  const stage = await mkdtemp(join(dist, '.third-party-stage-'));
  const name = `desktop-commander-sandbox-third-party-sources-${version}.tar.gz`;
  const temporary = join(stage, `${name}.tmp`);
  try {
    await mkdir(join(stage, 'sources'));
    for (const entry of manifest.artifacts) await cp(join(cache, entry.file), join(stage, 'sources', entry.file));
    await cp(join(ROOT, 'third-party'), join(stage, 'third-party'), { recursive: true, filter: file => !file.startsWith(join(ROOT, 'third-party/installed')) });
    await cp(join(ROOT, 'THIRD-PARTY-NOTICES.md'), join(stage, 'THIRD-PARTY-NOTICES.md'));
    const result = spawnSync('tar', ['-czf', temporary, '-C', stage, 'sources', 'third-party', 'THIRD-PARTY-NOTICES.md'], { stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error('Could not create third-party source archive (tar is required)');
    const bytes = await readFile(temporary);
    await rename(temporary, join(dist, name));
    const checksum = join(stage, 'checksum');
    await writeFile(checksum, `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`, { flag: 'wx' });
    await rename(checksum, join(dist, `${name}.sha256`));
    console.log(`Created dist/${name}: ${manifest.artifacts.length} verified source/patch archives.`);
  } finally {
    await rm(stage, { recursive: true, force: true });
    await rm(temporary, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
