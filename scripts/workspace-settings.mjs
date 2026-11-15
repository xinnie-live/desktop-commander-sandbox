import { realpathSync, lstatSync } from 'node:fs';
import { chmod, lstat, mkdir, readFile, rename, rm, rmdir, utimes, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, posix, resolve, win32 } from 'node:path';
import { randomBytes } from 'node:crypto';

// Resolve existing ancestors even when the final config/log directory is not created yet.
// A dangling symlink or inaccessible ancestor must fail closed.
export function canonicalControlPath(path) {
  const absolute = resolve(path);
  try { return realpathSync(absolute); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try { lstatSync(absolute); throw new Error('Dangling control-path symlink'); }
    catch (issue) { if (issue.code !== 'ENOENT') throw issue; }
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return join(canonicalControlPath(parent), basename(absolute));
  }
}

export function workspaceSettingsPath(platform = process.platform, env = process.env) {
  const pathApi = platform === 'win32' ? win32 : posix;
  if (env.REMOTE_DEVICE_SANDBOX_CONFIG_HOME && pathApi.isAbsolute(env.REMOTE_DEVICE_SANDBOX_CONFIG_HOME)) {
    return pathApi.join(env.REMOTE_DEVICE_SANDBOX_CONFIG_HOME, 'desktop-commander-sandbox', 'workspace.json');
  }
  let base;
  if (platform === 'win32') {
    base = env.APPDATA && pathApi.isAbsolute(env.APPDATA)
      ? env.APPDATA
      : env.USERPROFILE && pathApi.isAbsolute(env.USERPROFILE)
        ? pathApi.join(env.USERPROFILE, 'AppData', 'Roaming')
        : null;
  } else if (platform === 'darwin') {
    base = env.HOME && pathApi.isAbsolute(env.HOME) ? pathApi.join(env.HOME, 'Library', 'Application Support') : null;
  } else if (platform === 'linux') {
    base = env.XDG_CONFIG_HOME && pathApi.isAbsolute(env.XDG_CONFIG_HOME)
      ? env.XDG_CONFIG_HOME
      : env.HOME && pathApi.isAbsolute(env.HOME)
        ? pathApi.join(env.HOME, '.config')
        : null;
  }
  if (!base) throw new Error('无法确定当前用户的本机配置目录。');
  return pathApi.join(base, 'desktop-commander-sandbox', 'workspace.json');
}

export function mountProfilesPath(platform = process.platform, env = process.env) {
  const pathApi = platform === 'win32' ? win32 : posix;
  return pathApi.join(pathApi.dirname(workspaceSettingsPath(platform, env)), 'mount-profiles.json');
}

export function workspaceProfilesPath(platform = process.platform, env = process.env) {
  const pathApi = platform === 'win32' ? win32 : posix;
  return pathApi.join(pathApi.dirname(workspaceSettingsPath(platform, env)), 'workspace-profiles.json');
}

export function applicationLogDirectory(platform = process.platform, env = process.env) {
  const pathApi = platform === 'win32' ? win32 : posix;
  if (env.REMOTE_DEVICE_SANDBOX_LOG_HOME && pathApi.isAbsolute(env.REMOTE_DEVICE_SANDBOX_LOG_HOME)) {
    return pathApi.resolve(env.REMOTE_DEVICE_SANDBOX_LOG_HOME);
  }
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA && pathApi.isAbsolute(env.LOCALAPPDATA)
      ? env.LOCALAPPDATA
      : env.USERPROFILE && pathApi.isAbsolute(env.USERPROFILE)
        ? pathApi.join(env.USERPROFILE, 'AppData', 'Local')
        : null;
    if (!base) throw new Error('无法确定当前用户的本机日志目录。');
    return pathApi.join(base, 'Desktop Commander Sandbox', 'logs');
  }
  if (platform === 'darwin') {
    if (!env.HOME || !pathApi.isAbsolute(env.HOME)) throw new Error('无法确定当前用户的本机日志目录。');
    return pathApi.join(env.HOME, 'Library', 'Logs', 'Desktop Commander Sandbox');
  }
  if (platform === 'linux') {
    const base = env.XDG_STATE_HOME && pathApi.isAbsolute(env.XDG_STATE_HOME)
      ? env.XDG_STATE_HOME
      : env.HOME && pathApi.isAbsolute(env.HOME)
        ? pathApi.join(env.HOME, '.local', 'state')
        : null;
    if (!base) throw new Error('无法确定当前用户的本机日志目录。');
    return pathApi.join(base, 'desktop-commander-sandbox', 'logs');
  }
  throw new Error('当前系统没有配置本机日志目录。');
}

const WORKSPACE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,27}$/;
const COMPOSE_PROJECT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,49}$/;

export function validateWorkspaceProfiles(value) {
  if (!value || value.version !== 1 || typeof value.activeWorkspace !== 'string'
    || !WORKSPACE_ID_PATTERN.test(value.activeWorkspace)
    || typeof value.deviceProject !== 'string' || !COMPOSE_PROJECT_PATTERN.test(value.deviceProject)
    || !value.workspaces || typeof value.workspaces !== 'object' || Array.isArray(value.workspaces)) {
    throw new Error('本机项目工作区配置格式无效；请修复或移除该配置后重试。');
  }
  const deletedWorkspaces = value.deletedWorkspaces ?? [];
  if (!Array.isArray(deletedWorkspaces) || deletedWorkspaces.length > 2000
    || deletedWorkspaces.some((workspace) => !WORKSPACE_ID_PATTERN.test(workspace) || workspace === 'default'
      || workspace === value.activeWorkspace || Object.hasOwn(value.workspaces, workspace))
    || new Set(deletedWorkspaces).size !== deletedWorkspaces.length) {
    throw new Error('本机项目工作区配置中的已删除项目列表无效。');
  }
  const workspaces = {};
  const entries = Object.entries(value.workspaces);
  if (entries.length > 200 || !Object.hasOwn(value.workspaces, value.activeWorkspace)) {
    throw new Error('本机项目工作区配置格式无效；当前项目配置缺失或数量超出限制。');
  }
  for (const [workspace, profile] of entries) {
    if (!WORKSPACE_ID_PATTERN.test(workspace) || !profile || typeof profile.directory !== 'string'
      || !isAbsolute(profile.directory) || typeof profile.readOnly !== 'boolean'
      || typeof profile.label !== 'string' || !profile.label.trim() || profile.label.length > 120
      || !Array.isArray(profile.mounts) || profile.mounts.length > 8) {
      throw new Error('本机项目工作区配置格式无效；请修复或移除该配置后重试。');
    }
    const ids = new Set();
    const mounts = profile.mounts.map((mount) => {
      if (!mount || typeof mount.id !== 'string' || !/^mount-[a-f0-9]{12}$/.test(mount.id)
        || ids.has(mount.id) || typeof mount.directory !== 'string' || !isAbsolute(mount.directory)
        || typeof mount.readOnly !== 'boolean') {
        throw new Error('本机项目工作区中的挂载配置无效；请修复或移除该配置后重试。');
      }
      ids.add(mount.id);
      return { id: mount.id, directory: resolve(mount.directory), readOnly: mount.readOnly };
    });
    workspaces[workspace] = {
      label: profile.label.trim(),
      directory: resolve(profile.directory),
      readOnly: profile.readOnly,
      mounts,
    };
  }
  return { version: 1, activeWorkspace: value.activeWorkspace, deviceProject: value.deviceProject, workspaces, deletedWorkspaces };
}

export async function readWorkspaceProfiles(path) {
  let details;
  try {
    details = await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error('本机项目工作区配置必须是普通文件；为避免读取被替换的配置，控制台已停止。');
  }
  try {
    return validateWorkspaceProfiles(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error.message.startsWith('本机项目工作区')) throw error;
    throw new Error('本机项目工作区配置无法读取或解析；请修复或移除该配置后重试。');
  }
}

async function withDirectoryLock(lockPath, action, { staleMs = 30_000, heartbeatMs = 0 } = {}) {
  let acquired = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await mkdir(lockPath, { mode: 0o700 });
      acquired = true;
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const details = await lstat(lockPath).catch((issue) => issue.code === 'ENOENT' ? null : Promise.reject(issue));
      if (details && (!details.isDirectory() || details.isSymbolicLink())) {
        throw new Error('本机工作区写入锁不是普通目录；请检查本机配置。');
      }
      if (details && Date.now() - details.mtimeMs > staleMs) {
        await rmdir(lockPath).catch((issue) => { if (issue.code !== 'ENOENT') throw issue; });
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
  }
  if (!acquired) {
    const error = new Error('另一控制进程正在修改工作区；请稍后重试。');
    error.code = 'WORKSPACE_PROFILE_BUSY';
    throw error;
  }
  const heartbeat = heartbeatMs ? setInterval(() => {
    const now = new Date();
    utimes(lockPath, now, now).catch(() => {});
  }, heartbeatMs) : null;
  heartbeat?.unref();
  try {
    return await action();
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    await rmdir(lockPath);
  }
}

export async function withWorkspaceProfileOperationLock(path, action) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const details = await lstat(directory);
  if (!details.isDirectory() || details.isSymbolicLink()) throw new Error('本机项目工作区配置目录必须是普通目录。');
  await chmod(directory, 0o700);
  return withDirectoryLock(`${path}.operation.lock`, action, { staleMs: 120_000, heartbeatMs: 10_000 });
}

export async function writeWorkspaceProfiles(path, value, { expectedRevision } = {}) {
  const profiles = validateWorkspaceProfiles(value);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryDetails = await lstat(directory);
  if (!directoryDetails.isDirectory() || directoryDetails.isSymbolicLink()) {
    throw new Error('本机项目工作区配置目录必须是普通目录。');
  }
  await chmod(directory, 0o700);
  await withDirectoryLock(`${path}.lock`, async () => {
    const existing = await lstat(path).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
      throw new Error('拒绝覆盖非普通的本机项目工作区配置文件。');
    }
    if (expectedRevision !== undefined) {
      const current = await readWorkspaceProfiles(path);
      if ((current ? JSON.stringify(current) : null) !== expectedRevision) {
        const error = new Error('工作区已被另一控制进程修改；请重新读取最新清单后重试。');
        error.code = 'WORKSPACE_PROFILE_CONFLICT';
        throw error;
      }
    }
    const temporary = join(directory, `.workspace-profiles-${process.pid}-${randomBytes(8).toString('hex')}.tmp`);
    try {
      await writeFile(temporary, `${JSON.stringify(profiles, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  });
}

function validateSettings(value) {
  if (!value || value.version !== 1 || typeof value.directory !== 'string'
    || !isAbsolute(value.directory) || typeof value.readOnly !== 'boolean') {
    throw new Error('本机工作区设置格式无效；请重新选择文件夹。');
  }
  return { version: 1, directory: resolve(value.directory), readOnly: value.readOnly };
}

export async function readWorkspaceSettings(path) {
  let details;
  try {
    details = await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!details.isFile() || details.isSymbolicLink()) throw new Error('本机工作区设置必须是普通文件；为避免读取被替换的配置，控制台已停止。');
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('本机工作区设置无法读取或解析；请修复或移除该设置文件后重试。');
  }
  return validateSettings(parsed);
}

export async function writeWorkspaceSettings(path, value) {
  const settings = validateSettings(value);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryDetails = await lstat(directory);
  if (!directoryDetails.isDirectory() || directoryDetails.isSymbolicLink()) {
    throw new Error('本机工作区设置目录必须是普通目录。');
  }
  await chmod(directory, 0o700);
  const existing = await lstat(path).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
    throw new Error('拒绝覆盖非普通的本机工作区设置文件。');
  }

  const temporary = join(directory, `.workspace-${process.pid}-${randomBytes(8).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

function validateMountProfiles(value) {
  if (!value || value.version !== 1 || !value.projects || typeof value.projects !== 'object' || Array.isArray(value.projects)) {
    throw new Error('本机挂载清单格式无效；请修复或移除挂载清单后重试。');
  }
  const projects = {};
  for (const [project, mounts] of Object.entries(value.projects)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,49}$/.test(project) || !Array.isArray(mounts) || mounts.length > 8) {
      throw new Error('本机挂载清单格式无效；请修复或移除挂载清单后重试。');
    }
    const ids = new Set();
    projects[project] = mounts.map((mount) => {
      if (!mount || typeof mount.id !== 'string' || !/^mount-[a-f0-9]{12}$/.test(mount.id)
        || ids.has(mount.id) || typeof mount.directory !== 'string' || !isAbsolute(mount.directory)
        || typeof mount.readOnly !== 'boolean') {
        throw new Error('本机挂载清单中的项目无效；请修复或移除挂载清单后重试。');
      }
      ids.add(mount.id);
      return { id: mount.id, directory: resolve(mount.directory), readOnly: mount.readOnly };
    });
  }
  return { version: 1, projects };
}

export async function readMountProfiles(path) {
  let details;
  try {
    details = await lstat(path);
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, projects: {} };
    throw error;
  }
  if (!details.isFile() || details.isSymbolicLink()) throw new Error('本机挂载清单必须是普通文件；为避免读取被替换的配置，控制台已停止。');
  try {
    return validateMountProfiles(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error.message.startsWith('本机挂载清单')) throw error;
    throw new Error('本机挂载清单无法读取或解析；请修复或移除该清单后重试。');
  }
}

export async function writeMountProfiles(path, value) {
  const profiles = validateMountProfiles(value);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryDetails = await lstat(directory);
  if (!directoryDetails.isDirectory() || directoryDetails.isSymbolicLink()) throw new Error('本机挂载清单目录必须是普通目录。');
  await chmod(directory, 0o700);
  const existing = await lstat(path).catch((error) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('拒绝覆盖非普通的本机挂载清单文件。');
  const temporary = join(directory, `.mount-profiles-${process.pid}-${randomBytes(8).toString('hex')}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(profiles, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
