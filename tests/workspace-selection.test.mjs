import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  DEFAULT_PROJECT,
  DEFAULT_WORKSPACE,
  identifyWorkspaceDirectory,
  isWorkspaceName,
  listWorkspaceProfiles,
  workspaceDirectory,
  workspaceProjectName,
} from '../scripts/workspace-selection.mjs';

test('maps safe workspace identifiers to fixed directory and project names', () => {
  assert.equal(isWorkspaceName(DEFAULT_WORKSPACE), true);
  assert.equal(isWorkspaceName('analysis_01'), true);
  assert.equal(isWorkspaceName('../outside'), false);
  assert.equal(isWorkspaceName('Upper'), false);
  assert.equal(workspaceProjectName(DEFAULT_WORKSPACE), DEFAULT_PROJECT);
  assert.equal(workspaceProjectName('analysis_01'), 'remote-device-analysis_01');
  assert.throws(() => workspaceDirectory('/sandbox-workspace', '../outside'), /工作区名称/);
});

test('lists only direct safe workspace directories and never returns host paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rds-workspace-list-'));
  try {
    await mkdir(join(root, 'alpha'));
    await mkdir(join(root, 'with space'));
    await writeFile(join(root, 'not-a-folder'), 'fixture');
    const profiles = await listWorkspaceProfiles(root, 'new-profile');
    assert.deepEqual(profiles.map((profile) => profile.workspace), ['default', 'alpha', 'new-profile']);
    assert.equal(profiles[0].project, DEFAULT_PROJECT);
    assert.equal(profiles[1].directory, 'sandbox-workspace/alpha');
    assert.equal(profiles[1].exists, true);
    assert.equal(profiles[2].exists, false);
    assert.ok(profiles.every((profile) => !JSON.stringify(profile).includes(root)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('maps a selected directory to its managed profile or a stable opaque project id', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rds-selected-root-'));
  const outside = await mkdtemp(join(tmpdir(), 'rds-selected-outside-'));
  try {
    const managed = join(root, 'project_a');
    await mkdir(managed);
    const managedResult = await identifyWorkspaceDirectory(root, managed);
    assert.equal(managedResult.workspace, 'project_a');
    assert.equal(managedResult.project, 'remote-device-project_a');
    assert.equal(managedResult.external, false);

    const first = await identifyWorkspaceDirectory(root, outside);
    const second = await identifyWorkspaceDirectory(root, outside);
    assert.match(first.workspace, /^folder-[a-f0-9]{20}$/);
    assert.equal(first.workspace, second.workspace);
    assert.equal(first.project, second.project);
    assert.equal(first.directory, await realpath(outside));
    assert.equal(first.display, first.directory);
    assert.equal(first.external, true);
    await assert.rejects(identifyWorkspaceDirectory(root, join(outside, 'missing')), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
