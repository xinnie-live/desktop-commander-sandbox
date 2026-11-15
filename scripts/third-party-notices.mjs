import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUFFERS_HASH = '97801e296ba5f3c32242f647e1daac5917e300367fed7935ab1e62f40adb1b8a';

export async function collectNotices(root) {
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'));
  const packages = [];
  const sections = [];
  for (const [location, locked] of Object.entries(lock.packages).sort()) {
    if (!location) continue;
    const directory = resolve(root, location);
    if (!location.startsWith('node_modules/') || !directory.startsWith(`${resolve(root)}${sep}`)) throw new Error('Invalid locked package path');
    let pkg;
    try { pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT' && locked.optional) continue;
      if (error.code === 'ENOENT') throw new Error(`Required locked package is missing: ${location}. Notice collection requires the npm 10.9.4 install layout. Reinstall with npx --yes npm@10.9.4 ci --omit=dev --ignore-scripts --no-audit --no-fund, then rerun npm run remote-device:notices. No required package was skipped.`);
      throw error;
    }
    if (pkg.version !== locked.version) throw new Error(`Installed version differs from lock: ${location}`);
    let license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type;
    license ||= locked.license;
    if (pkg.name === 'buffers' && pkg.version === '0.1.1') {
      const hash = createHash('sha256').update(await readFile(join(directory, 'index.js'))).digest('hex');
      if (hash !== BUFFERS_HASH) throw new Error('buffers differs from the reviewed upstream licensing evidence');
      license = 'MIT/X11';
    }
    if (!license) throw new Error(`Missing license declaration: ${location}`);
    const noticeFiles = [];
    async function visit(folder, depth = 0) {
      for (const name of (await readdir(folder)).sort()) {
        const file = join(folder, name);
        const info = await lstat(file);
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory() && depth < 2 && /^licen[cs]es?$/i.test(name)) await visit(file, depth + 1);
        if (!info.isFile() || !/^(licen[cs]e|copying|copyright|notice|authors|readme)([._-]|$)/i.test(name)) continue;
        const text = await readFile(file, 'utf8');
        if (/^readme/i.test(name) && !/licen[cs]e|copyright/i.test(text)) continue;
        const relative = file.slice(directory.length + 1).split(sep).join('/');
        noticeFiles.push(relative);
        sections.push(`\n===== ${pkg.name}@${pkg.version} / ${relative} =====\n${text}`);
      }
    }
    await visit(directory);
    packages.push({ location, name: pkg.name, version: pkg.version, license, author: pkg.author ?? null, repository: pkg.repository ?? null, integrity: locked.integrity, noticeFiles });
  }
  return { packages, notices: sections.join('\n') };
}

async function main() {
  const result = await collectNotices(ROOT);
  const supplements = JSON.parse(await readFile(join(ROOT, 'third-party/npm-supplemental.json'), 'utf8'));
  for (const pkg of result.packages.filter(pkg => pkg.noticeFiles.length === 0)) {
    if (!supplements.some(s => s.name === pkg.name && s.version === pkg.version && s.license === pkg.license)) {
      throw new Error(`Missing original or reviewed supplemental notice: ${pkg.name}@${pkg.version}`);
    }
  }
  result.notices += `\n===== Reviewed supplemental notices =====\n${await readFile(join(ROOT, 'third-party/npm-SUPPLEMENTAL-NOTICES.txt'), 'utf8')}`;
  const out = join(ROOT, 'third-party', 'installed');
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'npm-packages.json'), `${JSON.stringify(result.packages, null, 2)}\n`);
  await writeFile(join(out, 'npm-NOTICES.txt'), result.notices);
  console.log(`Collected declarations and original notices for ${result.packages.length} installed npm packages.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
