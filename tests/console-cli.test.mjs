import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  'scripts/third-party-notices.mjs', 'scripts/package-third-party.mjs',
  'package.json', 'compose.yaml',
  'scripts/node-version.mjs', 'scripts/console.mjs', 'scripts/console-cli.mjs', 'scripts/console-http.mjs', 'scripts/docker-output.mjs', 'scripts/run-log-files.mjs', 'scripts/compose-version.mjs',
  'scripts/mount-compose.mjs', 'scripts/public-data.mjs', 'scripts/run-log-security.mjs',
  'scripts/system-proxy.mjs', 'scripts/workspace-selection.mjs', 'scripts/workspace-settings.mjs',
  'web/authorization-url.mjs', 'web/ui-format.mjs',
  'web/app.js', 'web/i18n.mjs', 'web/index.html', 'web/style.css',
];

test('CLI and web share validated workspace profiles and apply one running-device transition', {
  skip: process.platform === 'win32' ? 'synthetic Docker executable uses a POSIX shell' : false,
}, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rds-cli-')));
  const project = join(root, 'project');
  const config = join(root, 'config');
  const logs = join(root, 'logs');
  const bin = join(root, 'bin');
  const main = join(root, 'main-folder');
  const customDefault = join(root, 'custom-default');
  const readOnlyFolder = join(root, 'read-only-folder');
  const writableFolder = join(root, 'writable-folder');
  const state = join(root, 'device-state');
  const callLog = join(root, 'docker-calls');
  const proxyLog = join(root, 'proxy-observed');
  const profileFile = join(config, 'desktop-commander-sandbox', 'workspace-profiles.json');
  const env = {
    ...process.env, REMOTE_DEVICE_CONSOLE_PORT: '0',
    REMOTE_DEVICE_SANDBOX_CONFIG_HOME: config,
    REMOTE_DEVICE_SANDBOX_LOG_HOME: logs,
    RDS_CLI_STATE: state,
    RDS_CLI_CALLS: callLog,
    RDS_CLI_PROXY: proxyLog,
    PATH: `${bin}:${process.env.PATH || ''}`,
  };
  delete env.REMOTE_DEVICE_PROJECT;
  delete env.REMOTE_DEVICE_WORKSPACE;
  const run = (...args) => spawnSync(process.execPath, [join(project, 'scripts/console.mjs'), ...args], {
    cwd: project, env, encoding: 'utf8', timeout: 12_000,
  });
  const runWithInput = (input, ...args) => spawnSync(process.execPath, [join(project, 'scripts/console.mjs'), ...args], {
    cwd: project, env, encoding: 'utf8', timeout: 12_000, input,
  });
  try {
    for (const file of FILES) {
      const target = join(project, file);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(SOURCE_ROOT, file), target);
    }
    for (const directory of [main, customDefault, readOnlyFolder, writableFolder, bin, logs]) {
      await mkdir(directory, { mode: 0o770 });
      await chmod(directory, 0o770);
    }
    await writeFile(state, 'stopped\n');
    const docker = join(bin, 'docker');
    await writeFile(docker, `#!/bin/sh
printf '%s\\n' "$*" >> "$RDS_CLI_CALLS"
case " $* " in
  *' ps --all --format json '*)
    if [ "$(cat "$RDS_CLI_STATE")" = running ]; then
      printf '[{"Service":"remote-device","Name":"synthetic-device","ID":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","State":"running","Status":"Up"}]\\n'
    else
      printf '[]\\n'
    fi ;;
  *' image inspect '*) printf 'sha256:synthetic\\n' ;;
  *' build '*) exit 0 ;;
  *' pull remote-device '*) exit 0 ;;
  *' stats --no-stream --format '*) printf '{"CPUPerc":"1.00%%","MemUsage":"1MiB / 2MiB","MemPerc":"50.00%%","NetIO":"1kB / 2kB","BlockIO":"3kB / 4kB","PIDs":"2"}\\n' ;;
  *' exec --no-TTY --user 10001:10001 remote-device du -s -B1 /var/lib/remote-device '*) printf '4096 /var/lib/remote-device\\n' ;;
  *' exec --no-TTY --user 10002:10002 remote-device du -s -B1 /home/tool '*) printf '2048 /home/tool\\n' ;;
  *' stop --timeout 15 '*) printf 'stopped\\n' > "$RDS_CLI_STATE" ;;
  *' up --no-build --pull never --remove-orphans '*) printf 'running\\n' > "$RDS_CLI_STATE"; printf '%s\\n' "$REMOTE_DEVICE_HTTP_PROXY" > "$RDS_CLI_PROXY"; printf 'SYNTHETIC_RUN\\n' ;;
  *) printf 'unsupported synthetic Docker call\\n' >&2; exit 87 ;;
esac
`, { mode: 0o700 });
    await chmod(docker, 0o700);

    const manifestPath = join(project, 'package.json');
    const originalManifest = await readFile(manifestPath, 'utf8');
    const releaseManifest = JSON.parse(originalManifest);
    releaseManifest.version = '1.2.3';
    await writeFile(manifestPath, JSON.stringify(releaseManifest));
    const pulled = run('pull');
    assert.equal(pulled.status, 0, pulled.stderr);
    assert.match(await readFile(callLog, 'utf8'), /pull remote-device/);
    assert.notEqual(run('pull', '--image', 'untrusted.invalid/image').status, 0);
    await writeFile(manifestPath, originalManifest);

    const builtIn = join(project, 'sandbox-workspace', 'default');
    const shownDefault = run('workspace', 'show', 'default');
    assert.equal(shownDefault.status, 0, shownDefault.stderr);
    assert.match(shownDefault.stdout, /work -> \/workspace/);
    assert.match(shownDefault.stdout, /reference -> \/mnt\/remote-device\/reference \(read-only,/);
    const built = run('build');
    assert.equal(built.status, 0, built.stderr);
    const referenceInput = join(builtIn, 'reference', 'input.txt');
    assert.equal(await readFile(referenceInput, 'utf8'), 'alpha\nbeta\n');
    await writeFile(referenceInput, 'existing local input\n');
    assert.equal(run('build').status, 0);
    assert.equal(await readFile(referenceInput, 'utf8'), 'existing local input\n');

    const unconfirmed = run('workspace', 'create', 'demo', '--main', main);
    assert.equal(unconfirmed.status, 1);
    assert.match(unconfirmed.stderr, /Confirmation requires a terminal/);

    const created = run('workspace', 'create', 'demo', '--main', main, '--mount-ro', readOnlyFolder, '--yes');
    assert.equal(created.status, 0, created.stderr || created.stdout);
    const saved = JSON.parse(await readFile(profileFile, 'utf8'));
    assert.equal(saved.workspaces.demo.directory, main);
    assert.equal(saved.workspaces.demo.readOnly, true);
    assert.equal(saved.workspaces.demo.mounts.length, 1);
    assert.equal(saved.workspaces.demo.mounts[0].readOnly, true);
    assert.match(created.stdout, /read-only-folder -> \/mnt\/remote-device\/read-only-folder/);
    assert.equal(saved.activeWorkspace, 'default');

    const listed = run('workspace', 'show', 'demo');
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /main-folder -> \/workspace/);
    assert.match(listed.stdout, /read-only-folder/);

    const selected = run('workspace', 'switch', 'demo', '--yes');
    assert.equal(selected.status, 0, selected.stderr || selected.stdout);
    assert.equal(JSON.parse(await readFile(profileFile, 'utf8')).activeWorkspace, 'demo');
    const selectedDefault = run('workspace', 'switch', 'default', '--yes');
    assert.equal(selectedDefault.status, 0, selectedDefault.stderr);
    const override = await readFile(join(project, '.runtime', 'mounts.compose.yaml'), 'utf8');
    assert.match(override, /target: "\/mnt\/remote-device\/reference"/);
    assert.match(override, /read_only: true/);
    assert.ok(override.includes(join(builtIn, 'reference')));
    assert.equal(run('workspace', 'switch', 'demo', '--yes').status, 0);


    await writeFile(state, 'running\n');
    const edited = run('workspace', 'edit', 'demo', '--mount-rw', writableFolder, '--read-only', '--yes');
    assert.equal(edited.status, 0, edited.stderr || edited.stdout);
    assert.match(edited.stdout, /SYNTHETIC_RUN/);
    const updated = JSON.parse(await readFile(profileFile, 'utf8'));
    assert.equal(updated.workspaces.demo.readOnly, true);
    assert.equal(updated.workspaces.demo.mounts.length, 2);
    assert.equal(updated.workspaces.demo.mounts[1].directory, writableFolder);
    const calls = await readFile(callLog, 'utf8');
    assert.equal((calls.match(/stop --timeout 15/g) || []).length, 1);
    assert.equal((calls.match(/up --no-build --pull never --remove-orphans/g) || []).length, 1);
    assert.match(calls, /up --no-build --pull never --remove-orphans --exit-code-from remote-device/);

    const unsafe = run('workspace', 'edit', 'demo', '--main', project, '--read-write', '--yes');
    assert.equal(unsafe.status, 1);
    assert.equal(JSON.parse(await readFile(profileFile, 'utf8')).workspaces.demo.directory, main);

    const dashboard = spawn(process.execPath, [join(project, 'scripts/console.mjs'), 'dashboard', '--no-open'], {
      cwd: project, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      const address = await new Promise((resolveAddress, rejectAddress) => {
        let output = '';
        const timeout = setTimeout(() => rejectAddress(new Error('Synthetic dashboard did not start.')), 8000);
        dashboard.once('error', rejectAddress);
        dashboard.stdout.on('data', (chunk) => {
          output += chunk.toString('utf8');
          const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/#session=([A-Za-z0-9_-]+)/);
          if (!match) return;
          clearTimeout(timeout);
          resolveAddress({ origin: `http://127.0.0.1:${match[1]}`, token: match[2] });
        });
      });
      const response = await fetch(`${address.origin}/api/workspaces`, {
        headers: {
          authorization: `Bearer ${address.token}`,
          'x-console-request': 'desktop-commander-sandbox',
          origin: address.origin,
        },
      });
      assert.equal(response.status, 200);
      const webProfile = (await response.json()).workspaces.find((item) => item.workspace === 'demo');
      assert.equal(webProfile.localPath, main);
      assert.equal(webProfile.mountCount, 2);
      assert.equal(webProfile.readOnly, true);
    } finally {
      if (dashboard.exitCode === null && dashboard.signalCode === null) {
        const closed = new Promise((resolveClose) => dashboard.once('close', resolveClose));
        dashboard.kill('SIGTERM');
        await closed;
      }
    }

    const runs = run('logs', 'list');
    assert.equal(runs.status, 0, runs.stderr);
    const runId = JSON.parse(runs.stdout)[0]?.id;
    assert.match(runId, /^[a-f0-9]{16}$/);
    const log = run('logs', 'show', runId);
    assert.equal(log.status, 0, log.stderr);
    assert.match(log.stdout, /SYNTHETIC_RUN/);

    const resources = run('resources');
    assert.equal(resources.status, 0, resources.stderr);
    assert.equal(JSON.parse(resources.stdout).running, true);
    const storage = run('storage');
    assert.equal(storage.status, 0, storage.stderr);
    assert.equal(JSON.parse(storage.stdout).bytes, 6144);

    const mountId = updated.workspaces.demo.mounts[1].id;
    assert.equal(run('mount', 'mode', mountId, 'ro:extra', '--yes').status, 1);
    const mode = run('mount', 'mode', mountId, 'ro', '--yes');
    assert.equal(mode.status, 0, mode.stderr || mode.stdout);
    assert.equal(JSON.parse(await readFile(profileFile, 'utf8')).workspaces.demo.mounts[1].readOnly, true);
    const removed = run('mount', 'remove', mountId, '--yes');
    assert.equal(removed.status, 0, removed.stderr || removed.stdout);
    assert.equal(JSON.parse(await readFile(profileFile, 'utf8')).workspaces.demo.mounts.length, 1);

    const builtinMount = JSON.parse(await readFile(profileFile, 'utf8')).workspaces.default.mounts[0];
    const editedDefault = run('workspace', 'edit', 'default', '--main', customDefault,
      '--read-only', '--remove-mount', builtinMount.id, '--mount-ro', readOnlyFolder, '--yes');
    assert.equal(editedDefault.status, 0, editedDefault.stderr || editedDefault.stdout);
    const savedDefault = JSON.parse(await readFile(profileFile, 'utf8')).workspaces.default;
    assert.equal(savedDefault.directory, customDefault);
    assert.equal(savedDefault.readOnly, true);
    assert.equal(savedDefault.mounts[0].directory, readOnlyFolder);

    const deleted = run('workspace', 'delete', 'demo', '--yes');
    assert.equal(deleted.status, 0, deleted.stderr || deleted.stdout);
    const afterDeletion = JSON.parse(await readFile(profileFile, 'utf8'));
    assert.equal(afterDeletion.workspaces.demo, undefined);
    assert.equal(afterDeletion.activeWorkspace, 'default');
    assert.deepEqual(afterDeletion.workspaces.default, savedDefault);
    assert.equal(await realpath(main), main);

    const added = run('mount', 'add', writableFolder, '--yes');
    assert.equal(added.status, 0, added.stderr || added.stdout);
    assert.equal(JSON.parse(await readFile(profileFile, 'utf8')).workspaces.default.mounts[0].readOnly, true);

    await writeFile(state, 'stopped\n');
    await rm(proxyLog, { force: true });
    const proxied = spawn(process.execPath, [join(project, 'scripts/console.mjs'), 'start', '--proxy', 'manual', '--yes', '--no-open'], {
      cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'],
    });
    try {
      proxied.stdin.end('http://127.0.0.1:18080\n');
      await new Promise((resolveReady, rejectReady) => {
        const timer = setTimeout(() => rejectReady(new Error('CLI controller did not open.')), 8000);
        proxied.stdout.on('data', (chunk) => {
          if (!chunk.toString('utf8').includes('Desktop Commander Sandbox console:')) return;
          clearTimeout(timer);
          resolveReady();
        });
        proxied.once('error', rejectReady);
      });
      let observed = '';
      for (let attempt = 0; attempt < 100; attempt += 1) {
        observed = await readFile(proxyLog, 'utf8').catch(() => '');
        if (observed.endsWith('\n')) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }
      assert.equal(observed.trim(), 'http://host.docker.internal:18080/');
    } finally {
      if (proxied.exitCode === null && proxied.signalCode === null) {
        const closed = new Promise((resolveClose) => proxied.once('close', resolveClose));
        proxied.kill('SIGTERM');
        await closed;
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('parallel CLI profile edits never report success for a lost change', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rds-cli-concurrent-')));
  const config = join(root, 'config');
  const profileFile = join(config, 'desktop-commander-sandbox', 'workspace-profiles.json');
  const main = join(root, 'main');
  try {
    await mkdir(main);
    await mkdir(dirname(profileFile), { recursive: true });
    await writeFile(profileFile, `${JSON.stringify({
      version: 1,
      activeWorkspace: 'default',
      deviceProject: 'rds-concurrent-test',
      workspaces: { default: { label: 'default', directory: main, readOnly: true, mounts: [] } },
    })}\n`);
    const env = { ...process.env, REMOTE_DEVICE_CONSOLE_PORT: '0', REMOTE_DEVICE_SANDBOX_LOG_HOME: join(config, 'test-logs'), REMOTE_DEVICE_SANDBOX_CONFIG_HOME: config };
    delete env.REMOTE_DEVICE_PROJECT;
    delete env.REMOTE_DEVICE_WORKSPACE;
    const results = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
      const name = `race-${index}`;
      const directory = join(root, name);
      await mkdir(directory);
      await chmod(directory, 0o770);
      return new Promise((resolveRun, rejectRun) => {
        const child = spawn(process.execPath, [join(SOURCE_ROOT, 'scripts/console.mjs'), 'workspace', 'create', name,
          '--main', directory, '--read-only', '--yes'], { cwd: SOURCE_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = '';
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { output += chunk; });
        child.once('error', rejectRun);
        child.once('close', (code) => resolveRun({ name, code, output }));
      });
    }));
    const saved = JSON.parse(await readFile(profileFile, 'utf8'));
    const successful = results.filter((result) => result.code === 0);
    assert.ok(successful.length >= 1);
    for (const result of successful) assert.ok(saved.workspaces[result.name], result.name);
    for (const result of results.filter((item) => item.code !== 0)) {
      assert.match(result.output, /Workspace profiles changed in another controller/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('parallel running-device edits perform only one stop and restart', {
  skip: process.platform === 'win32' ? 'synthetic Docker executable uses a POSIX shell' : false,
  timeout: 15_000,
}, async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'rds-cli-transition-lock-')));
  const config = join(root, 'config');
  const profileFile = join(config, 'desktop-commander-sandbox', 'workspace-profiles.json');
  const main = join(root, 'main');
  const bin = join(root, 'bin');
  const state = join(root, 'state');
  const calls = join(root, 'calls');
  const release = join(root, 'release-stop');
  const children = [];
  try {
    await mkdir(dirname(profileFile), { recursive: true });
    await mkdir(main);
    // Linux requires selected folders to be group-accessible by the user's primary group.
    await chmod(main, 0o770);
    await mkdir(bin);
    await writeFile(state, 'running\n');
    await writeFile(profileFile, `${JSON.stringify({
      version: 1,
      activeWorkspace: 'default',
      deviceProject: 'rds-transition-test',
      workspaces: { default: { label: 'default', directory: main, readOnly: true, mounts: [] } },
    })}\n`);
    const docker = join(bin, 'docker');
    await writeFile(docker, `#!/bin/sh
printf '%s\\n' "$*" >> "$RDS_TRANSITION_CALLS"
case " $* " in
  *' ps --all --format json '*)
    if [ "$(cat "$RDS_TRANSITION_STATE")" = running ]; then
      printf '[{"Service":"remote-device","Name":"synthetic-device","ID":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef","State":"running","Status":"Up"}]\\n'
    else
      printf '[]\\n'
    fi ;;
  *' image inspect '*) printf 'sha256:synthetic\\n' ;;
  *' stop --timeout 15 '*) while [ ! -e "$RDS_TRANSITION_RELEASE" ]; do sleep 0.05; done; printf 'stopped\\n' > "$RDS_TRANSITION_STATE" ;;
  *' up --no-build --pull never --remove-orphans '*) printf 'running\\n' > "$RDS_TRANSITION_STATE"; printf 'SYNTHETIC_RUN\\n' ;;
  *) exit 87 ;;
esac
`, { mode: 0o700 });
    await chmod(docker, 0o700);
    const env = { ...process.env, REMOTE_DEVICE_CONSOLE_PORT: '0', REMOTE_DEVICE_SANDBOX_LOG_HOME: join(config, 'test-logs'), REMOTE_DEVICE_SANDBOX_CONFIG_HOME: config,
      RDS_TRANSITION_STATE: state, RDS_TRANSITION_CALLS: calls, RDS_TRANSITION_RELEASE: release,
      PATH: `${bin}:${process.env.PATH || ''}` };
    delete env.REMOTE_DEVICE_PROJECT;
    delete env.REMOTE_DEVICE_WORKSPACE;
    const startEdit = (label) => {
      const child = spawn(process.execPath, [join(SOURCE_ROOT, 'scripts/console.mjs'), 'workspace', 'edit', 'default',
        '--label', label, '--read-write', '--yes'], { cwd: SOURCE_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
      const run = { label, child, output: '', done: null };
      child.stdout.on('data', (chunk) => { run.output += chunk; });
      child.stderr.on('data', (chunk) => { run.output += chunk; });
      run.done = new Promise((resolveRun, rejectRun) => {
        child.once('error', rejectRun);
        child.once('close', (code) => resolveRun({ label, code, output: run.output }));
      });
      children.push(run);
      return run;
    };
    const waitFor = async (predicate) => {
      const deadline = Date.now() + 5_000;
      while (!await predicate()) {
        if (Date.now() > deadline) throw new Error('Synthetic concurrent edit did not reach its expected stage.');
        await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      }
    };
    const first = startEdit('first');
    await waitFor(async () => (await readFile(calls, 'utf8').catch(() => '')).includes('stop --timeout 15'));
    const second = startEdit('second');
    await waitFor(() => second.output.includes('Edit workspace default'));
    await writeFile(release, 'continue\n');
    const results = await Promise.all([first.done, second.done]);
    const successful = results.filter((result) => result.code === 0);
    assert.equal(successful.length, 1, JSON.stringify(results));
    assert.match(results.find((result) => result.code !== 0).output, /Workspace profiles changed in another controller/);
    assert.equal(JSON.parse(await readFile(profileFile, 'utf8')).workspaces.default.label, successful[0].label);
    const callLog = await readFile(calls, 'utf8');
    assert.equal((callLog.match(/stop --timeout 15/g) || []).length, 1);
    assert.equal((callLog.match(/up --no-build --pull never --remove-orphans/g) || []).length, 1);
  } finally {
    await writeFile(release, 'continue\n').catch(() => {});
    for (const run of children) if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGTERM');
    await Promise.allSettled(children.map((run) => run.done));
    await rm(root, { recursive: true, force: true });
  }
});
