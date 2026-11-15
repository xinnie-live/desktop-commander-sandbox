import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let child;
let interrupted = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = true;
    child?.kill(signal);
  });
}

function run(command) {
  return new Promise((resolveExit) => {
    child = spawn(process.execPath, [resolve(root, 'scripts/console.mjs'), command], {
      cwd: root,
      stdio: 'inherit',
    });
    child.once('error', (error) => {
      console.error(error.message);
      resolveExit(1);
    });
    child.once('exit', (code) => resolveExit(code ?? 1));
  });
}

if (Number(process.versions.node.split('.')[0]) < 22) {
  console.error('Node.js 22+ required. Install from https://nodejs.org/en/download');
  process.exitCode = 1;
} else {
  const result = await run('doctor');
  process.exitCode = result;
  if (result === 0 && !interrupted) process.exitCode = await run('dashboard');
}
