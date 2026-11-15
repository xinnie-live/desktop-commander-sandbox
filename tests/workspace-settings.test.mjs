import assert from 'node:assert/strict';
import { lstat, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  applicationLogDirectory,
  replaceConfigFile,
  mountProfilesPath,
  readMountProfiles,
  readWorkspaceProfiles,
  readWorkspaceSettings,
  workspaceSettingsPath,
  workspaceProfilesPath,
  writeMountProfiles,
  writeWorkspaceProfiles,
  writeWorkspaceSettings,
  withWorkspaceProfileOperationLock,
} from '../scripts/workspace-settings.mjs';

test('chooses platform-specific per-user settings locations', () => {
  assert.equal(workspaceSettingsPath('darwin', { HOME: '/Users/demo' }), '/Users/demo/Library/Application Support/desktop-commander-sandbox/workspace.json');
  assert.equal(workspaceSettingsPath('win32', { APPDATA: 'C:\\Users\\demo\\AppData\\Roaming' }), 'C:\\Users\\demo\\AppData\\Roaming\\desktop-commander-sandbox\\workspace.json');
  assert.equal(workspaceSettingsPath('linux', { XDG_CONFIG_HOME: '/home/demo/.config' }), '/home/demo/.config/desktop-commander-sandbox/workspace.json');
  assert.equal(workspaceSettingsPath('linux', { HOME: '/home/demo' }), '/home/demo/.config/desktop-commander-sandbox/workspace.json');
  assert.equal(mountProfilesPath('linux', { XDG_CONFIG_HOME: '/tmp/config' }), '/tmp/config/desktop-commander-sandbox/mount-profiles.json');
  assert.equal(workspaceProfilesPath('darwin', { HOME: '/Users/demo' }), '/Users/demo/Library/Application Support/desktop-commander-sandbox/workspace-profiles.json');
  assert.equal(applicationLogDirectory('darwin', { HOME: '/Users/demo' }), '/Users/demo/Library/Logs/Desktop Commander Sandbox');
  assert.equal(applicationLogDirectory('win32', { LOCALAPPDATA: 'C:\\Users\\demo\\AppData\\Local' }), 'C:\\Users\\demo\\AppData\\Local\\Desktop Commander Sandbox\\logs');
  assert.equal(applicationLogDirectory('linux', { XDG_STATE_HOME: '/home/demo/.local/state' }), '/home/demo/.local/state/desktop-commander-sandbox/logs');
});

test('serializes profile operations and releases the lock after failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rds-operation-lock-'));
  const file = join(root, 'app', 'workspace-profiles.json');
  const order = [];
  let releaseFirst;
  let signalFirst;
  const firstEntered = new Promise((resolveEntered) => { signalFirst = resolveEntered; });
  const gate = new Promise((resolveGate) => { releaseFirst = resolveGate; });
  try {
    const first = withWorkspaceProfileOperationLock(file, async () => {
      order.push('first entered');
      signalFirst();
      await gate;
      order.push('first finished');
    });
    await firstEntered;
    const second = withWorkspaceProfileOperationLock(file, async () => { order.push('second entered'); });
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(order, ['first entered', 'first finished', 'second entered']);
    await assert.rejects(withWorkspaceProfileOperationLock(file, () => { throw new Error('synthetic failure'); }), /synthetic failure/);
    await withWorkspaceProfileOperationLock(file, () => { order.push('recovered'); });
    assert.equal(order.at(-1), 'recovered');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('persists validated workspace and per-project mount settings with private file permissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rds-settings-'));
  const workspaceFile = join(root, 'app', 'workspace.json');
  const mountsFile = join(root, 'app', 'mount-profiles.json');
  const profilesFile = join(root, 'app', 'workspace-profiles.json');
  try {
    const workspace = { version: 1, directory: join(root, 'user-files'), readOnly: true };
    await writeWorkspaceSettings(workspaceFile, workspace);
    assert.deepEqual(await readWorkspaceSettings(workspaceFile), workspace);
    const profile = { version: 1, projects: { 'remote-device-demo': [
      { id: 'mount-012345abcdef', directory: join(root, 'read-only'), readOnly: true },
      { id: 'mount-fedcba987654', directory: join(root, 'read-write'), readOnly: false },
    ] } };
    await writeMountProfiles(mountsFile, profile);
    assert.deepEqual(await readMountProfiles(mountsFile), profile);
    const workspaces = {
      version: 1,
      activeWorkspace: 'demo',
      deviceProject: 'remote-device-main',
      deletedWorkspaces: [],
      workspaces: {
        demo: {
          label: 'Demo',
          directory: join(root, 'user-files'),
          readOnly: true,
          mounts: profile.projects['remote-device-demo'],
        },
      },
    };
    await writeWorkspaceProfiles(profilesFile, workspaces);
    assert.deepEqual(await readWorkspaceProfiles(profilesFile), workspaces);
    const withDeletedProfile = { ...workspaces, deletedWorkspaces: ['legacy'] };
    await writeWorkspaceProfiles(profilesFile, withDeletedProfile);
    assert.deepEqual(await readWorkspaceProfiles(profilesFile), withDeletedProfile);
    if (process.platform !== 'win32') {
      assert.equal((await lstat(join(root, 'app'))).mode & 0o777, 0o700);
      assert.equal((await lstat(workspaceFile)).mode & 0o777, 0o600);
      assert.equal((await lstat(mountsFile)).mode & 0o777, 0o600);
      assert.equal((await lstat(profilesFile)).mode & 0o777, 0o600);
    }
    await assert.rejects(writeWorkspaceSettings(workspaceFile, { version: 1, directory: 'relative', readOnly: false }), /设置格式无效/);
    await assert.rejects(writeMountProfiles(mountsFile, { version: 1, projects: { 'remote-device-demo': [{ id: 'mount-unsafe', directory: '/tmp', readOnly: false }] } }), /挂载清单/);
    await assert.rejects(writeWorkspaceProfiles(profilesFile, { ...workspaces, deviceProject: '../outside' }), /工作区配置/);
    await assert.rejects(writeWorkspaceProfiles(profilesFile, { ...workspaces, deletedWorkspaces: ['demo'] }), /已删除项目列表无效/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('does not follow a symlink in either settings file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rds-settings-link-'));
  const target = join(root, 'target.json');
  const workspaceLink = join(root, 'workspace.json');
  const mountsLink = join(root, 'mount-profiles.json');
  const workspaceProfilesLink = join(root, 'workspace-profiles.json');
  try {
    await writeFile(target, '{"version":1,"directory":"/tmp","readOnly":false}');
    await symlink(target, workspaceLink);
    await symlink(target, mountsLink);
    await symlink(target, workspaceProfilesLink);
    await assert.rejects(readWorkspaceSettings(workspaceLink), /普通文件/);
    await assert.rejects(readMountProfiles(mountsLink), /普通文件/);
    await assert.rejects(readWorkspaceProfiles(workspaceProfilesLink), /普通文件/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Windows config replacement survives transient sharing errors and preserves atomic failure', async () => {
  let attempts = 0;
  const calls = [];
  const busy = Object.assign(new Error('sharing violation'), { code: 'EPERM' });
  await replaceConfigFile('temporary', 'config', {
    platform: 'win32', pause: async () => {},
    renameFile: async (...args) => { calls.push(args); if (++attempts < 3) throw busy; },
  });
  assert.equal(attempts, 3);
  assert.deepEqual(calls, Array.from({ length: 3 }, () => ['temporary', 'config']));
  for (const [platform, code, expectedAttempts] of [['win32', 'EPERM', 6], ['linux', 'EPERM', 1], ['win32', 'ENOENT', 1]]) {
    attempts = 0;
    const failure = Object.assign(new Error('rename failed'), { code });
    await assert.rejects(replaceConfigFile('temporary', 'config', {
      platform, pause: async () => {}, renameFile: async () => { attempts += 1; throw failure; },
    }), (error) => error === failure);
    assert.equal(attempts, expectedAttempts);
  }
});
