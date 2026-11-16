import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = 'batch-apply-test';
const OTHER_WORKSPACE = 'profile-switch-test';
const PROJECT = `remote-device-${WORKSPACE}`;
const FILES = [
  'scripts/third-party-notices.mjs', 'scripts/package-third-party.mjs',
  'package.json',
  'compose.yaml',
  'scripts/node-version.mjs', 'scripts/console.mjs',
  'scripts/console-cli.mjs', 'scripts/console-http.mjs', 'scripts/docker-output.mjs', 'scripts/run-log-files.mjs',
  'scripts/compose-version.mjs',
  'scripts/mount-compose.mjs',
  'scripts/public-data.mjs',
  'scripts/run-log-security.mjs',
  'scripts/system-proxy.mjs',
  'scripts/workspace-selection.mjs',
  'scripts/workspace-settings.mjs',
  'web/app.js',
  'web/authorization-url.mjs',
  'web/i18n.mjs',
  'web/ui-format.mjs',
  'web/index.html',
  'web/style.css',
];

function request(port, path, { method = 'GET', token, origin, body } = {}) {
  const encodedBody = body === undefined ? '' : JSON.stringify(body);
  return new Promise((resolveResponse, rejectResponse) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        ...(encodedBody ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(encodedBody) } : {}),
        ...(token ? { authorization: `Bearer ${token}`, 'x-console-request': 'desktop-commander-sandbox' } : {}),
        ...(origin ? { origin } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.once('end', () => resolveResponse({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.once('error', rejectResponse);
    if (encodedBody) req.write(encodedBody);
    req.end();
  });
}

async function stopConsole(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolveClose) => child.once('close', resolveClose));
  child.kill('SIGTERM');
  let timeout;
  const exited = await Promise.race([
    closed.then(() => true),
    new Promise((resolveTimeout) => { timeout = setTimeout(() => resolveTimeout(false), 5000); }),
  ]);
  clearTimeout(timeout);
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await closed;
  }
}

test('stages multiple permission changes, applies one stop/up cycle, then saves stopped changes without restarting', {
  skip: process.platform === 'win32' ? 'the fake Docker CLI uses a POSIX executable; Windows host validation remains a release gate' : false,
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), 'rds-mount-apply-'));
  const projectRoot = join(temp, 'project');
  const configHome = join(temp, 'config');
  const bin = join(temp, 'bin');
  const stateFile = join(temp, 'docker-state');
  const callLog = join(temp, 'docker-calls.log');
  const directoryA = join(temp, 'selected-readonly');
  const directoryB = join(temp, 'selected-readwrite');
  const fakeDocker = join(bin, 'docker');
  let child;

  try {
    for (const file of FILES) {
      const destination = join(projectRoot, file);
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(SOURCE_ROOT, file), destination);
    }
    await mkdir(join(projectRoot, 'sandbox-workspace', WORKSPACE), { recursive: true });
    await mkdir(directoryA, { mode: 0o770 });
    await mkdir(directoryB, { mode: 0o770 });
    await chmod(directoryA, 0o770);
    await chmod(directoryB, 0o770);
    await mkdir(bin, { recursive: true });
    await mkdir(join(configHome, 'desktop-commander-sandbox'), { recursive: true });
    await writeFile(stateFile, 'running\n');

    const mountProfiles = {
      version: 1,
      projects: {
        [PROJECT]: [
          { id: 'mount-012345abcdef', directory: await realpath(directoryA), readOnly: true },
          { id: 'mount-fedcba987654', directory: await realpath(directoryB), readOnly: false },
        ],
      },
    };
    await writeFile(join(configHome, 'desktop-commander-sandbox', 'mount-profiles.json'), `${JSON.stringify(mountProfiles)}\n`, { mode: 0o600 });
    await writeFile(fakeDocker, `#!/bin/sh
set -eu
printf '%s\\n' "$*" >> "$RDS_MOCK_DOCKER_LOG"
case " $* " in
  *' ps --all --format json '*)
    if [ "$(cat "$RDS_MOCK_DOCKER_STATE")" = running ]; then
      printf '[{"Service":"remote-device","Name":"mock-device","State":"running","Status":"Up"}]\\n'
    else
      printf '[{"Service":"remote-device","Name":"mock-device","State":"exited","Status":"Exited (0)"}]\\n'
    fi
    ;;
  *' image inspect '*) printf 'sha256:synthetic-image\\n' ;;
  *' stop --timeout 15 '*) printf 'stopped\\n' > "$RDS_MOCK_DOCKER_STATE"; printf 'SYNTHETIC_STOP\\n' ;;
  *' up --no-build --pull never --remove-orphans '*) printf 'running\\n' > "$RDS_MOCK_DOCKER_STATE"; printf 'SYNTHETIC_UP\\n'; printf 'Verify this device: https://mcp.desktopcommander.app/device/verify?user_code=AB12-CDEF\\n'; printf 'Make sure the code matches:\\nAB12-CDEF\\n' ;;
  *) printf 'unsupported fake Docker invocation\\n' >&2; exit 87 ;;
esac
`, { mode: 0o700 });
    await chmod(fakeDocker, 0o700);

    const env = {
      ...process.env, REMOTE_DEVICE_CONSOLE_PORT: '0',
      PATH: `${bin}:${process.env.PATH || ''}`,
      REMOTE_DEVICE_SANDBOX_CONFIG_HOME: configHome,
      REMOTE_DEVICE_SANDBOX_LOG_HOME: join(temp, 'application-logs'),
      RDS_MOCK_DOCKER_STATE: stateFile,
      RDS_MOCK_DOCKER_LOG: callLog,
    };
    delete env.REMOTE_DEVICE_PROJECT;
    delete env.REMOTE_DEVICE_WORKSPACE;
    child = spawn(process.execPath, [join(projectRoot, 'scripts/console.mjs'), 'dashboard', '--no-open', '--workspace', WORKSPACE], {
      cwd: projectRoot,
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const { port, token } = await new Promise((resolveStart, rejectStart) => {
      let output = '';
      const timer = setTimeout(() => rejectStart(new Error('Mock-backed console did not start in time.')), 10000);
      child.once('error', (error) => {
        clearTimeout(timer);
        rejectStart(error);
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        rejectStart(new Error(`Mock-backed console exited early with code ${code}.`));
      });
      child.stdout.on('data', (chunk) => {
        output = `${output}${chunk.toString('utf8')}`.slice(-2048);
        const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/#session=([A-Za-z0-9_-]+)/);
        if (match) {
          clearTimeout(timer);
          resolveStart({ port: Number(match[1]), token: match[2] });
        }
      });
    });
    const origin = `http://127.0.0.1:${port}`;
    const auth = { token, origin };

    const initial = await request(port, '/api/mounts', auth);
    assert.equal(initial.status, 200);
    const initialMounts = JSON.parse(initial.body);
    assert.deepEqual(initialMounts.draft.map((mount) => mount.readOnly), [true, false]);
    assert.deepEqual(initialMounts.draft.map((mount) => mount.target), [
      '/mnt/remote-device/selected-readonly',
      '/mnt/remote-device/selected-readwrite',
    ]);
    assert.deepEqual(initialMounts.draft.map((mount) => mount.localPath), [await realpath(directoryA), await realpath(directoryB)], 'the local dashboard must show canonical host-to-container mappings');
    assert.equal(await lstat(callLog).then(() => true).catch(() => false), false, 'loading the draft must not invoke Docker');

    const firstChange = await request(port, '/api/mount-mode', { ...auth, method: 'POST', body: { mountId: 'mount-012345abcdef', readOnly: false } });
    assert.equal(firstChange.status, 200, firstChange.body);
    const secondChange = await request(port, '/api/mount-mode', { ...auth, method: 'POST', body: { mountId: 'mount-fedcba987654', readOnly: true } });
    assert.equal(secondChange.status, 200, secondChange.body);
    const primaryChange = await request(port, '/api/workspace-mode', { ...auth, method: 'POST', body: { readOnly: true } });
    assert.equal(primaryChange.status, 200, primaryChange.body);
    const draft = JSON.parse(primaryChange.body);
    assert.equal(draft.dirty, true);
    assert.deepEqual(draft.applied.map((mount) => mount.readOnly), [true, false]);
    assert.deepEqual(draft.draft.map((mount) => mount.readOnly), [false, true]);
    assert.equal(draft.primaryReadOnly, true);
    assert.equal(await lstat(callLog).then(() => true).catch(() => false), false, 'staging any number of changes must not invoke Docker');

    const appliedResponse = await request(port, '/api/mount-apply', { ...auth, method: 'POST', body: {} });
    assert.equal(appliedResponse.status, 202, appliedResponse.body);
    const appliedJob = JSON.parse(appliedResponse.body).job;
    const deadline = Date.now() + 10000;
    let finalJob;
    do {
      const output = await request(port, '/api/output', auth);
      finalJob = JSON.parse(output.body).job;
      if (['finished', 'failed', 'output-cleared'].includes(finalJob?.phase)) break;
      await new Promise((resolveWait) => setTimeout(resolveWait, 40));
    } while (Date.now() < deadline);
    assert.equal(finalJob?.id, appliedJob.id);
    assert.equal(finalJob?.phase, 'finished');
    assert.equal(finalJob?.exitCode, 0);

    const transientOutput = await request(port, '/api/output', auth);
    const transientJob = JSON.parse(transientOutput.body).job;
    assert.equal(transientJob.authorizationUrl, 'https://mcp.desktopcommander.app/device/verify?user_code=AB12-CDEF');
    const runLogs = await request(port, '/api/logs', auth);
    const runHistory = JSON.parse(runLogs.body).runs;
    assert.equal(runHistory.length, 1);
    assert.equal(runHistory[0].workspace, WORKSPACE);
    const persistedLog = await request(port, `/api/logs?id=${runHistory[0].id}`, auth);
    assert.equal(persistedLog.status, 200);
    const persistedText = JSON.parse(persistedLog.body).text;
    assert.match(persistedText, /https:\/\/mcp\.desktopcommander\.app\/device\/verify\?user_code=AB12-CDEF/);
    assert.match(persistedText, /AB12-CDEF/);

    const calls = (await readFile(callLog, 'utf8')).trim().split(/\r?\n/);
    const stops = calls.filter((call) => /(?:^| )stop --timeout 15(?: |$)/.test(call));
    const starts = calls.filter((call) => /(?:^| )up --no-build --pull never --remove-orphans(?: |$)/.test(call));
    assert.equal(stops.length, 1, `expected one stop, got ${stops.length}: ${calls.join(' | ')}`);
    assert.equal(starts.length, 1, `expected one up, got ${starts.length}: ${calls.join(' | ')}`);
    assert.ok(calls.indexOf(stops[0]) < calls.indexOf(starts[0]));
    assert.doesNotMatch(stops[0], /mounts\.compose\.yaml/);
    assert.match(starts[0], /mounts\.compose\.yaml/);

    const savedProfiles = JSON.parse(await readFile(join(configHome, 'desktop-commander-sandbox', 'workspace-profiles.json'), 'utf8'));
    assert.equal(savedProfiles.deviceProject, PROJECT);
    assert.equal(savedProfiles.activeWorkspace, WORKSPACE);
    assert.deepEqual(savedProfiles.workspaces[WORKSPACE].mounts.map((mount) => mount.readOnly), [false, true]);
    const runtimeOverride = await readFile(join(projectRoot, '.runtime', 'mounts.compose.yaml'), 'utf8');
    assert.match(runtimeOverride, /read_only: false/);
    assert.match(runtimeOverride, /read_only: true/);
    assert.match(runtimeOverride, /target: "\/mnt\/remote-device\/selected-readonly"/);
    assert.match(runtimeOverride, /target: "\/mnt\/remote-device\/selected-readwrite"/);

    await writeFile(stateFile, 'stopped\n');
    const stoppedDraft = await request(port, '/api/mount-mode', {
      ...auth,
      method: 'POST',
      body: { mountId: 'mount-012345abcdef', readOnly: true },
    });
    assert.equal(stoppedDraft.status, 200, stoppedDraft.body);
    const stoppedApply = await request(port, '/api/mount-apply', { ...auth, method: 'POST', body: {} });
    assert.equal(stoppedApply.status, 200, stoppedApply.body);
    const stoppedResult = JSON.parse(stoppedApply.body);
    assert.equal(stoppedResult.restarted, false);
    assert.equal(stoppedResult.job, null);
    assert.equal(stoppedResult.mounts.dirty, false);

    const callsAfterStoppedApply = (await readFile(callLog, 'utf8')).trim().split(/\r?\n/);
    assert.equal(callsAfterStoppedApply.filter((call) => /(?:^| )stop --timeout 15(?: |$)/.test(call)).length, 1);
    assert.equal(callsAfterStoppedApply.filter((call) => /(?:^| )up --no-build --pull never --remove-orphans(?: |$)/.test(call)).length, 1);
    const stoppedProfiles = JSON.parse(await readFile(join(configHome, 'desktop-commander-sandbox', 'workspace-profiles.json'), 'utf8'));
    assert.deepEqual(stoppedProfiles.workspaces[WORKSPACE].mounts.map((mount) => mount.readOnly), [true, true]);

    const dockerCallsBeforeCreate = await readFile(callLog, 'utf8');
    const createProfile = await request(port, '/api/workspace-create', {
      ...auth,
      method: 'POST',
      body: { workspace: OTHER_WORKSPACE },
    });
    assert.equal(createProfile.status, 200, createProfile.body);
    const createdProfile = JSON.parse(createProfile.body);
    assert.equal(createdProfile.workspace, WORKSPACE, 'creating a profile must not switch the active workspace');
    assert.equal(createdProfile.workspaces.find((profile) => profile.workspace === OTHER_WORKSPACE).selected, false, createProfile.body);
    assert.equal(createdProfile.project, PROJECT, 'saving a workspace must keep the current device-state project');
    assert.equal(createdProfile.restarted, false, 'saving a profile must not start containers');
    assert.deepEqual(createdProfile.mounts.applied.map((mount) => mount.folderName), ['selected-readonly', 'selected-readwrite']);
    assert.deepEqual(createdProfile.mounts.applied.map((mount) => mount.readOnly), [true, true]);
    assert.equal(await readFile(callLog, 'utf8'), dockerCallsBeforeCreate, 'saving a profile must not call Docker');
    const createdProfileConfig = JSON.parse(await readFile(join(configHome, 'desktop-commander-sandbox', 'workspace-profiles.json'), 'utf8'));
    assert.equal(createdProfileConfig.activeWorkspace, WORKSPACE, 'saving a profile must preserve the active workspace');

    const restoreProfile = await request(port, '/api/workspace-select', {
      ...auth,
      method: 'POST',
      body: { workspace: WORKSPACE },
    });
    assert.equal(restoreProfile.status, 200, restoreProfile.body);
    const restoredProfile = JSON.parse(restoreProfile.body);
    assert.equal(restoredProfile.project, PROJECT, restoreProfile.body);
    assert.deepEqual(restoredProfile.mounts.applied.map((mount) => mount.readOnly), [true, true]);
    const restoredProfiles = JSON.parse(await readFile(join(configHome, 'desktop-commander-sandbox', 'workspace-profiles.json'), 'utf8'));
    assert.equal(restoredProfiles.activeWorkspace, WORKSPACE);
    assert.equal(restoredProfiles.deviceProject, PROJECT);
    assert.deepEqual(restoredProfiles.workspaces[WORKSPACE].mounts.map((mount) => mount.readOnly), [true, true]);
  } finally {
    await stopConsole(child);
    await rm(temp, { recursive: true, force: true });
  }
});
