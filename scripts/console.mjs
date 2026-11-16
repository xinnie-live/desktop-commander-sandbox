#!/usr/bin/env node
import { isSupportedNode } from './node-version.mjs';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { appendFile, readFile, lstat, mkdir, open, realpath, stat, chmod, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { constants, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { normalizeProxyUrl, proxyUrlForContainer, readSystemProxy } from './system-proxy.mjs';
import { confirmApply, printHelp, printMapping, runTerminalCli } from './console-cli.mjs';
import { openConsoleUrl, readSmallJsonBody, safeTokenEqual, sanitizePublicValue, securityHeaders } from './console-http.mjs';
import { cleanLogText, parseComposeJson, parseDockerStats, parseFixedDuOutput } from './docker-output.mjs';
import {
  isOwnedRunLog,
  LOG_TRAILER_RESERVE_BYTES,
  LOG_TRUNCATION_MARKER,
  MAX_PERSISTED_RUN_BYTES,
  MAX_PERSISTED_RUNS,
} from './run-log-files.mjs';
import { extractAuthorizationUrl } from './run-log-security.mjs';
import { isComposeVersionSupported, MINIMUM_COMPOSE_VERSION } from './compose-version.mjs';
import { renderMountsCompose } from './mount-compose.mjs';
import {
  DEFAULT_PROJECT,
  DEFAULT_WORKSPACE,
  identifyWorkspaceDirectory,
  isWorkspaceName,
  listWorkspaceProfiles,
  projectWorkspaceProfile,
  workspaceDirectory,
  workspaceProjectName,
} from './workspace-selection.mjs';
import {
  canonicalControlPath,
  mountProfilesPath,
  applicationLogDirectory,
  readMountProfiles,
  readWorkspaceProfiles,
  readWorkspaceSettings,
  validateWorkspaceProfiles,
  withWorkspaceProfileOperationLock,
  workspaceSettingsPath,
  workspaceProfilesPath,
  writeWorkspaceProfiles,
} from './workspace-settings.mjs';
import { createHostPathRedactor, folderDisplayName, publicMountSummary } from './public-data.mjs';

const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const PRODUCT_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const COMPOSE_FILE = join(ROOT, 'compose.yaml');
const CLI_ARGS = process.argv.slice(2);
const command = CLI_ARGS[0] || 'help';
const TERMINAL_MUTATION = ['workspace', 'mount'].includes(command);
function readNamedOption(args, option) {
  for (let index = 1; index < args.length; index += 1) {
    if (args[index] === option) {
      if (!args[index + 1] || args[index + 1].startsWith('--')) {
        console.error(`${option} requires a name.`);
        process.exit(2);
      }
      return args[index + 1];
    }
    if (args[index].startsWith(`${option}=`)) return args[index].slice(option.length + 1);
  }
  return null;
}
const EXPLICIT_WORKSPACE = readNamedOption(CLI_ARGS, '--workspace') ?? process.env.REMOTE_DEVICE_WORKSPACE ?? null;
const STARTUP_WORKSPACE = EXPLICIT_WORKSPACE ?? DEFAULT_WORKSPACE;
if (!isWorkspaceName(STARTUP_WORKSPACE)) {
  console.error('Workspace names must be 1–28 characters, start with a lowercase letter or digit, and contain only lowercase letters, digits, underscores, or hyphens.');
  process.exit(2);
}
const PROJECT_OVERRIDE = readNamedOption(CLI_ARGS, '--project')
  || process.env.REMOTE_DEVICE_PROJECT
  || '';
const PROJECT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,49}$/;
const WORKSPACE_ROOT = join(ROOT, 'sandbox-workspace');
const DEFAULT_REFERENCE = projectWorkspaceProfile(WORKSPACE_ROOT, DEFAULT_WORKSPACE).mounts[0];
const WORKSPACE_SETTINGS_FILE = workspaceSettingsPath();
const MOUNT_PROFILES_FILE = mountProfilesPath();
const WORKSPACE_PROFILES_FILE = workspaceProfilesPath();
const RUNTIME_MOUNTS_FILE = join(ROOT, '.runtime', 'mounts.compose.yaml');
const WORKSPACE_SELECTION_LOCKED = Boolean(PROJECT_OVERRIDE);
let savedWorkspaceSettings = null;
if (!EXPLICIT_WORKSPACE && !WORKSPACE_SELECTION_LOCKED) {
  try {
    savedWorkspaceSettings = await readWorkspaceSettings(WORKSPACE_SETTINGS_FILE);
  } catch (error) {
    console.error('Could not load local workspace settings. Fix or remove the settings file, then retry.');
    process.exit(2);
  }
}
let savedMountProfiles = { version: 1, projects: {} };
try {
  savedMountProfiles = await readMountProfiles(MOUNT_PROFILES_FILE);
} catch (error) {
  console.error('Could not load local mount profiles. Fix or remove the local configuration, then retry.');
  process.exit(2);
}
async function loadStartupWorkspace(directory) {
  try {
    return await identifyWorkspaceDirectory(WORKSPACE_ROOT, directory, { allowMissing: true, allowInaccessible: true });
  } catch (error) {
    console.error(`Could not load the saved workspace folder (${error.code || error.message}). Check its permissions or use --workspace with a dedicated folder.`);
    process.exit(2);
  }
}

const LEGACY_SELECTION = savedWorkspaceSettings
  ? await loadStartupWorkspace(savedWorkspaceSettings.directory)
  : {
    workspace: STARTUP_WORKSPACE,
    project: workspaceProjectName(STARTUP_WORKSPACE),
    directory: workspaceDirectory(WORKSPACE_ROOT, STARTUP_WORKSPACE),
    display: STARTUP_WORKSPACE === DEFAULT_WORKSPACE ? 'sandbox-workspace/default/work' : `sandbox-workspace/${STARTUP_WORKSPACE}`,
    external: false,
  };
let savedWorkspaceProfiles;
try {
  savedWorkspaceProfiles = await readWorkspaceProfiles(WORKSPACE_PROFILES_FILE);
} catch (error) {
  console.error('Could not load local workspace profiles. Fix or remove the local configuration, then retry.');
  process.exit(2);
}
let persistedProfileRevision = savedWorkspaceProfiles ? JSON.stringify(savedWorkspaceProfiles) : null;
if (!savedWorkspaceProfiles) {
  const legacyWorkspace = savedWorkspaceSettings ? LEGACY_SELECTION.workspace : STARTUP_WORKSPACE;
  const legacyProjectExists = Boolean(
    savedWorkspaceSettings
    || EXPLICIT_WORKSPACE
    || Object.hasOwn(savedMountProfiles.projects, LEGACY_SELECTION.project),
  );
  const priorMounts = savedMountProfiles.projects[LEGACY_SELECTION.project];
  const hasLegacyDefaultMounts = legacyWorkspace === DEFAULT_WORKSPACE && priorMounts !== undefined;
  const legacyProfile = savedWorkspaceSettings || hasLegacyDefaultMounts
    ? {
      label: savedWorkspaceSettings ? basename(LEGACY_SELECTION.directory) : legacyWorkspace,
      directory: savedWorkspaceSettings?.directory ?? WORKSPACE_ROOT,
      readOnly: savedWorkspaceSettings?.readOnly ?? false,
      mounts: (priorMounts || []).map((mount) => ({ ...mount })),
    }
    : {
      ...projectWorkspaceProfile(WORKSPACE_ROOT, legacyWorkspace),
      ...(priorMounts === undefined ? {} : { mounts: priorMounts.map((mount) => ({ ...mount })) }),
    };
  savedWorkspaceProfiles = {
    version: 1,
    activeWorkspace: legacyWorkspace,
    deviceProject: PROJECT_OVERRIDE || (legacyProjectExists ? LEGACY_SELECTION.project : DEFAULT_PROJECT),
    workspaces: { [legacyWorkspace]: legacyProfile },
  };
}
let WORKSPACE = EXPLICIT_WORKSPACE ? STARTUP_WORKSPACE : savedWorkspaceProfiles.activeWorkspace;
let PROJECT = PROJECT_OVERRIDE || savedWorkspaceProfiles.deviceProject || DEFAULT_PROJECT;
if (!savedWorkspaceProfiles.workspaces[WORKSPACE]) {
  savedWorkspaceProfiles.workspaces[WORKSPACE] = projectWorkspaceProfile(WORKSPACE_ROOT, WORKSPACE);
}
const initialWorkspaceProfile = savedWorkspaceProfiles.workspaces[WORKSPACE];
const INITIAL_SELECTION = await loadStartupWorkspace(initialWorkspaceProfile.directory);
WORKSPACE = savedWorkspaceProfiles.workspaces[WORKSPACE] ? WORKSPACE : INITIAL_SELECTION.workspace;
let WORKSPACE_DIR = INITIAL_SELECTION.directory;
let WORKSPACE_DISPLAY = INITIAL_SELECTION.display;
let WORKSPACE_EXTERNAL = INITIAL_SELECTION.external;
let WORKSPACE_READ_ONLY = initialWorkspaceProfile.readOnly;
let WORKSPACE_PROFILE_LABEL = initialWorkspaceProfile.label || basename(WORKSPACE_DIR);
let DRAFT_WORKSPACE_READ_ONLY = WORKSPACE_READ_ONLY;
let EXTRA_MOUNTS = initialWorkspaceProfile.mounts.map((mount) => ({ ...mount }));
let DRAFT_EXTRA_MOUNTS = EXTRA_MOUNTS.map((mount) => ({ ...mount }));
let workspaceRevision = 0;
const pendingWorkspaceSelections = new Map();
const FIXED_IMAGES = [`ghcr.io/xinnie-live/desktop-commander-sandbox:${PRODUCT_VERSION}`];
const MAX_LOG_BYTES = 64 * 1024;
const MAX_LOG_LINES = 350;
const OUTPUT_TTL_MS = 3 * 60 * 1000;
const RUN_LOG_DIRECTORY = applicationLogDirectory();
const CONTROLLER_DIRECTORY = join(dirname(WORKSPACE_PROFILES_FILE), `controller-${createHash('sha256').update(`${ROOT}\0${PROJECT}`).digest('hex').slice(0, 20)}`);
let pendingRunLogWrites = Promise.resolve();
let sessionProxyMode;
let sessionProxyConfig;
let workspaceTransition = false;
let activePickerChild = null;
const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/authorization-url.mjs', ['authorization-url.mjs', 'text/javascript; charset=utf-8']],
  ['/i18n.mjs', ['i18n.mjs', 'text/javascript; charset=utf-8']],
  ['/ui-format.mjs', ['ui-format.mjs', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
]);

if (!PROJECT_PATTERN.test(PROJECT)) {
  console.error('Compose project names must start with a lowercase letter or digit and contain only lowercase letters, digits, underscores, or hyphens.');
  process.exit(2);
}
function composeArgs(args, { includeMounts = false } = {}) {
  const composeFiles = ['-f', COMPOSE_FILE];
  if (includeMounts && EXTRA_MOUNTS.length) composeFiles.push('-f', RUNTIME_MOUNTS_FILE);
  return ['compose', ...composeFiles, '-p', PROJECT, ...args];
}

async function writeRuntimeMountsFile(mounts) {
  const runtimeDirectory = dirname(RUNTIME_MOUNTS_FILE);
  if (mounts.length) {
    await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
  } else {
    const parent = await lstat(runtimeDirectory).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!parent) return;
    if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('本机运行配置目录必须是普通目录。');
  }
  const directoryDetails = await lstat(runtimeDirectory);
  if (!directoryDetails.isDirectory() || directoryDetails.isSymbolicLink()) throw new Error('本机运行配置目录必须是普通目录。');
  await chmod(runtimeDirectory, 0o700);
  const existing = await lstat(RUNTIME_MOUNTS_FILE).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('拒绝覆盖非普通的本机运行配置文件。');
  if (!mounts.length) {
    if (existing) await rm(RUNTIME_MOUNTS_FILE);
    return;
  }
  const temporary = `${RUNTIME_MOUNTS_FILE}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(temporary, renderMountsCompose(mounts), { flag: 'wx', mode: 0o600 });
    await rename(temporary, RUNTIME_MOUNTS_FILE);
  } finally {
    await rm(temporary, { force: true });
  }
}

function pathIsWithin(parent, candidate) {
  const path = relative(resolve(parent), resolve(candidate));
  return path === '' || (!path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && path !== '..' && !isAbsolute(path));
}

function validateWritableWorkspaceBoundary(selection, readOnly) {
  if (readOnly) return;
  const selectedPath = canonicalControlPath(selection.directory);
  const settingsPath = canonicalControlPath(dirname(WORKSPACE_SETTINGS_FILE));
  if (pathIsWithin(selectedPath, settingsPath) || pathIsWithin(settingsPath, selectedPath)) {
    throw new Error('该文件夹包含 Desktop Commander Sandbox 的本机挂载设置，不能以读写方式开放。请选择更窄的子文件夹，或改为只读。');
  }
  const logPath = canonicalControlPath(RUN_LOG_DIRECTORY);
  if (pathIsWithin(selectedPath, logPath) || pathIsWithin(logPath, selectedPath)) {
    throw new Error('该文件夹包含 Desktop Commander Sandbox 的本机运行日志，不能以读写方式开放。请选择其他文件夹或改为只读。');
  }
  const selectedInsideProject = pathIsWithin(canonicalControlPath(ROOT), selectedPath);
  const containsProject = pathIsWithin(selectedPath, canonicalControlPath(ROOT));
  const selectedInsideWorkspace = pathIsWithin(canonicalControlPath(WORKSPACE_ROOT), selectedPath);
  if ((containsProject || selectedInsideProject && !selectedInsideWorkspace) && selection.external) {
    throw new Error('该文件夹包含项目源码或本机控制文件，不能以读写方式开放给 Remote Device。请选择项目专用工作区或更窄的其他文件夹。');
  }
}

function validateActiveMountBoundaries() {
  validateWritableWorkspaceBoundary({ directory: WORKSPACE_DIR, external: WORKSPACE_EXTERNAL }, WORKSPACE_READ_ONLY);
  for (const mount of EXTRA_MOUNTS) {
    validateWritableWorkspaceBoundary({ directory: mount.directory, external: true }, mount.readOnly);
  }
}

async function prepareActiveMounts({ checkDirectories = true } = {}) {
  validateActiveMountBoundaries();
  if (checkDirectories) await checkMountDirectories();
  await validateAdditionalMounts(EXTRA_MOUNTS, { directory: WORKSPACE_DIR }, { allowMissingDefault: true });
  await prepareDefaultReference(EXTRA_MOUNTS);
  await validateAdditionalMounts(EXTRA_MOUNTS, { directory: WORKSPACE_DIR });
  await writeRuntimeMountsFile(EXTRA_MOUNTS);
}

function dockerEnvironment() {
  const env = { ...process.env };
  env.REMOTE_DEVICE_WORKSPACE = '';
  env.REMOTE_DEVICE_WORKSPACE_PATH = WORKSPACE_DIR;
  env.REMOTE_DEVICE_WORKSPACE_READ_ONLY = String(WORKSPACE_READ_ONLY);
  if (sessionProxyMode !== undefined) {
    env.REMOTE_DEVICE_HTTP_PROXY = sessionProxyConfig?.http || '';
    env.REMOTE_DEVICE_HTTPS_PROXY = sessionProxyConfig?.https || '';
    env.REMOTE_DEVICE_NO_PROXY = sessionProxyConfig?.noProxy || '';
  }
  if (process.platform === 'linux' && typeof process.getgid === 'function') {
    const gid = process.getgid();
    if (gid === 0) {
      env.REMOTE_DEVICE_WORKSPACE_GID = '';
      env.REMOTE_DEVICE_DOCKER_GROUP_GID = '10001';
      return env;
    }
    if (!Number.isSafeInteger(gid) || gid < 1 || gid > 65_535) {
      throw new Error('Linux 主机用户的主组 GID 必须在 1 到 65535 之间；为避免把容器加入 root 组，当前启动已拒绝。');
    }
    env.REMOTE_DEVICE_WORKSPACE_GID = String(gid);
    env.REMOTE_DEVICE_DOCKER_GROUP_GID = String(gid);
  } else {
    env.REMOTE_DEVICE_WORKSPACE_GID = '';
    env.REMOTE_DEVICE_DOCKER_GROUP_GID = '10001';
  }
  return env;
}

function runDockerCapture(args, timeoutMs = 10_000) {
  return new Promise((resolveRun) => {
    const child = spawn('docker', args, {
      cwd: ROOT,
      env: dockerEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1500).unref();
    }, timeoutMs);
    const collect = (current, chunk) => {
      const next = current + chunk.toString('utf8');
      return next.length > 256_000 ? next.slice(-256_000) : next;
    };
    child.stdout.on('data', (chunk) => { stdout = collect(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = collect(stderr, chunk); });
    child.once('error', (error) => {
      clearTimeout(timer);
      resolveRun({ code: 127, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolveRun({ code: code ?? 1, stdout, stderr, timedOut });
    });
  });
}

function printDoctorCheck(label, ready, detail, hint = '') {
  const marker = ready ? '✓' : '✗';
  console.log(`${marker} ${label}: ${detail}`);
  if (!ready && hint) console.log(`  Next step: ${hint}`);
}

async function runDoctor() {
  let ready = true;
  const platformNames = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };
  const platform = platformNames[process.platform];
  const architecture = process.arch === 'x64' ? 'x86_64' : process.arch;
  const supportedNode = isSupportedNode(process.versions.node);
  const supportedPlatform = Boolean(platform);
  const supportedArchitecture = ['x64', 'arm64'].includes(process.arch);
  const supportedUser = !(process.platform === 'linux' && process.getuid?.() === 0);

  console.log('Desktop Commander Sandbox · Local prerequisites');
  printDoctorCheck(
    'System',
    supportedPlatform && supportedArchitecture && supportedUser,
    `${platform || process.platform} / ${architecture}${!supportedPlatform || !supportedArchitecture ? ' (requires macOS, Windows, or Linux on x86_64 or arm64)' : ''}${!supportedUser ? ' (do not run as root on Linux)' : ''}`,
    !supportedUser ? 'Use a regular account with Docker access.' : 'Use a supported platform.',
  );
  ready &&= supportedPlatform && supportedArchitecture && supportedUser;
  printDoctorCheck(
    'Node.js',
    supportedNode,
    `${process.versions.node}${supportedNode ? '' : ' (22.12.0 or later required)'}`,
    'Install Node.js 22.12.0 or later, then rerun npm run remote-device:doctor.',
  );
  ready &&= supportedNode;

  const stopAtDependency = (skipped) => {
    console.log(`后续检查已跳过 / Skipped: ${skipped}`);
    console.log('解决上述问题后，关闭此窗口，再次运行启动器。');
    console.log('After fixing this issue, close this window and run the launcher again.');
    process.exitCode = 1;
  };
  const docker = await runDockerCapture(['--version']);
  if (docker.code !== 0) {
    printDoctorCheck('Docker', false, '未找到或无法运行 / command not found or unavailable');
    if (process.platform === 'win32') {
      console.log('1. 安装 Docker Desktop for Windows，选择 WSL 2，使用 Linux 容器。');
      console.log('   Install Docker Desktop for Windows with WSL 2 and Linux containers.');
      console.log('   WSL 2 由 Docker 在后台使用；无需另外安装 Ubuntu 或 Linux 桌面，也无需进入 Linux 终端。');
      console.log('   Docker uses WSL 2 in the background. No separate Ubuntu/Linux desktop or Linux terminal is needed.');
      console.log('   如果安装器提示缺少 WSL 2，按官方指引启用或更新即可。');
      console.log('   If prompted, enable or update WSL 2 following the official instructions.');
      console.log('   https://docs.docker.com/desktop/setup/install/windows-install/');
      console.log('2. 打开 Docker Desktop，等待引擎启动完成；如安装器要求重启，请先重启电脑。');
      console.log('   Open Docker Desktop and wait for the engine. Restart Windows if the installer requests it.');
    } else if (process.platform === 'darwin') {
      console.log('1. 安装并打开 Docker Desktop 或 OrbStack，等待引擎启动完成。');
      console.log('   Install and open Docker Desktop or OrbStack, then wait for the engine.');
      console.log('   https://docs.docker.com/desktop/setup/install/mac-install/');
      console.log('   https://orbstack.dev/');
    } else {
      console.log('1. 按发行版官方说明安装并启动 Docker Engine，包含 Compose 插件。');
      console.log('   Install and start Docker Engine with the Compose plugin for your distribution.');
      console.log('   https://docs.docker.com/engine/install/');
    }
    console.log('已安装？请新开终端运行 docker --version；若仍找不到命令，检查安装和 PATH。');
    console.log('Already installed? Run docker --version in a new terminal; if missing, check installation and PATH.');
    stopAtDependency('Compose / Engine / Project configuration / Workspace folders');
    return;
  }
  printDoctorCheck('Docker CLI', true, (docker.stdout || '').trim());

  const compose = await runDockerCapture(['compose', 'version', '--short']);
  const composeVersion = (compose.stdout || '').trim();
  const composeReady = compose.code === 0 && isComposeVersionSupported(composeVersion);
  printDoctorCheck('Docker Compose', composeReady, composeReady ? composeVersion : '版本缺失或过旧 / missing or outdated',
    `需要 / Requires Compose ${MINIMUM_COMPOSE_VERSION}+. macOS / Windows: update Docker Desktop (or OrbStack on macOS). Linux: https://docs.docker.com/compose/install/linux/`);
  if (!composeReady) {
    stopAtDependency('Engine / Project configuration / Workspace folders');
    return;
  }

  const engine = await runDockerCapture(['info', '--format', '{{.ServerVersion}}'], 15_000);
  const engineVersion = (engine.stdout || '').trim();
  const engineReady = engine.code === 0 && Boolean(engineVersion);
  printDoctorCheck('Docker Engine', engineReady, engineReady ? `connected (${engineVersion})` : '无法连接 / not reachable',
    '启动 Docker Desktop、OrbStack 或 Docker Engine，等待引擎就绪。Open your Docker runtime and wait for the engine; check docker info in a new terminal.');
  if (!engineReady) {
    stopAtDependency('Project configuration / Workspace folders');
    return;
  }

  const config = await runDockerCapture(composeArgs(['config', '--quiet']));
  const configReady = config.code === 0;
  printDoctorCheck('Project configuration', configReady,
    configReady ? 'available' : 'fixed configuration could not be loaded',
    'Check the project files and .env configuration, then retry.');
  ready &&= configReady;

  const mountDirectories = await inspectFixedMountDirectories();
  const mountDirectoriesReady = mountDirectories.status !== 'error';
  printDoctorCheck(
    'Workspace folders',
    mountDirectoriesReady,
    mountDirectories.status === 'ok' ? 'selected folders are available'
      : ['warning', 'info'].includes(mountDirectories.status) ? 'project-local folders will be created during build or start'
        : 'saved folder access or mount boundaries failed validation',
    'Check the saved workspace and mount permissions in the local console.',
  );
  ready &&= mountDirectoriesReady;

  console.log(`Project: ${PROJECT}`);
  console.log(`Workspace: ${WORKSPACE}`);
  console.log(`Result: ${ready ? 'ready to open the console' : 'complete the steps above before starting'}`);
  if (ready) {
    const nextArgs = [];
    if (PROJECT_OVERRIDE) nextArgs.push('--project', PROJECT_OVERRIDE);
    if (EXPLICIT_WORKSPACE) nextArgs.push('--workspace', WORKSPACE);
    console.log(`Next step: npm run remote-device:dashboard${nextArgs.length ? ` -- ${nextArgs.join(' ')}` : ''}`);
  }
  if (!ready) process.exitCode = 1;
}

function runComposeCapture(args, timeoutMs = 10_000) {
  return runDockerCapture(composeArgs(args), timeoutMs);
}

function conciseError(result) {
  const raw = (result.stderr || result.stdout || '').replace(/\s+/g, ' ').trim();
  if (result.timedOut) return 'Docker Compose 命令超时。';
  if (!raw) return `Docker Compose 退出码 ${result.code}。`;
  return raw.slice(0, 420);
}

async function checkMountDirectories(selection = {
  directory: WORKSPACE_DIR,
  display: WORKSPACE_DISPLAY,
  external: WORKSPACE_EXTERNAL,
  readOnly: WORKSPACE_READ_ONLY,
}) {
  if (process.platform === 'linux' && process.getgid() === 0) {
    throw new Error('Linux 上请以拥有 Docker 权限的普通用户运行控制台；不支持以 root 主组映射可写工作区。');
  }
  if (!selection.external) {
    await ensureWorkspaceRoot();
    if (selection.directory === workspaceDirectory(WORKSPACE_ROOT, DEFAULT_WORKSPACE)) await ensureDefaultLayout();
  }
  const expectedPaths = [{ path: selection.directory, label: selection.display, create: !selection.external }];
  for (const entry of expectedPaths) {
    let details;
    try {
      details = await lstat(entry.path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!entry.create) throw new Error(`所选工作区 ${entry.label} 已不存在，请重新选择。`);
      try {
        await createDedicatedWorkspace(entry.path);
        details = await lstat(entry.path);
      } catch (createError) {
        throw new Error(`无法创建工作区目录 ${entry.label}：${createError.message}`);
      }
    }
    if (!details.isDirectory() || details.isSymbolicLink()) {
      throw new Error(`工作区挂载路径 ${entry.label} 必须是普通文件夹。`);
    }
    const actual = await realpath(entry.path);
    if (actual !== entry.path) {
      throw new Error(`工作区挂载路径 ${entry.label} 与选择的真实文件夹不一致，已拒绝启动。`);
    }
  }
  if (process.platform === 'linux') await prepareLinuxMountPermissions(selection);
}

async function ensureWorkspaceRoot() {
  let details;
  try {
    details = await lstat(WORKSPACE_ROOT);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await mkdir(WORKSPACE_ROOT, { mode: 0o700 });
    details = await lstat(WORKSPACE_ROOT);
  }
  if (!details.isDirectory() || details.isSymbolicLink() || await realpath(WORKSPACE_ROOT) !== WORKSPACE_ROOT) {
    throw new Error('sandbox-workspace 必须是项目目录内的普通文件夹。');
  }
}

async function ensureDefaultLayout() {
  const directory = dirname(DEFAULT_REFERENCE.directory);
  await mkdir(directory, { mode: 0o755 }).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
  const details = await lstat(directory);
  if (!details.isDirectory() || details.isSymbolicLink() || await realpath(directory) !== directory) {
    throw new Error('sandbox-workspace/default 必须是项目目录内的普通文件夹。');
  }
}

function isDefaultReference(mount) {
  return mount.id === DEFAULT_REFERENCE.id && mount.directory === DEFAULT_REFERENCE.directory && mount.readOnly;
}

async function prepareDefaultReference(mounts) {
  if (!mounts.some(isDefaultReference)) return;
  await ensureWorkspaceRoot();
  await ensureDefaultLayout();
  const directory = DEFAULT_REFERENCE.directory;
  const created = await mkdir(directory, { mode: 0o755 }).then(() => true, (error) => {
    if (error.code !== 'EEXIST') throw error;
    return false;
  });
  const details = await lstat(directory);
  if (!details.isDirectory() || details.isSymbolicLink() || await realpath(directory) !== directory) {
    throw new Error('默认只读示例目录必须是项目内的普通文件夹。');
  }
  if (created && process.platform === 'linux') await chmod(directory, 0o750);
  const input = join(directory, 'input.txt');
  try {
    await writeFile(input, 'alpha\nbeta\n', { flag: 'wx', mode: 0o644 });
    if (process.platform === 'linux') await chmod(input, 0o640);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await lstat(input);
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error('默认只读示例必须是普通文件。');
  }
}

function runPickerCommand(program, args) {
  return new Promise((resolveResult) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(value);
    };
    const child = spawn(program, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    activePickerChild = child;
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish({ code: 124, stdout, stderr });
    }, 5 * 60 * 1000);
    timer.unref();
    child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk.toString('utf8')}`.slice(0, 16_384); });
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(0, 16_384); });
    child.once('error', (error) => {
      if (activePickerChild === child) activePickerChild = null;
      finish({ code: 127, stdout, stderr: '', spawnError: error.code });
    });
    child.once('close', (code) => {
      if (activePickerChild === child) activePickerChild = null;
      finish({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function chooseDirectoryWithNativeDialog(language = 'en') {
  const pickerTitle = language === 'zh' ? '选择要挂载到 Remote Device 的文件夹' : 'Choose a folder to mount in Remote Device';
  let result;
  if (process.platform === 'darwin') {
    result = await runPickerCommand('osascript', [
      '-e', `POSIX path of (choose folder with prompt "${pickerTitle}")`,
    ]);
  } else if (process.platform === 'win32') {
    const script = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = "${pickerTitle}"; try { $result = $dialog.ShowDialog(); if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::WriteLine($dialog.SelectedPath) } } finally { $dialog.Dispose() }`;
    result = await runPickerCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script]);
  } else if (process.platform === 'linux') {
    result = await runPickerCommand('zenity', ['--file-selection', '--directory', `--title=${pickerTitle}`]);
    if (result.spawnError === 'ENOENT') {
      result = await runPickerCommand('kdialog', ['--getexistingdirectory', '.', '--title', pickerTitle]);
      if (result.spawnError === 'ENOENT') {
        throw new Error('Linux 桌面文件夹选择器不可用；安装 zenity 或 kdialog 后重试，或使用 CLI 固定工作区。');
      }
    }
  } else {
    throw new Error('当前操作系统没有受支持的系统文件夹选择器。');
  }

  if (result.spawnError) {
    throw new Error(process.platform === 'darwin'
      ? '无法打开 macOS 文件夹选择器。'
      : process.platform === 'win32'
        ? '无法打开 Windows 文件夹选择器。'
        : '无法打开 Linux 文件夹选择器。');
  }
  if (result.code === 124) throw new Error('文件夹选择超时，请重新选择。');
  if (result.code !== 0) {
    if (result.code === 1 && (!result.stderr.trim() || /cancel|cancelled|user canceled/i.test(result.stderr))) return null;
    throw new Error('系统文件夹选择器未能完成；请确认桌面会话可用后重试。');
  }
  const selected = result.stdout.replace(/[\r\n]+$/, '');
  return selected || null;
}

function activateWorkspace(selection, readOnly = WORKSPACE_READ_ONLY) {
  WORKSPACE = selection.workspace;
  PROJECT = PROJECT_OVERRIDE || savedWorkspaceProfiles.deviceProject || DEFAULT_PROJECT;
  WORKSPACE_DIR = selection.directory;
  WORKSPACE_DISPLAY = selection.display;
  WORKSPACE_EXTERNAL = selection.external;
  WORKSPACE_READ_ONLY = readOnly;
  WORKSPACE_PROFILE_LABEL = selection.label || basename(selection.directory);
  sessionProxyMode = undefined;
  sessionProxyConfig = undefined;
  if (latestJob?.closeTimer) clearTimeout(latestJob.closeTimer);
  latestJob = null;
  return {
    workspace: WORKSPACE,
    project: PROJECT,
    workspaceName: WORKSPACE_PROFILE_LABEL,
    workspaceFolderName: folderDisplayName(WORKSPACE_DIR),
    workspaceLocalPath: WORKSPACE_DIR,
    readOnly: WORKSPACE_READ_ONLY,
  };
}

async function refreshExternalWorkspaceProfiles() {
  const diskProfiles = await readWorkspaceProfiles(WORKSPACE_PROFILES_FILE);
  if (!diskProfiles || JSON.stringify(diskProfiles) === JSON.stringify(savedWorkspaceProfiles)) return false;
  if (workspaceTransition || activeJob || activePickerChild) throw new Error('另一控制进程已修改工作区；请先完成当前设备操作或文件夹选择，再重试。');
  const workspace = EXPLICIT_WORKSPACE || diskProfiles.activeWorkspace;
  const profile = diskProfiles.workspaces[workspace];
  if (!profile) throw new Error('当前指定的工作区已被另一控制进程删除；请重新启动控制台。');
  const selection = await identifyWorkspaceDirectory(WORKSPACE_ROOT, profile.directory, { allowMissing: true, allowInaccessible: true });
  savedWorkspaceProfiles = diskProfiles;
  persistedProfileRevision = JSON.stringify(diskProfiles);
  activateWorkspace({ ...selection, workspace, label: profile.label }, profile.readOnly);
  EXTRA_MOUNTS = profile.mounts.map((mount) => ({ ...mount }));
  DRAFT_EXTRA_MOUNTS = EXTRA_MOUNTS.map((mount) => ({ ...mount }));
  DRAFT_WORKSPACE_READ_ONLY = profile.readOnly;
  pendingWorkspaceSelections.clear();
  workspaceRevision += 1;
  return true;
}

async function persistWorkspaceProfiles(nextProfiles) {
  try {
    await writeWorkspaceProfiles(WORKSPACE_PROFILES_FILE, nextProfiles, { expectedRevision: persistedProfileRevision });
  } catch (error) {
    if (command !== 'dashboard' && error.code === 'WORKSPACE_PROFILE_CONFLICT') {
      throw new Error('Workspace profiles changed in another controller. Review the latest mapping and retry.');
    }
    if (command !== 'dashboard' && error.code === 'WORKSPACE_PROFILE_BUSY') {
      throw new Error('Another controller is changing workspace profiles. Retry shortly.');
    }
    throw error;
  }
  persistedProfileRevision = JSON.stringify(validateWorkspaceProfiles(nextProfiles));
}

async function withProfileMutation(action) {
  const expectedRevision = persistedProfileRevision;
  try {
    return await withWorkspaceProfileOperationLock(WORKSPACE_PROFILES_FILE, async () => {
      const current = await readWorkspaceProfiles(WORKSPACE_PROFILES_FILE);
      if ((current ? JSON.stringify(current) : null) !== expectedRevision) {
        const error = new Error('工作区已被另一控制进程修改；请重新读取最新清单后重试。');
        error.code = 'WORKSPACE_PROFILE_CONFLICT';
        throw error;
      }
      return action();
    });
  } catch (error) {
    if (command !== 'dashboard' && error.code === 'WORKSPACE_PROFILE_CONFLICT') {
      throw new Error('Workspace profiles changed in another controller. Review the latest mapping and retry.');
    }
    if (command !== 'dashboard' && error.code === 'WORKSPACE_PROFILE_BUSY') {
      throw new Error('Another controller is changing workspace profiles. Retry shortly.');
    }
    throw error;
  }
}

async function pickWorkspaceDirectory(language = 'en', purpose = 'mount', workspace) {
  if (WORKSPACE_SELECTION_LOCKED) throw new Error('当前通过 --project 固定了项目，Web 工作区切换已禁用。');
  if (activeJob && activeJob.kind !== 'start' || workspaceTransition) throw new Error('当前有设备操作或工作区切换，请完成后再试。');
  if (activePickerChild) throw new Error('系统文件夹选择窗口已打开；请先完成或取消当前选择。');
  if (purpose === 'workspace-edit-mount' && !isWorkspaceName(workspace)) throw new Error('请选择有效的工作区。');
  if (purpose === 'mount' && DRAFT_EXTRA_MOUNTS.length >= 8) throw new Error('一个工作区最多可配置 8 个额外挂载文件夹。');
  const selectedDirectory = await chooseDirectoryWithNativeDialog(language);
  if (!selectedDirectory) return { cancelled: true };
  if (selectedDirectory.length > 4096 || /[\x00-\x1f\x7f]/.test(selectedDirectory)) {
    throw new Error('所选文件夹路径格式不受支持；请选择不包含控制字符的文件夹。');
  }
  const selection = await identifyWorkspaceDirectory(WORKSPACE_ROOT, selectedDirectory);
  const selectionId = randomBytes(18).toString('base64url');
  const now = Date.now();
  for (const [id, pending] of pendingWorkspaceSelections) {
    if (now - pending.createdAt > 5 * 60 * 1000) pendingWorkspaceSelections.delete(id);
  }
  if (pendingWorkspaceSelections.size >= 16) throw new Error('待确认的文件夹选择过多；请先完成或取消当前操作。');
  pendingWorkspaceSelections.set(selectionId, { id: selectionId, selection, purpose, workspace, createdAt: now });
  return {
    selectionId,
    workspace: selection.workspace,
    project: selection.project,
    workspaceName: selection.label || basename(selection.directory),
    folderName: folderDisplayName(selection.directory),
    localPath: selection.directory,
    readOnly: WORKSPACE_READ_ONLY,
  };
}

async function prepareTerminalPath(input, purpose, workspace) {
  if (typeof input !== 'string' || !isAbsolute(input) || input.length > 4096 || /[\x00-\x1f\x7f]/.test(input)) {
    throw new Error('Specify an absolute folder path without control characters.');
  }
  const selection = await identifyWorkspaceDirectory(WORKSPACE_ROOT, input);
  const selectionId = randomBytes(18).toString('base64url');
  const mountId = `mount-${randomBytes(6).toString('hex')}`;
  pendingWorkspaceSelections.set(selectionId, {
    id: selectionId,
    mountId,
    selection,
    purpose,
    workspace,
    createdAt: Date.now(),
  });
  return { selectionId, mountId, directory: selection.directory };
}

function publicMounts(mounts) {
  return mounts.map((mount) => publicMountSummary(mount, mounts));
}

function mountsAreDirty() {
  return DRAFT_WORKSPACE_READ_ONLY !== WORKSPACE_READ_ONLY || !mountSetsEqual(DRAFT_EXTRA_MOUNTS, EXTRA_MOUNTS);
}

function mountDraftResponse() {
  return {
    project: PROJECT,
    applied: publicMounts(EXTRA_MOUNTS),
    draft: publicMounts(DRAFT_EXTRA_MOUNTS),
    primaryReadOnly: DRAFT_WORKSPACE_READ_ONLY,
    dirty: mountsAreDirty(),
    maxMounts: 8,
  };
}

function stageSelectedMount(selectionId, readOnly) {
  if (typeof readOnly !== 'boolean') throw new Error('请选择只读或读写权限。');
  const pending = pendingWorkspaceSelections.get(selectionId);
  if (!pending || pending.purpose !== 'mount' || Date.now() - pending.createdAt > 5 * 60 * 1000) {
    pendingWorkspaceSelections.delete(selectionId);
    throw new Error('文件夹选择已过期，请重新选择。');
  }
  const selected = pending.selection;
  pendingWorkspaceSelections.delete(selectionId);
  if (DRAFT_EXTRA_MOUNTS.length >= 8) throw new Error('一个工作区最多可配置 8 个额外挂载文件夹。');
  if (selected.directory === WORKSPACE_DIR) throw new Error('该文件夹已经作为 /workspace 挂载。');
  if (DRAFT_EXTRA_MOUNTS.some((mount) => mount.directory === selected.directory)) {
    throw new Error('该文件夹已经在待应用清单中；请直接修改现有条目的访问权限。');
  }
  const id = `mount-${randomBytes(6).toString('hex')}`;
  DRAFT_EXTRA_MOUNTS = [...DRAFT_EXTRA_MOUNTS, { id, directory: selected.directory, readOnly }];
  return mountDraftResponse();
}

function changeDraftMountMode(mountId, readOnly) {
  if (typeof mountId !== 'string' || !/^mount-[a-f0-9]{12}$/.test(mountId) || typeof readOnly !== 'boolean') {
    throw new Error('挂载条目或权限选项无效。');
  }
  if (!DRAFT_EXTRA_MOUNTS.some((mount) => mount.id === mountId)) throw new Error('待应用清单中找不到该挂载文件夹。');
  DRAFT_EXTRA_MOUNTS = DRAFT_EXTRA_MOUNTS.map((mount) => mount.id === mountId ? { ...mount, readOnly } : mount);
  return mountDraftResponse();
}

function removeDraftMount(mountId) {
  if (typeof mountId !== 'string' || !/^mount-[a-f0-9]{12}$/.test(mountId)) throw new Error('挂载条目无效。');
  if (!DRAFT_EXTRA_MOUNTS.some((mount) => mount.id === mountId)) throw new Error('待应用清单中找不到该挂载文件夹。');
  DRAFT_EXTRA_MOUNTS = DRAFT_EXTRA_MOUNTS.filter((mount) => mount.id !== mountId);
  return mountDraftResponse();
}

function resetDraftMounts() {
  DRAFT_EXTRA_MOUNTS = EXTRA_MOUNTS.map((mount) => ({ ...mount }));
  DRAFT_WORKSPACE_READ_ONLY = WORKSPACE_READ_ONLY;
  for (const [id, pending] of pendingWorkspaceSelections) {
    if (pending.purpose === 'mount') pendingWorkspaceSelections.delete(id);
  }
  return mountDraftResponse();
}

function cloneWorkspaceProfiles(profiles) {
  return {
    version: 1,
    activeWorkspace: profiles.activeWorkspace,
    deviceProject: profiles.deviceProject,
    workspaces: Object.fromEntries(Object.entries(profiles.workspaces).map(([workspace, profile]) => [workspace, {
      label: profile.label,
      directory: profile.directory,
      readOnly: profile.readOnly,
      mounts: profile.mounts.map((mount) => ({ ...mount })),
    }])),
    deletedWorkspaces: [...(profiles.deletedWorkspaces || [])],
  };
}

function mountSetsEqual(left, right) {
  return left.length === right.length && left.every((mount, index) => {
    const other = right[index];
    return mount.id === other.id && mount.directory === other.directory && mount.readOnly === other.readOnly;
  });
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolveExit) => {
    const finish = (exited) => {
      clearTimeout(timer);
      child.removeListener('close', onClose);
      resolveExit(exited);
    };
    const onClose = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref();
    child.once('close', onClose);
  });
}

async function stopAttachedStartJob(job) {
  if (!job?.child || job.kind !== 'start') return;
  const child = job.child;
  job.phase = 'stopping';
  child.kill('SIGINT');
  if (!(await waitForChildExit(child, 15_000))) {
    child.kill('SIGTERM');
    if (!(await waitForChildExit(child, 3_000))) child.kill('SIGKILL');
  }
  await waitForChildExit(child, 3_000);
}

async function validateAdditionalMounts(mounts, primarySelection, { allowMissingDefault = false } = {}) {
  if (!Array.isArray(mounts) || mounts.length > 8) throw new Error('一个工作区最多可配置 8 个额外挂载文件夹。');
  const directories = [primarySelection.directory];
  const ids = new Set();
  for (const mount of mounts) {
    if (!mount || !/^mount-[a-f0-9]{12}$/.test(mount.id) || ids.has(mount.id) || typeof mount.readOnly !== 'boolean') {
      throw new Error('待应用的挂载清单无效，请重新选择文件夹。');
    }
    ids.add(mount.id);
    const details = await lstat(mount.directory).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
    const missingDefaultReference = !details && allowMissingDefault && isDefaultReference(mount);
    if (!missingDefaultReference && (!details?.isDirectory() || details.isSymbolicLink() || await realpath(mount.directory) !== mount.directory)) {
      throw new Error('所选挂载文件夹已不存在或不是普通文件夹，请重新选择。');
    }
    if (directories.some((directory) => pathIsWithin(directory, mount.directory) || pathIsWithin(mount.directory, directory))) {
      throw new Error('两个挂载文件夹不能互相包含或重复；请保留其中一个路径，避免容器中的内容重叠。');
    }
    validateWritableWorkspaceBoundary({ directory: mount.directory, external: true }, mount.readOnly);
    if (process.platform === 'linux' && !missingDefaultReference) {
      const access = await stat(mount.directory);
      const requiredGroupBits = mount.readOnly ? 0o050 : 0o070;
      const gid = process.getgid();
      if (access.gid !== gid || (access.mode & requiredGroupBits) !== requiredGroupBits) {
        throw new Error(`Linux 所选挂载文件夹需要归当前主组 GID ${gid} 所有，并具备${mount.readOnly ? '读取和进入' : '读写和进入'}权限；控制台不会更改所选文件夹。`);
      }
    }
    directories.push(mount.directory);
  }
}

async function applyWorkspaceSelection(selection, { readOnly = false, extraMounts, allowLockedProject = false } = {}) {
  if (WORKSPACE_SELECTION_LOCKED && !allowLockedProject) throw new Error('当前通过 --project 固定了项目，Web 工作区切换已禁用。');
  if (typeof readOnly !== 'boolean') throw new Error('请选择只读或读写权限。');
  const existingProfile = savedWorkspaceProfiles.workspaces[selection.workspace];
  const nextMounts = (extraMounts ?? existingProfile?.mounts ?? []).map((mount) => ({ ...mount }));
  const nextReadOnly = extraMounts === undefined && existingProfile ? existingProfile.readOnly : readOnly;
  const nextLabel = selection.label || existingProfile?.label || basename(selection.directory);
  if (selection.workspace === WORKSPACE && selection.directory === WORKSPACE_DIR && nextReadOnly === WORKSPACE_READ_ONLY
    && nextLabel === WORKSPACE_PROFILE_LABEL && mountSetsEqual(nextMounts, EXTRA_MOUNTS)) {
    return { workspace: WORKSPACE, project: PROJECT, workspaceName: WORKSPACE_PROFILE_LABEL, folderName: folderDisplayName(WORKSPACE_DIR), readOnly: nextReadOnly, unchanged: true, restarted: false, job: null };
  }
  const attachedStart = activeJob?.kind === 'start' ? activeJob : null;
  if (jobPreparing || (activeJob && !attachedStart) || workspaceTransition) throw new Error('当前有设备操作或工作区切换，请完成后再试。');
  validateWritableWorkspaceBoundary(selection, nextReadOnly);
  workspaceTransition = true;
  try {
    const status = await readProjectStatus();
    if (activeJob && activeJob !== attachedStart) throw new Error('设备操作刚刚开始，请完成后再切换工作区。');
    if (status.state === 'partial' && !attachedStart) throw new Error('当前设备状态异常；请先处理本机容器状态，再修改挂载。');

    if (!selection.external && selection.directory !== workspaceDirectory(WORKSPACE_ROOT, DEFAULT_WORKSPACE)) {
      await ensureWorkspaceRoot();
      const details = await lstat(selection.directory).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (!details?.isDirectory() || details.isSymbolicLink() || await realpath(selection.directory) !== selection.directory) {
        throw new Error('只能选择 sandbox-workspace/ 下已存在的普通文件夹。');
      }
    } else if (selection.external) {
      const details = await lstat(selection.directory).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (!details?.isDirectory() || await realpath(selection.directory) !== selection.directory) {
        throw new Error('所选文件夹已不存在或位置已改变，请重新选择。');
      }
    }

    const nextSelection = { ...selection, readOnly: nextReadOnly, label: nextLabel };
    const wasRunning = status.state === 'running' || Boolean(attachedStart);
    if (wasRunning && !status.imagesReady) throw new Error('固定设备镜像尚未准备，无法自动重启。请先停止设备，再准备镜像。');
    if (attachedStart) await stopAttachedStartJob(attachedStart);
    const afterAttachedStop = await readProjectStatus();
    if (afterAttachedStop.state === 'partial') throw new Error('当前设备停止后仍处于异常状态；挂载没有切换，请先处理本机容器状态。');
    if (afterAttachedStop.state === 'running') {
      const stop = await runComposeCapture(['stop', '--timeout', '15'], 20_000);
      if (stop.code !== 0) throw new Error('当前设备未能正常停止，挂载没有切换。请检查 Docker 状态后重试。');
    }

    try {
      await checkMountDirectories(nextSelection);
      await validateAdditionalMounts(nextMounts, nextSelection, { allowMissingDefault: true });
      await prepareDefaultReference(nextMounts);
      await validateAdditionalMounts(nextMounts, nextSelection);
    } catch (error) {
      throw new Error(`挂载设置未应用：${error.message}`);
    }

    const previousRuntimeMounts = EXTRA_MOUNTS.map((mount) => ({ ...mount }));
    const previousProfiles = cloneWorkspaceProfiles(savedWorkspaceProfiles);
    const nextProfiles = cloneWorkspaceProfiles(savedWorkspaceProfiles);
    nextProfiles.activeWorkspace = selection.workspace;
    nextProfiles.deviceProject = PROJECT_OVERRIDE || nextProfiles.deviceProject || DEFAULT_PROJECT;
    nextProfiles.workspaces[selection.workspace] = {
      label: nextLabel,
      directory: nextSelection.directory,
      readOnly: nextReadOnly,
      mounts: nextMounts,
    };
    nextProfiles.deletedWorkspaces = nextProfiles.deletedWorkspaces.filter((workspace) => workspace !== selection.workspace);
    try {
      await writeRuntimeMountsFile(nextMounts);
      await persistWorkspaceProfiles(nextProfiles);
    } catch (error) {
      try { await writeRuntimeMountsFile(previousRuntimeMounts); } catch {}
      savedWorkspaceProfiles = previousProfiles;
      throw new Error(wasRunning
        ? `原设备已停止，但工作区设置未能保存，因此没有应用新设置；原配置仍保留。${error.message}`
        : error.message);
    }

    const applied = activateWorkspace(nextSelection, nextReadOnly);
    savedWorkspaceProfiles = nextProfiles;
    EXTRA_MOUNTS = nextMounts;
    DRAFT_EXTRA_MOUNTS = EXTRA_MOUNTS.map((mount) => ({ ...mount }));
    DRAFT_WORKSPACE_READ_ONLY = WORKSPACE_READ_ONLY;
    if (wasRunning) {
      const job = await spawnJob('start', ['up', '--no-build', '--pull', 'never', '--remove-orphans', '--exit-code-from', 'remote-device'], { allowWorkspaceTransition: true });
      return { ...applied, restarted: true, mountCount: EXTRA_MOUNTS.length, job: publicJob(job) };
    }
    return { ...applied, restarted: false, mountCount: EXTRA_MOUNTS.length, job: null };
  } finally {
    workspaceTransition = false;
  }
}

async function saveWorkspaceProfile(name, folders = []) {
  if (WORKSPACE_SELECTION_LOCKED) throw new Error('当前通过 --project 固定了项目，Web 工作区切换已禁用。');
  if (!isWorkspaceName(name) || name === DEFAULT_WORKSPACE) throw new Error('工作区名称无效。请使用小写字母、数字、下划线或连字符，且新工作区不能使用 default。');
  if (savedWorkspaceProfiles.workspaces[name]) throw new Error('同名工作区已经存在。');
  if ((activeJob && activeJob.kind !== 'start') || workspaceTransition) throw new Error('当前有设备操作或工作区切换，请稍后再试。');
  if (!Array.isArray(folders) || folders.length > 9) throw new Error('最多可选择 1 个主文件夹和 8 个额外挂载文件夹。');
  const seenSelectionIds = new Set();
  const selections = folders.map((folder) => {
    if (!folder || Object.keys(folder).some((key) => !['selectionId', 'readOnly'].includes(key))
      || typeof folder.selectionId !== 'string' || typeof folder.readOnly !== 'boolean'
      || seenSelectionIds.has(folder.selectionId)) {
      throw new Error('新建工作区只接受系统选择器生成的临时编号和只读/读写权限。');
    }
    seenSelectionIds.add(folder.selectionId);
    const pending = pendingWorkspaceSelections.get(folder.selectionId);
    if (!pending || pending.purpose !== 'workspace-create' || Date.now() - pending.createdAt > 5 * 60 * 1000) {
      throw new Error('文件夹选择已过期，请重新选择。');
    }
    return { id: folder.selectionId, pending, readOnly: folder.readOnly };
  });

  workspaceTransition = true;
  try {
    let primarySelection;
    let primaryReadOnly = false;
    let mounts = [];
    if (selections.length) {
      const primary = selections[0];
      primarySelection = {
        ...primary.pending.selection,
        workspace: name,
        project: PROJECT,
        label: name,
      };
      primaryReadOnly = primary.readOnly;
      for (const [otherWorkspace, otherProfile] of Object.entries(savedWorkspaceProfiles.workspaces)) {
        if (pathsMatch(primarySelection.directory, otherProfile.directory)
          || otherWorkspace === DEFAULT_WORKSPACE && pathsMatch(primarySelection.directory, WORKSPACE_ROOT)) {
          throw new Error('这个文件夹已经是其他工作区的主文件夹，请为新工作区选择不同的文件夹。');
        }
      }
      validateWritableWorkspaceBoundary(primarySelection, primaryReadOnly);
      const primaryDetails = await lstat(primarySelection.directory).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (!primaryDetails?.isDirectory() || primaryDetails.isSymbolicLink()
        || await realpath(primarySelection.directory) !== primarySelection.directory) {
        throw new Error('所选主文件夹已不存在或位置已改变，请重新选择。');
      }
      if (process.platform === 'linux' && primarySelection.external) {
        const access = await stat(primarySelection.directory);
        const requiredGroupBits = primaryReadOnly ? 0o050 : 0o070;
        const gid = process.getgid();
        if (access.gid !== gid || (access.mode & requiredGroupBits) !== requiredGroupBits) {
          throw new Error(`Linux 所选文件夹需要归当前用户主组 GID ${gid} 所有，并为该组提供${primaryReadOnly ? '读和进入' : '读、写和进入'}权限；控制台不会更改该目录。`);
        }
      }
      mounts = selections.slice(1).map(({ pending, readOnly }) => ({
        id: pending.mountId || `mount-${randomBytes(6).toString('hex')}`,
        directory: pending.selection.directory,
        readOnly,
      }));
      await validateAdditionalMounts(mounts, primarySelection);
    } else {
      await ensureWorkspaceRoot();
      const directory = workspaceDirectory(WORKSPACE_ROOT, name);
      let details = await lstat(directory).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
      if (!details) {
        await createDedicatedWorkspace(directory);
        details = await lstat(directory);
      }
      if (!details.isDirectory() || details.isSymbolicLink() || await realpath(directory) !== directory) {
        throw new Error('同名工作区位置不是普通文件夹。');
      }
      primarySelection = {
        workspace: name,
        project: PROJECT,
        directory,
        display: `sandbox-workspace/${name}`,
        external: false,
        label: name,
      };
    }

    const nextProfiles = cloneWorkspaceProfiles(savedWorkspaceProfiles);
    nextProfiles.workspaces[name] = {
      label: name,
      directory: primarySelection.directory,
      readOnly: primaryReadOnly,
      mounts,
    };
    nextProfiles.deletedWorkspaces = nextProfiles.deletedWorkspaces.filter((workspace) => workspace !== name);
    await persistWorkspaceProfiles(nextProfiles);
    savedWorkspaceProfiles = nextProfiles;
    for (const { id } of selections) pendingWorkspaceSelections.delete(id);
    return {
      workspace: WORKSPACE,
      project: PROJECT,
      workspaceName: WORKSPACE_PROFILE_LABEL,
      folderName: folderDisplayName(WORKSPACE_DIR),
      readOnly: WORKSPACE_READ_ONLY,
      unchanged: false,
      restarted: false,
      job: null,
      savedWorkspace: name,
    };
  } finally {
    workspaceTransition = false;
  }
}

async function switchWorkspace(name, { readOnly = false } = {}) {
  if (!isWorkspaceName(name)) throw new Error('工作区名称无效。请使用小写字母、数字、下划线或连字符。');
  const saved = savedWorkspaceProfiles.workspaces[name];
  const profile = saved || projectWorkspaceProfile(WORKSPACE_ROOT, name);
  const external = identifyWorkspaceDirectorySyncFallback(profile.directory);
  const selection = {
    workspace: name,
    project: PROJECT,
    directory: profile.directory,
    display: external ? profile.directory : relative(ROOT, profile.directory),
    external,
    label: profile.label,
  };
  return applyWorkspaceSelection(selection, { readOnly: saved?.readOnly ?? readOnly, extraMounts: profile.mounts });
}

function cleanWorkspaceLabel(label) {
  if (typeof label !== 'string') throw new Error('请输入工作区显示名称。');
  const normalized = label.trim();
  if (!normalized || normalized.length > 80 || /[\x00-\x1f\x7f]/.test(normalized)) {
    throw new Error('工作区显示名称需要为 1 到 80 个字符，且不能包含控制字符。');
  }
  return normalized;
}

function pathsMatch(left, right) {
  const a = resolve(left);
  const b = resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function editWorkspaceProfile(body) {
  if (WORKSPACE_SELECTION_LOCKED) throw new Error('当前通过 --project 固定了项目，Web 工作区切换已禁用。');
  const allowed = new Set(['workspace', 'label', 'readOnly', 'selectionId', 'mounts', 'applyDraftMounts']);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new Error('工作区编辑不接受路径、项目名或其他字段。');
  if (!isWorkspaceName(body.workspace)) throw new Error('请选择有效的工作区。');
  if (typeof body.readOnly !== 'boolean') throw new Error('请选择只读或读写权限。');
  if (body.applyDraftMounts !== undefined && typeof body.applyDraftMounts !== 'boolean') throw new Error('挂载应用选项无效。');
  if (body.mounts !== undefined && (!Array.isArray(body.mounts) || body.mounts.length > 8)) throw new Error('一个工作区最多可配置 8 个额外挂载文件夹。');
  const label = cleanWorkspaceLabel(body.label);
  if ((activeJob && activeJob.kind !== 'start') || workspaceTransition) throw new Error('当前有设备操作或工作区切换，请完成后再编辑。');
  const workspace = body.workspace;
  const hasDraftMountChanges = mountsAreDirty();
  if (hasDraftMountChanges && workspace === WORKSPACE && body.mounts === undefined && body.applyDraftMounts !== true) {
    throw new Error('请先应用待应用的挂载更改，或在编辑当前工作区时确认合并应用。');
  }
  if (body.applyDraftMounts === true && workspace !== WORKSPACE) {
    throw new Error('只能把当前工作区的待应用挂载与当前工作区设置合并。');
  }
  const profile = savedWorkspaceProfiles.workspaces[workspace] || projectWorkspaceProfile(WORKSPACE_ROOT, workspace);

  let selection;
  let pendingPrimarySelection;
  if (body.selectionId !== undefined) {
    const pending = pendingWorkspaceSelections.get(body.selectionId);
    if (typeof body.selectionId !== 'string' || !pending
      || pending.purpose !== 'workspace-edit'
      || pending.workspace !== workspace
      || Date.now() - pending.createdAt > 5 * 60 * 1000) {
      if (typeof body.selectionId === 'string') pendingWorkspaceSelections.delete(body.selectionId);
      throw new Error('主文件夹选择已过期，请重新选择。');
    }
    selection = { ...pending.selection };
    pendingPrimarySelection = pending;
  } else {
    selection = await identifyWorkspaceDirectory(WORKSPACE_ROOT, profile.directory);
  }
  selection.workspace = workspace;
  selection.project = PROJECT;
  selection.label = label;
  selection.readOnly = body.readOnly;

  for (const [otherWorkspace, otherProfile] of Object.entries(savedWorkspaceProfiles.workspaces)) {
    if (otherWorkspace !== workspace && pathsMatch(selection.directory, otherProfile.directory)) {
      throw new Error('这个文件夹已经是另一个工作区的主文件夹，请为工作区选择不同的文件夹。');
    }
  }
  validateWritableWorkspaceBoundary(selection, body.readOnly);

  let nextMounts;
  const consumedMountSelections = [];
  if (body.mounts !== undefined) {
    const editableMounts = workspace === WORKSPACE
      ? [...(profile.mounts || []), ...DRAFT_EXTRA_MOUNTS]
      : profile.mounts || [];
    const existingMounts = new Map(editableMounts.map((mount) => [mount.id, mount]));
    const seenIds = new Set();
    nextMounts = body.mounts.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)
        || Object.keys(item).some((key) => !['mountId', 'selectionId', 'readOnly'].includes(key))
        || typeof item.readOnly !== 'boolean'
        || (typeof item.mountId === 'string') === (typeof item.selectionId === 'string')) {
        throw new Error('挂载清单只接受已保存的挂载编号或系统选择器生成的临时编号及访问权限。');
      }
      if (item.mountId !== undefined) {
        if (!/^mount-[a-f0-9]{12}$/.test(item.mountId) || seenIds.has(item.mountId) || !existingMounts.has(item.mountId)) {
          throw new Error('挂载清单包含无效或重复的已保存挂载编号。');
        }
        seenIds.add(item.mountId);
        return { ...existingMounts.get(item.mountId), readOnly: item.readOnly };
      }
      if (typeof item.selectionId !== 'string' || item.selectionId.length > 128 || seenIds.has(item.selectionId)) {
        throw new Error('挂载清单包含无效或重复的系统选择器编号。');
      }
      seenIds.add(item.selectionId);
      const pending = pendingWorkspaceSelections.get(item.selectionId);
      if (!pending || pending.purpose !== 'workspace-edit-mount' || pending.workspace !== workspace
        || Date.now() - pending.createdAt > 5 * 60 * 1000) {
        throw new Error('额外挂载文件夹选择已过期，请重新选择。');
      }
      consumedMountSelections.push(pending);
      return {
        id: pending.mountId || `mount-${randomBytes(6).toString('hex')}`,
        directory: pending.selection.directory,
        readOnly: item.readOnly,
      };
    });
  } else if (workspace === WORKSPACE) {
    nextMounts = body.applyDraftMounts === true
      ? DRAFT_EXTRA_MOUNTS.map((mount) => ({ ...mount }))
      : EXTRA_MOUNTS.map((mount) => ({ ...mount }));
  } else {
    nextMounts = (profile.mounts || []).map((mount) => ({ ...mount }));
  }
  await validateAdditionalMounts(nextMounts, selection, { allowMissingDefault: true });

  let result;
  if (workspace === WORKSPACE) {
    const runtimeChanged = !pathsMatch(selection.directory, profile.directory)
      || body.readOnly !== profile.readOnly
      || !mountSetsEqual(profile.mounts, nextMounts);
    if (!runtimeChanged) {
      const nextProfiles = cloneWorkspaceProfiles(savedWorkspaceProfiles);
      nextProfiles.workspaces[workspace] = { ...profile, label };
      nextProfiles.deletedWorkspaces = nextProfiles.deletedWorkspaces.filter((item) => item !== workspace);
      await persistWorkspaceProfiles(nextProfiles);
      savedWorkspaceProfiles = nextProfiles;
      WORKSPACE_PROFILE_LABEL = label;
      result = { workspace, project: PROJECT, workspaceName: label, folderName: folderDisplayName(WORKSPACE_DIR), readOnly: WORKSPACE_READ_ONLY, restarted: false, job: null };
    } else {
      result = await applyWorkspaceSelection(selection, { readOnly: body.readOnly, extraMounts: nextMounts });
    }
  } else {
    const details = await lstat(selection.directory).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!details?.isDirectory() || details.isSymbolicLink() || await realpath(selection.directory) !== selection.directory) {
      throw new Error('所选工作区文件夹不存在或已改变，请重新选择。');
    }
    const nextProfiles = cloneWorkspaceProfiles(savedWorkspaceProfiles);
    nextProfiles.workspaces[workspace] = {
      label,
      directory: selection.directory,
      readOnly: body.readOnly,
      mounts: nextMounts,
    };
    nextProfiles.deletedWorkspaces = nextProfiles.deletedWorkspaces.filter((item) => item !== workspace);
    await persistWorkspaceProfiles(nextProfiles);
    savedWorkspaceProfiles = nextProfiles;
    result = { workspace, project: PROJECT, workspaceName: label, folderName: folderDisplayName(selection.directory), readOnly: body.readOnly, restarted: false, job: null };
  }
  if (pendingPrimarySelection) pendingWorkspaceSelections.delete(body.selectionId);
  for (const pending of consumedMountSelections) pendingWorkspaceSelections.delete(pending.id);
  return { ...result, workspaces: await currentWorkspaceProfiles() };
}

async function deleteWorkspaceProfile(workspace) {
  if (WORKSPACE_SELECTION_LOCKED) throw new Error('当前通过 --project 固定了项目，Web 工作区管理已禁用。');
  if (!isWorkspaceName(workspace) || workspace === DEFAULT_WORKSPACE) throw new Error('默认工作区不能删除。');
  if (mountsAreDirty()) throw new Error('请先应用或撤销待应用的挂载更改，再删除工作区。');
  if ((activeJob && activeJob.kind !== 'start') || workspaceTransition) throw new Error('当前有设备操作或工作区切换，请完成后再删除。');
  if (!savedWorkspaceProfiles.workspaces[workspace]) {
    const candidate = workspaceDirectory(WORKSPACE_ROOT, workspace);
    const details = await lstat(candidate).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (!details?.isDirectory() || details.isSymbolicLink()) throw new Error('找不到这个已保存的工作区。');
  }

  const transition = workspace === WORKSPACE ? await switchWorkspace(DEFAULT_WORKSPACE) : null;

  const nextProfiles = cloneWorkspaceProfiles(savedWorkspaceProfiles);
  delete nextProfiles.workspaces[workspace];
  nextProfiles.deletedWorkspaces = [...nextProfiles.deletedWorkspaces.filter((item) => item !== workspace), workspace].slice(-2000);
  if (nextProfiles.activeWorkspace === workspace) nextProfiles.activeWorkspace = DEFAULT_WORKSPACE;
  await persistWorkspaceProfiles(nextProfiles);
  savedWorkspaceProfiles = nextProfiles;

  return {
    deletedWorkspace: workspace,
    workspace: WORKSPACE,
    restarted: transition?.restarted || false,
    job: transition?.job || null,
    folderPreserved: true,
    workspaces: await currentWorkspaceProfiles(),
  };
}

function identifyWorkspaceDirectorySyncFallback(directory) {
  const resolved = resolve(directory);
  return !pathIsWithin(WORKSPACE_ROOT, resolved);
}

// Only newly created dedicated roots receive group permissions. Never walk or
// chmod an existing Agent-writable tree; permissions inside it remain user-owned.
async function createDedicatedWorkspace(directory) {
  await mkdir(directory, { mode: 0o700 });
  if (process.platform !== 'linux') return;
  const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const details = await handle.stat();
    if (!details.isDirectory() || details.uid !== process.getuid() || details.gid !== process.getgid()) {
      throw new Error('New workspace ownership differs from the controller user.');
    }
    await handle.chmod(0o2770);
  } finally { await handle.close(); }
}

async function prepareLinuxMountPermissions(selection = {
  directory: WORKSPACE_DIR,
  external: WORKSPACE_EXTERNAL,
  readOnly: WORKSPACE_READ_ONLY,
}) {
  const workspace = selection.directory;
  const hostGid = process.getgid();
  const details = await lstat(workspace);
  const requiredGroupBits = selection.readOnly ? 0o050 : 0o070;
  if (!details.isDirectory() || details.isSymbolicLink()
    || details.gid !== hostGid || (details.mode & requiredGroupBits) !== requiredGroupBits) {
    throw new Error(`Linux 所选文件夹需要归当前用户主组 GID ${hostGid} 所有，并为该组提供${selection.readOnly ? '读和进入' : '读、写和进入'}权限。为避免改动用户文件，控制台不会自动修改目录权限。`);
  }
}

async function currentWorkspaceProfiles() {
  // Keep discovering legacy/unconfigured folders, but honor persisted
  // tombstones so deleting a profile never deletes its files or makes it reappear.
  const directories = await listWorkspaceProfiles(WORKSPACE_ROOT, DEFAULT_WORKSPACE);
  const deleted = new Set(savedWorkspaceProfiles.deletedWorkspaces || []);
  const profileIds = new Set([
    ...directories.map((profile) => profile.workspace).filter((workspace) => !deleted.has(workspace)),
    DEFAULT_WORKSPACE,
    WORKSPACE,
    ...Object.keys(savedWorkspaceProfiles.workspaces),
  ]);
  const profiles = [];
  for (const workspace of [DEFAULT_WORKSPACE, ...[...profileIds].filter((name) => name !== DEFAULT_WORKSPACE).sort()]) {
    const profile = savedWorkspaceProfiles.workspaces[workspace] || projectWorkspaceProfile(WORKSPACE_ROOT, workspace);
    const directory = profile.directory;
    const external = !pathIsWithin(WORKSPACE_ROOT, directory);
    let exists = false;
    try {
      const details = await lstat(directory);
      exists = details.isDirectory() && !details.isSymbolicLink();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    profiles.push({
      workspace,
      label: profile.label,
      project: PROJECT,
      folderName: folderDisplayName(directory),
      localPath: directory,
      exists,
      external,
      readOnly: profile.readOnly,
      mountCount: profile.mounts.length,
      mounts: publicMounts(profile.mounts),
      selected: workspace === WORKSPACE,
      deletable: workspace !== DEFAULT_WORKSPACE,
    });
  }
  return profiles;
}

async function readProjectStatus() {
  const [result, imageResult] = await Promise.all([
    runComposeCapture(['ps', '--all', '--format', 'json']),
    runDockerCapture(['image', 'inspect', '--format', '{{.Id}}', ...FIXED_IMAGES]),
  ]);
  if (result.code !== 0) throw new Error(conciseError(result));
  let containers;
  try {
    containers = parseComposeJson(result.stdout);
  } catch {
    throw new Error('无法解析 Docker Compose 状态输出。');
  }
  const services = ['remote-device'].map((name) => {
    const item = containers.find((entry) => entry.Service === name);
    const state = String(item?.State || 'not-created').toLowerCase();
    const status = String(item?.Status || 'not created');
    const health = String(item?.Health || (status.match(/\((healthy|unhealthy|starting)\)/i)?.[1] || ''));
    return {
      name,
      container: item?.Name || null,
      state,
      status,
      health: health.toLowerCase(),
      running: state === 'running',
    };
  });
  const device = services[0];
  const projectState = device.running ? 'running' : ['not-created', 'exited', 'stopped'].includes(device.state) ? 'stopped' : 'partial';
  if (activeJob?.kind === 'start' && activeJob.phase === 'starting' && projectState === 'running') {
    activeJob.phase = 'running';
  }
  return {
    project: PROJECT,
    workspace: WORKSPACE,
    workspaceName: WORKSPACE_PROFILE_LABEL,
    workspaceFolderName: folderDisplayName(WORKSPACE_DIR),
    workspaceLocalPath: WORKSPACE_DIR,
    workspaceExternal: WORKSPACE_EXTERNAL,
    workspaceReadOnly: WORKSPACE_READ_ONLY,
    state: projectState,
    imagesReady: imageResult.code === 0,
    imageDownloadAvailable: !PRODUCT_VERSION.includes('-'),
    services,
    updatedAt: new Date().toISOString(),
  };
}

async function findRunningDeviceContainer() {
  const result = await runComposeCapture(['ps', '--all', '--format', 'json']);
  if (result.code !== 0) throw new Error('无法读取当前项目的容器状态。');
  let containers;
  try {
    containers = parseComposeJson(result.stdout);
  } catch {
    throw new Error('无法解析当前项目的容器状态。');
  }
  const device = containers.find((entry) => entry.Service === 'remote-device');
  const id = String(device?.ID || '');
  if (String(device?.State || '').toLowerCase() !== 'running' || !/^[a-f0-9]{12,64}$/i.test(id)) {
    return { running: false };
  }
  return { running: true, id };
}

async function readDeviceResources() {
  const container = await findRunningDeviceContainer();
  if (!container.running) return { running: false, metrics: null, updatedAt: new Date().toISOString() };
  const result = await runDockerCapture([
    'stats', '--no-stream', '--format', '{{json .}}', container.id,
  ], 8_000);
  if (result.code !== 0 || result.timedOut) throw new Error('Docker 当前无法读取设备资源用量。');
  return { running: true, metrics: parseDockerStats(result.stdout), updatedAt: new Date().toISOString() };
}

async function readPersistentVolumeUsage() {
  const container = await findRunningDeviceContainer();
  if (!container.running) return { available: false, updatedAt: new Date().toISOString() };
  // Both commands are fixed, read-only summaries of the two application volumes.
  // They execute as the owning container users, so no extra container privileges are needed.
  const [deviceState, toolHome] = await Promise.all([
    runComposeCapture(['exec', '--no-TTY', '--user', '10001:10001', 'remote-device', 'du', '-s', '-B1', '/var/lib/remote-device'], 15_000),
    runComposeCapture(['exec', '--no-TTY', '--user', '10002:10002', 'remote-device', 'du', '-s', '-B1', '/home/tool'], 15_000),
  ]);
  if (deviceState.code !== 0 || toolHome.code !== 0 || deviceState.timedOut || toolHome.timedOut) {
    throw new Error('无法读取持久化数据卷占用；设备可能正忙，请稍后重试。');
  }
  const deviceStateBytes = parseFixedDuOutput(deviceState.stdout, '/var/lib/remote-device');
  const toolHomeBytes = parseFixedDuOutput(toolHome.stdout, '/home/tool');
  const bytes = deviceStateBytes + toolHomeBytes;
  if (!Number.isSafeInteger(bytes)) throw new Error('持久化数据卷占用超出可处理范围。');
  return {
    available: true,
    bytes,
    deviceStateBytes,
    toolConfigBytes: toolHomeBytes, // Keep the existing storage response key.
    updatedAt: new Date().toISOString(),
  };
}

async function inspectFixedMountDirectories() {
  const directories = [
    ...(!WORKSPACE_EXTERNAL ? [{ path: WORKSPACE_ROOT, label: 'sandbox-workspace' }] : []),
    { path: WORKSPACE_DIR, label: WORKSPACE_DISPLAY },
  ];
  const issues = [];
  try {
    validateActiveMountBoundaries();
    await validateAdditionalMounts(EXTRA_MOUNTS, { directory: WORKSPACE_DIR }, { allowMissingDefault: true });
  } catch (error) {
    issues.push({ status: 'error', text: error.message });
  }
  const seen = new Set();
  for (const entry of directories) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    const expected = entry.path;
    try {
      const details = await lstat(expected);
      if (!details.isDirectory() || details.isSymbolicLink()) {
        issues.push({ status: 'error', text: `${entry.label} 不是普通文件夹` });
        continue;
      }
      if (await realpath(expected) !== expected) {
        issues.push({ status: 'error', text: `${entry.label} 与所选真实文件夹不一致` });
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        issues.push({ status: 'warning', text: `${entry.label} 尚未创建` });
        continue;
      }
      issues.push({ status: 'error', text: `无法读取 ${entry.label} 的状态` });
    }
  }
  if (process.platform === 'linux' && WORKSPACE_EXTERNAL) {
    const gid = process.getgid();
    try {
      const details = await stat(WORKSPACE_DIR);
      const requiredGroupBits = WORKSPACE_READ_ONLY ? 0o050 : 0o070;
      if (details.gid !== gid || (details.mode & requiredGroupBits) !== requiredGroupBits) {
        issues.push({ status: 'error', text: `Linux 所选文件夹需要主组 GID ${gid} 具备${WORKSPACE_READ_ONLY ? '读取和进入' : '读写和进入'}权限` });
      }
    } catch {
      issues.push({ status: 'error', text: '无法检查 Linux 所选文件夹权限' });
    }
  }
  const errors = issues.filter((issue) => issue.status === 'error');
  if (errors.length) {
    return { status: 'error', detail: `${errors.map((issue) => issue.text).join('；')}。`, action: WORKSPACE_EXTERNAL ? '检查所选文件夹权限；控制台不会更改所选目录或其中的文件。' : '检查并修复项目内固定挂载目录。' };
  }
  const missing = issues.filter((issue) => issue.status === 'warning');
  if (missing.length) {
    return { status: WORKSPACE_DIR === workspaceDirectory(WORKSPACE_ROOT, DEFAULT_WORKSPACE) ? 'info' : 'warning', detail: `${missing.map((issue) => issue.text).join('；')}。`, action: '设备构建或启动时会在项目目录内创建。' };
  }
  return { status: 'ok', detail: '所选工作区为可用文件夹。', action: '' };
}

async function runDiagnostics() {
  const checks = [];
  const nodeReady = isSupportedNode(process.versions.node);
  checks.push({
    id: 'node',
    label: 'Node.js',
    status: nodeReady ? 'ok' : 'error',
    detail: nodeReady ? `已安装 ${process.versions.node}` : `当前为 ${process.versions.node}；需要 22.12.0 或更高版本。`,
    action: nodeReady ? '' : '安装 Node.js 22.12.0 或更高版本后重新打开控制台。',
  });

  const [docker, compose] = await Promise.all([
    runDockerCapture(['--version']),
    runDockerCapture(['compose', 'version', '--short']),
  ]);
  const dockerReady = docker.code === 0;
  checks.push({
    id: 'docker-cli', label: 'Docker CLI', status: dockerReady ? 'ok' : 'error',
    detail: dockerReady ? (docker.stdout || '').trim().slice(0, 120) : '未找到或无法运行。',
    action: dockerReady ? '' : '安装 Docker Desktop，或在 Linux 上安装 Docker CLI。',
  });
  const composeVersion = (compose.stdout || '').trim();
  const composeReady = Boolean(compose.code === 0 && isComposeVersionSupported(composeVersion));
  checks.push({
    id: 'compose', label: 'Docker Compose', status: composeReady ? 'ok' : 'error',
    detail: composeReady ? `已安装 ${composeVersion}` : `需要 Docker Compose ${MINIMUM_COMPOSE_VERSION} 或更高版本。`,
    action: composeReady ? '' : `安装 Docker Compose ${MINIMUM_COMPOSE_VERSION} 或更新版本。`,
  });

  if (dockerReady) {
    const engine = await runDockerCapture(['info', '--format', '{{.ServerVersion}}'], 15_000);
    const engineVersion = (engine.stdout || '').trim();
    const engineReady = engine.code === 0 && Boolean(engineVersion);
    checks.push({
      id: 'engine', label: 'Docker Engine', status: engineReady ? 'ok' : 'error',
      detail: engineReady ? `已连接（${engineVersion}）` : '当前无法连接。',
      action: engineReady ? '' : '启动 Docker Desktop 或 Docker Engine，再重新检查。',
    });
  } else {
    checks.push({ id: 'engine', label: 'Docker Engine', status: 'error', detail: 'Docker CLI 不可用，无法检查。', action: '先安装 Docker CLI。' });
  }

  if (composeReady) {
    const config = await runDockerCapture(composeArgs(['config', '--quiet']));
    checks.push({
      id: 'compose-config', label: '项目配置', status: config.code === 0 ? 'ok' : 'error',
      detail: config.code === 0 ? '固定 Compose 配置有效。' : 'Compose 配置无法加载。',
      action: config.code === 0 ? '' : '检查项目文件和 .env 配置。',
    });
  } else {
    checks.push({ id: 'compose-config', label: '项目配置', status: 'error', detail: 'Compose 不可用，无法检查。', action: `先安装 Docker Compose ${MINIMUM_COMPOSE_VERSION} 或更高版本。` });
  }

  const image = dockerReady ? await runDockerCapture(['image', 'inspect', '--format', '{{.Id}}', ...FIXED_IMAGES]) : null;
  const imageReady = Boolean(image && image.code === 0);
  checks.push({
    id: 'image', label: '设备镜像', status: imageReady ? 'ok' : 'warning',
    detail: imageReady ? '固定版本镜像已准备。' : '固定版本镜像尚未准备。',
    action: imageReady ? '' : '在控制台选择“准备镜像”。',
  });

  try {
    const status = await readProjectStatus();
    const running = status.state === 'running';
    checks.push({
      id: 'device', label: '本机设备容器', status: 'info',
      detail: running ? '容器正在运行。' : status.state === 'partial' ? '容器状态异常。' : '容器已停止。',
      action: '容器运行状态不代表云端已连接；请在远程客户端确认连接。',
    });
    if (status.state === 'partial') checks.at(-1).status = 'warning';
  } catch {
    checks.push({
      id: 'device', label: '本机设备容器', status: 'warning',
      detail: '无法读取容器状态。',
      action: '查看 Docker Engine 与 Compose 项目状态。',
    });
  }

  const mounts = await inspectFixedMountDirectories();
  checks.push({ id: 'mounts', label: '工作目录', ...mounts });
  checks.push({
    id: 'workspace', label: '当前工作区', status: 'info',
    detail: '控制台使用当前选择的工作区文件夹。',
    action: '容器只将当前所选文件夹挂载到 /workspace；停止设备后可在控制台重新选择。',
  });

  const proxyLabels = { project: '项目配置', system: '跟随系统设置', manual: '手动 HTTP(S)', direct: '直连' };
  checks.push({
    id: 'network', label: '网络设置', status: 'info',
    detail: `${proxyLabels[sessionProxyMode || 'project'] || '项目配置'}。`,
    action: '此处只显示代理设置；本机控制台无法读取云端连接状态。',
  });

  return { checkedAt: new Date().toISOString(), checks };
}

function safeWorkspaceLogSlug() {
  const slug = String(WORKSPACE_PROFILE_LABEL || WORKSPACE)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return slug || WORKSPACE;
}

async function prepareRunLog(job) {
  if (job.kind !== 'start') return;
  await pendingRunLogWrites.catch(() => {});
  await mkdir(RUN_LOG_DIRECTORY, { recursive: true, mode: 0o700 });
  const directory = await lstat(RUN_LOG_DIRECTORY);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('本机日志位置必须是普通目录。');
  await chmod(RUN_LOG_DIRECTORY, 0o700);
  const stamp = job.startedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const filename = `remote-device-${safeWorkspaceLogSlug()}-${stamp}-${job.id}.log`;
  const path = join(RUN_LOG_DIRECTORY, filename);
  const header = [
    'Desktop Commander Sandbox · 本次设备运行',
    `工作区：${safeWorkspaceLogSlug()}`,
    `开始时间：${job.startedAt}`,
    `本机项目：${PROJECT}`,
    '此文件保存本次容器 stdout/stderr 原始输出；内容可能包含授权信息、工具参数和结果。',
    '',
  ].join('\n');
  await writeFile(path, header, { flag: 'wx', mode: 0o600 });
  job.logPath = path;
  job.logFilename = filename;
  job.logBytes = Buffer.byteLength(header, 'utf8');
  job.persistChain = Promise.resolve();

  const names = await readdir(RUN_LOG_DIRECTORY, { withFileTypes: true });
  const logs = [];
  for (const entry of names) {
    if (!entry.isFile() || !/^remote-device-[a-z0-9_-]+-\d{8}T\d{6}Z-[a-f0-9]{16}\.log$/.test(entry.name)) continue;
    const candidatePath = join(RUN_LOG_DIRECTORY, entry.name);
    const details = await lstat(candidatePath);
    if (!details.isFile() || details.isSymbolicLink()) continue;
    if (!await isOwnedRunLog(candidatePath)) continue;
    logs.push({ path: candidatePath, startedAt: details.birthtimeMs || details.mtimeMs });
  }
  logs.sort((left, right) => right.startedAt - left.startedAt);
  for (const obsolete of logs.slice(MAX_PERSISTED_RUNS)) await rm(obsolete.path, { force: true, recursive: false });
}

function enqueueRunLogBytes(job, bytes) {
  if (!bytes.length) return;
  job.logBytes += bytes.length;
  job.persistChain = job.persistChain.then(() => appendFile(job.logPath, bytes, { mode: 0o600 })).catch(() => {
    job.logError = '本次运行日志无法继续保存。';
  });
  pendingRunLogWrites = job.persistChain;
}

function persistRunLogChunk(job, value) {
  if (!job.logPath || job.logTruncated) return;
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  if (!bytes.length) return;
  const writableBytes = Math.max(0, MAX_PERSISTED_RUN_BYTES - LOG_TRAILER_RESERVE_BYTES - job.logBytes);
  if (bytes.length <= writableBytes) {
    enqueueRunLogBytes(job, bytes);
    return;
  }
  enqueueRunLogBytes(job, bytes.subarray(0, writableBytes));
  job.logTruncated = true;
  enqueueRunLogBytes(job, LOG_TRUNCATION_MARKER);
}

async function listRunLogs() {
  if (latestJob?.persistChain) await latestJob.persistChain.catch(() => {});
  const names = await readdir(RUN_LOG_DIRECTORY, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const records = [];
  for (const entry of names) {
    const match = entry.name.match(/^remote-device-([a-z0-9_-]+)-(\d{8}T\d{6}Z)-([a-f0-9]{16})\.log$/);
    if (!match || !entry.isFile()) continue;
    const path = join(RUN_LOG_DIRECTORY, entry.name);
    const details = await lstat(path);
    if (!details.isFile() || details.isSymbolicLink()) continue;
    if (!await isOwnedRunLog(path)) continue;
    const runId = match[3];
    records.push({
      id: runId,
      workspace: match[1],
      startedAt: details.birthtime.toISOString(),
      sizeBytes: details.size,
      active: Boolean(latestJob?.id === runId && latestJob.kind === 'start' && activeJob === latestJob),
      current: Boolean(latestJob?.id === runId && latestJob.kind === 'start'),
      filename: entry.name,
    });
  }
  records.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  return records.slice(0, MAX_PERSISTED_RUNS);
}

async function readRunLog(runId) {
  if (typeof runId !== 'string' || !/^[a-f0-9]{16}$/.test(runId)) throw new Error('运行记录编号无效。');
  const record = (await listRunLogs()).find((entry) => entry.id === runId);
  if (!record) throw new Error('找不到这次运行的日志；它可能已被清理。');
  const path = join(RUN_LOG_DIRECTORY, record.filename);
  const details = await lstat(path);
  if (!details.isFile() || details.isSymbolicLink() || details.size > MAX_PERSISTED_RUN_BYTES) {
    throw new Error('日志文件状态无效或超过允许大小。');
  }
  return { run: record, text: await readFile(path, 'utf8') };
}

let latestJob = null;
let activeJob = null;
let jobPreparing = false;
let shuttingDown = false;
let cliStartupPending = false;

function pushLiveLogLine(job, value) {
  if (!value) return;
  const line = String(value);
  job.authorizationUrl = extractAuthorizationUrl(line) || job.authorizationUrl || null;
  const entry = { sequence: ++job.sequence, text: line };
  job.lines.push(entry);
  job.bytes += Buffer.byteLength(line, 'utf8');
  while (job.lines.length > MAX_LOG_LINES || job.bytes > MAX_LOG_BYTES) {
    const removed = job.lines.shift();
    job.bytes -= Buffer.byteLength(removed.text, 'utf8');
  }
}

function addLogLine(job, value) {
  if (!value) return;
  const line = String(value);
  if (job.echoOutput) process.stdout.write(`${line}\n`);
  persistRunLogChunk(job, `${line}\n`);
  pushLiveLogLine(job, line);
}

function attachStream(job, stream) {
  const decoder = new StringDecoder('utf8');
  let carry = '';
  const consume = (value) => {
    const sanitized = cleanLogText(value);
    if (job.echoOutput && sanitized) process.stdout.write(sanitized);
    const parts = `${carry}${sanitized}`.split('\n');
    carry = parts.pop() || '';
    for (const part of parts) pushLiveLogLine(job, part);
    while (carry.length > 4000) {
      pushLiveLogLine(job, carry.slice(0, 4000));
      carry = carry.slice(4000);
    }
  };
  stream.on('data', (chunk) => {
    persistRunLogChunk(job, chunk);
    consume(decoder.write(chunk));
  });
  stream.once('end', () => {
    consume(decoder.end());
    if (carry) pushLiveLogLine(job, carry);
  });
}

async function spawnJob(kind, args, { allowWorkspaceTransition = false, echoOutput = false } = {}) {
  if (workspaceTransition && !allowWorkspaceTransition) throw new Error('工作区正在切换，请稍后重试。');
  if (activeJob) throw new Error(`当前正在${activeJob.kind === 'build' ? '构建镜像' : activeJob.kind === 'start' ? '启动服务' : '停止服务'}，请等它完成。`);
  if (shuttingDown) throw new Error('The controller is closing.');
  if (jobPreparing) throw new Error('正在准备设备操作，请稍后重试。');
  jobPreparing = true;
  let job;
  let child;
  try {
    if (kind === 'start' && !allowWorkspaceTransition) {
      const status = await readProjectStatus();
      if (!status.imagesReady) throw new Error('Build the fixed image first with npm run remote-device:build.');
      if (status.state === 'running') throw new Error('The local device is already running.');
      if (sessionProxyMode === 'system') sessionProxyConfig = await readSystemProxy();
    }
    if (kind === 'start') await prepareActiveMounts({ checkDirectories: !allowWorkspaceTransition });
    if (kind === 'build' && WORKSPACE_DIR === workspaceDirectory(WORKSPACE_ROOT, DEFAULT_WORKSPACE)) {
      await checkMountDirectories();
      await prepareDefaultReference(EXTRA_MOUNTS);
    }
    job = {
      id: randomBytes(8).toString('hex'),
      kind,
      workspace: WORKSPACE_PROFILE_LABEL,
      phase: kind === 'stop' ? 'stopping' : ['build', 'pull'].includes(kind) ? 'building' : 'starting',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      exitCode: null,
      error: null,
      outputCleared: false,
      sequence: 0,
      lines: [],
      bytes: 0,
      child: null,
      closeTimer: null,
      authorizationUrl: null,
      logPath: null,
      logFilename: null,
      logBytes: 0,
      logTruncated: false,
      echoOutput: echoOutput || TERMINAL_MUTATION,
    };
    await prepareRunLog(job);
    if (shuttingDown) throw new Error('The controller is closing.');
    child = spawn('docker', composeArgs(args, { includeMounts: kind === 'start' }), {
      cwd: ROOT,
      env: dockerEnvironment(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    job.child = child;
    activeJob = job;
    latestJob = job;
  } finally {
    jobPreparing = false;
  }
  attachStream(job, child.stdout);
  attachStream(job, child.stderr);
  child.once('error', (error) => {
    job.error = error.message;
    addLogLine(job, `无法启动 Docker Compose：${error.message}`);
  });
  child.once('close', (code, signal) => {
    job.exitCode = code ?? (signal ? 128 : 1);
    job.finishedAt = new Date().toISOString();
    if (job.logPath) {
      const summary = `\n结束时间：${job.finishedAt}\n退出码：${job.exitCode}\n`;
      const summaryBytes = Buffer.from(summary, 'utf8');
      if (job.logTruncated && job.logBytes + summaryBytes.length <= MAX_PERSISTED_RUN_BYTES) {
        enqueueRunLogBytes(job, summaryBytes);
      } else {
        persistRunLogChunk(job, summaryBytes);
      }
    }
    if (job.exitCode !== 0 && job.phase !== 'stopping') job.phase = 'failed';
    else job.phase = 'finished';
    if (activeJob === job) activeJob = null;
    job.child = null;
    job.closeTimer = setTimeout(() => {
      if (latestJob === job) {
        job.lines = [];
        job.bytes = 0;
        job.phase = 'output-cleared';
        job.authorizationUrl = null;
      }
    }, OUTPUT_TTL_MS);
    job.closeTimer.unref();
  });
  return job;
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    kind: job.kind,
    workspace: job.workspace,
    phase: job.phase,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    exitCode: job.exitCode,
    error: job.error,
    sequence: job.sequence,
    outputCleared: job.outputCleared || job.phase === 'output-cleared',
    authorizationUrl: job.authorizationUrl || null,
    logFilename: job.logFilename || null,
    logError: job.logError || null,
  };
}

function localHostPaths() {
  const savedPaths = Object.values(savedWorkspaceProfiles.workspaces).flatMap((profile) => [
    profile.directory,
    ...profile.mounts.map((mount) => mount.directory),
  ]);
  return [
    ROOT,
    WORKSPACE_DIR,
    ...EXTRA_MOUNTS.map((mount) => mount.directory),
    ...DRAFT_EXTRA_MOUNTS.map((mount) => mount.directory),
    ...[...pendingWorkspaceSelections.values()].map((pending) => pending.selection.directory),
    ...savedPaths,
  ].filter(Boolean);
}

let cachedHostPathSignature = '';
let cachedHostPathRedactor = (value) => String(value);

function hostPathRedactor() {
  const paths = [...new Set(localHostPaths())].sort();
  const signature = JSON.stringify(paths);
  if (signature !== cachedHostPathSignature) {
    cachedHostPathRedactor = createHostPathRedactor(paths);
    cachedHostPathSignature = signature;
  }
  return cachedHostPathRedactor;
}

function json(res, status, value, options = {}) {
  const allowLocalPaths = options.allowLocalPaths ?? res.allowLocalPaths === true;
  const body = JSON.stringify(sanitizePublicValue(value, hostPathRedactor(), allowLocalPaths, options.allowRawLogText === true));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.end(body);
}

let ownsControllerDirectory = false;
let consoleServerActive = false;
async function acquireController() {
  await mkdir(dirname(CONTROLLER_DIRECTORY), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await mkdir(CONTROLLER_DIRECTORY, { mode: 0o700 });
      ownsControllerDirectory = true;
      await writeFile(join(CONTROLLER_DIRECTORY, 'owner.json'), JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
      return null;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    let owner;
    try { owner = JSON.parse(await readFile(join(CONTROLLER_DIRECTORY, 'owner.json'), 'utf8')); } catch {}
    if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
      try {
        process.kill(owner.pid, 0);
        if (typeof owner.url === 'string' && /^http:\/\/127\.0\.0\.1:\d+\/#session=[A-Za-z0-9_-]+$/.test(owner.url)) return owner.url;
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
        const stale = `${CONTROLLER_DIRECTORY}.stale-${process.pid}-${randomBytes(4).toString('hex')}`;
        try { await rename(CONTROLLER_DIRECTORY, stale); await rm(stale, { recursive: true, force: true }); } catch (moveError) { if (moveError.code !== 'ENOENT') throw moveError; }
      }
    } else {
      const details = await lstat(CONTROLLER_DIRECTORY).catch(() => null);
      if (details && Date.now() - details.mtimeMs > 1500) {
        const stale = `${CONTROLLER_DIRECTORY}.stale-${process.pid}-${randomBytes(4).toString('hex')}`;
        try { await rename(CONTROLLER_DIRECTORY, stale); await rm(stale, { recursive: true, force: true }); } catch (moveError) { if (moveError.code !== 'ENOENT') throw moveError; }
      }
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Another controller is starting or its ownership cannot be verified. Retry shortly.');
}

async function releaseController() {
  if (!ownsControllerDirectory) return;
  ownsControllerDirectory = false;
  consoleServerActive = false;
  await rm(CONTROLLER_DIRECTORY, { recursive: true, force: true });
}

async function activeControllerUrl() {
  let owner;
  try { owner = JSON.parse(await readFile(join(CONTROLLER_DIRECTORY, 'owner.json'), 'utf8')); } catch { return null; }
  if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0
    || typeof owner.url !== 'string'
    || !/^http:\/\/127\.0\.0\.1:\d+\/#session=[A-Za-z0-9_-]+$/.test(owner.url)) return null;
  try { process.kill(owner.pid, 0); } catch { return null; }
  return owner.url;
}

async function stopThroughController(url) {
  const target = new URL(url);
  const token = target.hash.slice('#session='.length);
  const origin = target.origin;
  const body = '{}';
  const response = await new Promise((resolveResponse, rejectResponse) => {
    const req = httpRequest(`${origin}/api/stop`, {
      method: 'POST', timeout: 30_000,
      headers: { Host: target.host, Origin: origin, Authorization: `Bearer ${token}`, 'X-Console-Request': 'desktop-commander-sandbox', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let output = '';
      res.on('data', (chunk) => { output += chunk.toString('utf8'); });
      res.once('end', () => resolveResponse({ status: res.statusCode, output }));
    });
    req.once('error', rejectResponse);
    req.once('timeout', () => req.destroy(new Error('The running controller did not answer the stop request.')));
    req.end(body);
  });
  if (response.status !== 202) throw new Error(`The running controller did not stop the device (${response.status}).`);
  console.log('The running controller is stopping the device.');
}

async function startDashboard({ openBrowser = true } = {}) {
  const token = randomBytes(32).toString('base64url');
  const staticContent = new Map();
  for (const [route, [filename, contentType]] of STATIC_FILES) {
    staticContent.set(route, { body: await readFile(join(ROOT, 'web', filename)), contentType });
  }

  let port = 0;
  const server = createServer(async (req, res) => {
    securityHeaders(res);
    const remote = req.socket.remoteAddress;
    if (shuttingDown) {
      json(res, 503, { error: '控制台正在关闭。' });
      return;
    }
    if (remote !== '127.0.0.1' && remote !== '::ffff:127.0.0.1') {
      res.writeHead(403).end();
      return;
    }
    const expectedHost = `127.0.0.1:${port}`;
    if (req.headers.host !== expectedHost) {
      res.writeHead(421).end();
      return;
    }
    const url = new URL(req.url || '/', `http://${expectedHost}`);

    if (url.pathname.startsWith('/api/')) {
      const pathFieldsAllowed = (req.method === 'GET' && ['/api/status', '/api/workspaces', '/api/mounts'].includes(url.pathname))
        || (req.method === 'POST' && [
          'workspace-select', 'workspace-create', 'workspace-create-pick', 'workspace-pick', 'workspace-main-pick', 'workspace-edit',
          'workspace-delete', 'workspace-apply', 'workspace-mode', 'mount-stage', 'mount-mode', 'mount-remove',
          'mount-reset', 'mount-apply',
        ].includes(url.pathname.slice('/api/'.length)));
      res.allowLocalPaths = pathFieldsAllowed;
      const authorization = req.headers.authorization || '';
      const candidate = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      const origin = req.headers.origin;
      const fetchSite = req.headers['sec-fetch-site'];
      const sourceValid = (!origin || origin === `http://${expectedHost}`)
        && (!fetchSite || fetchSite === 'same-origin' || fetchSite === 'none')
        && req.headers['x-console-request'] === 'desktop-commander-sandbox';
      if (!safeTokenEqual(candidate, token) || !sourceValid) {
        json(res, 403, { error: '本地会话无效或请求来源不匹配。请使用启动控制台的终端中显示的链接重新打开。' });
        return;
      }

      try {
        const changedExternally = await refreshExternalWorkspaceProfiles();
        if (changedExternally && req.method !== 'GET') {
          json(res, 409, { error: '工作区已被另一控制进程修改，当前草稿已重置。请检查最新清单后重试。' });
          return;
        }
      } catch (error) {
        json(res, 503, { error: error.message });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/status') {
        try {
          const status = await readProjectStatus();
          json(res, 200, { status, job: publicJob(latestJob), workspaceRevision });
        } catch (error) {
          json(res, 503, { error: `Docker 状态读取失败：${error.message}`, job: publicJob(latestJob) });
        }
        return;
      }

      if (req.method === 'GET' && ['/api/resources', '/api/resources/storage'].includes(url.pathname)) {
        if (url.search) {
          json(res, 400, { error: '资源查询不接受 URL 参数。' });
          return;
        }
        try {
          const result = url.pathname === '/api/resources'
            ? await readDeviceResources()
            : await readPersistentVolumeUsage();
          json(res, 200, result);
        } catch {
          json(res, 503, {
            error: url.pathname === '/api/resources'
              ? '暂时无法读取容器资源用量。'
              : '暂时无法读取持久化数据卷占用。',
          });
        }
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/workspaces') {
        try {
          const workspaces = await currentWorkspaceProfiles();
          json(res, 200, {
            workspaces,
            selectedWorkspace: WORKSPACE,
            selectionEnabled: !WORKSPACE_SELECTION_LOCKED,
          });
        } catch {
          json(res, 503, { error: '无法读取固定工作区目录。' });
        }
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/mounts') {
        json(res, 200, mountDraftResponse());
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/diagnostics') {
        try {
          json(res, 200, await runDiagnostics());
        } catch {
          json(res, 503, { error: '本机检查未能完成，请查看终端中的控制台状态后重试。' });
        }
        return;
      }

      if (req.method === 'POST' && ['workspace-select', 'workspace-create', 'workspace-create-pick', 'workspace-pick', 'workspace-main-pick', 'workspace-edit', 'workspace-delete', 'workspace-apply', 'workspace-cancel', 'workspace-mode', 'mount-stage', 'mount-mode', 'mount-remove', 'mount-reset', 'mount-apply'].includes(url.pathname.slice('/api/'.length))) {
        if (origin !== `http://${expectedHost}`) {
          json(res, 403, { error: '操作请求必须来自本机控制台页面。' });
          return;
        }
        try {
          const action = url.pathname.slice('/api/'.length);
          const body = await readSmallJsonBody(req, ['workspace-create', 'workspace-edit'].includes(action) ? 4096 : 128);
          if (action === 'workspace-create') {
            if (Object.keys(body).some((key) => !['workspace', 'folders'].includes(key))
              || typeof body.workspace !== 'string'
              || body.folders !== undefined && !Array.isArray(body.folders)) {
              throw new Error('新建工作区只接受名称和本机选择器生成的文件夹编号及权限。');
            }
            const result = await withProfileMutation(() => saveWorkspaceProfile(body.workspace, body.folders || []));
            json(res, 200, { ...result, workspaces: await currentWorkspaceProfiles(), mounts: mountDraftResponse() });
            return;
          }
          if (action === 'workspace-create-pick') {
            if (Object.keys(body).some((key) => key !== 'language')) throw new Error('新建工作区的系统文件夹选择不接受路径参数。');
            if (body.language !== undefined && !['en', 'zh'].includes(body.language)) throw new Error('系统文件夹选择器只接受中文或英文界面设置。');
            const selection = await pickWorkspaceDirectory(body.language || 'en', 'workspace-create');
            if (selection.cancelled) {
              json(res, 200, { cancelled: true });
              return;
            }
            json(res, 200, selection);
            return;
          }
          if (action === 'workspace-pick') {
            if (Object.keys(body).some((key) => !['language', 'workspace'].includes(key))) throw new Error('系统文件夹选择不接受路径参数。');
            if (body.language !== undefined && !['en', 'zh'].includes(body.language)) throw new Error('系统文件夹选择器只接受中文或英文界面设置。');
            let purpose = 'mount';
            if (body.workspace !== undefined) {
              if (!isWorkspaceName(body.workspace)) throw new Error('请选择有效的工作区。');
              const profiles = await currentWorkspaceProfiles();
              if (!profiles.some((profile) => profile.workspace === body.workspace)) throw new Error('找不到这个已保存的工作区。');
              purpose = 'workspace-edit-mount';
            }
            const selection = await pickWorkspaceDirectory(body.language || 'en', purpose, body.workspace);
            if (selection.cancelled) {
              json(res, 200, { cancelled: true });
              return;
            }
            json(res, 200, selection);
            return;
          }
          if (action === 'workspace-main-pick') {
            if (Object.keys(body).some((key) => !['language', 'workspace'].includes(key))
              || !isWorkspaceName(body.workspace)) throw new Error('系统文件夹选择只接受工作区编号和界面语言，不接受路径参数。');
            if (body.language !== undefined && !['en', 'zh'].includes(body.language)) throw new Error('系统文件夹选择器只接受中文或英文界面设置。');
            const profile = savedWorkspaceProfiles.workspaces[body.workspace];
            if (!profile) throw new Error('找不到这个已保存的工作区。');
            const selection = await pickWorkspaceDirectory(body.language || 'en', 'workspace-edit', body.workspace);
            json(res, 200, selection.cancelled ? selection : {
              selectionId: selection.selectionId,
              folderName: selection.folderName,
              localPath: selection.localPath,
              folderChanged: !pathsMatch(selection.localPath, profile.directory),
            });
            return;
          }
          if (action === 'workspace-edit') {
            const result = await withProfileMutation(() => editWorkspaceProfile(body));
            json(res, result.job ? 202 : 200, result);
            return;
          }
          if (action === 'workspace-delete') {
            if (Object.keys(body).length !== 1 || typeof body.workspace !== 'string') throw new Error('删除工作区只接受工作区编号。');
            const result = await withProfileMutation(() => deleteWorkspaceProfile(body.workspace));
            json(res, result.job ? 202 : 200, result);
            return;
          }
          if (action === 'workspace-cancel') {
            if (Object.keys(body).some((key) => key !== 'selectionId')
              || body.selectionId !== undefined && typeof body.selectionId !== 'string') {
              throw new Error('取消操作只接受系统选择器生成的临时编号。');
            }
            if (body.selectionId) pendingWorkspaceSelections.delete(body.selectionId);
            else pendingWorkspaceSelections.clear();
            json(res, 200, { cancelled: true });
            return;
          }
          if (action === 'mount-stage') {
            if (Object.keys(body).some((key) => !['selectionId', 'readOnly'].includes(key))) throw new Error('添加挂载只接受系统选择器生成的临时编号和访问权限，不接受路径。');
            if (activeJob && activeJob.kind !== 'start' || workspaceTransition) throw new Error('当前有设备操作或工作区切换，请完成后再添加。');
            json(res, 200, stageSelectedMount(body.selectionId, body.readOnly));
            return;
          }
          if (action === 'mount-mode') {
            if (Object.keys(body).some((key) => !['mountId', 'readOnly'].includes(key))) throw new Error('权限调整不接受路径或其他参数。');
            if (activeJob && activeJob.kind !== 'start' || workspaceTransition) throw new Error('当前有设备操作或工作区切换，请稍后再试。');
            json(res, 200, changeDraftMountMode(body.mountId, body.readOnly));
            return;
          }
          if (action === 'workspace-mode') {
            if (Object.keys(body).some((key) => key !== 'readOnly') || typeof body.readOnly !== 'boolean') throw new Error('工作区权限调整只接受只读或读写选项。');
            if (activeJob && activeJob.kind !== 'start' || workspaceTransition) throw new Error('当前有设备操作或工作区切换，请稍后再试。');
            DRAFT_WORKSPACE_READ_ONLY = body.readOnly;
            json(res, 200, mountDraftResponse());
            return;
          }
          if (action === 'mount-remove') {
            if (Object.keys(body).some((key) => key !== 'mountId')) throw new Error('移除挂载只接受清单条目标识。');
            if (activeJob && activeJob.kind !== 'start' || workspaceTransition) throw new Error('当前有设备操作或工作区切换，请稍后再试。');
            json(res, 200, removeDraftMount(body.mountId));
            return;
          }
          if (action === 'mount-reset') {
            if (Object.keys(body).length) throw new Error('撤销待应用更改不接受额外参数。');
            if (activeJob && activeJob.kind !== 'start' || workspaceTransition) throw new Error('当前有设备操作或工作区切换，请稍后再试。');
            json(res, 200, resetDraftMounts());
            return;
          }
          if (action === 'mount-apply') {
            if (Object.keys(body).length) throw new Error('应用挂载更改不接受路径、命令或项目名。');
            const result = await withProfileMutation(() => applyWorkspaceSelection({
              workspace: WORKSPACE,
              project: PROJECT,
              directory: WORKSPACE_DIR,
              display: WORKSPACE_DISPLAY,
              external: WORKSPACE_EXTERNAL,
            }, { readOnly: DRAFT_WORKSPACE_READ_ONLY, extraMounts: DRAFT_EXTRA_MOUNTS }));
            json(res, result.job ? 202 : 200, { ...result, mounts: mountDraftResponse() });
            return;
          }
          const allowedFields = new Set(['workspace', 'selectionId', 'readOnly']);
          if (Object.keys(body).some((key) => !allowedFields.has(key))
            || body.readOnly !== undefined && typeof body.readOnly !== 'boolean') {
            throw new Error('挂载确认只接受本机选择器返回的项目标识和只读/读写选项，不接受路径或项目名。');
          }
          if (mountsAreDirty()) throw new Error('请先应用或撤销额外挂载更改，再切换工作区。');
          let result;
          if (body.selectionId !== undefined) {
            if (Object.keys(body).some((key) => !['selectionId', 'readOnly'].includes(key))) throw new Error('系统选择结果不能与其他参数混用。');
            if (typeof body.readOnly !== 'boolean') throw new Error('请选择只读或读写权限。');
            const pendingSelection = pendingWorkspaceSelections.get(body.selectionId);
            if (!pendingSelection || Date.now() - pendingSelection.createdAt > 5 * 60 * 1000) {
              pendingWorkspaceSelections.delete(body.selectionId);
              throw new Error('文件夹选择已过期，请重新选择。');
            }
            try {
              result = await withProfileMutation(() => applyWorkspaceSelection(pendingSelection.selection, { readOnly: body.readOnly }));
            } finally {
              if (pendingWorkspaceSelections.get(body.selectionId) === pendingSelection) pendingWorkspaceSelections.delete(body.selectionId);
            }
          } else {
            if (typeof body.workspace !== 'string') throw new Error('请选择工作区。');
            if (action === 'workspace-pick' || action === 'workspace-main-pick' || action === 'workspace-cancel') throw new Error('此操作不接受工作区参数。');
            if (mountsAreDirty()) throw new Error('请先应用或撤销额外挂载更改，再切换工作区。');
            result = await withProfileMutation(() => switchWorkspace(body.workspace, { readOnly: body.readOnly ?? false }));
          }
          json(res, result.job ? 202 : 200, { ...result, workspaces: await currentWorkspaceProfiles(), mounts: mountDraftResponse() });
          return;
        } catch (error) {
          json(res, 409, { error: error.message });
          return;
        }
      }

      if (req.method === 'GET' && url.pathname === '/api/proxy') {
        json(res, 200, { mode: sessionProxyMode || 'project' });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/output') {
        const rawAfter = url.searchParams.get('after') || '0';
        const after = /^\d{1,12}$/.test(rawAfter) ? Number(rawAfter) : 0;
        const job = latestJob;
        json(res, 200, { job: publicJob(job), lines: job?.lines.filter((entry) => entry.sequence > after) || [] }, { allowRawLogText: true });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/logs') {
        try {
          const runId = url.searchParams.get('id');
          if (runId) json(res, 200, await readRunLog(runId), { allowRawLogText: true });
          else {
            const runs = await listRunLogs();
            json(res, 200, { runs, currentRunId: runs.find((run) => run.current)?.id || null });
          }
        } catch (error) {
          json(res, 404, { error: error.message || '无法读取本机运行日志。' });
        }
        return;
      }

      if (req.method === 'POST' && ['pull', 'build', 'start', 'stop', 'proxy'].includes(url.pathname.slice('/api/'.length))) {
        if (origin !== `http://${expectedHost}`) {
          json(res, 403, { error: '操作请求必须来自本机控制台页面。' });
          return;
        }
        try {
          const action = url.pathname.slice('/api/'.length);
          const body = await readSmallJsonBody(req, action === 'proxy' ? 2048 : 128);
          if (action === 'proxy') {
            if (Object.keys(body).some((key) => !['mode', 'proxyUrl'].includes(key))) {
              throw new Error('此设置不接受未识别的字段。');
            }
            if (body.mode === 'inherit' && !Object.hasOwn(body, 'proxyUrl')) {
              sessionProxyMode = undefined;
              sessionProxyConfig = undefined;
            } else if (body.mode === 'direct' && !Object.hasOwn(body, 'proxyUrl')) {
              sessionProxyMode = 'direct';
              sessionProxyConfig = { http: '', https: '' };
            } else if (body.mode === 'proxy' && Object.hasOwn(body, 'proxyUrl')) {
              const proxyUrl = proxyUrlForContainer(normalizeProxyUrl(body.proxyUrl));
              sessionProxyMode = 'manual';
              sessionProxyConfig = { http: proxyUrl, https: proxyUrl };
            } else if (body.mode === 'system' && !Object.hasOwn(body, 'proxyUrl')) {
              sessionProxyConfig = await readSystemProxy();
              sessionProxyMode = 'system';
            }
            else throw new Error('请选择代理地址、直连或使用项目配置。');
            json(res, 200, {
              mode: sessionProxyMode || 'project',
              proxyAvailable: Boolean(sessionProxyConfig?.http || sessionProxyConfig?.https),
            });
            return;
          }
          if (Object.keys(body).length !== 0) throw new Error('此操作不接受额外参数。');
          if (action === 'pull') {
            if (PRODUCT_VERSION.includes('-')) throw new Error('当前是开发版，尚无已发布镜像，请选择“从源码构建”。');
            const job = await spawnJob('pull', ['pull', 'remote-device']);
            json(res, 202, { job: publicJob(job) });
            return;
          }
          if (action === 'build') {
            if (sessionProxyMode === 'system') sessionProxyConfig = await readSystemProxy();
            const job = await spawnJob('build', ['build']);
            json(res, 202, { job: publicJob(job) });
            return;
          }
          if (action === 'start') {
            if (cliStartupPending) throw new Error('命令行正在启动设备，请稍后查看本次运行。');
            const job = await beginDeviceStart();
            json(res, 202, { job: publicJob(job) });
            return;
          }
          if (activeJob?.kind === 'start' && activeJob.child) {
            const startingJob = activeJob;
            startingJob.phase = 'stopping';
            await stopAttachedStartJob(startingJob);
            const stopJob = await spawnJob('stop', ['stop', '--timeout', '15']);
            json(res, 202, { job: publicJob(stopJob) });
            return;
          }
          const job = await spawnJob('stop', ['stop', '--timeout', '15']);
          json(res, 202, { job: publicJob(job) });
          return;
        } catch (error) {
          json(res, 409, { error: error.message });
          return;
        }
      }
      json(res, 404, { error: '未找到该本地操作。' });
      return;
    }

    if (req.method !== 'GET' || url.search || url.hash) {
      res.writeHead(404).end();
      return;
    }
    const file = staticContent.get(url.pathname);
    if (!file) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': file.contentType,
      'Content-Length': file.body.length,
    });
    res.end(file.body);
  });

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port;
      resolveListen();
    });
  });
  consoleServerActive = true;

  const url = `http://127.0.0.1:${port}/#session=${token}`;
  await writeFile(join(CONTROLLER_DIRECTORY, 'owner.json'), JSON.stringify({ pid: process.pid, url }), { mode: 0o600 });
  console.log(`Desktop Commander Sandbox console: ${url}`);
  console.log(`Project: ${PROJECT} · Press Ctrl+C to close the console`);
  if (openBrowser) openConsoleUrl(url);

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const stopRunningDevice = activeJob?.kind === 'start';
    if (latestJob?.closeTimer) clearTimeout(latestJob.closeTimer);
    const child = activeJob?.child || activePickerChild;
    if (child) {
      let completed = false;
      let forceExit;
      const finish = async () => {
        if (completed) return;
        completed = true;
        if (forceExit) clearTimeout(forceExit);
        if (stopRunningDevice) {
          await runComposeCapture(['stop', '--timeout', '15'], 20_000).catch(() => {});
        }
        server.close(async () => { await releaseController(); process.exit(0); });
      };
      const fallback = setTimeout(() => {
        if (activeJob?.child === child || activePickerChild === child) child.kill('SIGTERM');
        forceExit = setTimeout(() => {
          if (activeJob?.child === child || activePickerChild === child) child.kill('SIGKILL');
          finish();
        }, 5000);
        forceExit.unref();
      }, 5000);
      fallback.unref();
      child.once('close', () => {
        clearTimeout(fallback);
        finish();
      });
      child.kill('SIGINT');
      return;
    }
    server.close(async () => { await releaseController(); process.exit(0); });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.on('close', () => {
    if (latestJob) {
      latestJob.lines = [];
      latestJob.bytes = 0;
      if (latestJob.closeTimer) clearTimeout(latestJob.closeTimer);
    }
  });
  return url;
}

async function runForeground(args) {
  const child = spawn('docker', composeArgs(args), { cwd: ROOT, env: dockerEnvironment(), stdio: 'inherit' });
  child.once('error', (error) => {
    console.error(`Could not run Docker Compose: ${error.message}`);
    process.exitCode = 1;
  });
  child.once('close', (code) => { process.exitCode = code ?? 1; });
}

async function beginDeviceStart({ echoOutput = false } = {}) {
  return spawnJob('start', ['up', '--no-build', '--pull', 'never', '--remove-orphans', '--exit-code-from', 'remote-device'], { echoOutput });
}

async function runTerminalAction(action, { openBrowser = true } = {}) {
  if (action === 'pull') {
    if (PRODUCT_VERSION.includes('-')) throw new Error('Development versions have no published image. Use remote-device:build.');
    await runForeground(['pull', 'remote-device']);
    return;
  }
  if (action === 'build') {
    await checkMountDirectories();
    await prepareDefaultReference(EXTRA_MOUNTS);
    await runForeground(['build']);
    return;
  }
  cliStartupPending = true;
  const url = await startDashboard({ openBrowser: false });
  try {
    await beginDeviceStart({ echoOutput: true });
    if (openBrowser) openConsoleUrl(url);
  } finally {
    cliStartupPending = false;
  }
}

const terminalApi = {
  listWorkspaces: currentWorkspaceProfiles,
  validateNewWorkspaceName: (name) => {
    if (!isWorkspaceName(name) || name === DEFAULT_WORKSPACE) throw new Error('Choose a new lowercase workspace name, not default.');
  },
  validateLabel: cleanWorkspaceLabel,
  defaultPath: (name) => workspaceDirectory(WORKSPACE_ROOT, name),
  preparePath: prepareTerminalPath,
  refreshSelections: (ids) => {
    for (const id of ids) {
      const pending = pendingWorkspaceSelections.get(id);
      if (pending) pending.createdAt = Date.now();
    }
  },
  renderMounts: publicMounts,
  validatePlan: async (directory, readOnly, mounts) => {
    const selection = await identifyWorkspaceDirectory(WORKSPACE_ROOT, directory, { allowMissing: true });
    validateWritableWorkspaceBoundary(selection, readOnly);
    await validateAdditionalMounts(mounts, selection, { allowMissingDefault: true });
  },
  createWorkspace: (...args) => withProfileMutation(() => saveWorkspaceProfile(...args)),
  editWorkspace: (...args) => withProfileMutation(() => editWorkspaceProfile(...args)),
  switchWorkspace: (...args) => withProfileMutation(() => switchWorkspace(...args)),
  deleteWorkspace: (...args) => withProfileMutation(() => deleteWorkspaceProfile(...args)),
  resources: readDeviceResources,
  storage: readPersistentVolumeUsage,
  listLogs: listRunLogs,
  readLog: readRunLog,
  setProxy: async (mode, input) => {
    if (mode === 'project') {
      sessionProxyMode = undefined;
      sessionProxyConfig = undefined;
    } else if (mode === 'direct') {
      sessionProxyMode = 'direct';
      sessionProxyConfig = { http: '', https: '' };
    } else if (mode === 'system') {
      sessionProxyConfig = await readSystemProxy();
      sessionProxyMode = 'system';
    } else {
      const proxyUrl = proxyUrlForContainer(normalizeProxyUrl(input));
      sessionProxyMode = 'manual';
      sessionProxyConfig = { http: proxyUrl, https: proxyUrl };
    }
  },
  prepareStartMapping: async ({ main, mountRo, mountRw, readOnly, yes }) => {
    const selection = main
      ? await identifyWorkspaceDirectory(WORKSPACE_ROOT, main)
      : await identifyWorkspaceDirectory(WORKSPACE_ROOT, WORKSPACE_DIR, { allowMissing: true });
    selection.workspace = WORKSPACE;
    selection.label = WORKSPACE_PROFILE_LABEL;
    const finalReadOnly = readOnly ?? (main ? true : WORKSPACE_READ_ONLY);
    const mounts = mountRo.length || mountRw.length
      ? [...mountRo.map((directory) => ({ directory, readOnly: true })), ...mountRw.map((directory) => ({ directory, readOnly: false }))]
      : EXTRA_MOUNTS.map((mount) => ({ ...mount }));
    for (const mount of mounts) {
      if (mount.id) continue;
      const prepared = await prepareTerminalPath(mount.directory, 'start-mount', WORKSPACE);
      mount.id = prepared.mountId;
      mount.directory = prepared.directory;
    }
    validateWritableWorkspaceBoundary(selection, finalReadOnly);
    await validateAdditionalMounts(mounts, selection, { allowMissingDefault: true });
    printMapping(`Start device · workspace ${WORKSPACE}`, selection.directory, finalReadOnly, mounts, publicMounts);
    await confirmApply(yes, 'Start device with this mapping? [y/N] ');
    if (main || mountRo.length || mountRw.length || readOnly !== undefined) {
      await withProfileMutation(() => applyWorkspaceSelection(selection, { readOnly: finalReadOnly, extraMounts: mounts, allowLockedProject: true }));
    }
  },
  runAction: runTerminalAction,
  waitForRestart: async (result) => {
    if (!result.job) return;
    const job = latestJob;
    if (!job?.child) {
      if (job?.exitCode) process.exitCode = job.exitCode;
      return;
    }
    console.log('Following device output. Press Ctrl+C to stop this foreground session.');
    await new Promise((resolveClose) => job.child.once('close', resolveClose));
    await job.persistChain?.catch(() => {});
    if (job.exitCode) process.exitCode = job.exitCode;
  },
};

try {
  if (command === 'doctor') await runDoctor();
  else if (command === 'dashboard') {
    const existing = await acquireController();
    if (existing) {
      console.log(`Desktop Commander Sandbox console: ${existing}`);
      if (!process.argv.includes('--no-open')) openConsoleUrl(existing);
    } else await startDashboard({ openBrowser: !process.argv.includes('--no-open') });
  }
  else if (command === 'status') {
    const status = await readProjectStatus();
    console.log(`${status.project}: ${status.state}`);
    console.log(`Workspace: ${status.workspace}`);
    console.log(`Device image: ${status.imagesReady ? 'ready' : 'missing (run remote-device:build)'}`);
    for (const service of status.services) console.log(`- ${service.name}: ${service.status}${service.health ? ` / ${service.health}` : ''}`);
  } else if (command === 'start') {
    const existing = await acquireController();
    if (existing) throw new Error(`A controller is already running for this project: ${existing}`);
    await runTerminalCli(CLI_ARGS, terminalApi);
  } else if (['pull', 'build', 'workspace', 'mount', 'resources', 'storage', 'logs'].includes(command)) {
    let action;
    for (let index = 1; index < CLI_ARGS.length; index += 1) {
      const arg = CLI_ARGS[index];
      if (arg === '--project' || arg === '--workspace') { index += 1; continue; }
      if (arg.startsWith('--project=') || arg.startsWith('--workspace=')) continue;
      action = arg;
      break;
    }
    const mutatesDevice = ['build', 'pull'].includes(command)
      || command === 'workspace' && !['list', 'show'].includes(action)
      || command === 'mount' && action !== 'list';
    if (mutatesDevice && await activeControllerUrl()) {
      throw new Error('A controller is already running for this project. Use its web console for build, workspace, or mount changes.');
    }
    await runTerminalCli(CLI_ARGS, terminalApi);
  } else if (command === 'stop') {
    const existing = await activeControllerUrl();
    if (existing) await stopThroughController(existing);
    else await runForeground(['stop', '--timeout', '15']);
  } else printHelp({ project: PROJECT, workspace: WORKSPACE });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  if (!consoleServerActive) await releaseController();
}
