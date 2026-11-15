import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const productVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const result = spawnSync('docker', ['compose', 'config', '--format', 'json'], {
  cwd: root,
  env: {
    ...process.env,
    REMOTE_DEVICE_WORKSPACE_PATH: path.join(root, 'sandbox-workspace', 'default', 'work'),
    REMOTE_DEVICE_WORKSPACE_READ_ONLY: 'false',
  },
  encoding: 'utf8',
  timeout: 15_000,
});
if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const config = JSON.parse(result.stdout);
function validate(candidate) {
  const failures = [];
  const expect = (condition, message) => { if (!condition) failures.push(message); };
  const service = candidate.services?.['remote-device'];

  expect(Boolean(service), 'remote-device service is missing');
  if (!service) return failures;
  expect(Object.keys(candidate.services ?? {}).length === 1, 'compose must contain only the remote-device service');
  expect(service.image === `ghcr.io/xinnie-live/desktop-commander-sandbox:${productVersion}`, `the fixed product image tag must match package.json (${productVersion})`);
  const buildArgs = service.build?.args ?? {};
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY']) {
    expect(typeof buildArgs[key] === 'string', `optional ${key} build proxy argument must be configured`);
  }
  expect(
    service.build?.extra_hosts?.some((entry) => entry === 'host.docker.internal=host-gateway' || entry === 'host.docker.internal:host-gateway'),
    'build steps must resolve host.docker.internal through the Docker host gateway',
  );
  expect(Object.keys(candidate.networks ?? {}).every((name) => name === 'default'), 'only the Compose default network may be defined');
  expect(!candidate.networks?.default?.driver || candidate.networks.default.driver === 'bridge', 'the default network must use the bridge driver');

  expect(service.privileged !== true, 'privileged mode must remain disabled');
  expect(!service.user || service.user === '10001:10001', 'Remote Device must not run as root or another overridden user');
  expect(service.read_only === true, 'container root filesystem must be read-only');
  expect(service.logging?.driver === 'none', 'container logs must not persist transient authorization codes or credentials');
  expect(!service.security_opt?.some((value) => /no-new-privileges\s*[=:]\s*(?:true|1|yes)/i.test(value)), 'no-new-privileges must stay disabled so the fixed SUID helper can run');
  expect(service.network_mode === undefined, 'host networking must remain disabled for cross-platform compatibility');
  expect(Object.keys(service.networks ?? {}).every((name) => name === 'default'), 'remote-device must use only the default bridge network');
  expect(service.networks?.default === null || typeof service.networks?.default === 'object', 'remote-device must be attached to the Compose default network');
  expect(service.depends_on === undefined, 'single-container service must not depend on another Compose service');
  expect(service.pid !== 'host', 'host PID namespace is forbidden');
  expect(!service.ports?.length, 'published host ports are not expected');
  expect(service.environment?.DESKTOP_COMMANDER_DISABLE_TELEMETRY === '1', 'Desktop Commander telemetry must be disabled');
  expect(service.environment?.NODE_USE_ENV_PROXY === '1', 'Node environment proxy support must be enabled for optional user proxy settings');
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) {
    expect(typeof service.environment?.[key] === 'string', `${key} must be an optional string environment setting`);
  }
  expect(service.environment?.NO_PROXY?.includes('host.docker.internal'), 'NO_PROXY must include the cross-platform host gateway alias');
  expect(service.environment?.['ALL_PROXY'] === undefined && service.environment?.['all_proxy'] === undefined, 'unsupported ALL_PROXY settings must not be advertised');
  expect(service.extra_hosts?.includes('host.docker.internal=host-gateway'), 'host.docker.internal must resolve through the host-gateway mapping');
  const workspaceGid = Number(service.group_add?.[0]);
  expect(service.group_add?.length === 1, 'only the workspace access group may be added');
  expect(Number.isInteger(workspaceGid) && workspaceGid >= 1 && workspaceGid <= 65_535, 'workspace supplementary GID must be a non-root bounded numeric group');
  const mountedWorkspaceGid = service.environment?.REMOTE_DEVICE_WORKSPACE_GID || '';
  expect(mountedWorkspaceGid === '' || (/^\d+$/.test(mountedWorkspaceGid) && Number(mountedWorkspaceGid) >= 1 && Number(mountedWorkspaceGid) <= 65_535), 'workspace group environment must be empty or a non-root bounded numeric GID');
  expect(mountedWorkspaceGid ? Number(mountedWorkspaceGid) === workspaceGid : workspaceGid === 10001, 'host and tool workspace GIDs must match, with no added group on non-Linux defaults');
  const composeText = fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8');
  expect(composeText.includes('HTTP_PROXY: ${REMOTE_DEVICE_HTTP_PROXY:-}'), 'HTTP proxy must be optional and default to empty');
  expect(composeText.includes('HTTPS_PROXY: ${REMOTE_DEVICE_HTTPS_PROXY:-}'), 'HTTPS proxy must be optional and default to empty');
  expect(composeText.includes('args:\n        HTTP_PROXY: ${REMOTE_DEVICE_HTTP_PROXY:-}'), 'build must receive the same optional HTTP proxy setting as runtime');
  expect(composeText.includes('HTTPS_PROXY: ${REMOTE_DEVICE_HTTPS_PROXY:-}'), 'build must receive the same optional HTTPS proxy setting as runtime');
  expect(composeText.includes('host.docker.internal:host-gateway'), 'build must receive the host-gateway alias for optional host proxy access');
  expect(composeText.includes('REMOTE_DEVICE_NO_PROXY:-localhost,127.0.0.1,::1,host.docker.internal'), 'NO_PROXY must preserve safe local defaults when no bypass list is supplied');
  expect(composeText.includes('REMOTE_DEVICE_DOCKER_GROUP_GID:-10001'), 'Compose must default to the device primary group without extra privileges');
  expect(composeText.includes('source: ${REMOTE_DEVICE_WORKSPACE_PATH:-./sandbox-workspace/default/work}'), 'workspace bind source must come from the fixed path variable selected by the trusted local controller');
  expect(!/127\.0\.0\.1:\d{2,5}/.test(composeText), 'application proxy endpoint must not be tied to a host loopback port');
  expect(service.cap_drop?.includes('ALL'), 'all capabilities must be dropped first');
  expect(
    JSON.stringify([...(service.cap_add ?? [])].sort()) === JSON.stringify(['SETGID', 'SETUID']),
    'only SETUID and SETGID may be added for the fixed identity transition',
  );

  const volumes = service.volumes ?? [];
  const mounts = new Map(volumes.map((volume) => [volume.target, volume]));
  const workspace = mounts.get('/workspace');
  const deviceState = mounts.get('/var/lib/remote-device');
  const toolHome = mounts.get('/home/tool');

  expect(workspace?.type === 'bind' && (workspace.read_only === undefined || typeof workspace.read_only === 'boolean'), 'the explicit workspace bind mount must use a user-selected read-only or read-write mode');
  const workspaceSource = typeof workspace?.source === 'string' ? path.resolve(workspace.source) : '';
  const expectedWorkspaceSource = path.join(root, 'sandbox-workspace', 'default', 'work');
  expect(workspaceSource === expectedWorkspaceSource, 'workspace source must match the one explicitly selected local folder');
  expect(workspace?.bind?.create_host_path === false, 'workspace source must exist before Compose starts; implicit creation is forbidden');
  for (const [name, source] of [['workspace', workspace?.source]]) {
    if (typeof source !== 'string') continue;
    let current = path.resolve(source);
    while (true) {
      if (fs.existsSync(current) && fs.realpathSync(current) !== current) {
        expect(false, `${name} source contains a symlink component: ${current}`);
        break;
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  expect(deviceState?.type === 'volume' && deviceState.source === 'device-state', 'device credentials must use the private named volume');
  expect(toolHome?.type === 'volume' && toolHome.source === 'tool-config', 'tool home must use the existing tool-config named volume');
  expect(volumes.length === 3, 'unexpected mount detected');

  for (const volume of volumes) {
    expect(!volume.source?.includes('docker.sock'), 'Docker Socket mount is forbidden');
    expect(volume.target !== '/' && !volume.target.startsWith('/Users/'), 'host root/home targets are forbidden');
  }
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  expect(!/^\s*(?:ARG|ENV)\s+(?:HTTP_PROXY|HTTPS_PROXY|NO_PROXY)\b/im.test(dockerfile), 'BuildKit proxy arguments must not be referenced in the Dockerfile');
  expect(/\bUSER\s+10001:10001\b/.test(dockerfile), 'image must run the Remote Device as UID/GID 10001');
  expect(dockerfile.includes('gcc:12-bookworm@sha256:5b83b2851a74d87a3ebf35dc04f16ea1540aff7538b0688b0c9fcd7a407c24a4'), 'helper build must use a pinned multi-platform GCC manifest');
  expect(dockerfile.includes('node:22.21.0-bookworm-slim@sha256:f9f7f95dcf1f007b007c4dcd44ea8f7773f931b71dc79d57c216e731c87a090b'), 'Remote Device image must use the pinned multi-platform Node manifest');
  return failures;
}

const failures = validate(config);

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}
console.log('PASS compose policy shape (static config only; no container was started)');
if (process.argv.includes('--self-test')) {
  const readOnlyWorkspace = spawnSync('docker', ['compose', '-f', path.join(root, 'compose.yaml'), '-p', 'workspace-readonly-self-test', 'config', '--format', 'json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
    env: {
      ...process.env,
      REMOTE_DEVICE_WORKSPACE_PATH: path.join(root, 'sandbox-workspace', 'default', 'work'),
      REMOTE_DEVICE_WORKSPACE_READ_ONLY: 'true',
    },
  });
  if (readOnlyWorkspace.error) throw readOnlyWorkspace.error;
  if (readOnlyWorkspace.status !== 0
    || JSON.parse(readOnlyWorkspace.stdout).services['remote-device'].volumes.find((volume) => volume.target === '/workspace')?.read_only !== true) {
    throw new Error('Compose did not enforce the selected read-only mode for /workspace.');
  }
  console.log('PASS Compose enforces the selected read-only mode for /workspace');

  const cases = [
    ['privileged mode', (candidate) => { candidate.services['remote-device'].privileged = true; }],
    ['root user override', (candidate) => { candidate.services['remote-device'].user = '0:0'; }],
    ['persistent container logs', (candidate) => { candidate.services['remote-device'].logging = { driver: 'json-file' }; }],
    ['host networking enabled', (candidate) => { candidate.services['remote-device'].network_mode = 'host'; }],
    ['host PID namespace', (candidate) => { candidate.services['remote-device'].pid = 'host'; }],
    ['wide workspace source', (candidate) => { candidate.services['remote-device'].volumes.find((v) => v.target === '/workspace').source = '/'; }],
    ['workspace path traversal', (candidate) => {
      candidate.services['remote-device'].volumes.find((v) => v.target === '/workspace').source = path.join(root, 'sandbox-workspace/../..');
    }],
    ['implicit workspace directory creation', (candidate) => {
      candidate.services['remote-device'].volumes.find((v) => v.target === '/workspace').bind.create_host_path = true;
    }],
    ['extra capability', (candidate) => { candidate.services['remote-device'].cap_add.push('SYS_ADMIN'); }],
    ['Docker Socket mount', (candidate) => { candidate.services['remote-device'].volumes.push({ type: 'bind', source: '/var/run/docker.sock', target: '/var/run/docker.sock' }); }],
    ['telemetry enabled', (candidate) => { candidate.services['remote-device'].environment.DESKTOP_COMMANDER_DISABLE_TELEMETRY = '0'; }],
    ['SUID helper blocked by no-new-privileges', (candidate) => { candidate.services['remote-device'].security_opt = ['no-new-privileges:true']; }],
    ['extra Compose service', (candidate) => { candidate.services['unexpected-service'] = { image: 'example.invalid/test' }; }],
    ['custom network', (candidate) => { candidate.services['remote-device'].networks = { bridge: null }; }],
    ['host as default network driver', (candidate) => { candidate.networks.default.driver = 'host'; }],
    ['published host port', (candidate) => { candidate.services['remote-device'].ports = ['8080:8080']; }],
    ['missing optional proxy support', (candidate) => { delete candidate.services['remote-device'].environment.NODE_USE_ENV_PROXY; }],
    ['missing build-time HTTPS proxy support', (candidate) => { delete candidate.services['remote-device'].build.args.HTTPS_PROXY; }],
    ['missing build-time host gateway mapping', (candidate) => { candidate.services['remote-device'].build.extra_hosts = []; }],
    ['root workspace supplementary group', (candidate) => { candidate.services['remote-device'].group_add = ['0']; }],
    ['mismatched workspace mount group', (candidate) => { candidate.services['remote-device'].environment.REMOTE_DEVICE_WORKSPACE_GID = '23456'; }],
  ];
  for (const [name, change] of cases) {
    const candidate = structuredClone(config);
    change(candidate);
    if (!validate(candidate).length) throw new Error(`validator did not reject ${name}`);
    console.log(`PASS validator rejects ${name}`);
  }

  const syntheticProxy = spawnSync('docker', ['compose', '-f', path.join(root, 'compose.yaml'), '-p', 'proxy-config-self-test', 'config', '--format', 'json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
    env: {
      ...process.env,
      REMOTE_DEVICE_HTTP_PROXY: 'http://synthetic-user:synthetic-pass@proxy.invalid:18080',
      REMOTE_DEVICE_HTTPS_PROXY: 'http://synthetic-user:synthetic-pass@proxy.invalid:18081',
      REMOTE_DEVICE_NO_PROXY: 'localhost,.example.invalid',
      REMOTE_DEVICE_WORKSPACE_PATH: path.join(root, 'sandbox-workspace', 'default', 'work'),
      REMOTE_DEVICE_WORKSPACE_READ_ONLY: 'false',
    },
  });
  if (syntheticProxy.error) throw syntheticProxy.error;
  if (syntheticProxy.status !== 0) throw new Error('Compose could not resolve the synthetic build proxy configuration.');
  const syntheticService = JSON.parse(syntheticProxy.stdout).services['remote-device'];
  const syntheticArgs = syntheticService.build?.args ?? {};
  if (syntheticArgs.HTTP_PROXY !== 'http://synthetic-user:synthetic-pass@proxy.invalid:18080'
    || syntheticArgs.HTTPS_PROXY !== 'http://synthetic-user:synthetic-pass@proxy.invalid:18081'
    || syntheticArgs.NO_PROXY !== 'localhost,.example.invalid') {
    throw new Error('Compose did not pass the synthetic proxy settings to the build arguments.');
  }
  console.log('PASS Compose forwards synthetic optional proxy settings to build arguments');
}
