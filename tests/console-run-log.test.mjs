import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { afterEach, test } from 'node:test';
import { request as httpRequest } from 'node:http';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const CONSOLE = join(ROOT, 'scripts/console.mjs');
const PROJECT = `runlog-test-${randomBytes(5).toString('hex')}`;
const WORKSPACE = `runlog-test-${randomBytes(5).toString('hex')}`;
const WORKSPACE_DIR = join(ROOT, 'sandbox-workspace', WORKSPACE);
const TEST_AUTH_URL = 'https://mcp.desktopcommander.app/verify-device?verify_device=true&user_code=AB12-CD34';
let child;
let foregroundChild;
let testRoot;
let server;
let sessionToken;
let testEnv;

function request(port, path, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolveResponse, rejectResponse) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: { ...(body ? { 'content-length': Buffer.byteLength(body) } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.once('end', () => resolveResponse({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.once('error', rejectResponse);
    if (body) req.write(body);
    req.end();
  });
}

function authHeaders(origin) {
  return {
    authorization: `Bearer ${sessionToken}`,
    'x-console-request': 'desktop-commander-sandbox',
    origin,
  };
}

async function prepareTestEnvironment({ largeOutput = false, holdOutput = false } = {}) {
  testRoot = await mkdtemp(join(tmpdir(), 'rds-runlog-'));
  const bin = join(testRoot, 'bin');
  await mkdir(bin);
  const mockDocker = join(bin, 'docker');
const mock = `#!/bin/sh\nprintf '%s\\n' "$*" >> "$RDS_RUNLOG_CALLS"\ncase "$*" in\n  *"ps --all"*) printf '[]\\n' ;;\n  *"image inspect"*) printf 'sha256:synthetic\\n' ;;\n  *"up --no-build"*)\n    if [ -n "$MOCK_DOCKER_STREAM_GATE" ]; then\n      trap 'exit 0' INT TERM\n      printf 'stream-first\\n'\n      while [ ! -e "$MOCK_DOCKER_STREAM_GATE/second" ]; do sleep 0.05; done\n      printf 'stream-second\\n'\n      while [ ! -e "$MOCK_DOCKER_STREAM_GATE/exit" ]; do sleep 0.05; done\n    elif [ "${'${MOCK_DOCKER_LARGE_OUTPUT:-0}'}" = "1" ]; then\n      dd if=/dev/zero bs=1048576 count=11 2>/dev/null\n    else\n      printf '%s\\n' 'Verify this device in your browser:' '${TEST_AUTH_URL}' 'Make sure code matches:' 'AB12-CD34' '- User: synthetic@example.invalid' '- Device ID: 12345678-abcd-4abc-8def-1234567890ab' '- Device Name: abcdef123456' 'Cannot access ${WORKSPACE_DIR}/private.txt'\n      printf 'long:'\n      i=0\n      while [ "$i" -lt 5000 ]; do printf x; i=$((i + 1)); done\n      printf '\\n'\n    fi\n    ;;\n  *) exit 0 ;;\nesac\n`;
  await writeFile(mockDocker, mock, { mode: 0o700 });
  await chmod(mockDocker, 0o700);
  await mkdir(WORKSPACE_DIR, { recursive: true });
  // Existing synthetic folders must supply their own group access; the controller
  // no longer recursively changes permissions on behalf of callers.
  await chmod(WORKSPACE_DIR, 0o770);
  testEnv = {
    ...process.env, REMOTE_DEVICE_CONSOLE_PORT: '0',
    REMOTE_DEVICE_SANDBOX_CONFIG_HOME: join(testRoot, 'config'),
    REMOTE_DEVICE_SANDBOX_LOG_HOME: join(testRoot, 'logs'),
    MOCK_DOCKER_LARGE_OUTPUT: largeOutput ? '1' : '0',
    RDS_RUNLOG_CALLS: join(testRoot, 'docker-calls'),
    PATH: `${bin}${delimiter}${process.env.PATH || ''}`,
  };
  if (holdOutput) {
    const gate = join(testRoot, 'hold-output');
    await mkdir(gate);
    testEnv.MOCK_DOCKER_STREAM_GATE = gate;
  }
  delete testEnv.REMOTE_DEVICE_PROJECT;
  delete testEnv.REMOTE_DEVICE_WORKSPACE;
}

async function startConsole(options = {}) {
  await prepareTestEnvironment(options);
  child = spawn(process.execPath, [CONSOLE, 'dashboard', '--no-open', '--workspace', WORKSPACE], {
    cwd: ROOT,
    env: testEnv,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const address = await new Promise((resolveStart, rejectStart) => {
    let output = '';
    const timer = setTimeout(() => rejectStart(new Error('Mock console did not start.')), 10_000);
    child.once('error', () => { clearTimeout(timer); rejectStart(new Error('Could not start mock console.')); });
    child.once('close', () => { clearTimeout(timer); rejectStart(new Error('Mock console exited early.')); });
    child.stdout.on('data', (chunk) => {
      output = `${output}${chunk.toString('utf8')}`.slice(-2048);
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/#session=([A-Za-z0-9_-]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolveStart({ port: Number(match[1]), token: match[2] });
    });
  });
  server = address;
  sessionToken = address.token;
}

async function stopConsole() {
  if (foregroundChild && foregroundChild.exitCode === null && foregroundChild.signalCode === null) {
    const runningChild = foregroundChild;
    const closed = new Promise((resolveClose) => runningChild.once('close', resolveClose));
    runningChild.kill('SIGTERM');
    await Promise.race([closed, new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5000))]);
    if (runningChild.exitCode === null && runningChild.signalCode === null) {
      runningChild.kill('SIGKILL');
      await closed;
    }
  }
  if (child && child.exitCode === null && child.signalCode === null) {
    const runningChild = child;
    const closed = new Promise((resolveClose) => runningChild.once('close', resolveClose));
    runningChild.kill('SIGTERM');
    await Promise.race([closed, new Promise((resolveTimeout) => setTimeout(resolveTimeout, 5000))]);
    if (runningChild.exitCode === null && runningChild.signalCode === null) {
      runningChild.kill('SIGKILL');
      await closed;
    }
  }
  await rm(WORKSPACE_DIR, { recursive: true, force: true });
  if (testRoot) await rm(testRoot, { recursive: true, force: true });
  child = null;
  foregroundChild = null;
  testRoot = null;
  server = null;
  sessionToken = null;
  testEnv = null;
}

afterEach(stopConsole);

const testWithFakeDocker = (name, run) => test(name, {
  skip: process.platform === 'win32' ? 'the synthetic Docker executable requires a POSIX shell' : false,
}, run);

testWithFakeDocker('shows and persists full container output including authorization data and long lines', async () => {
  await startConsole();
  const origin = `http://127.0.0.1:${server.port}`;
  const started = await request(server.port, '/api/start', {
    method: 'POST',
    headers: { ...authHeaders(origin), 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(started.status, 202, started.body);

  let output;
  let logs;
  const deadline = Date.now() + 5000;
  do {
    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
    [output, logs] = await Promise.all([
      request(server.port, '/api/output', { headers: authHeaders(origin) }),
      request(server.port, '/api/logs', { headers: authHeaders(origin) }),
    ]);
  } while (Date.now() < deadline && (JSON.parse(output.body).job?.phase !== 'finished' || !JSON.parse(logs.body).runs?.length));

  const currentOutput = JSON.parse(output.body);
  assert.equal(currentOutput.job.phase, 'finished');
  assert.equal(currentOutput.job.authorizationUrl, TEST_AUTH_URL);
  assert.ok(output.body.includes(WORKSPACE_DIR));
  assert.ok(currentOutput.lines.some((line) => line.text === `Cannot access ${WORKSPACE_DIR}/private.txt`));
  const run = JSON.parse(logs.body).runs[0];
  assert.ok(run?.id);
  const response = await request(server.port, `/api/logs?id=${run.id}`, { headers: authHeaders(origin) });
  assert.equal(response.status, 200, response.body);
  const persisted = JSON.parse(response.body).text;
  assert.ok(response.body.includes(WORKSPACE_DIR));
  assert.match(persisted, new RegExp(TEST_AUTH_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(persisted, /AB12-CD34|user_code=/);
  assert.match(persisted, /synthetic@example\.invalid/);
  assert.match(persisted, /12345678-abcd-4abc-8def-1234567890ab/);
  assert.match(persisted, /abcdef123456/);
  assert.ok(persisted.includes(`Cannot access ${WORKSPACE_DIR}/private.txt`));
  assert.ok(persisted.includes(`long:${'x'.repeat(5000)}`));
});

testWithFakeDocker('concurrent start requests spawn only one Compose up', async () => {
  await startConsole({ holdOutput: true });
  const gate = testEnv.MOCK_DOCKER_STREAM_GATE;
  const origin = `http://127.0.0.1:${server.port}`;
  const start = () => request(server.port, '/api/start', {
    method: 'POST',
    headers: { ...authHeaders(origin), 'content-type': 'application/json' },
    body: '{}',
  });
  try {
    const responses = await Promise.all(Array.from({ length: 6 }, start));
    assert.deepEqual(responses.map(({ status }) => status).sort(), [202, 409, 409, 409, 409, 409]);
    const deadline = Date.now() + 5_000;
    let calls = '';
    while (Date.now() < deadline) {
      calls = await readFile(join(testRoot, 'docker-calls'), 'utf8');
      if (calls.includes(' up --no-build ')) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    assert.equal(calls.split('\n').filter((line) => line.includes(' up --no-build ')).length, 1);
    assert.match(calls, /--exit-code-from remote-device/);
  } finally {
    await writeFile(join(gate, 'exit'), '');
    await writeFile(join(gate, 'second'), '');
  }
});

testWithFakeDocker('CLI foreground start also saves full output', async () => {
  await prepareTestEnvironment();
  child = spawn(process.execPath, [CONSOLE, 'start', '--workspace', WORKSPACE, '--yes', '--no-open'], {
    cwd: ROOT,
    env: testEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let displayedOutput = '';
  child.stdout.on('data', (chunk) => { displayedOutput += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { displayedOutput += chunk.toString('utf8'); });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && (!displayedOutput.includes('AB12-CD34') || !displayedOutput.includes('Desktop Commander Sandbox console:'))) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  assert.match(displayedOutput, /AB12-CD34/);
  assert.match(displayedOutput, /Desktop Commander Sandbox console: http:\/\/127\.0\.0\.1:/);
  const closed = new Promise((resolveClose) => child.once('close', resolveClose));
  child.kill('SIGTERM');
  await closed;

  const names = await import('node:fs/promises').then(({ readdir }) => readdir(join(testRoot, 'logs')));
  const runFiles = names.filter((name) => name.endsWith('.log'));
  assert.equal(runFiles.length, 1);
  const persisted = await import('node:fs/promises').then(({ readFile }) => readFile(join(testRoot, 'logs', runFiles[0]), 'utf8'));
  assert.ok(persisted.includes(TEST_AUTH_URL));
  assert.match(persisted, /AB12-CD34/);
  assert.match(persisted, /synthetic@example\.invalid/);
  assert.match(persisted, /12345678-abcd-4abc-8def-1234567890ab/);
  assert.match(persisted, /abcdef123456/);
  assert.ok(persisted.includes(`Cannot access ${WORKSPACE_DIR}/private.txt`));
});

testWithFakeDocker('CLI start owns the web console, rejects a second start, and keeps console open after web stop', async () => {
  await prepareTestEnvironment();
  child = spawn(process.execPath, [CONSOLE, 'start', '--workspace', WORKSPACE, '--yes', '--no-open'], {
    cwd: ROOT, env: testEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const address = await new Promise((resolveStart, rejectStart) => {
    let output = '';
    const timer = setTimeout(() => rejectStart(new Error('CLI console did not open.')), 10_000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/#session=([A-Za-z0-9_-]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolveStart({ port: Number(match[1]), token: match[2], url: match[0] });
    });
    child.once('error', rejectStart);
  });
  sessionToken = address.token;
  const origin = `http://127.0.0.1:${address.port}`;
  const dashboard = spawnSync(process.execPath, [CONSOLE, 'dashboard', '--workspace', WORKSPACE, '--no-open'], {
    cwd: ROOT, env: testEnv, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(dashboard.status, 0, dashboard.stderr);
  assert.ok(dashboard.stdout.includes(address.url));
  const duplicate = spawnSync(process.execPath, [CONSOLE, 'start', '--workspace', WORKSPACE, '--yes', '--no-open'], {
    cwd: ROOT, env: testEnv, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /controller is already running/);
  const mutation = spawnSync(process.execPath, [CONSOLE, 'mount', 'remove', 'mount-012345abcdef', '--yes', '--workspace', WORKSPACE], {
    cwd: ROOT, env: testEnv, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(mutation.status, 1);
  assert.match(mutation.stderr, /Use its web console/);
  // The console listens before asynchronous mount/log preparation completes.
  // Wait for observable startup output, not the console URL or a fixed delay.
  let output;
  const deadline = Date.now() + 5000;
  do {
    const response = await request(address.port, '/api/output', { headers: authHeaders(origin) });
    assert.equal(response.status, 200, response.body);
    output = JSON.parse(response.body);
    if (output.job?.kind === 'start' && output.lines.some((line) => line.text.includes('AB12-CD34'))) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  } while (Date.now() < deadline);
  assert.equal(output.job?.kind, 'start');
  assert.ok(output.lines.some((line) => line.text.includes('AB12-CD34')));
  await new Promise((resolveWait) => setTimeout(resolveWait, 100)); // no browser connection remains
  assert.equal((await request(address.port, '/api/status', { headers: authHeaders(origin) })).status, 200);
  const stopped = await request(address.port, '/api/stop', {
    method: 'POST', headers: { ...authHeaders(origin), 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(stopped.status, 202, stopped.body);
  assert.equal((await request(address.port, '/api/status', { headers: authHeaders(origin) })).status, 200);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = JSON.parse((await request(address.port, '/api/output', { headers: authHeaders(origin) })).body);
    if (state.job?.kind === 'stop' && state.job.phase === 'finished') break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  const cliStop = spawnSync(process.execPath, [CONSOLE, 'stop', '--workspace', WORKSPACE], {
    cwd: ROOT, env: testEnv, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(cliStop.status, 0, cliStop.stderr);
  assert.match(cliStop.stdout, /running controller is stopping/);
  const names = await readdir(join(testRoot, 'logs'));
  assert.ok(names.some((name) => name.endsWith('.log')));
  assert.ok(!names.some((name) => name.startsWith('active-')));
});

testWithFakeDocker('CLI start applies a confirmed main folder and per-mount permissions before Docker up', async () => {
  await prepareTestEnvironment();
  const main = join(testRoot, 'main-trial');
  const reference = join(testRoot, 'reference-trial');
  const writable = join(testRoot, 'writable-trial');
  await Promise.all([main, reference, writable].map((path) => mkdir(path)));
  // Linux requires selected folders to be group-accessible by the user's primary group.
  await Promise.all([main, reference, writable].map((path) => chmod(path, 0o770)));
  child = spawn(process.execPath, [CONSOLE, 'start', '--workspace', WORKSPACE, '--main', main,
    '--read-write', '--mount-ro', reference, '--mount-rw', writable, '--yes', '--no-open'], {
    cwd: ROOT, env: testEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
  let errors = '';
  child.stderr.on('data', (chunk) => { errors += chunk.toString('utf8'); });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !output.includes('Desktop Commander Sandbox console:') && child.exitCode === null) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  assert.match(output, /Desktop Commander Sandbox console:/, errors || output);
  assert.ok(output.includes(`${main} -> /workspace (read/write)`));
  assert.ok(output.includes(`${reference} -> /mnt/remote-device/reference-trial (read-only`));
  assert.ok(output.includes(`${writable} -> /mnt/remote-device/writable-trial (read/write`));
  const profiles = JSON.parse(await readFile(join(testRoot, 'config', 'desktop-commander-sandbox', 'workspace-profiles.json'), 'utf8'));
  const saved = profiles.workspaces[WORKSPACE];
  assert.equal(saved.directory, await import('node:fs/promises').then(({ realpath }) => realpath(main)));
  assert.equal(saved.readOnly, false);
  assert.deepEqual(saved.mounts.map((mount) => mount.readOnly), [true, false]);
});

testWithFakeDocker('Ctrl+C closes the attached controller and invokes fixed Compose stop', async () => {
  await prepareTestEnvironment();
  const gate = join(testRoot, 'stream-gate');
  await mkdir(gate);
  testEnv.MOCK_DOCKER_STREAM_GATE = gate;
  child = spawn(process.execPath, [CONSOLE, 'start', '--workspace', WORKSPACE, '--yes', '--no-open'], {
    cwd: ROOT, env: testEnv, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString('utf8'); });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline && !output.includes('stream-first')) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  assert.match(output, /stream-first/);
  const closed = new Promise((resolveClose) => child.once('close', resolveClose));
  child.kill('SIGINT');
  await Promise.race([closed, new Promise((_, rejectTimeout) => setTimeout(() => rejectTimeout(new Error('Controller did not close after Ctrl+C.')), 12_000))]);
  const calls = await readFile(join(testRoot, 'docker-calls'), 'utf8');
  assert.match(calls, /stop --timeout 15/);
});

testWithFakeDocker('web stop ends an attached run but leaves its controller available for another start', async () => {
  await startConsole();
  const gate = join(testRoot, 'web-stop-gate');
  await mkdir(gate);
  // The mock Docker process inherits this setting only when the controller starts.
  // Start a fresh controller with the gate configured in its environment.
  const old = child;
  const oldClosed = new Promise((resolveClose) => old.once('close', resolveClose));
  old.kill('SIGTERM');
  await oldClosed;
  testEnv.MOCK_DOCKER_STREAM_GATE = gate;
  child = spawn(process.execPath, [CONSOLE, 'dashboard', '--no-open', '--workspace', WORKSPACE], {
    cwd: ROOT, env: testEnv, stdio: ['ignore', 'pipe', 'ignore'],
  });
  const address = await new Promise((resolveStart, rejectStart) => {
    let output = '';
    const timer = setTimeout(() => rejectStart(new Error('Gated console did not open.')), 10_000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString('utf8');
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/#session=([A-Za-z0-9_-]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolveStart({ port: Number(match[1]), token: match[2] });
    });
    child.once('error', rejectStart);
  });
  sessionToken = address.token;
  const origin = `http://127.0.0.1:${address.port}`;
  const start = await request(address.port, '/api/start', {
    method: 'POST', headers: { ...authHeaders(origin), 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(start.status, 202, start.body);
  const stop = await request(address.port, '/api/stop', {
    method: 'POST', headers: { ...authHeaders(origin), 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(stop.status, 202, stop.body);
  assert.equal((await request(address.port, '/api/status', { headers: authHeaders(origin) })).status, 200);
  const calls = await readFile(join(testRoot, 'docker-calls'), 'utf8');
  assert.match(calls, /stop --timeout 15/);
  const restarted = await request(address.port, '/api/start', {
    method: 'POST', headers: { ...authHeaders(origin), 'content-type': 'application/json' }, body: '{}',
  });
  assert.equal(restarted.status, 202, restarted.body);
});

testWithFakeDocker('caps each persisted run log at 10 MB', async () => {
  await startConsole({ largeOutput: true });
  const logDirectory = join(testRoot, 'logs');
  const origin = `http://127.0.0.1:${server.port}`;
  const response = await request(server.port, '/api/start', {
    method: 'POST',
    headers: { ...authHeaders(origin), 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 202, response.body);
  const deadline = Date.now() + 10_000;
  let runId;
  while (Date.now() < deadline) {
    const output = JSON.parse((await request(server.port, '/api/output', { headers: authHeaders(origin) })).body);
    if (output.job?.phase === 'finished') { runId = output.job.id; break; }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  assert.ok(runId, 'mock device run should finish');
  await request(server.port, '/api/logs', { headers: authHeaders(origin) });
  const filename = (await readdir(logDirectory)).find((name) => name.includes(runId));
  assert.ok(filename);
  const size = (await lstat(join(logDirectory, filename))).size;
  assert.ok(size <= 10 * 1024 * 1024);
  assert.ok(size > 10 * 1024 * 1024 - 1024);
});

testWithFakeDocker('retains seven recent regular run logs and leaves other files and symlink targets untouched', async () => {
  await startConsole();
  const logDirectory = join(testRoot, 'logs');
  await mkdir(logDirectory, { recursive: true });
  const unrelatedPath = join(logDirectory, 'user-notes.txt');
  await writeFile(unrelatedPath, 'keep this file');
  const outsidePath = join(testRoot, 'outside-sentinel.txt');
  await writeFile(outsidePath, 'keep this target');
  const linkPath = join(logDirectory, 'remote-device-default-20000101T000000Z-0000000000000001.log');
  await symlink(outsidePath, linkPath);
  const unrelatedMatchPath = join(logDirectory, 'remote-device-default-20000101T000000Z-0000000000000002.log');
  await writeFile(unrelatedMatchPath, 'this file did not come from the console');
  const origin = `http://127.0.0.1:${server.port}`;
  const start = async () => {
    const response = await request(server.port, '/api/start', {
      method: 'POST',
      headers: { ...authHeaders(origin), 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 202, response.body);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const output = JSON.parse((await request(server.port, '/api/output', { headers: authHeaders(origin) })).body);
      if (output.job?.phase === 'finished') return output.job.id;
      await new Promise((resolveWait) => setTimeout(resolveWait, 20));
    }
    throw new Error('Mock device run did not finish.');
  };

  const firstId = await start();
  for (let index = 0; index < 7; index += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    await start();
  }
  const history = JSON.parse((await request(server.port, '/api/logs', { headers: authHeaders(origin) })).body);
  assert.equal(history.runs.length, 7);
  assert.ok(!history.runs.some((run) => run.id === firstId));
  assert.equal(await readFile(unrelatedPath, 'utf8'), 'keep this file');
  assert.equal(await readFile(outsidePath, 'utf8'), 'keep this target');
  assert.equal(await readFile(unrelatedMatchPath, 'utf8'), 'this file did not come from the console');
  assert.equal((await lstat(linkPath)).isSymbolicLink(), true);
  const names = await readdir(logDirectory);
  const regularLogs = [];
  for (const name of names) {
    const details = await lstat(join(logDirectory, name));
    if (!details.isFile() || !name.endsWith('.log')) continue;
    const prefix = (await readFile(join(logDirectory, name))).subarray(0, Buffer.byteLength('Desktop Commander Sandbox · 本次设备运行\n'));
    if (prefix.toString('utf8') === 'Desktop Commander Sandbox · 本次设备运行\n') regularLogs.push(name);
  }
  assert.equal(regularLogs.length, 7);
});
