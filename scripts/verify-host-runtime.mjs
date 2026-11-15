import { randomBytes } from 'node:crypto';
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const IMAGE = `ghcr.io/xinnie-live/desktop-commander-sandbox:${JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version}`;
const MARKERS = {
  workspace: 'SYNTHETIC_WORKSPACE_MARKER',
  state: 'SYNTHETIC_DEVICE_STATE',
  toolHome: 'SYNTHETIC_TOOL_CONFIG',
};
const PROJECT = `rds-host-check-${process.pid}-${randomBytes(4).toString('hex')}`;
const LEGACY_CONTAINER = `${PROJECT}-legacy-service-1`;
const TEMP_BASE = process.platform === 'darwin' ? '/private/tmp' : tmpdir();
let COMPOSE_ROOT;
let OVERRIDE_FILE;
let LEGACY_OVERRIDE_FILE;
let composeRootCreated = false;
let environment;

function prepareHostEnvironment() {
  const env = {
    ...process.env,
    REMOTE_DEVICE_HTTP_PROXY: '',
    REMOTE_DEVICE_HTTPS_PROXY: '',
    REMOTE_DEVICE_NO_PROXY: 'localhost,127.0.0.1,::1,host.docker.internal',
    REMOTE_DEVICE_WORKSPACE: '',
    REMOTE_DEVICE_WORKSPACE_PATH: join(COMPOSE_ROOT, 'sandbox-workspace'),
    REMOTE_DEVICE_WORKSPACE_READ_ONLY: 'false',
    REMOTE_DEVICE_PROJECT: PROJECT,
  };
  if (process.platform === 'linux') {
    const gid = typeof process.getgid === 'function' ? process.getgid() : 0;
    if (!Number.isSafeInteger(gid) || gid < 1 || gid > 65_535) {
      throw new Error('This runtime check requires a non-root Linux user with a primary GID between 1 and 65535.');
    }
    env.REMOTE_DEVICE_WORKSPACE_GID = String(gid);
    env.REMOTE_DEVICE_DOCKER_GROUP_GID = String(gid);
  } else {
    env.REMOTE_DEVICE_WORKSPACE_GID = '';
    env.REMOTE_DEVICE_DOCKER_GROUP_GID = '10001';
  }
  return env;
}

function docker(args, { allowFailure = false, timeout = 90_000 } = {}) {
  const result = spawnSync('docker', args, {
    cwd: existsSync(COMPOSE_ROOT) ? COMPOSE_ROOT : ROOT,
    env: environment,
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error) throw new Error(`Docker command could not complete: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || '').trim().replace(/\s+/g, ' ').slice(-700);
    throw new Error(`Docker command failed with exit code ${result.status ?? 'unknown'}${detail ? `: ${detail}` : '.'}`);
  }
  return { status: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function compose(args, options) {
  return docker(['compose', '-p', PROJECT, '-f', join(COMPOSE_ROOT, 'compose.yaml'), '-f', OVERRIDE_FILE, ...args], options);
}

function legacyCompose(args, options) {
  return docker(['compose', '-p', PROJECT, '-f', join(COMPOSE_ROOT, 'compose.yaml'), '-f', OVERRIDE_FILE, '-f', LEGACY_OVERRIDE_FILE, ...args], options);
}

function prepareDirectories() {
  const tempBase = realpathSync(TEMP_BASE);
  COMPOSE_ROOT = mkdtempSync(join(tempBase, 'desktop-commander-sandbox-host-runtime-'));
  OVERRIDE_FILE = join(COMPOSE_ROOT, 'runtime-override.yaml');
  LEGACY_OVERRIDE_FILE = join(COMPOSE_ROOT, 'legacy-service.yaml');
  composeRootCreated = true;
  const root = realpathSync(COMPOSE_ROOT);
  if (!root.startsWith(`${tempBase}${sep}`)) throw new Error('Temporary Compose project escaped the operating-system temporary directory.');

  for (const relativePath of [
    'compose.yaml',
    'Dockerfile',
    '.dockerignore',
    'package.json',
    'package-lock.json',
  ]) {
    copyFileSync(join(ROOT, relativePath), join(COMPOSE_ROOT, relativePath));
  }
  mkdirSync(join(COMPOSE_ROOT, 'scripts'));
  mkdirSync(join(COMPOSE_ROOT, 'docker'));
  copyFileSync(join(ROOT, 'scripts', 'patch-upstream.mjs'), join(COMPOSE_ROOT, 'scripts', 'patch-upstream.mjs'));
  copyFileSync(join(ROOT, 'docker', 'drop_uid_exec.c'), join(COMPOSE_ROOT, 'docker', 'drop_uid_exec.c'));
  mkdirSync(join(COMPOSE_ROOT, 'sandbox-workspace'));
  if (process.platform === 'linux') {
    chmodSync(join(COMPOSE_ROOT, 'sandbox-workspace'), 0o2770);
  }

  const runtimeScript = [
    'set -eu',
    'test "$(id -u)" = 10001',
    'printf SYNTHETIC_WORKSPACE_MARKER > /workspace/workspace-marker.txt',
    'printf SYNTHETIC_DEVICE_STATE > /var/lib/remote-device/state-marker.txt',
    "/usr/local/bin/drop-uid-exec -- /bin/sh -c 'printf SYNTHETIC_TOOL_CONFIG > /home/tool/tool-marker.txt'",
    'test ! -e /var/run/docker.sock',
    'test ! -e /Users',
    'sleep 300',
  ].join('\n');
  const override = [
    'services:',
    '  remote-device:',
    '    network_mode: none',
    '    entrypoint: ["/bin/sh"]',
    '    command:',
    '      - -c',
    '      - |-',
      ...runtimeScript.split('\n').map((line) => `        ${line}`),
    '',
  ].join('\n');
  writeFileSync(OVERRIDE_FILE, override);

  const legacyOverride = [
    'services:',
    '  legacy-service:',
    `    container_name: ${LEGACY_CONTAINER}`,
    `    image: ${IMAGE}`,
    '    network_mode: none',
    '    init: true',
    '    restart: "no"',
    '    logging:',
    '      driver: none',
    '    entrypoint: ["/bin/sh", "-c"]',
    '    command: ["sleep 300"]',
    '',
  ].join('\n');
  writeFileSync(LEGACY_OVERRIDE_FILE, legacyOverride);
}

function ensureRunningContainerHasMarkers(containerId) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const check = docker(['exec', containerId, 'test', '-f', '/var/lib/remote-device/state-marker.txt'], { allowFailure: true });
    if (check.status === 0) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  throw new Error('The isolated service did not write its synthetic state markers.');
}

function checkToolVolume(containerId) {
  const result = docker(['exec', containerId, '/usr/local/bin/drop-uid-exec', '--', '/bin/sh', '-c', `test "$(cat /home/tool/tool-marker.txt)" = ${MARKERS.toolHome}`], { allowFailure: true });
  if (result.status !== 0) throw new Error('The synthetic tool-home marker is missing.');
}

function assertVolumeExists(name) {
  docker(['volume', 'inspect', name]);
}

function runLifecycleChecks() {
  docker(['image', 'inspect', IMAGE]);

  legacyCompose(['up', '--detach', '--no-build', '--pull', 'never']);
  compose(['up', '--detach', '--no-build', '--pull', 'never', '--remove-orphans', 'remote-device']);
  const services = docker(['container', 'ls', '--all', '--filter', `label=com.docker.compose.project=${PROJECT}`, '--format', '{{.Label "com.docker.compose.service"}}']);
  const serviceNames = services.stdout.trim().split(/\r?\n/).filter(Boolean).sort();
  if (serviceNames.join(',') !== 'remote-device') {
    throw new Error(`Compose did not leave exactly the fixed remote-device service after removing the Compose-created synthetic orphan: ${serviceNames.join(',') || 'none'}`);
  }

  const containerId = compose(['ps', '-q', 'remote-device']).stdout.trim();
  if (!containerId) throw new Error('Compose did not create the shell-only runtime-check container.');
  const stateVolumes = [`${PROJECT}_device-state`, `${PROJECT}_tool-config`];
  ensureRunningContainerHasMarkers(containerId);
  checkToolVolume(containerId);
  const workspaceMarker = readFileSync(join(COMPOSE_ROOT, 'sandbox-workspace', 'workspace-marker.txt'), 'utf8').trim();
  if (workspaceMarker !== MARKERS.workspace) throw new Error('The synthetic workspace marker did not reach the host directory.');

  compose(['stop', '--timeout', '5', 'remote-device']);
  const stopped = docker(['inspect', '--format', '{{.State.Status}}', containerId]).stdout.trim();
  if (stopped !== 'exited') throw new Error(`Expected the shell-only service to be stopped, got ${stopped || 'unknown'}.`);
  for (const volume of stateVolumes) assertVolumeExists(volume);

  const restoreScript = [
    'set -eu',
    `test "$(cat /workspace/workspace-marker.txt)" = ${MARKERS.workspace}`,
    `test "$(cat /var/lib/remote-device/state-marker.txt)" = ${MARKERS.state}`,
    `/usr/local/bin/drop-uid-exec -- /bin/sh -c 'test "$(cat /home/tool/tool-marker.txt)" = ${MARKERS.toolHome}'`,
  ].join('; ');
  compose(['run', '--rm', '--no-deps', '--entrypoint', '/bin/sh', 'remote-device', '-c', restoreScript]);

  compose(['down', '--remove-orphans']);
  for (const volume of stateVolumes) assertVolumeExists(volume);
  console.log('PASS host Compose lifecycle: synthetic orphan removed; workspace mount verified; stop/down preserved both named volumes.');
}

function cleanup() {
  if (environment && composeRootCreated) {
    try {
      legacyCompose(['down', '--volumes', '--remove-orphans'], { timeout: 30_000 });
    } catch {
      // Continue removing only this test's uniquely named orphan and directory.
    }
  }
  if (environment && COMPOSE_ROOT) docker(['rm', '--force', LEGACY_CONTAINER], { allowFailure: true, timeout: 15_000 });
  if (composeRootCreated && existsSync(COMPOSE_ROOT)) rmSync(COMPOSE_ROOT, { recursive: true, force: true });
}

function main() {
  try {
    prepareDirectories();
    environment = prepareHostEnvironment();
    runLifecycleChecks();
  } finally {
    cleanup();
  }
}

try {
  main();
} catch (error) {
  console.error(`Host runtime check failed: ${error.message}`);
  process.exitCode = 1;
}
