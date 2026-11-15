import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENTS = [
  'scripts/validate-release.mjs',
  'tests/release-metadata.test.mjs',
  'THIRD-PARTY-NOTICES.md',
  'scripts/third-party-notices.mjs',
  'scripts/package-third-party.mjs',
  'scripts/smoke-dependencies.sh',
  'tests/third-party.test.mjs',
  'third-party/buffers/README.markdown',
  'third-party/buffers/debian-copyright.txt',
  'third-party/buffers/package.upstream.json',
  'third-party/licenses/GPL-3.0.txt',
  'third-party/licenses/LGPL-3.0.txt',
  'third-party/sharp-libvips/LICENSE',
  'third-party/sharp-libvips/SOURCE-NOTICES.txt',
  'third-party/sharp-libvips/THIRD-PARTY-NOTICES.md',
  'third-party/sharp-libvips/versions.properties',
  'third-party/sources.lock.json',
  'third-party/npm-supplemental.json',
  'third-party/npm-SUPPLEMENTAL-NOTICES.txt',

  'start.command',
  'start.sh',
  'start.cmd',
  'scripts/launch.mjs',
  '.editorconfig',
  '.gitattributes',
  '.github/dependabot.yml',
  '.github/ISSUE_TEMPLATE/bug_report.md',
  '.github/ISSUE_TEMPLATE/feature_request.md',
  '.github/pull_request_template.md',
  '.github/workflows/ci.yml',
  '.github/workflows/release.yml',
  '.dockerignore',
  '.env.example',
  'AGENTS.md',
  'AGENTS.zh-CN.md',
  '.gitignore',
  '.nvmrc',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'CONTRIBUTING.zh-CN.md',
  'Dockerfile',
  'README.md',
  'README.zh-CN.md',
  'LICENSE',
  'SECURITY.md',
  'docs/assets/demo.gif',
  'docs/assets/demo.zh-CN.gif',
  'docs/assets/overview-en.png',
  'docs/assets/overview-zh.png',
  'docs/assets/prepare-en.png',
  'docs/assets/prepare-zh.png',
  'docs/assets/workspace-en.png',
  'docs/assets/workspace-zh.png',
  'docs/assets/acceptance-summary-en.png',
  'docs/assets/acceptance-summary-zh.png',
  'docs/assets/README.md',
  'docs/AI_WORKFLOW.md',
  'docs/AI_WORKFLOW.zh-CN.md',
  'docs/SECURITY_MODEL.md',
  'docs/SECURITY_MODEL.zh-CN.md',
  'compose.yaml',
  'docker/drop_uid_exec.c',
  'docs/USAGE.md',
  'docs/USAGE.zh-CN.md',
  'package-lock.json',
  'package.json',
  'scripts/console.mjs',
  'scripts/console-cli.mjs',
  'scripts/console-http.mjs',
  'scripts/docker-output.mjs',
  'scripts/run-log-files.mjs',
  'scripts/compose-version.mjs',
  'scripts/mount-compose.mjs',
  'scripts/workspace-settings.mjs',
  'scripts/package-release.mjs',
  'scripts/patch-upstream.mjs',
  'scripts/public-data.mjs',
  'scripts/run-log-security.mjs',
  'scripts/proxy-runtime-probe.mjs',
  'scripts/system-proxy.mjs',
  'scripts/workspace-selection.mjs',
  'scripts/validate-compose.mjs',
  'scripts/smoke-compose-runtime.sh',
  'scripts/smoke-helper.sh',
  'scripts/smoke-integration.sh',
  'scripts/verify-host-runtime.mjs',
  'scripts/smoke-proxy-runtime.sh',
  'web/app.js',
  'web/authorization-url.mjs',
  'web/i18n.mjs',
  'web/ui-format.mjs',
  'web/index.html',
  'web/style.css',
  'tests/compose-version.test.mjs',
  'tests/console-cli.test.mjs',
  'tests/console-http.test.mjs',
  'tests/console-mount-apply.test.mjs',
  'tests/console-run-log.test.mjs',
  'tests/console-startup.test.mjs',
  'tests/console-ui.test.mjs',
  'tests/doctor-dependencies.test.mjs',
  'tests/extracted-helpers.test.mjs',
  'tests/i18n.test.mjs',
  'tests/mount-compose.test.mjs',
  'tests/product-readiness.test.mjs',
  'tests/public-data.test.mjs',
  'tests/system-proxy.test.mjs',
  'tests/workspace-selection.test.mjs',
  'tests/workspace-settings.test.mjs',
];

const crcTable = new Uint32Array(256);
for (let n = 0; n < crcTable.length; n += 1) {
  let value = n;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  crcTable[n] = value >>> 0;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { dosDate, dosTime };
}

function checkedZipEntry(path, content, timestamp) {
  const name = Buffer.from(path, 'utf8');
  if (name.length > 0xffff || content.length > 0xffffffff) throw new Error(`Archive entry is too large: ${path}`);
  const compressed = deflateRawSync(content, { level: 9 });
  if (compressed.length > 0xffffffff) throw new Error(`Compressed archive entry is too large: ${path}`);
  const checksum = crc32(content);
  const { dosDate, dosTime } = dosDateTime(timestamp);

  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  name.copy(local, 30);

  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE((path.endsWith('/start.command') || path.endsWith('/start.sh') ? 0o100755 : 0o100644) * 0x10000, 38);
  name.copy(central, 46);

  return { local, compressed, central };
}

async function sourceFiles() {
  const entries = [];
  const seen = new Set();
  const testsDirectory = await lstat(join(ROOT, 'tests'));
  if (!testsDirectory.isDirectory() || testsDirectory.isSymbolicLink()) {
    throw new Error('tests must be a regular directory inside the project.');
  }
  for (const relativePath of CONTENTS) {
    const source = resolve(ROOT, relativePath);
    if (!source.startsWith(`${ROOT}${sep}`)) throw new Error(`Project file is outside the repository: ${relativePath}`);
    if (await realpath(source) !== source) throw new Error(`Release entry must not traverse a symlink: ${relativePath}`);
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Release entry must be a regular file: ${relativePath}`);
    const archivePath = relative(ROOT, source).split(sep).join('/');
    if (seen.has(archivePath)) throw new Error(`Duplicate release entry: ${archivePath}`);
    seen.add(archivePath);
    entries.push({ archivePath, content: await readFile(source), modifiedAt: info.mtime });
  }
  return entries.sort((a, b) => (a.archivePath < b.archivePath ? -1 : a.archivePath > b.archivePath ? 1 : 0));
}

function makeArchive(entries, version) {
  if (entries.length > 0xffff) throw new Error('Release archive exceeds the ZIP entry limit.');
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  let centralSize = 0;

  for (const entry of entries) {
    const record = checkedZipEntry(`desktop-commander-sandbox-${version}/${entry.archivePath}`, entry.content, entry.modifiedAt);
    if (localOffset + record.local.length + record.compressed.length > 0xffffffff) throw new Error('Release archive exceeds the ZIP size limit.');
    record.central.writeUInt32LE(localOffset, 42);
    localParts.push(record.local, record.compressed);
    centralParts.push(record.central);
    localOffset += record.local.length + record.compressed.length;
    centralSize += record.central.length;
  }
  if (centralSize > 0xffffffff) throw new Error('Release archive directory exceeds the ZIP size limit.');

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

async function main() {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(ROOT, 'package-lock.json'), 'utf8'));
  const compose = await readFile(join(ROOT, 'compose.yaml'), 'utf8');
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)) throw new Error('package.json has an invalid version.');
  if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) throw new Error('package.json and package-lock.json versions do not match.');
  if (!compose.includes(`image: ghcr.io/xinnie-live/desktop-commander-sandbox:${pkg.version}`)) throw new Error('Compose image tag does not match package.json.');

  const dist = join(ROOT, 'dist');
  await mkdir(dist, { recursive: true });
  const distInfo = await lstat(dist);
  if (!distInfo.isDirectory() || distInfo.isSymbolicLink()) throw new Error('dist must be a regular directory inside the project.');

  const archiveName = `desktop-commander-sandbox-${pkg.version}.zip`;
  const output = join(dist, archiveName);
  const temporary = `${output}.tmp-${process.pid}`;
  try {
    const outputInfo = await lstat(output);
    if (!outputInfo.isFile() || outputInfo.isSymbolicLink()) throw new Error(`Refusing to overwrite a non-regular file: dist/${archiveName}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const entries = await sourceFiles();
  const archive = makeArchive(entries, pkg.version);
  try {
    await writeFile(temporary, archive, { flag: 'wx' });
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }

  const checksumPath = `${output}.sha256`;
  const checksumTemporary = `${checksumPath}.tmp-${process.pid}`;
  try {
    await writeFile(checksumTemporary, `${createHash('sha256').update(archive).digest('hex')}  ${archiveName}\n`, { flag: 'wx' });
    await rename(checksumTemporary, checksumPath);
  } finally {
    await rm(checksumTemporary, { force: true });
  }

  console.log(`Created source archive: dist/${archiveName}`);
  console.log(`Included ${entries.length} allowlisted files (${(archive.length / 1024).toFixed(1)} KiB).`);
  console.log('Excluded node_modules, .env, local workspaces, logs, Docker images, and named volumes.');
  console.log('This is a source archive; users still need Node.js 22+ and Docker.');
}

main().catch((error) => {
  console.error(`Source archive creation failed: ${error.message}`);
  process.exitCode = 1;
});
