import assert from 'node:assert/strict';
import test from 'node:test';
import { safeTokenEqual, sanitizePublicValue } from '../scripts/console-http.mjs';
import { cleanLogText, parseComposeJson, parseDockerStats, parseFixedDuOutput } from '../scripts/docker-output.mjs';
import { formatBytes, formatLocalTime } from '../web/ui-format.mjs';

test('parses Compose JSON as an array or as JSON lines', () => {
  assert.deepEqual(parseComposeJson(''), []);
  assert.deepEqual(parseComposeJson('[{"Service":"a"}]'), [{ Service: 'a' }]);
  assert.deepEqual(parseComposeJson('{"Service":"a"}\n{"Service":"b"}\n'), [{ Service: 'a' }, { Service: 'b' }]);
});

test('parses fixed docker stats output and rejects malformed data', () => {
  const stats = parseDockerStats('{"CPUPerc":"1.5%","MemUsage":"20MiB / 2GiB","NetIO":"1kB / 2kB","BlockIO":"0B / 0B","PIDs":"7"}\n');
  assert.equal(stats.cpu, '1.5%');
  assert.equal(stats.memory, '20MiB');
  assert.equal(stats.processes, 7);
  assert.throws(() => parseDockerStats(''));
  assert.throws(() => parseDockerStats('not json'));
});

test('accepts du output only for the expected fixed path', () => {
  assert.equal(parseFixedDuOutput('4096\t/home/tool\n', '/home/tool'), 4096);
  assert.throws(() => parseFixedDuOutput('4096\t/etc\n', '/home/tool'));
  assert.throws(() => parseFixedDuOutput('-1\t/home/tool', '/home/tool'));
});

test('strips terminal escape sequences and control characters from log text', () => {
  assert.equal(cleanLogText('\x1B[31mred\x1B[0m\r\x07ok'), 'red\nok');
});

test('compares session tokens without accepting near matches', () => {
  assert.equal(safeTokenEqual('abc', 'abc'), true);
  assert.equal(safeTokenEqual('abd', 'abc'), false);
  assert.equal(safeTokenEqual('ab', 'abc'), false);
  assert.equal(safeTokenEqual(undefined, 'abc'), false);
  assert.equal(safeTokenEqual('x'.repeat(201), 'x'.repeat(201)), false);
});

test('redacts public strings and only exposes allowlisted path fields', () => {
  const redact = (value) => String(value).replaceAll('/Users/demo', '<path>');
  const value = { note: '/Users/demo/a', localPath: '/Users/demo/b', nested: [{ text: '/Users/demo/c' }] };
  assert.deepEqual(sanitizePublicValue(value, redact), { note: '<path>/a', localPath: '<path>/b', nested: [{ text: '<path>/c' }] });
  assert.equal(sanitizePublicValue(value, redact, true).localPath, '/Users/demo/b');
  assert.equal(sanitizePublicValue({ text: '/Users/demo/c' }, redact, false, true).text, '/Users/demo/c');
});

test('formats byte sizes and timestamps for the console', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1_234_567), '1.23 MB');
  assert.equal(formatBytes(-1), '—');
  assert.equal(formatLocalTime('not a date', 'en'), '');
  assert.notEqual(formatLocalTime('2026-11-13T01:00:00Z', 'en'), '');
});

// Exercise the actual controller functions with synthetic filesystem fixtures.
const { mkdtemp, mkdir, writeFile, readFile, lstat, stat, chmod, readdir, symlink, rm, open } = await import('node:fs/promises');
const { constants, realpathSync } = await import('node:fs');
const { tmpdir } = await import('node:os');
const { join, dirname, resolve, relative, isAbsolute } = await import('node:path');
const { default: vm } = await import('node:vm');
const { canonicalControlPath, workspaceSettingsPath, applicationLogDirectory } = await import('../scripts/workspace-settings.mjs');
const controller = await readFile(new URL('../scripts/console.mjs', import.meta.url), 'utf8');
const boundaryCode = controller.slice(controller.indexOf('function pathIsWithin('), controller.indexOf('function validateActiveMountBoundaries('));
const permissionCode = controller.slice(controller.indexOf('async function createDedicatedWorkspace('), controller.indexOf('\nasync function ', controller.indexOf('async function prepareLinuxMountPermissions(') + 1));

test('Linux permission checks do not traverse or chmod existing files during replacement', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dcs-permission-'));
  try {
    const workspace = join(root, 'workspace');
    const victim = join(root, 'outside');
    await mkdir(workspace, { mode: 0o770 });
    await chmod(workspace, 0o770);
    await writeFile(victim, 'synthetic', { mode: 0o600 });
    await writeFile(join(workspace, 'file'), 'synthetic', { mode: 0o600 });
    const context = vm.createContext({ constants, open, mkdir, process: { platform: 'linux', getuid: process.getuid, getgid: process.getgid },
      async lstat(path) {
        const info = await lstat(path);
        // A concurrent writer swaps a child after the root check.
        await rm(join(workspace, 'file'), { force: true });
        await symlink(victim, join(workspace, 'file'));
        return info;
      },
      readdir() { throw new Error('Must not traverse an Agent-writable tree'); },
      chmod() { throw new Error('Must not chmod existing paths'); },
    });
    vm.runInContext(permissionCode, context);
    await context.prepareLinuxMountPermissions({ directory: workspace, external: false, readOnly: false });
    assert.equal((await stat(victim)).mode & 0o777, 0o600);
    assert.equal((await stat(workspace)).mode & 0o7777, 0o770);
    const fresh = join(root, 'fresh');
    await context.createDedicatedWorkspace(fresh);
    assert.equal((await stat(fresh)).mode & 0o7777, 0o2770);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('writable boundaries canonicalize HOME, XDG and custom config/log ancestors, including missing suffixes', async () => {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'dcs-boundary-')));
  try {
    const real = join(root, 'real');
    const alias = join(root, 'alias');
    await mkdir(real);
    await symlink(real, alias, 'dir');
    const project = join(root, 'project');
    await mkdir(project);
    const keys = process.platform === 'win32'
      ? ['USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'REMOTE_DEVICE_SANDBOX_CONFIG_HOME', 'REMOTE_DEVICE_SANDBOX_LOG_HOME']
      : ['HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'REMOTE_DEVICE_SANDBOX_CONFIG_HOME', 'REMOTE_DEVICE_SANDBOX_LOG_HOME'];
    for (const key of keys) {
      for (const platform of process.platform === 'win32' ? ['win32'] : key === 'HOME' ? ['linux', 'darwin'] : ['linux']) {
        const env = { HOME: join(root, 'home'), USERPROFILE: join(root, 'home'), [key]: join(alias, 'not-created') };
        const context = vm.createContext({ resolve, relative, isAbsolute, dirname, canonicalControlPath, process,
          ROOT: project, WORKSPACE_ROOT: join(project, 'sandbox-workspace'),
          WORKSPACE_SETTINGS_FILE: workspaceSettingsPath(platform, env), RUN_LOG_DIRECTORY: applicationLogDirectory(platform, env) });
        vm.runInContext(boundaryCode, context);
        assert.throws(() => context.validateWritableWorkspaceBoundary({ directory: real, external: true }, false), /本机挂载设置|本机运行日志/, key);
        context.validateWritableWorkspaceBoundary({ directory: real, external: true }, true);
        context.validateWritableWorkspaceBoundary({ directory: join(root, 'unrelated'), external: true }, false);
      }
    }
    await symlink(join(root, 'missing'), join(root, 'dangling'));
    assert.throws(() => canonicalControlPath(join(root, 'dangling', 'child')), /Dangling/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('mount preparation waits for a successful stop and does not run after a failed stop', async () => {
  const start = controller.indexOf('    const nextSelection = { ...selection, readOnly: nextReadOnly, label: nextLabel };');
  const code = controller.slice(start, controller.indexOf('    const previousRuntimeMounts', start));
  for (const stopCode of [0, 1]) {
    const events = [];
    const context = vm.createContext({ selection: {}, nextReadOnly: false, nextLabel: 'synthetic', nextMounts: [], attachedStart: null,
      status: { state: 'running', imagesReady: true },
      async readProjectStatus() { return { state: 'running' }; },
      async runComposeCapture(args) { assert.equal(args[0], 'stop'); events.push('stop'); return { code: stopCode }; },
      async checkMountDirectories() { events.push('permissions'); },
      async validateAdditionalMounts() { events.push('validate'); },
      async prepareDefaultReference() { events.push('reference'); },
    });
    const result = vm.runInContext(`(async () => { ${code} })()`, context);
    if (stopCode) {
      await assert.rejects(result, /未能正常停止/);
      assert.deepEqual(events, ['stop']);
    } else {
      await result;
      assert.deepEqual(events, ['stop', 'permissions', 'validate', 'reference', 'validate']);
    }
  }
});
