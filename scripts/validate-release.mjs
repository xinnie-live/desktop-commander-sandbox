import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function validateReleaseMetadata({ pkg, lock, compose, changelog }, { rehearsal = false, tag } = {}) {
  const version = pkg.version;
  const pattern = rehearsal ? /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/ : /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (typeof version !== 'string' || !pattern.test(version)) throw new Error('Release requires a stable x.y.z version; development versions are rehearsal-only.');
  if (lock.version !== version || lock.packages?.['']?.version !== version) throw new Error('package-lock.json root versions must match package.json.');
  const images = [...compose.matchAll(/^\s+image:\s*(\S+)\s*$/gm)].map(match => match[1]);
  if (images.length !== 1 || images[0] !== `ghcr.io/xinnie-live/desktop-commander-sandbox:${version}`) throw new Error('Compose image must match the release version.');
  const heading = rehearsal && version.includes('-') ? '## [Unreleased]' : `## [${version}]`;
  const lines = changelog.split(/\r?\n/);
  if (!lines.some(line => line === heading || line.startsWith(`${heading} - `))) throw new Error('Matching CHANGELOG section is required.');
  if (!rehearsal && tag !== `v${version}`) throw new Error('Release tag must exactly match package.json.');
  return version;
}

async function main() {
  const args = process.argv.slice(2);
  if (!(args.length === 1 && args[0] === '--rehearsal') && !(args.length === 2 && args[0] === '--tag')) throw new Error('Usage: node scripts/validate-release.mjs --rehearsal | --tag vX.Y.Z');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const [pkg, lock, compose, changelog] = await Promise.all(['package.json', 'package-lock.json', 'compose.yaml', 'CHANGELOG.md'].map(file => readFile(resolve(root, file), 'utf8')));
  const version = validateReleaseMetadata({ pkg: JSON.parse(pkg), lock: JSON.parse(lock), compose, changelog }, { rehearsal: args[0] === '--rehearsal', tag: args[1] });
  console.log(`Validated ${version} metadata (${args[0] === '--rehearsal' ? 'rehearsal; no publication' : 'release tag'}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
