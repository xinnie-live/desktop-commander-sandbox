import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { afterEach, test } from 'node:test';
import { request as httpRequest } from 'node:http';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONSOLE = resolve(ROOT, 'scripts/console.mjs');
const TEST_WORKSPACE = `console-test-${randomBytes(5).toString('hex')}`;
const CREATED_WORKSPACE = `console-created-${randomBytes(5).toString('hex')}`;
const TEST_WORKSPACE_ROOT = resolve(ROOT, 'sandbox-workspace');
let syntheticSelectedPath;
let child;
let address;
let sessionToken;
let testConfigHome;
let syntheticPickerPaths = [];

async function startConsole({ pickerFolderNames = [] } = {}) {
  testConfigHome = await mkdtemp(join(tmpdir(), 'rds-console-config-'));
  syntheticSelectedPath = join(testConfigHome, 'private-synthetic-folder');
  const configDirectory = join(testConfigHome, 'desktop-commander-sandbox');
  await mkdir(configDirectory, { recursive: true });
  await writeFile(join(configDirectory, 'workspace-profiles.json'), `${JSON.stringify({
    version: 1,
    activeWorkspace: TEST_WORKSPACE,
    deviceProject: `remote-device-${TEST_WORKSPACE}`,
    workspaces: {
      [TEST_WORKSPACE]: {
        label: 'Synthetic external workspace',
        directory: syntheticSelectedPath,
        readOnly: true,
        mounts: [],
      },
    },
  })}\n`);
  await mkdir(TEST_WORKSPACE_ROOT).catch((error) => {
    if (error.code !== 'EEXIST') throw error;
  });
  const workspaceRootInfo = await lstat(TEST_WORKSPACE_ROOT);
  if (!workspaceRootInfo.isDirectory() || workspaceRootInfo.isSymbolicLink() || await realpath(TEST_WORKSPACE_ROOT) !== TEST_WORKSPACE_ROOT) {
    throw new Error('Test workspace root must be a project-local real directory.');
  }
  await mkdir(resolve(TEST_WORKSPACE_ROOT, TEST_WORKSPACE));
  const env = { ...process.env };
  env.REMOTE_DEVICE_SANDBOX_CONFIG_HOME = testConfigHome;
  env.REMOTE_DEVICE_SANDBOX_LOG_HOME = join(testConfigHome, 'test-logs');
  syntheticPickerPaths = [];
  if (pickerFolderNames.length && process.platform !== 'win32') {
    const pickerBin = join(testConfigHome, 'fake-picker-bin');
    await mkdir(pickerBin);
    syntheticPickerPaths = pickerFolderNames.map((name) => join(testConfigHome, name));
    for (const directory of syntheticPickerPaths) await mkdir(directory, { recursive: true, mode: 0o770 });
    const selectionList = join(testConfigHome, 'synthetic-picker-selections.txt');
    const selectionIndex = join(testConfigHome, 'synthetic-picker-index.txt');
    await writeFile(selectionList, `${syntheticPickerPaths.join('\n')}\n`);
    await writeFile(selectionIndex, '1\n');
    const executable = join(pickerBin, process.platform === 'darwin' ? 'osascript' : 'zenity');
    const pickerScript = [
      '#!/bin/sh',
      'set -eu',
      'index="$(cat "$RDS_TEST_PICKER_INDEX")"',
      'selected="$(sed -n "${index}p" "$RDS_TEST_PICKER_LIST")"',
      'printf \'%s\\n\' "$selected"',
      'printf \'%s\\n\' "$((index + 1))" > "$RDS_TEST_PICKER_INDEX"',
      '',
    ].join('\n');
    await writeFile(executable, pickerScript);
    await chmod(executable, 0o700);
    env.RDS_TEST_PICKER_LIST = selectionList;
    env.RDS_TEST_PICKER_INDEX = selectionIndex;
    env.PATH = `${pickerBin}:${env.PATH || ''}`;
  }
  delete env.REMOTE_DEVICE_PROJECT;
  delete env.REMOTE_DEVICE_WORKSPACE;
  child = spawn(process.execPath, [CONSOLE, 'dashboard', '--no-open', '--workspace', TEST_WORKSPACE], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  return new Promise((resolveStart, rejectStart) => {
    let output = '';
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Local console did not start within the expected time.')), 10_000);
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectStart(error);
      else resolveStart(result);
    };

    child.once('error', () => finish(new Error('Could not start the local console process.')));
    child.once('close', () => finish(new Error('Local console exited before it was ready.')));
    child.stdout.on('data', (chunk) => {
      output = `${output}${chunk.toString('utf8')}`.slice(-2048);
      const match = output.match(/http:\/\/127\.0\.0\.1:(\d+)\/#session=([A-Za-z0-9_-]+)/);
      if (match) finish(null, { port: Number(match[1]), token: match[2] });
    });
  });
}

function sendRequest(port, path, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolveResponse, rejectResponse) => {
    const req = httpRequest({
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: { ...(body ? { 'content-length': Buffer.byteLength(body) } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.once('end', () => resolveResponse({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.once('error', rejectResponse);
    if (body) req.write(body);
    req.end();
  });
}

function sessionHeaders(origin) {
  return {
    authorization: `Bearer ${sessionToken}`,
    'x-console-request': 'desktop-commander-sandbox',
    ...(origin ? { origin } : {}),
  };
}

async function stopConsole() {
  if (child && child.exitCode === null && child.signalCode === null) {
    const runningChild = child;
    const closed = new Promise((resolveClose) => runningChild.once('close', resolveClose));
    runningChild.kill('SIGTERM');
    let timeout;
    const graceful = await Promise.race([
      closed.then(() => true),
      new Promise((resolveTimeout) => { timeout = setTimeout(() => resolveTimeout(false), 5_000); }),
    ]);
    clearTimeout(timeout);
    if (!graceful && runningChild.exitCode === null && runningChild.signalCode === null) {
      runningChild.kill('SIGKILL');
      await closed;
    }
  }
  for (const name of [TEST_WORKSPACE, CREATED_WORKSPACE]) {
    const directory = resolve(TEST_WORKSPACE_ROOT, name);
    const details = await lstat(directory).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
    if (details?.isDirectory() && !details.isSymbolicLink() && await realpath(directory) === directory) {
      await rm(directory, { recursive: true, force: true });
    }
  }
  if (testConfigHome) await rm(testConfigHome, { recursive: true, force: true });
  testConfigHome = null;
  child = null;
}

afterEach(stopConsole);

test('local console enforces its browser/API boundary without starting Docker actions', async () => {
  ({ port: address, token: sessionToken } = await startConsole({
    pickerFolderNames: ['picked-main', 'picked-extra-write', 'picked-extra-read', 'edited-extra-one', 'edited-extra-two', 'edit-binding-check'],
  }));
  const origin = `http://127.0.0.1:${address}`;

  const page = await sendRequest(address, '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /id="language-toggle"/);
  assert.match(page.body, /type="module" src="\/app.js"/);
  assert.match(page.headers['content-security-policy'], /default-src 'self'/);
  assert.doesNotMatch(page.headers['content-security-policy'], /unsafe-inline|unsafe-eval/);
  assert.match(page.body, /第 1 步：准备镜像（下载或源码构建，二选一）。完成后再启动设备。/);
  assert.match(page.body, /有 Docker 权限的本机用户可在容器配置中查看地址/);
  assert.match(page.body, /正在运行的容器不会因此改变/);
  assert.match(page.body, /选择已保存的文件夹组合，或在弹窗中管理工作区/);
  assert.match(page.body, /切换工作区会恢复该工作区保存的文件夹和权限；设备登录状态沿用/);
  assert.match(page.body, /id="authorization-dialog"/);
  assert.match(page.body, /id="logs-dialog"/);
  assert.match(page.body, /id="diagnostics-dialog"/);
  assert.doesNotMatch(page.body, /id="diagnostics-button"/);
  assert.match(page.body, /id="workspace-create-status"/);
  assert.match(page.body, /保存工作区/);
  assert.match(page.body, /id="build-button"[^>]*hidden/);
  assert.match(page.body, /id="start-button"[^>]*hidden/);
  assert.match(page.body, /id="stop-button"[^>]*hidden/);
  assert.match(page.body, /id="workspace-edit-button"/);
  assert.match(page.body, /id="workspace-delete-button"/);
  assert.match(page.body, /id="resource-details-dialog"/);
  assert.match(page.body, /id="resource-metrics"/);
  assert.match(page.body, /id="storage-breakdown"/);
  assert.match(page.body, /id="logs-open-button"/);
  assert.match(page.body, /id="logs-dialog"/);
  assert.match(page.body, /id="connectivity-dialog"/);
  assert.match(page.body, /class="dashboard-grid"/);
  assert.match(page.body, /class="theme-icon-sun"/);
  assert.match(page.body, /class="theme-icon-moon"/);
  assert.ok(page.body.indexOf('id="build-button"') < page.body.indexOf('id="start-button"'));

  const languageModule = await sendRequest(address, '/i18n.mjs');
  assert.equal(languageModule.status, 200);
  assert.match(languageModule.body, /detectLanguage/);
  const authorizationModule = await sendRequest(address, '/authorization-url.mjs');
  assert.equal(authorizationModule.status, 200);
  assert.match(authorizationModule.body, /isSupportedAuthorizationUrl/);
  const uiFormatModule = await sendRequest(address, '/ui-format.mjs');
  assert.equal(uiFormatModule.status, 200);
  assert.match(uiFormatModule.body, /formatMountAccessSummary/);

  const diagnosticsResponse = await sendRequest(address, '/api/diagnostics', {
    headers: sessionHeaders(`http://127.0.0.1:${address}`),
  });
  assert.equal(diagnosticsResponse.status, 200);
  const diagnostics = JSON.parse(diagnosticsResponse.body);
  assert.deepEqual(diagnostics.checks.map((check) => check.id), [
    'node', 'docker-cli', 'compose', 'engine', 'compose-config', 'image', 'device', 'mounts', 'workspace', 'network',
  ]);
  assert.equal(diagnostics.checks.find((check) => check.id === 'network').action, '此处只显示代理设置；本机控制台无法读取云端连接状态。');
  assert.ok(!diagnosticsResponse.body.includes(syntheticSelectedPath), diagnosticsResponse.body);
  assert.ok(!diagnosticsResponse.body.includes(ROOT));

  const resourceQueryInjection = await sendRequest(address, '/api/resources?container=anything', {
    headers: sessionHeaders(origin),
  });
  assert.equal(resourceQueryInjection.status, 400);
  assert.match(JSON.parse(resourceQueryInjection.body).error, /不接受 URL 参数/);
  const storageQueryInjection = await sendRequest(address, '/api/resources/storage?path=/tmp', {
    headers: sessionHeaders(origin),
  });
  assert.equal(storageQueryInjection.status, 400);
  assert.match(JSON.parse(storageQueryInjection.body).error, /不接受 URL 参数/);

  const workspacesResponse = await sendRequest(address, '/api/workspaces', {
    headers: sessionHeaders(origin),
  });
  assert.equal(workspacesResponse.status, 200);
  const workspaceData = JSON.parse(workspacesResponse.body);
  assert.equal(workspaceData.selectedWorkspace, TEST_WORKSPACE);
  assert.equal(workspaceData.selectionEnabled, true);
  const externalProfile = workspaceData.workspaces.find((item) => item.workspace === TEST_WORKSPACE);
  assert.equal(externalProfile.project, `remote-device-${TEST_WORKSPACE}`);
  assert.equal(externalProfile.folderName, 'private-synthetic-folder');
  assert.equal(externalProfile.localPath, syntheticSelectedPath);
  assert.equal(Object.hasOwn(externalProfile, 'directory'), false);
  // Workspace management intentionally returns full local paths to the
  // authenticated loopback console so users can verify each host/container
  // mapping. Keep the internal `directory` field private.
  assert.ok(workspaceData.workspaces.every((item) => typeof item.localPath === 'string' && isAbsolute(item.localPath)));
  assert.ok(workspaceData.workspaces.every((item) => !Object.hasOwn(item, 'directory')));

  const mountsResponse = await sendRequest(address, '/api/mounts', { headers: sessionHeaders(origin) });
  assert.equal(mountsResponse.status, 200);
  assert.deepEqual(JSON.parse(mountsResponse.body).draft, []);

  const rawPickerPath = await sendRequest(address, '/api/workspace-pick', {
    method: 'POST',
    headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
    body: JSON.stringify({ path: '/tmp/not-opened' }),
  });
  assert.equal(rawPickerPath.status, 409);
  assert.match(JSON.parse(rawPickerPath.body).error, /不接受路径参数/);

  const rawMainFolderPickerPath = await sendRequest(address, '/api/workspace-main-pick', {
    method: 'POST',
    headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
    body: JSON.stringify({ path: '/tmp/not-opened' }),
  });
  assert.equal(rawMainFolderPickerPath.status, 409);
  assert.match(JSON.parse(rawMainFolderPickerPath.body).error, /不接受路径参数/);

  const invalidPickerLanguage = await sendRequest(address, '/api/workspace-pick', {
    method: 'POST',
    headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
    body: JSON.stringify({ language: 'fr' }),
  });
  assert.equal(invalidPickerLanguage.status, 409);
  assert.match(JSON.parse(invalidPickerLanguage.body).error, /只接受中文或英文/);

  const invalidJsonMediaType = await sendRequest(address, '/api/workspace-mode', {
    method: 'POST',
    headers: { ...sessionHeaders(origin), 'content-type': 'application/jsonp' },
    body: JSON.stringify({ readOnly: false }),
  });
  assert.equal(invalidJsonMediaType.status, 409);
  assert.match(JSON.parse(invalidJsonMediaType.body).error, /请求格式不正确/);

  const oversizedBody = await sendRequest(address, '/api/workspace-mode', {
    method: 'POST',
    headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
    body: `{"note":"${'x'.repeat(256)}"}`,
  });
  assert.equal(oversizedBody.status, 409);
  assert.match(JSON.parse(oversizedBody.body).error, /请求内容过长/);

  const rawMountPath = await sendRequest(address, '/api/mount-stage', {
    method: 'POST',
    headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
    body: JSON.stringify({ selectionId: 'forged', readOnly: false, path: '/tmp/not-opened' }),
  });
  assert.equal(rawMountPath.status, 409);
  assert.match(JSON.parse(rawMountPath.body).error, /不接受路径/);

  const rawApplyPath = await sendRequest(address, '/api/mount-apply', {
    method: 'POST',
    headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
    body: JSON.stringify({ path: '/tmp/not-opened' }),
  });
  assert.equal(rawApplyPath.status, 409);
  assert.match(JSON.parse(rawApplyPath.body).error, /不接受路径/);

  const arbitraryWorkspace = await sendRequest(address, '/api/workspace-select', {
    method: 'POST',
    headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
    body: JSON.stringify({ workspace: '../outside', project: 'untrusted' }),
  });
  assert.equal(arbitraryWorkspace.status, 409);
  assert.match(JSON.parse(arbitraryWorkspace.body).error, /不接受路径或项目名/);

  const removedConnectivityProbe = await sendRequest(address, '/api/connectivity', {
    method: 'POST',
    headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(removedConnectivityProbe.status, 404);

  const statusResponse = await sendRequest(address, '/api/status', { headers: sessionHeaders(origin) });
  let selectedWorkspace;
  if (statusResponse.status === 200) {
    assert.equal(JSON.parse(statusResponse.body).status.workspaceLocalPath, syntheticSelectedPath);
  }
  if (process.platform !== 'win32') {
    selectedWorkspace = `console-picked-${randomBytes(4).toString('hex')}`;
    const canonicalPickerPaths = await Promise.all(syntheticPickerPaths.map((directory) => realpath(directory)));
    const [selectedMain, selectedExtraWrite, selectedExtraRead] = canonicalPickerPaths;
    await chmod(syntheticPickerPaths[0], 0o750);
    await chmod(syntheticPickerPaths[1], 0o770);
    await chmod(syntheticPickerPaths[2], 0o750);
    const pickedFolders = [];
    for (let index = 0; index < 3; index += 1) {
      const picked = await sendRequest(address, '/api/workspace-create-pick', {
        method: 'POST',
        headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
        body: JSON.stringify({ language: 'zh' }),
      });
      assert.equal(picked.status, 200, picked.body);
      const selection = JSON.parse(picked.body);
      assert.equal(selection.localPath, canonicalPickerPaths[index]);
      pickedFolders.push({ selectionId: selection.selectionId, readOnly: index !== 1 });
    }
    const unissuedSelection = await sendRequest(address, '/api/workspace-create', {
      method: 'POST',
      headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: `fake-${randomBytes(3).toString('hex')}`, folders: [{ selectionId: 'not-issued-by-picker', readOnly: true }] }),
    });
    assert.equal(unissuedSelection.status, 409);
    assert.match(JSON.parse(unissuedSelection.body).error, /文件夹选择已过期/);
    const createPickedWorkspace = await sendRequest(address, '/api/workspace-create', {
      method: 'POST',
      headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: selectedWorkspace, folders: pickedFolders }),
    });
    assert.equal(createPickedWorkspace.status, 200, createPickedWorkspace.body);
    const pickedResult = JSON.parse(createPickedWorkspace.body);
    assert.equal(pickedResult.workspace, TEST_WORKSPACE, 'saving selected folders must not switch the active workspace');
    const pickedProfile = pickedResult.workspaces.find((profile) => profile.workspace === selectedWorkspace);
    assert.equal(pickedProfile.localPath, selectedMain, 'the first selected folder becomes /workspace');
    assert.equal(pickedProfile.readOnly, true);
    assert.equal(pickedProfile.mountCount, 2);
    assert.deepEqual(pickedProfile.mounts.map((mount) => mount.localPath), [selectedExtraWrite, selectedExtraRead]);
    assert.deepEqual(pickedProfile.mounts.map((mount) => mount.readOnly), [false, true]);
    const projectLocalWorkspace = resolve(TEST_WORKSPACE_ROOT, selectedWorkspace);
    await assert.rejects(lstat(projectLocalWorkspace), { code: 'ENOENT' }, 'selected folders must not create a project-local workspace directory');
  }
  if (statusResponse.status === 200 && JSON.parse(statusResponse.body).status.state === 'stopped') {
    const createWorkspace = await sendRequest(address, '/api/workspace-create', {
      method: 'POST',
      headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: CREATED_WORKSPACE }),
    });
    assert.equal(createWorkspace.status, 200, createWorkspace.body);
    const created = JSON.parse(createWorkspace.body);
    assert.equal(created.workspace, TEST_WORKSPACE, 'creating a profile must not switch the active workspace');
    assert.equal(created.project, `remote-device-${TEST_WORKSPACE}`);
    assert.equal(created.restarted, false);
    assert.equal(created.workspaces.find((item) => item.workspace === CREATED_WORKSPACE).selected, false);
    assert.equal(created.workspaces.find((item) => item.workspace === TEST_WORKSPACE).selected, true);

    const editedExtraSelections = [];
    for (const readOnly of [true, false]) {
      const picked = await sendRequest(address, '/api/workspace-pick', {
        method: 'POST',
        headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
        body: JSON.stringify({ language: 'zh', workspace: CREATED_WORKSPACE }),
      });
      assert.equal(picked.status, 200, picked.body);
      const selection = JSON.parse(picked.body);
      assert.ok(selection.selectionId);
      assert.equal(selection.localPath, await realpath(syntheticPickerPaths[3 + editedExtraSelections.length]));
      editedExtraSelections.push({ selectionId: selection.selectionId, readOnly });
    }
    const editWorkspaceMounts = await sendRequest(address, '/api/workspace-edit', {
      method: 'POST',
      headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
      body: JSON.stringify({
        workspace: CREATED_WORKSPACE,
        label: 'Project Notes',
        readOnly: true,
        mounts: editedExtraSelections,
      }),
    });
    assert.equal(editWorkspaceMounts.status, 200, editWorkspaceMounts.body);
    const editedWithMounts = JSON.parse(editWorkspaceMounts.body);
    const editedMountProfile = editedWithMounts.workspaces.find((item) => item.workspace === CREATED_WORKSPACE);
    assert.equal(editedWithMounts.workspace, CREATED_WORKSPACE);
    assert.equal(editedWithMounts.restarted, false, 'editing an inactive workspace must not restart the device');
    assert.equal(editedMountProfile.mountCount, 2);
    assert.equal(editedMountProfile.selected, false);
    assert.deepEqual(editedMountProfile.mounts.map((mount) => mount.readOnly), [true, false]);
    assert.deepEqual(editedMountProfile.mounts.map((mount) => mount.localPath), [
      await realpath(join(testConfigHome, 'edited-extra-one')),
      await realpath(join(testConfigHome, 'edited-extra-two')),
    ]);
    const afterInactiveEdit = await sendRequest(address, '/api/workspaces', { headers: sessionHeaders(origin) });
    assert.equal(afterInactiveEdit.status, 200, afterInactiveEdit.body);
    assert.equal(JSON.parse(afterInactiveEdit.body).selectedWorkspace, TEST_WORKSPACE, 'editing an inactive workspace must not switch the active workspace');
    const bindingSelectionResponse = await sendRequest(address, '/api/workspace-pick', {
      method: 'POST',
      headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ language: 'zh', workspace: CREATED_WORKSPACE }),
    });
    assert.equal(bindingSelectionResponse.status, 200, bindingSelectionResponse.body);
    const bindingSelection = JSON.parse(bindingSelectionResponse.body);
    const wrongWorkspaceEdit = await sendRequest(address, '/api/workspace-edit', {
      method: 'POST',
      headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
      body: JSON.stringify({
        workspace: selectedWorkspace,
        label: 'Invalid edit',
        readOnly: true,
        mounts: [{ selectionId: bindingSelection.selectionId, readOnly: true }],
      }),
    });
    assert.equal(wrongWorkspaceEdit.status, 409);
    assert.match(JSON.parse(wrongWorkspaceEdit.body).error, /额外挂载文件夹选择已过期/);
    await sendRequest(address, '/api/workspace-cancel', {
      method: 'POST',
      headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ selectionId: bindingSelection.selectionId }),
    });

    const createWithExtraFields = await sendRequest(address, '/api/workspace-create', {
      method: 'POST',
      headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: `other-${CREATED_WORKSPACE}`, readOnly: false }),
    });
    assert.equal(createWithExtraFields.status, 409, createWithExtraFields.body);

    const rawWorkspacePath = await sendRequest(address, '/api/workspace-edit', {
      method: 'POST',
      headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: CREATED_WORKSPACE, label: 'Project Notes', readOnly: false, directory: '/tmp/not-opened' }),
    });
    assert.equal(rawWorkspacePath.status, 409);
    assert.match(JSON.parse(rawWorkspacePath.body).error, /不接受路径/);

    const editWorkspace = await sendRequest(address, '/api/workspace-edit', {
      method: 'POST',
      headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: CREATED_WORKSPACE, label: 'Project Notes', readOnly: false }),
    });
    assert.equal(editWorkspace.status, 200, editWorkspace.body);
    const edited = JSON.parse(editWorkspace.body);
    assert.equal(edited.workspaceName, 'Project Notes');
    assert.equal(edited.restarted, false, 'changing only the display name must not restart the device');
    assert.equal(edited.workspaces.find((item) => item.workspace === CREATED_WORKSPACE).label, 'Project Notes');

    const deleteDefault = await sendRequest(address, '/api/workspace-delete', {
      method: 'POST',
      headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: 'default' }),
    });
    assert.equal(deleteDefault.status, 409);
    assert.match(JSON.parse(deleteDefault.body).error, /默认工作区不能删除/);

    const deleteWorkspace = await sendRequest(address, '/api/workspace-delete', {
      method: 'POST',
      headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: CREATED_WORKSPACE }),
    });
    assert.equal(deleteWorkspace.status, 200, deleteWorkspace.body);
    const deleted = JSON.parse(deleteWorkspace.body);
    assert.equal(deleted.workspace, TEST_WORKSPACE, 'deleting an inactive profile must keep the active workspace unchanged');
    assert.equal(deleted.restarted, false);
    assert.equal(deleted.folderPreserved, true);
    assert.equal(deleted.workspaces.some((item) => item.workspace === CREATED_WORKSPACE), false);
    await assert.doesNotReject(lstat(resolve(TEST_WORKSPACE_ROOT, CREATED_WORKSPACE)), 'deleting a profile must keep its local folder');

    const recreateWorkspace = await sendRequest(address, '/api/workspace-create', {
      method: 'POST',
      headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: CREATED_WORKSPACE }),
    });
    assert.equal(recreateWorkspace.status, 200, recreateWorkspace.body);
    assert.equal(JSON.parse(recreateWorkspace.body).workspace, TEST_WORKSPACE);
    assert.equal(JSON.parse(recreateWorkspace.body).workspaces.find((item) => item.workspace === CREATED_WORKSPACE).selected, false);
  }

  const wrongHost = await sendRequest(address, '/api/proxy', {
    headers: { host: 'attacker.invalid' },
  });
  assert.equal(wrongHost.status, 421);

  const noToken = await sendRequest(address, '/api/proxy');
  assert.equal(noToken.status, 403);

  const validSession = await sendRequest(address, '/api/proxy', {
    headers: sessionHeaders(origin),
  });
  assert.equal(validSession.status, 200);
  assert.equal(JSON.parse(validSession.body).mode, 'project');

  const wrongOrigin = await sendRequest(address, '/api/proxy', {
    headers: sessionHeaders('http://attacker.invalid'),
  });
  assert.equal(wrongOrigin.status, 403);

  const preflight = await sendRequest(address, '/api/proxy', {
    method: 'OPTIONS',
    headers: {
      origin: 'http://attacker.invalid',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,x-console-request',
    },
  });
  assert.equal(preflight.status, 403);
  assert.equal(preflight.headers['access-control-allow-origin'], undefined);

  const originlessPost = await sendRequest(address, '/api/proxy', {
    method: 'POST',
    headers: { ...sessionHeaders(), 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'direct' }),
  });
  assert.equal(originlessPost.status, 403);

  const unauthorizedAction = await sendRequest(address, '/api/start', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(unauthorizedAction.status, 403);

  const arbitraryCommand = await sendRequest(address, '/api/start', {
    method: 'POST',
    headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
    body: JSON.stringify({ command: 'uname -a' }),
  });
  assert.equal(arbitraryCommand.status, 409);

  const arbitraryPull = await sendRequest(address, '/api/pull', {
    method: 'POST',
    headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
    body: JSON.stringify({ image: 'untrusted.invalid/image' }),
  });
  assert.equal(arbitraryPull.status, 409);
  assert.match(JSON.parse(arbitraryPull.body).error, /不接受额外参数/);

  const directMode = await sendRequest(address, '/api/proxy', {
    method: 'POST',
    headers: { ...sessionHeaders(origin), 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'direct' }),
  });
  assert.equal(directMode.status, 200);
  assert.equal(JSON.parse(directMode.body).mode, 'direct');

  const updatedMode = await sendRequest(address, '/api/proxy', {
    headers: sessionHeaders(origin),
  });
  assert.equal(updatedMode.status, 200);
  assert.equal(JSON.parse(updatedMode.body).mode, 'direct');
});

test('each process start rotates the local session token', async () => {
  const first = await startConsole();
  await stopConsole();
  const second = await startConsole();
  const oldTokenHeaders = {
    authorization: `Bearer ${first.token}`,
    'x-console-request': 'desktop-commander-sandbox',
    origin: `http://127.0.0.1:${second.port}`,
  };
  const oldToken = await sendRequest(second.port, '/api/proxy', { headers: oldTokenHeaders });
  assert.equal(oldToken.status, 403);

  const newToken = await sendRequest(second.port, '/api/proxy', {
    headers: {
      authorization: `Bearer ${second.token}`,
      'x-console-request': 'desktop-commander-sandbox',
      origin: `http://127.0.0.1:${second.port}`,
    },
  });
  assert.equal(newToken.status, 200);
});

test('dashboard reloads externally changed workspace profiles and rejects a stale action', async () => {
  ({ port: address, token: sessionToken } = await startConsole());
  const origin = `http://127.0.0.1:${address}`;
  const extra = join(testConfigHome, 'synthetic-extra');
  await mkdir(extra);
  await writeFile(join(testConfigHome, 'desktop-commander-sandbox', 'workspace-profiles.json'), `${JSON.stringify({
    version: 1,
    activeWorkspace: TEST_WORKSPACE,
    deviceProject: `remote-device-${TEST_WORKSPACE}`,
    workspaces: {
      [TEST_WORKSPACE]: {
        label: 'Changed externally',
        directory: syntheticSelectedPath,
        readOnly: true,
        mounts: [{ id: 'mount-123456789abc', directory: extra, readOnly: true }],
      },
    },
  })}\n`);

  const staleAction = await sendRequest(address, '/api/mount-reset', {
    method: 'POST',
    headers: sessionHeaders(origin),
  });
  assert.equal(staleAction.status, 409);

  const workspaces = await sendRequest(address, '/api/workspaces', { headers: sessionHeaders(origin) });
  assert.equal(workspaces.status, 200);
  const active = JSON.parse(workspaces.body).workspaces.find((profile) => profile.selected);
  assert.equal(active.label, 'Changed externally');
  assert.equal(active.mountCount, 1);

  const mounts = await sendRequest(address, '/api/mounts', { headers: sessionHeaders(origin) });
  assert.equal(mounts.status, 200);
  assert.equal(JSON.parse(mounts.body).applied.length, 1);
});
