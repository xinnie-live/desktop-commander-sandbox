import { createHash } from 'node:crypto';
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

export const DEFAULT_WORKSPACE = 'default';
export const DEFAULT_PROJECT = 'desktop-commander-sandbox-local';
export const WORKSPACE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,27}$/;

export function isWorkspaceName(value) {
  return value === DEFAULT_WORKSPACE || (typeof value === 'string' && WORKSPACE_PATTERN.test(value));
}

export function workspaceProjectName(workspace) {
  if (!isWorkspaceName(workspace)) throw new Error('工作区名称不符合要求。');
  return workspace === DEFAULT_WORKSPACE ? DEFAULT_PROJECT : `remote-device-${workspace}`;
}

export function workspaceDirectory(root, workspace) {
  if (!isWorkspaceName(workspace)) throw new Error('工作区名称不符合要求。');
  return workspace === DEFAULT_WORKSPACE ? join(root, DEFAULT_WORKSPACE, 'work') : join(root, workspace);
}

export function projectWorkspaceProfile(root, workspace) {
  return {
    label: workspace,
    directory: workspaceDirectory(root, workspace),
    readOnly: false,
    mounts: workspace === DEFAULT_WORKSPACE
      ? [{ id: 'mount-000000000000', directory: join(root, DEFAULT_WORKSPACE, 'reference'), readOnly: true }]
      : [],
  };
}

export async function identifyWorkspaceDirectory(root, selectedDirectory, { allowMissing = false, allowInaccessible = false } = {}) {
  let canonicalDirectory;
  try {
    canonicalDirectory = await realpath(selectedDirectory);
  } catch (error) {
    if (!(allowMissing && error.code === 'ENOENT')
      && !(allowInaccessible && ['EACCES', 'EPERM'].includes(error.code))) throw error;
    if (!isAbsolute(selectedDirectory)) throw new Error('保存的工作区路径必须是绝对路径。');
    canonicalDirectory = resolve(selectedDirectory);
  }
  const details = await stat(canonicalDirectory).catch((error) => {
    if (allowMissing && error.code === 'ENOENT'
      || allowInaccessible && ['EACCES', 'EPERM'].includes(error.code)) return null;
    throw error;
  });
  if (details && !details.isDirectory()) throw new Error('请选择一个文件夹。');

  let canonicalRoot = null;
  try {
    canonicalRoot = await realpath(root);
  } catch (error) {
    if (error.code !== 'ENOENT' && !(allowInaccessible && ['EACCES', 'EPERM'].includes(error.code))) throw error;
  }

  if (canonicalDirectory === root || canonicalDirectory === workspaceDirectory(root, DEFAULT_WORKSPACE) || (canonicalRoot && canonicalDirectory === canonicalRoot)) {
    const display = canonicalDirectory === workspaceDirectory(root, DEFAULT_WORKSPACE) ? 'sandbox-workspace/default/work' : 'sandbox-workspace';
    return { workspace: DEFAULT_WORKSPACE, project: DEFAULT_PROJECT, directory: canonicalDirectory, display, external: false, exists: Boolean(details) };
  }
  const name = basename(canonicalDirectory);
  if (canonicalRoot && dirname(canonicalDirectory) === canonicalRoot && name !== DEFAULT_WORKSPACE && WORKSPACE_PATTERN.test(name)) {
    return { workspace: name, project: workspaceProjectName(name), directory: canonicalDirectory, display: `sandbox-workspace/${name}`, external: false, exists: Boolean(details) };
  }

  const identity = createHash('sha256').update(canonicalDirectory).digest('hex').slice(0, 20);
  const workspace = `folder-${identity}`;
  return {
    workspace,
    project: workspaceProjectName(workspace),
    directory: canonicalDirectory,
    display: canonicalDirectory,
    external: true,
    exists: Boolean(details),
  };
}

export async function listWorkspaceProfiles(root, selectedWorkspace = DEFAULT_WORKSPACE) {
  if (!isWorkspaceName(selectedWorkspace)) throw new Error('工作区名称不符合要求。');
  const names = new Set([DEFAULT_WORKSPACE, selectedWorkspace]);
  try {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.isDirectory() && WORKSPACE_PATTERN.test(entry.name)) names.add(entry.name);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const profiles = [];
  for (const name of [DEFAULT_WORKSPACE, ...[...names].filter((item) => item !== DEFAULT_WORKSPACE).sort()]) {
    const directory = workspaceDirectory(root, name);
    let exists = false;
    try {
      const details = await lstat(directory);
      exists = details.isDirectory() && !details.isSymbolicLink();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    profiles.push({
      workspace: name,
      project: workspaceProjectName(name),
      directory: name === DEFAULT_WORKSPACE ? 'sandbox-workspace/default/work' : `sandbox-workspace/${name}`,
      exists,
    });
  }
  return profiles;
}
