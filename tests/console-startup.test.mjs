import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [
  'scripts/third-party-notices.mjs', 'scripts/package-third-party.mjs',
  'package.json', 'compose.yaml', 'scripts/node-version.mjs', 'scripts/console.mjs', 'scripts/console-cli.mjs', 'scripts/console-http.mjs', 'scripts/docker-output.mjs', 'scripts/run-log-files.mjs', 'scripts/compose-version.mjs',
  'scripts/mount-compose.mjs', 'scripts/public-data.mjs', 'scripts/run-log-security.mjs',
  'scripts/system-proxy.mjs', 'scripts/workspace-selection.mjs', 'scripts/workspace-settings.mjs',
  'web/authorization-url.mjs', 'web/ui-format.mjs',
];

test('read-only commands do not generate mount overrides and saved unsafe mounts cannot start', {
  skip: process.platform === 'win32' ? 'the synthetic Docker executable requires a POSIX shell' : false,
}, async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), 'rds-startup-')));
  const project = join(temp, 'project');
  const config = join(temp, 'config');
  const bin = join(temp, 'bin');
  const workspace = join(project, 'sandbox-workspace');
  const safeMount = join(temp, 'synthetic-mount');
  const logDirectory = join(temp, 'synthetic-logs');
  const callLog = join(temp, 'docker-calls.txt');
  const profileFile = join(config, 'desktop-commander-sandbox', 'workspace-profiles.json');
  const environment = {
    ...process.env,
    REMOTE_DEVICE_SANDBOX_CONFIG_HOME: config,
    REMOTE_DEVICE_SANDBOX_LOG_HOME: logDirectory,
    RDS_TEST_DOCKER_CALLS: callLog,
    PATH: `${bin}:${process.env.PATH || ''}`,
  };
  delete environment.REMOTE_DEVICE_PROJECT;
  delete environment.REMOTE_DEVICE_WORKSPACE;
  const run = (...args) => spawnSync(process.execPath, [join(project, 'scripts/console.mjs'), ...args], {
    cwd: project, env: environment, encoding: 'utf8', timeout: 10_000,
  });
  const writeProfile = async (directory, mounts, deviceProject = 'desktop-commander-sandbox-local') => writeFile(profileFile, `${JSON.stringify({
    version: 1,
    activeWorkspace: 'default',
    deviceProject,
    workspaces: {
      default: { label: 'default', directory, readOnly: false, mounts },
    },
  })}\n`, { mode: 0o600 });
  const mount = (directory) => [{ id: 'mount-012345abcdef', directory, readOnly: false }];

  try {
    for (const file of FILES) {
      const target = join(project, file);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(join(SOURCE_ROOT, file), target);
    }
    await mkdir(workspace);
    await mkdir(safeMount);
    // Linux requires selected folders to be group-accessible by the user's primary group.
    await chmod(workspace, 0o770);
    await chmod(safeMount, 0o770);
    await mkdir(logDirectory);
    await mkdir(dirname(profileFile), { recursive: true });
    await mkdir(bin);
    const docker = join(bin, 'docker');
    await writeFile(docker, `#!/bin/sh
printf '%s\\n' "$*" >> "$RDS_TEST_DOCKER_CALLS"
case " $* " in
  *' --version '*) printf 'Docker version synthetic\\n' ;;
  *' compose version --short '*) printf 'v2.25.0\\n' ;;
  *' info --format '*) printf '27.0.0\\n' ;;
  *' image inspect '*) printf 'sha256:synthetic\\n' ;;
  *' ps --all --format json '*) printf '[]\\n' ;;
esac
`, { mode: 0o700 });
    await chmod(docker, 0o700);

    await writeProfile(workspace, mount(safeMount));
    const doctor = run('doctor');
    assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
    assert.match(doctor.stdout, /Local prerequisites/);
    assert.doesNotMatch(doctor.stdout, /[\p{Script=Han}]/u);
    assert.equal(existsSync(join(project, '.runtime')), false);

    await writeProfile(workspace, mount(safeMount), 'rds-acceptance-project');
    const savedProjectDoctor = run('doctor');
    assert.equal(savedProjectDoctor.status, 0, savedProjectDoctor.stderr || savedProjectDoctor.stdout);
    assert.match(savedProjectDoctor.stdout, /Project: rds-acceptance-project/);
    assert.match(savedProjectDoctor.stdout, /Next step: npm run remote-device:dashboard\n/);
    assert.doesNotMatch(savedProjectDoctor.stdout, /Next step: .*--project/);
    await writeProfile(workspace, mount(safeMount));
    assert.equal(run('--help').status, 0);
    assert.equal(existsSync(join(project, '.runtime')), false);
    const status = run('status');
    assert.equal(status.status, 0, status.stderr || status.stdout);
    assert.match(status.stdout, /- remote-device: not created/);
    assert.doesNotMatch(status.stdout, /[\p{Script=Han}]/u);
    assert.equal(existsSync(join(project, '.runtime')), false);

    await writeProfile(workspace, mount(project));
    const unsafeDoctor = run('doctor');
    assert.equal(unsafeDoctor.status, 1);
    assert.match(unsafeDoctor.stdout, /mount boundaries failed validation/);
    const unsafeStart = run('start');
    assert.equal(unsafeStart.status, 1);
    assert.equal(existsSync(join(project, '.runtime')), false);

    await writeProfile(workspace, mount(logDirectory));
    assert.equal(run('start').status, 1);
    assert.equal(existsSync(join(project, '.runtime')), false);

    if (process.getuid?.() !== 0) {
      const blockedParent = join(temp, 'blocked-parent');
      const blockedFolder = join(blockedParent, 'workspace');
      await mkdir(blockedFolder, { recursive: true });
      await writeProfile(blockedFolder, []);
      await chmod(blockedParent, 0o000);
      try {
        const inaccessible = run('doctor');
        assert.equal(inaccessible.status, 1);
        assert.match(inaccessible.stdout, /Workspace folders: saved folder access or mount boundaries failed validation/);
        assert.doesNotMatch(inaccessible.stderr, /\n\s+at /);
        assert.equal(run('doctor', '--workspace', 'rescue').status, 0);
      } finally {
        await chmod(blockedParent, 0o700);
      }
    }

    const calls = await readFile(callLog, 'utf8');
    assert.doesNotMatch(calls, / up --no-build /);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
