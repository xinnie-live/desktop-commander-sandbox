import { installLanguagePicker, translateText } from './i18n.mjs';
import { isSupportedAuthorizationUrl } from './authorization-url.mjs';
import { formatBytes, formatLocalTime, formatMountAccessSummary } from './ui-format.mjs';

const languagePicker = installLanguagePicker();

const $ = (selector) => document.querySelector(selector);
function openDialog(dialog) {
  dialog.returnValue = '';
  dialog.showModal();
}
const lock = $('#session-lock');
const notice = $('#notice');
const outputState = $('#output-state');
const stopDialog = $('#stop-dialog');
const workspaceConfirmDialog = $('#workspace-confirm-dialog');
const workspaceEditDialog = $('#workspace-edit-dialog');
const workspaceEditForm = $('#workspace-edit-form');
const workspaceCreateDialog = $('#workspace-create-dialog');
const workspaceDeleteDialog = $('#workspace-delete-dialog');
const networkDialog = $('#network-dialog');
const networkForm = $('#network-form');
const proxyInput = $('#proxy-url');
const networkButton = $('#network-button');
const diagnosticsDialog = $('#diagnostics-dialog');
const diagnosticsList = $('#diagnostics-list');
const diagnosticsToggle = $('#diagnostics-toggle');
const diagnosticsDescription = $('#diagnostics-description');
const diagnosticsUpdated = $('#diagnostics-updated');
const diagnosticsSummary = $('#diagnostics-summary');
const diagnosticsStartButton = $('#diagnostics-start-button');
const startButton = $('#start-button');
const buildButton = $('#build-button');
const stopButton = $('#stop-button');
const workspaceSelect = $('#workspace-select');
const workspaceSelectButton = $('#workspace-select-button');
const workspaceDropdown = $('#workspace-dropdown');
const workspaceDropdownTrigger = $('#workspace-dropdown-trigger');
const workspaceDropdownCurrent = $('#workspace-dropdown-current');
const workspaceDropdownOptions = $('#workspace-dropdown-options');
const workspaceCurrentLabel = $('#workspace-current-label');
const workspaceCurrentName = $('#workspace-current-name');
const workspaceCurrentMeta = $('#workspace-current-meta');
const workspaceEditButton = $('#workspace-edit-button');
const workspaceDeleteButton = $('#workspace-delete-button');
const workspaceNewButton = $('#workspace-new-button');
const workspaceCreateForm = $('#workspace-create-form');
const workspaceNameInput = $('#workspace-new-name');
const workspaceCreateButton = $('#workspace-create-button');
const workspaceCreateStatus = $('#workspace-create-status');
const workspaceCreatePickButton = $('#workspace-create-pick');
const workspaceCreateFolderList = $('#workspace-create-folder-list');
const workspaceCreateFolderCount = $('#workspace-create-folder-count');
const workspaceCreateFolderEmpty = $('#workspace-create-folder-empty');
const workspacePickButton = $('#workspace-pick-button');
const workspaceAccessMode = $('#workspace-edit-access');
const workspaceEditMountList = $('#workspace-edit-mount-list');
const workspaceEditMountCount = $('#workspace-edit-mount-count');
const workspaceEditStatus = $('#workspace-edit-status');
const mountResetButton = $('#mount-reset-button');
const mountApplyButton = $('#mount-apply-button');
const connectivityButton = $('#connectivity-button');
const connectivityDialog = $('#connectivity-dialog');
const connectionLocalStatus = $('#connection-local-status');
const logsDialog = $('#logs-dialog');
const logsList = $('#logs-list');
const logContent = $('#log-content');
const authorizationLink = $('#authorization-link');
const authorizationDialog = $('#authorization-dialog');
const authorizationCode = $('#authorization-code');
const currentLogPreview = $('#current-log-preview');
const pendingMountsList = $('#pending-mounts-list');
const pendingMountsSection = $('#pending-mounts-section');
const resourceDialog = $('#resource-details-dialog');
const refreshStorageButton = $('#refresh-storage');
const storageValue = $('#storage-value');
const storageUpdated = $('#storage-updated');
const authorizationState = $('#authorization-state');
const authorizationFeedbackDetail = $('#authorization-feedback-detail');
const authorizationCheckButton = $('#authorization-check');
const proxyModeInputs = [...document.querySelectorAll('input[name="mode"]')];
const proxySavedModeLabel = $('#proxy-saved-mode');
const proxyDraftModeLabel = $('#proxy-draft-mode');
const proxyRuntimeModeLabel = $('#proxy-runtime-mode');
const proxySaveStatus = $('#proxy-save-status');
const manualProxyFields = $('#manual-proxy-fields');
const proxySaveButton = $('#proxy-save');
const themeButton = $('#theme-toggle');

let token = '';
let lastJobId = null;
let lastSequence = 0;
let pollInProgress = false;
let actionInProgress = false;
let currentImagesReady = false;
let currentJobBusy = false;
let currentJobActive = false;
let currentJobKind = null;
let currentJobPhase = null;
let currentWorkspace = 'default';
let lastWorkspaceRevision = null;
let currentWorkspaceReadOnly = false;
let workspaceSelectionEnabled = true;
let workspaceProfiles = [];
let newWorkspaceFolders = [];
let pendingStartAfterDiagnostics = false;
let pendingWorkspaceChange = null;
let pendingWorkspaceDeletion = null;
let workspaceEditSelectionId = null;
let workspaceEditLocalPath = '';
let workspaceEditFolderChanged = false;
let workspaceEditSubmitting = false;
let workspaceEditWorkspace = '';
let workspaceEditMounts = [];
let workspaceEditStatusMessage = '';
let draftMounts = [];
let appliedMounts = [];
let mountSnapshot = null;
let mountsDirty = false;
let transientOutput = '';
let currentAuthorizationUrl = '';
let authorizationPromptedRunId = null;
let currentRunId = null;
let externalRunActive = false;
let selectedRunId = null;
let runHistory = [];
let fixedLogMessage = null;
let resourceRequestInProgress = false;
let storageRequestInProgress = false;
let lastResourcePollAt = 0;
let storageStatus = 'idle';
let storageUpdatedAt = null;
let savedProxyMode = 'project';
let proxyModeLoaded = false;
let networkSaveState = '';
let networkSaveBusy = false;

function setTheme(theme, persist = true) {
  const selected = theme === 'sage' || theme === 'light' ? 'sage' : 'dark';
  document.documentElement.dataset.theme = selected;
  const targetLabel = selected === 'dark' ? '切换到浅色主题' : '切换到深色主题';
  const label = languagePicker.language === 'zh' ? targetLabel : (selected === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
  themeButton.setAttribute('aria-label', label);
  themeButton.title = label;
  if (persist) {
    try { localStorage.setItem('rds-ui-theme', selected); } catch { /* Keep the current theme when storage is unavailable. */ }
  }
}

try { setTheme(localStorage.getItem('rds-ui-theme') || 'dark', false); } catch { setTheme('dark', false); }
themeButton.addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'sage' : 'dark'));
$('#language-toggle').addEventListener('click', () => queueMicrotask(() => {
  setTheme(document.documentElement.dataset.theme, false);
  renderWorkspaceSelector();
  renderNewWorkspaceFolders();
  if (mountSnapshot) renderMounts(mountSnapshot);
  if (workspaceEditDialog.open) {
    renderWorkspaceEditMounts();
    workspaceEditStatus.textContent = translateText(workspaceEditStatusMessage, languagePicker.language);
  }
  connectionLocalStatus.textContent = translateText(({
    running: '设备容器正在运行；云端状态未知。',
    partial: '容器状态异常；云端状态未知。',
    stopped: '设备容器已停止；云端授权状态未知。',
  })[currentProjectState] || '暂无法读取本机设备状态。', languagePicker.language);
  renderCurrentLogPreview();
  if (fixedLogMessage) logContent.textContent = translateText(fixedLogMessage, languagePicker.language);
  renderPersistentStorage();
  renderNetworkSettings();
  renderStatusFreshness();
  renderJob(renderedJob);
  if (logsDialog.open) showSelectedRunLog();
}));
renderCurrentLogPreview();
setFixedLogMessage('读取日志后显示内容。');

function loadSessionToken() {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const linkToken = fragment.get('session');
  if (linkToken) {
    sessionStorage.setItem('rds-local-session', linkToken);
    history.replaceState(null, document.title, location.pathname);
    return linkToken;
  }
  return sessionStorage.getItem('rds-local-session') || '';
}

function lockPage() {
  token = '';
  sessionStorage.removeItem('rds-local-session');
  lock.hidden = false;
}

function showNotice(message, isError = true) {
  notice.textContent = message;
  notice.hidden = !message;
  notice.dataset.kind = isError ? 'error' : 'info';
}

function resetAuthorizationFeedback() {
  authorizationState.textContent = '等待你在官方页面完成授权';
  authorizationFeedbackDetail.textContent = '控制台不会代为批准，也无法仅凭本机容器状态确认授权结果。';
  authorizationCheckButton.hidden = true;
  authorizationCheckButton.disabled = false;
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      cache: 'no-store',
      signal: path === '/api/status' ? AbortSignal.timeout(15_000) : undefined,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Console-Request': 'desktop-commander-sandbox',
        ...(options.method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      body: options.method === 'POST' ? JSON.stringify(options.body ?? {}) : undefined,
    });
  } catch (error) {
    if (error instanceof TypeError || error.name === 'TimeoutError') {
      throw new Error('无法连接本机控制台。请确认启动控制台的终端仍在运行；若已关闭，请回到项目目录运行 npm run remote-device:dashboard，再打开新终端链接。');
    }
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 403) {
    lockPage();
    throw new Error(data.error || '本地控制台会话已过期。');
  }
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）。`);
  return data;
}

let renderedJob = null;
let renderedJobRevision = '';

function renderJob(job) {
  renderedJob = job;
  const revision = job ? `${job.id}:${job.phase}` : '';
  if (revision !== renderedJobRevision) {
    renderedJobRevision = revision;
    if (logsDialog.open) loadRunHistory({ selectRunId: selectedRunId });
  }
  const busy = Boolean(job && ['building', 'starting', 'running', 'stopping'].includes(job.phase));
  currentJobBusy = Boolean(job && ['building', 'starting', 'stopping'].includes(job.phase));
  currentJobActive = busy;
  currentJobKind = job?.kind || null;
  currentJobPhase = job?.phase || null;
  const activeStart = job?.kind === 'start' && ['starting', 'running'].includes(job.phase);
  const activeBuild = ['build', 'pull'].includes(job?.kind) && ['building', 'running'].includes(job.phase);
  const needsBuild = !currentImagesReady && currentProjectState !== 'running';
  const showBuild = (needsBuild || activeBuild) && currentProjectState !== 'running';
  const showStart = currentImagesReady && currentProjectState !== 'running' && !activeBuild;
  buildButton.hidden = !showBuild;
  startButton.hidden = !showStart;
  stopButton.hidden = ['stopped', 'not-created'].includes(currentProjectState) && !activeStart;
  buildButton.classList.toggle('button-primary', showBuild && !showStart);
  buildButton.classList.toggle('button-secondary', !showBuild);
  startButton.classList.toggle('button-primary', showStart);
  startButton.classList.toggle('button-secondary', !showStart);
  startButton.disabled = statusUnavailable || actionInProgress || busy || currentProjectState === 'running';
  for (const button of [startButton, buildButton, stopButton, $('#image-options-button'), $('#source-build-button'), $('#download-image-button')]) {
    button.title = statusUnavailable ? $('#build-guide').textContent : '';
  }
  buildButton.disabled = statusUnavailable || actionInProgress || busy;
  $('#image-options-button').hidden = !currentImagesReady || currentProjectState === 'running';
  $('#image-options-button').disabled = statusUnavailable || actionInProgress || busy;
  $('#source-build-button').disabled = statusUnavailable || actionInProgress || busy || currentProjectState === 'running';
  stopButton.disabled = statusUnavailable || actionInProgress || (busy && !activeStart) || (['stopped', 'not-created'].includes(currentProjectState) && !activeStart);
  updateManagementControls();
  updateResourceControls();

  if (!job) {
    if (!currentRunId) {
      outputState.textContent = currentProjectState === 'running' ? '由其他控制进程启动' : '尚无运行记录';
      $('#current-run-label').textContent = currentProjectState === 'running'
        ? '本控制台没有实时输出；可通过“查看日志”读取已保存的运行记录。'
        : '启动设备后，这里会显示本次运行。';
    }
    return;
  }
  const labels = {
    building: '正在准备镜像',
    starting: '正在启动',
    running: '设备已启动',
    stopping: '正在停止',
    failed: `操作失败 · 退出码 ${job.exitCode ?? '未知'}`,
    finished: `操作结束 · 退出码 ${job.exitCode ?? '未知'}`,
    'output-cleared': '日志已清除',
  };
  outputState.textContent = labels[job.phase] || '已结束';
  currentRunId = job.kind === 'start' ? job.id : currentRunId;
  if (job.kind === 'start') {
    const when = new Date(job.startedAt).toLocaleString(languagePicker.language === 'zh' ? 'zh-CN' : 'en-US');
    $('#current-run-label').textContent = `${job.workspace || $('#workspace-name').textContent} · ${when}${job.logFilename ? ` · ${job.logFilename}` : ''}`;
    currentAuthorizationUrl = job.authorizationUrl || currentAuthorizationUrl;
    updateAuthorizationEntry();
    if (job.logError) showNotice(job.logError);
    if (job.outputCleared) {
      transientOutput = '';
      currentAuthorizationUrl = '';
      resetAuthorizationFeedback();
      updateAuthorizationEntry();
    }
  } else if (job.kind === 'stop') {
    currentAuthorizationUrl = '';
    resetAuthorizationFeedback();
    updateAuthorizationEntry();
  }
  renderCurrentLogPreview();
  if (job.outputCleared && logsDialog.open && selectedRunId === job.id) setFixedLogMessage('本次运行的临时终端输出已清除；可查看已保存的本机日志文件。');
  if (job.error) showNotice(job.error);
}

let currentProjectState = 'unknown';
let lastStatusConfirmedAt = null;
let statusUnavailable = false;

function renderStatusFreshness() {
  const label = $('#status-freshness');
  label.hidden = !statusUnavailable;
  if (!statusUnavailable) return;
  $('.overview').dataset.state = 'partial';
  $('#project-state').textContent = translateText('设备状态待确认', languagePicker.language);
  connectionLocalStatus.textContent = translateText('无法读取最新容器状态；容器可能仍在运行。', languagePicker.language);
  const guidance = translateText('无法确认 Docker 状态。请启动 Docker Desktop 或 Linux Docker Engine，检查当前用户的 Docker 权限，并运行 npm run remote-device:doctor。恢复连接后页面会自动刷新；容器可能仍在运行。', languagePicker.language);
  $('#build-guide').hidden = false;
  $('#build-guide').textContent = guidance;
  for (const selector of ['#start-button', '#build-button', '#stop-button', '#image-options-button', '#source-build-button', '#download-image-button']) {
    const button = $(selector);
    button.disabled = true;
    button.title = guidance;
  }
  const prefix = translateText('最后确认时间', languagePicker.language);
  label.textContent = lastStatusConfirmedAt
    ? `${prefix}: ${lastStatusConfirmedAt.toLocaleString(languagePicker.language === 'zh' ? 'zh-CN' : 'en-US')}`
    : translateText('尚未成功读取容器状态。', languagePicker.language);
}


function renderStatus(status, job) {
  const overview = $('.overview');
  statusUnavailable = false;
  lastStatusConfirmedAt = new Date();
  renderStatusFreshness();
  currentProjectState = status.state;
  currentImagesReady = status.imagesReady;
  $('#build-guide').textContent = currentImagesReady
    ? '镜像已就绪。点击“启动设备”；首次连接时按提示完成官方授权。'
    : '第 1 步：准备镜像（下载或源码构建，二选一）。完成后再启动设备。';
  $('#build-guide').hidden = status.state === 'running';
  $('#download-image-button').disabled = status.imageDownloadAvailable !== true;
  $('#development-image-note').hidden = status.imageDownloadAvailable === true;
  overview.dataset.state = status.state === 'running' ? 'running' : status.state === 'partial' ? 'partial' : 'stopped';
  const stateLabel = status.state === 'running' ? '设备运行中' : status.state === 'partial' ? '设备状态异常' : '设备已停止';
  $('#project-state').textContent = stateLabel;
  connectionLocalStatus.textContent = translateText(({
    running: '设备容器正在运行；云端状态未知。',
    partial: '容器状态异常；云端状态未知。',
    stopped: '设备容器已停止；云端授权状态未知。',
  })[status.state] || '暂无法读取本机设备状态。', languagePicker.language);
  $('#project-name').textContent = status.project;
  $('#workspace-name').textContent = status.workspaceName || status.workspace || 'default';
  $('#workspace-folder-name').textContent = status.workspaceFolderName || 'sandbox-workspace';
  $('#workspace-local-path').textContent = status.workspaceLocalPath || '';
  $('#workspace-name').setAttribute('data-i18n-ignore', '');
  $('#workspace-folder-name').setAttribute('data-i18n-ignore', '');
  $('#workspace-local-path').setAttribute('data-i18n-ignore', '');
  $('#workspace-primary-boundary').hidden = false;
  $('#workspace-access-label').textContent = status.workspaceReadOnly ? '只读' : '读写';
  $('#workspace-access-label').classList.toggle('access-read', status.workspaceReadOnly);
  $('#workspace-access-label').classList.toggle('access-write', !status.workspaceReadOnly);
  $('#workspace-access-label').hidden = false;
  currentWorkspace = status.workspace || 'default';
  currentWorkspaceReadOnly = status.workspaceReadOnly === true;
  renderWorkspaceSelector();
  updateManagementControls();
  renderJob(job);
  if (networkDialog.open) renderNetworkSettings();
}

function updateManagementControls() {
  const idle = !currentJobBusy;
  const selectedProfile = workspaceProfiles.find((profile) => profile.workspace === workspaceSelect.value);
  const selectedExists = selectedProfile?.exists === true;
  workspaceSelect.disabled = !workspaceSelectionEnabled || actionInProgress || !idle || mountsDirty;
  workspaceDropdownTrigger.disabled = workspaceSelect.disabled;
  workspaceSelectButton.disabled = workspaceSelect.disabled
    || workspaceSelect.value === currentWorkspace
    || (workspaceSelect.value !== 'default' && !selectedExists);
  workspaceEditButton.disabled = !workspaceSelectionEnabled || actionInProgress || !idle || !selectedProfile;
  workspaceDeleteButton.disabled = !workspaceSelectionEnabled || actionInProgress || !idle || mountsDirty
    || !selectedProfile?.deletable;
  workspaceNameInput.disabled = !workspaceSelectionEnabled || actionInProgress || !idle;
  workspaceNewButton.disabled = workspaceNameInput.disabled;
  workspaceCreateButton.disabled = workspaceNameInput.disabled;
  workspaceCreatePickButton.disabled = workspaceNameInput.disabled || newWorkspaceFolders.length >= 9;
  $('#workspace-create-cancel').disabled = actionInProgress;
  mountApplyButton.disabled = !mountsDirty || actionInProgress || !idle || currentProjectState === 'partial';
  mountResetButton.hidden = !mountsDirty;
  mountResetButton.disabled = actionInProgress || !idle;
  for (const control of workspaceEditMountList.querySelectorAll('input, button')) {
    control.disabled = actionInProgress || currentJobBusy;
  }
  for (const control of workspaceCreateFolderList.querySelectorAll('input, button')) {
    control.disabled = actionInProgress || currentJobBusy;
  }
  workspaceAccessMode.disabled = actionInProgress || currentJobBusy || !selectedProfile;
  workspacePickButton.disabled = actionInProgress || currentJobBusy || workspaceEditMounts.length >= 8;
  $('#workspace-edit-save').disabled = actionInProgress || currentJobBusy;
}

function renderWorkspaceSelector() {
  const canSelect = workspaceSelectionEnabled && workspaceProfiles.length > 1;
  const selected = workspaceProfiles.find((profile) => profile.workspace === workspaceSelect.value)
    || workspaceProfiles.find((profile) => profile.workspace === currentWorkspace);
  workspaceSelect.hidden = true;
  workspaceDropdown.hidden = !canSelect;
  workspaceSelectButton.hidden = !canSelect;
  workspaceCurrentLabel.hidden = canSelect;
  workspaceCurrentName.textContent = selected?.label || selected?.workspace || currentWorkspace;
  workspaceCurrentName.setAttribute('data-i18n-ignore', '');
  const selectedIsCurrent = selected?.workspace === currentWorkspace;
  const selectedStatus = selectedIsCurrent ? ' · 当前' : ' · 待切换';
  workspaceCurrentMeta.textContent = translateText(
    `${selected ? 1 + (selected.mountCount || 0) : 1} 个文件夹${selectedStatus}`,
    languagePicker.language,
  );
  workspaceDropdownTrigger.disabled = workspaceSelect.disabled;
  workspaceDropdownTrigger.setAttribute('aria-expanded', String(!workspaceDropdownOptions.hidden));
  workspaceDropdownCurrent.replaceChildren();
  const currentName = document.createElement('strong');
  currentName.textContent = selected?.label || selected?.workspace || currentWorkspace;
  currentName.setAttribute('data-i18n-ignore', '');
  const currentMeta = document.createElement('small');
  currentMeta.textContent = translateText(
    `${selected ? 1 + (selected.mountCount || 0) : 1} 个文件夹${selectedStatus}${selected?.exists === false ? ' · 文件夹不存在' : ''}`,
    languagePicker.language,
  );
  workspaceDropdownCurrent.append(currentName, currentMeta);
  workspaceDropdownCurrent.setAttribute('aria-label', `${currentName.textContent} · ${currentMeta.textContent}`);
  renderWorkspaceDropdownOptions(selected);
}

function renderWorkspaceDropdownOptions(selected) {
  const wasOpen = !workspaceDropdownOptions.hidden;
  workspaceDropdownOptions.replaceChildren();
  for (const profile of workspaceProfiles) {
    const count = 1 + (profile.mountCount || 0);
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'workspace-dropdown-option';
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', String(profile.workspace === workspaceSelect.value));
    option.tabIndex = profile.workspace === workspaceSelect.value ? 0 : -1;
    option.dataset.workspace = profile.workspace;
    const copy = document.createElement('span');
    copy.className = 'workspace-dropdown-option-copy';
    const name = document.createElement('strong');
    name.textContent = profile.label || profile.workspace;
    name.setAttribute('data-i18n-ignore', '');
    const summary = document.createElement('small');
    summary.textContent = translateText(
      `${count} 个文件夹${profile.workspace === currentWorkspace ? ' · 当前' : ''}${profile.exists === false ? ' · 文件夹不存在' : ''}`,
      languagePicker.language,
    );
    copy.append(name, summary);
    option.append(copy);
    if (profile.workspace === currentWorkspace) {
      const badge = document.createElement('span');
      badge.className = 'workspace-dropdown-badge';
      badge.textContent = translateText('当前', languagePicker.language);
      option.append(badge);
    }
    option.addEventListener('click', () => {
      workspaceSelect.value = profile.workspace;
      workspaceSelect.dispatchEvent(new Event('change', { bubbles: true }));
      closeWorkspaceDropdown(true);
    });
    workspaceDropdownOptions.append(option);
  }
  if (!workspaceDropdown.hidden && wasOpen) workspaceDropdownOptions.hidden = false;
}

function closeWorkspaceDropdown(returnFocus = false) {
  workspaceDropdownOptions.hidden = true;
  workspaceDropdownTrigger.setAttribute('aria-expanded', 'false');
  if (returnFocus) workspaceDropdownTrigger.focus();
}

function openWorkspaceDropdown(focusEdge = 'selected') {
  if (workspaceDropdownTrigger.disabled || workspaceDropdown.hidden) return;
  workspaceDropdownOptions.hidden = false;
  workspaceDropdownTrigger.setAttribute('aria-expanded', 'true');
  const options = [...workspaceDropdownOptions.querySelectorAll('[role="option"]')];
  const target = focusEdge === 'last' ? options.at(-1)
    : focusEdge === 'first' ? options[0]
      : options.find((option) => option.dataset.workspace === workspaceSelect.value) || options[0];
  target?.focus();
}

function moveWorkspaceDropdownFocus(current, direction) {
  const options = [...workspaceDropdownOptions.querySelectorAll('[role="option"]')];
  if (!options.length) return;
  const index = options.indexOf(current);
  const next = options[(index + direction + options.length) % options.length];
  options.forEach((option) => { option.tabIndex = option === next ? 0 : -1; });
  next.focus();
}

function renderWorkspaceProfiles(data) {
  // Refreshing profile metadata must not erase a workspace the user has picked
  // but has not applied yet. The active workspace and the editing selection
  // are separate pieces of state.
  const previousSelection = workspaceSelect.value;
  workspaceSelectionEnabled = data.selectionEnabled;
  workspaceProfiles = data.workspaces || [];
  workspaceSelect.replaceChildren();
  for (const profile of workspaceProfiles) {
    const option = document.createElement('option');
    option.value = profile.workspace;
    const folderCount = 1 + (profile.mountCount || 0);
    const state = profile.exists ? '' : ' · 文件夹不存在';
    const active = profile.workspace === (data.selectedWorkspace || currentWorkspace) ? ' · 当前' : '';
    option.textContent = `${profile.label || profile.workspace} · ${folderCount} 个文件夹${active}${state}`;
    workspaceSelect.append(option);
  }
  currentWorkspace = data.selectedWorkspace || currentWorkspace;
  const hasPreviousSelection = [...workspaceSelect.options].some((option) => option.value === previousSelection);
  const hasActiveWorkspace = [...workspaceSelect.options].some((option) => option.value === currentWorkspace);
  workspaceSelect.value = hasPreviousSelection
    ? previousSelection
    : hasActiveWorkspace ? currentWorkspace : workspaceSelect.options[0]?.value || '';
  renderWorkspaceSelector();
  if (!workspaceSelectionEnabled) {
    $('#workspace-help').textContent = '当前通过 --project 固定了设备状态项目，工作区切换已禁用。';
  }
  updateManagementControls();
}

async function refreshWorkspaces() {
  const data = await api('/api/workspaces');
  renderWorkspaceProfiles(data);
  await refreshMounts();
}

workspaceSelect.addEventListener('change', () => {
  renderWorkspaceSelector();
  updateManagementControls();
});

workspaceDropdownTrigger.addEventListener('click', () => {
  if (workspaceDropdownOptions.hidden) openWorkspaceDropdown();
  else closeWorkspaceDropdown();
});
workspaceDropdownTrigger.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    openWorkspaceDropdown(event.key === 'ArrowUp' ? 'last' : 'selected');
  }
});
workspaceDropdownOptions.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeWorkspaceDropdown(true);
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveWorkspaceDropdownFocus(event.target.closest('[role="option"]'), event.key === 'ArrowDown' ? 1 : -1);
  } else if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    const options = [...workspaceDropdownOptions.querySelectorAll('[role="option"]')];
    const target = event.key === 'Home' ? options[0] : options.at(-1);
    options.forEach((option) => { option.tabIndex = option === target ? 0 : -1; });
    target?.focus();
  }
});
document.addEventListener('click', (event) => {
  if (!workspaceDropdown.contains(event.target)) closeWorkspaceDropdown();
});

workspaceNewButton.addEventListener('click', () => {
  workspaceCreateStatus.hidden = true;
  workspaceCreateStatus.textContent = '';
  workspaceNameInput.value = '';
  newWorkspaceFolders = [];
  renderNewWorkspaceFolders();
  openDialog(workspaceCreateDialog);
  workspaceNameInput.focus();
});
$('#workspace-create-cancel').addEventListener('click', () => workspaceCreateDialog.close());

function createWritePermissionToggle({ checked, label, help, ariaLabel, dataset = {}, compact = false }) {
  const toggle = document.createElement('label');
  toggle.className = `permission-toggle${compact ? ' permission-toggle-compact' : ''}`;
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = checked;
  checkbox.setAttribute('aria-label', ariaLabel || label);
  for (const [key, value] of Object.entries(dataset)) checkbox.dataset[key] = value;
  const copy = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = label;
  copy.append(title);
  if (help) {
    const description = document.createElement('small');
    description.textContent = help;
    copy.append(description);
  }
  toggle.append(checkbox, copy);
  return toggle;
}

function renderWorkspaceEditMounts() {
  workspaceEditMountCount.textContent = `${workspaceEditMounts.length} / 8`;
  workspaceEditMountList.replaceChildren();
  if (!workspaceEditMounts.length) {
    const empty = document.createElement('li');
    empty.className = 'workspace-edit-mount-empty';
    empty.textContent = translateText('还没有额外挂载文件夹。', languagePicker.language);
    workspaceEditMountList.append(empty);
  }
  workspaceEditMounts.forEach((mount, index) => {
    const item = document.createElement('li');
    item.className = 'workspace-edit-mount-item';
    const details = document.createElement('div');
    details.className = 'workspace-edit-mount-details';
    const name = document.createElement('strong');
    name.textContent = mount.folderName || translateText('已选择的文件夹', languagePicker.language);
    name.setAttribute('data-i18n-ignore', '');
    const localPath = document.createElement('code');
    localPath.textContent = mount.localPath || '';
    localPath.setAttribute('data-i18n-ignore', '');
    const target = document.createElement('span');
    target.textContent = mount.target || translateText('保存后自动分配容器路径', languagePicker.language);
    target.setAttribute('data-i18n-ignore', '');
    details.append(name, localPath, target);
    const controls = document.createElement('div');
    controls.className = 'workspace-edit-mount-controls';
    controls.append(createWritePermissionToggle({
      checked: !mount.readOnly,
      label: translateText('写入', languagePicker.language),
      ariaLabel: `${translateText('允许容器写入', languagePicker.language)} ${mount.folderName || translateText('已选择的文件夹', languagePicker.language)}`,
      dataset: { editMountIndex: String(index) },
      compact: true,
    }));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'button button-secondary workspace-edit-mount-remove';
    remove.dataset.removeEditMountIndex = String(index);
    remove.textContent = translateText('移除', languagePicker.language);
    remove.setAttribute('aria-label', translateText(`移除 ${mount.folderName || '已选择的文件夹'}`, languagePicker.language));
    controls.append(remove);
    item.append(details, controls);
    workspaceEditMountList.append(item);
  });
  updateManagementControls();
}

function renderNewWorkspaceFolders() {
  workspaceCreateFolderCount.textContent = `${newWorkspaceFolders.length} / 9`;
  workspaceCreateFolderEmpty.hidden = newWorkspaceFolders.length > 0;
  workspaceCreateFolderList.replaceChildren();
  newWorkspaceFolders.forEach((folder, index) => {
    const item = document.createElement('li');
    item.className = 'workspace-create-folder-item';
    const details = document.createElement('div');
    details.className = 'workspace-create-folder-details';
    const role = document.createElement('span');
    role.className = 'workspace-create-folder-role';
    role.textContent = translateText(
      index === 0 ? '主文件夹 · /workspace' : `额外挂载 ${index} · 容器路径自动分配`,
      languagePicker.language,
    );
    const name = document.createElement('strong');
    name.textContent = folder.folderName || folder.workspaceName || translateText('已选择的文件夹', languagePicker.language);
    name.setAttribute('data-i18n-ignore', '');
    const path = document.createElement('code');
    path.textContent = folder.localPath || '';
    path.setAttribute('data-i18n-ignore', '');
    details.append(role, name, path);

    const access = createWritePermissionToggle({
      checked: !folder.readOnly,
      label: translateText('写入', languagePicker.language),
      ariaLabel: `${translateText('允许容器写入', languagePicker.language)} ${folder.folderName || folder.workspaceName || translateText('已选择的文件夹', languagePicker.language)}`,
      dataset: { folderIndex: String(index) },
      compact: true,
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'button button-secondary workspace-create-folder-remove';
    remove.dataset.removeFolderIndex = String(index);
    remove.textContent = translateText('移除', languagePicker.language);
    remove.setAttribute('aria-label', translateText(
      `移除 ${folder.folderName || translateText('已选择的文件夹', languagePicker.language)}`,
      languagePicker.language,
    ));
    item.append(details, access, remove);
    workspaceCreateFolderList.append(item);
  });
  updateManagementControls();
}

workspaceCreatePickButton.addEventListener('click', async () => {
  if (actionInProgress || newWorkspaceFolders.length >= 9) return;
  actionInProgress = true;
  updateManagementControls();
  workspaceCreateStatus.hidden = false;
  workspaceCreateStatus.dataset.kind = 'pending';
  workspaceCreateStatus.textContent = translateText('正在打开系统文件夹选择窗口…', languagePicker.language);
  try {
    const result = await api('/api/workspace-create-pick', {
      method: 'POST', body: { language: languagePicker.language },
    });
    if (result.cancelled) {
      workspaceCreateStatus.textContent = translateText('已取消文件夹选择。', languagePicker.language);
      workspaceCreateStatus.dataset.kind = 'info';
      return;
    }
    const normalizedPath = result.localPath || '';
    const duplicate = newWorkspaceFolders.some((folder) => folder.localPath === normalizedPath);
    if (duplicate) {
      await api('/api/workspace-cancel', { method: 'POST', body: { selectionId: result.selectionId } }).catch(() => {});
      workspaceCreateStatus.textContent = translateText('这个文件夹已在列表中。', languagePicker.language);
      workspaceCreateStatus.dataset.kind = 'error';
      return;
    }
    newWorkspaceFolders = [...newWorkspaceFolders, { ...result, readOnly: true }];
    renderNewWorkspaceFolders();
    workspaceCreateStatus.hidden = true;
    workspaceCreateStatus.textContent = '';
  } catch (error) {
    workspaceCreateStatus.textContent = translateText(error.message || '无法选择文件夹，请重试。', languagePicker.language);
    workspaceCreateStatus.dataset.kind = 'error';
    workspaceCreateStatus.hidden = false;
  } finally {
    actionInProgress = false;
    updateManagementControls();
  }
});

workspaceCreateFolderList.addEventListener('change', (event) => {
  const checkbox = event.target.closest('input[type="checkbox"][data-folder-index]');
  if (!checkbox) return;
  const folder = newWorkspaceFolders[Number(checkbox.dataset.folderIndex)];
  if (folder) folder.readOnly = !checkbox.checked;
});
workspaceCreateFolderList.addEventListener('click', async (event) => {
  const remove = event.target.closest('[data-remove-folder-index]');
  if (!remove || actionInProgress) return;
  const index = Number(remove.dataset.removeFolderIndex);
  const [folder] = newWorkspaceFolders.splice(index, 1);
  if (folder?.selectionId) {
    await api('/api/workspace-cancel', { method: 'POST', body: { selectionId: folder.selectionId } }).catch(() => {});
  }
  renderNewWorkspaceFolders();
});

workspaceCreateDialog.addEventListener('cancel', (event) => {
  if (actionInProgress) event.preventDefault();
});
workspaceCreateDialog.addEventListener('close', () => {
  if (!newWorkspaceFolders.length) return;
  const selectionIds = newWorkspaceFolders.map((folder) => folder.selectionId).filter(Boolean);
  newWorkspaceFolders = [];
  renderNewWorkspaceFolders();
  for (const selectionId of selectionIds) {
    api('/api/workspace-cancel', { method: 'POST', body: { selectionId } }).catch(() => {});
  }
});

function renderMounts(data) {
  mountSnapshot = data;
  draftMounts = data.draft || [];
  appliedMounts = data.applied || [];
  mountsDirty = data.dirty === true;
  const extraBoundaries = $('#extra-mount-boundaries');
  extraBoundaries.replaceChildren();
  for (const mount of appliedMounts) extraBoundaries.append(createBoundaryRow(mount));
  $('#active-mount-count').textContent = `${1 + appliedMounts.length} 个文件夹`;
  renderPendingMountChanges(data.primaryReadOnly === true);
  $('#mount-apply-button').textContent = mountsDirty ? '应用更改' : '没有待应用更改';
  updateManagementControls();
}

function createBoundaryRow(mount, changeLabel = '') {
  const row = document.createElement('div');
  row.className = `boundary-row${changeLabel ? ' pending-boundary-row' : ''}`;
  const icon = document.createElement('span');
  icon.className = 'folder-glyph';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M3.5 6.5h6l2 2h9v9.5a1.5 1.5 0 0 1-1.5 1.5h-14A1.5 1.5 0 0 1 3.5 18z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M3.5 9h17" stroke="currentColor" stroke-width="1.7"/></svg>';
  const details = document.createElement('div');
  details.className = 'boundary-details';
  const name = document.createElement('strong');
  name.textContent = mount.folderName;
  name.setAttribute('data-i18n-ignore', '');
  details.append(name);
  if (changeLabel) {
    const change = document.createElement('small');
    change.className = 'pending-change-label';
    change.textContent = changeLabel;
    details.append(change);
  }
  const localPath = document.createElement('small');
  localPath.className = 'path-value';
  const localLabel = document.createElement('span');
  localLabel.textContent = translateText('本机', languagePicker.language);
  const localCode = document.createElement('code');
  localCode.textContent = mount.localPath || '';
  localCode.setAttribute('data-i18n-ignore', '');
  localPath.append(localLabel, localCode);
  const targetPath = document.createElement('small');
  targetPath.className = 'path-value';
  const targetLabel = document.createElement('span');
  targetLabel.textContent = translateText('容器', languagePicker.language);
  const targetCode = document.createElement('code');
  targetCode.textContent = mount.target;
  targetCode.setAttribute('data-i18n-ignore', '');
  targetPath.append(targetLabel, targetCode);
  details.append(localPath, targetPath);
  const access = document.createElement('span');
  access.className = `access ${mount.readOnly ? 'access-read' : 'access-write'}`;
  access.textContent = mount.readOnly ? '只读' : '读写';
  row.append(icon, details, access);
  return row;
}

function renderPendingMountChanges(primaryReadOnly) {
  pendingMountsList.replaceChildren();
  const changes = [];
  const appliedById = new Map(appliedMounts.map((mount) => [mount.id, mount]));
  const draftById = new Map(draftMounts.map((mount) => [mount.id, mount]));
  for (const mount of draftMounts) {
    const applied = appliedById.get(mount.id);
    if (!applied) changes.push({ mount, label: '新增文件夹' });
    else if (applied.readOnly !== mount.readOnly) changes.push({ mount, label: '权限调整' });
  }
  for (const mount of appliedMounts) {
    if (!draftById.has(mount.id)) changes.push({ mount, label: '移除文件夹' });
  }
  if (currentWorkspaceReadOnly !== primaryReadOnly) {
    changes.unshift({
      mount: {
        folderName: $('#workspace-folder-name').textContent,
        localPath: $('#workspace-local-path').textContent,
        target: '/workspace',
        readOnly: primaryReadOnly,
      },
      label: '主文件夹权限调整',
    });
  }
  pendingMountsSection.hidden = !mountsDirty;
  if (!mountsDirty) return;
  for (const change of changes) pendingMountsList.append(createBoundaryRow(change.mount, change.label));
  $('#pending-mount-count').textContent = `${changes.length || 1} 项修改`;
}

function renderCurrentLogPreview() {
  const visibleLines = transientOutput.split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(-4);
  currentLogPreview.textContent = visibleLines.length
    ? visibleLines.join('\n')
    : translateText('暂无可显示的运行日志。', languagePicker.language);
  currentLogPreview.scrollTop = currentLogPreview.scrollHeight;
}

function setFixedLogMessage(message) {
  fixedLogMessage = message;
  logContent.textContent = translateText(message, languagePicker.language);
}

function setLogOutput(output) {
  fixedLogMessage = null;
  logContent.textContent = output;
}

async function refreshMounts() {
  const data = await api('/api/mounts');
  renderMounts(data);
}

async function updateMountDraft(path, body) {
  if (actionInProgress) return;
  actionInProgress = true;
  updateManagementControls();
  try {
    const result = await api(path, { method: 'POST', body });
    renderMounts(result);
    showNotice(mountsDirty ? '挂载清单已暂存；应用前不会重启设备。' : '挂载清单与已应用设置一致。', false);
  } catch (error) {
    showNotice(error.message);
    await refreshMounts().catch(() => {});
  } finally {
    actionInProgress = false;
    updateManagementControls();
  }
}

function clearWorkspaceOutput() {
  lastJobId = null;
  lastSequence = 0;
  transientOutput = '';
  currentAuthorizationUrl = '';
  authorizationPromptedRunId = null;
  updateAuthorizationEntry();
  setFixedLogMessage('选择一条历史记录查看。');
  renderCurrentLogPreview();
}

function makeMountReviewRow(mount) {
  const row = document.createElement('li');
  const name = document.createElement('strong');
  name.textContent = mount.directory;
  name.setAttribute('data-i18n-ignore', '');
  const local = document.createElement('span');
  local.className = 'mount-review-path';
  const localLabel = document.createElement('span');
  localLabel.textContent = translateText('本机', languagePicker.language);
  const localPath = document.createElement('code');
  localPath.textContent = mount.localPath || '';
  localPath.setAttribute('data-i18n-ignore', '');
  local.append(localLabel, document.createTextNode(' '), localPath);
  const container = document.createElement('span');
  container.className = 'mount-review-path';
  const containerLabel = document.createElement('span');
  containerLabel.textContent = translateText('容器', languagePicker.language);
  const containerPath = document.createElement('code');
  containerPath.textContent = mount.target;
  containerPath.setAttribute('data-i18n-ignore', '');
  container.append(containerLabel, document.createTextNode(' '), containerPath);
  const access = document.createElement('span');
  access.textContent = translateText(mount.readOnly ? '只读' : '读写', languagePicker.language);
  row.append(name, local, container, access);
  return row;
}

function showWorkspaceConfirmation(change) {
  pendingWorkspaceChange = { ...change };
  const running = currentProjectState === 'running';
  const mountReview = $('#mount-review-list');
  const pathPreview = $('#workspace-confirm-path-preview');
  mountReview.replaceChildren();
  mountReview.hidden = false;
  pathPreview.hidden = true;
  if (change.type === 'mounts') {
    $('#workspace-confirm-title').textContent = '确认修改挂载？';
    const readOnlyCount = draftMounts.filter((mount) => mount.readOnly).length;
    const readWriteCount = draftMounts.length - readOnlyCount;
    $('#workspace-confirm-description').textContent = running
      ? '确认后，所有已暂存的新增、移除和权限调整会合并为一次变更：当前设备停止一次，再按新清单启动一次。远程连接会暂时断开。'
      : 'Remote Device 当前已停止。确认后保存整份挂载清单；下次手动启动时一次性生效，不会现在启动容器。';
    $('#workspace-confirm-path').textContent = `${draftMounts.length} 个额外挂载文件夹 + /workspace`;
    $('#workspace-confirm-mode').textContent = formatMountAccessSummary({
      workspaceReadOnly: currentWorkspaceReadOnly,
      readWriteCount,
      readOnlyCount,
    }, languagePicker.language);
    $('#workspace-confirm-apply').textContent = running ? '重启一次并应用全部更改' : '保存挂载清单';
    const reviewRows = [
      { directory: $('#workspace-folder-name').textContent, localPath: $('#workspace-local-path').textContent, target: '/workspace', readOnly: currentWorkspaceReadOnly },
      ...draftMounts.map((mount) => ({ directory: mount.folderName, localPath: mount.localPath, target: mount.target, readOnly: mount.readOnly })),
    ];
    for (const mount of reviewRows) mountReview.append(makeMountReviewRow(mount));
  } else if (change.type === 'workspace-edit') {
    const profile = workspaceProfiles.find((item) => item.workspace === change.workspace);
    const active = change.workspace === currentWorkspace;
    const willRestart = active && running && change.runtimeChanged;
    const rows = [
      { directory: change.folderName, localPath: change.localPath, target: '/workspace', readOnly: change.readOnly },
      ...change.mounts.map((mount) => ({
        directory: mount.folderName,
        localPath: mount.localPath,
        target: mount.target || translateText('保存后自动分配容器路径', languagePicker.language),
        readOnly: mount.readOnly,
      })),
    ];
    for (const mount of rows) mountReview.append(makeMountReviewRow(mount));
    $('#workspace-confirm-title').textContent = translateText('确认保存工作区？', languagePicker.language);
    $('#workspace-confirm-description').textContent = translateText(willRestart
      ? '保存后当前 Remote Device 会停止并按新文件夹或权限重启一次。设备登录状态会保留；原文件夹及其内容不会移动或删除。'
      : active
        ? running
          ? '只保存显示名称或没有改变生效设置；当前容器会继续运行。文件夹及其内容不会移动或删除。'
          : '保存工作区设置；设备保持停止，下次手动启动时生效。所选文件夹及其内容不会移动或删除。'
        : '只更新这份工作区的本机配置，不会重启容器，也不会移动或删除文件。', languagePicker.language);
    $('#workspace-confirm-path').textContent = translateText(`${change.label} · ${1 + change.mounts.length} 个文件夹`, languagePicker.language);
    $('#workspace-confirm-mode').textContent = `${translateText(change.readOnly ? '主文件夹：只读' : '主文件夹：读写', languagePicker.language)} · ${translateText(`${change.mounts.length} 个额外挂载`, languagePicker.language)}`;
    $('#workspace-confirm-apply').textContent = translateText(willRestart
      ? '保存并重启一次'
      : '保存更改', languagePicker.language);
    $('#workspace-confirm-local-path').textContent = change.localPath || profile?.localPath || '';
    $('#workspace-confirm-container-path').textContent = '/workspace';
    pathPreview.hidden = false;
  } else if (change.type === 'workspace') {
    $('#workspace-confirm-title').textContent = '切换工作区？';
    const profile = workspaceProfiles.find((item) => item.workspace === change.workspace);
    const mainPath = change.folderName || profile?.folderName || `sandbox-workspace/${change.workspace}`;
    const mainReadOnly = profile?.readOnly === true;
    const savedMounts = profile?.mounts || [];
    $('#workspace-confirm-description').textContent = running
      ? '切换会停止并重新启动同一个 Remote Device 项目一次，再恢复这个工作区上次保存的文件夹权限。设备状态卷不变，登录状态会继续保留。'
      : '切换只保存并加载这个工作区的文件夹清单；设备保持停止，下次手动启动时生效。所有工作区共用同一份设备登录状态。';
    $('#workspace-confirm-path').textContent = `${profile?.label || change.workspace} · ${1 + savedMounts.length} 个文件夹`;
    $('#workspace-confirm-mode').textContent = '设备状态与登录配置保留';
    $('#workspace-confirm-apply').textContent = running ? '切换并重启一次' : '切换工作区';
    const reviewRows = [
      { directory: mainPath, localPath: change.localPath || profile?.localPath, target: '/workspace', readOnly: mainReadOnly },
      ...savedMounts.map((mount) => ({ directory: mount.folderName, localPath: mount.localPath, target: mount.target, readOnly: mount.readOnly })),
    ];
    for (const mount of reviewRows) mountReview.append(makeMountReviewRow(mount));
  } else {
    $('#workspace-confirm-title').textContent = '确认应用文件夹设置？';
    $('#workspace-confirm-description').textContent = running
      ? 'Remote Device 当前正在运行。确认后会停止当前项目，再按新工作区和权限重新启动；远程连接会暂时断开。'
      : 'Remote Device 当前已停止。确认后只更新工作区设置；下次手动启动设备时才会应用，不会现在启动容器。';
    $('#workspace-confirm-path').textContent = change.folderName;
    $('#workspace-confirm-path').setAttribute('data-i18n-ignore', '');
    $('#workspace-confirm-mode').textContent = pendingWorkspaceChange.readOnly ? '容器权限：只读' : '容器权限：读写';
    $('#workspace-confirm-apply').textContent = running ? '停止并重启一次' : '保存设置';
    $('#workspace-confirm-local-path').textContent = change.localPath || '';
    $('#workspace-confirm-container-path').textContent = '/workspace';
    pathPreview.hidden = false;
  }
  openDialog(workspaceConfirmDialog);
}

async function applyPendingWorkspaceChange() {
  if (!pendingWorkspaceChange || actionInProgress) return;
  const change = pendingWorkspaceChange;
  pendingWorkspaceChange = null;
  actionInProgress = true;
  updateManagementControls();
    showNotice(currentProjectState === 'running' ? '正在停止当前容器并按新挂载重新启动一次。' : '正在保存挂载设置；设备保持停止。', false);
  try {
    let result;
    if (change.type === 'mounts') {
      result = await api('/api/mount-apply', { method: 'POST' });
      renderMounts(result.mounts);
    } else if (change.type === 'workspace-edit') {
      result = await api('/api/workspace-edit', {
        method: 'POST',
        body: {
          workspace: change.workspace,
          label: change.label,
          readOnly: change.readOnly,
          mounts: change.mounts.map((mount) => ({
            ...(mount.id ? { mountId: mount.id } : { selectionId: mount.selectionId }),
            readOnly: mount.readOnly,
          })),
          ...(change.selectionId ? { selectionId: change.selectionId } : {}),
        },
      });
      workspaceEditSelectionId = null;
      workspaceEditMounts = [];
      workspaceEditFolderChanged = false;
      if (change.workspace === currentWorkspace) {
        currentWorkspaceReadOnly = result.readOnly;
      }
    } else {
      const body = change.selectionId
        ? { selectionId: change.selectionId, readOnly: change.readOnly }
        : { workspace: change.workspace };
      result = await api('/api/workspace-apply', { method: 'POST', body });
      currentWorkspace = result.workspace;
      currentWorkspaceReadOnly = result.readOnly;
    }
    clearWorkspaceOutput();
    if (result.job) {
      lastJobId = result.job.id;
      renderJob(result.job);
    }
    if (change.type !== 'mounts') await refreshWorkspaces();
    await refresh();
    if (result.unchanged) showNotice('工作区和文件夹权限没有变化。', false);
    else if (result.restarted) showNotice(change.type === 'mounts'
      ? '全部挂载更改已合并，Remote Device 正在重启一次。请查看运行日志；若出现设备码，请在官方页面自行核对和批准。'
      : change.type === 'workspace-edit'
        ? '工作区已更新，Remote Device 正在重启一次；原文件夹和内容已保留。'
        : '工作区已切换；设备状态卷和登录状态沿用。', false);
    else if (change.type === 'workspace-edit') showNotice('工作区设置已保存；本机文件和设备状态均保留。', false);
    else showNotice('挂载设置已更新；设备已停止，下次手动启动时生效。', false);
  } catch (error) {
    if (change.type === 'workspace-edit') {
      setWorkspaceEditStatus(error.message || '无法保存工作区，请重试。', 'error');
      openDialog(workspaceEditDialog);
    } else {
      showNotice(error.message);
    }
  } finally {
    actionInProgress = false;
    updateManagementControls();
  }
}

workspaceSelectButton.addEventListener('click', () => {
  const profile = workspaceProfiles.find((item) => item.workspace === workspaceSelect.value);
  if (!profile) return;
  showWorkspaceConfirmation({ type: 'workspace', workspace: profile.workspace, folderName: profile.folderName, localPath: profile.localPath });
});

workspaceEditButton.addEventListener('click', () => {
  const profile = workspaceProfiles.find((item) => item.workspace === workspaceSelect.value);
  if (!profile) return;
  workspaceEditWorkspace = profile.workspace;
  workspaceEditSelectionId = null;
  workspaceEditFolderChanged = false;
  workspaceEditLocalPath = profile.localPath || '';
  workspaceEditMounts = (profile.workspace === currentWorkspace ? draftMounts : profile.mounts || [])
    .map((mount) => ({ ...mount }));
  workspaceEditStatus.hidden = true;
  workspaceEditStatus.textContent = '';
  workspaceEditStatusMessage = '';
  $('#workspace-edit-label').value = profile.label || profile.workspace;
  $('#workspace-edit-label').setCustomValidity('');
  $('#workspace-edit-folder-name').textContent = profile.folderName;
  $('#workspace-edit-folder-name').setAttribute('data-i18n-ignore', '');
  $('#workspace-edit-local-path').textContent = workspaceEditLocalPath;
  $('#workspace-edit-local-path').setAttribute('data-i18n-ignore', '');
  workspaceAccessMode.checked = !profile.readOnly;
  renderWorkspaceEditMounts();
  openDialog(workspaceEditDialog);
  $('#workspace-edit-label').focus();
});

function setWorkspaceEditStatus(message, kind = 'info') {
  workspaceEditStatusMessage = message;
  workspaceEditStatus.textContent = translateText(workspaceEditStatusMessage, languagePicker.language);
  workspaceEditStatus.dataset.kind = kind;
  workspaceEditStatus.hidden = !message;
}

function cancelWorkspaceEditSelections() {
  const selectionIds = new Set([
    workspaceEditSelectionId,
    ...workspaceEditMounts.map((mount) => mount.selectionId),
  ].filter(Boolean));
  workspaceEditSelectionId = null;
  workspaceEditMounts = [];
  for (const selectionId of selectionIds) {
    api('/api/workspace-cancel', { method: 'POST', body: { selectionId } }).catch(() => {});
  }
}

$('#workspace-edit-folder-button').addEventListener('click', async () => {
  if (actionInProgress) return;
  actionInProgress = true;
  updateManagementControls();
  setWorkspaceEditStatus('正在打开系统文件夹选择窗口…', 'pending');
  try {
    const result = await api('/api/workspace-main-pick', {
      method: 'POST',
      body: { language: languagePicker.language, workspace: workspaceEditWorkspace },
    });
    if (result.cancelled) {
      setWorkspaceEditStatus('已取消文件夹选择。', 'info');
      return;
    }
    if ([...workspaceEditMounts.map((mount) => mount.localPath)].includes(result.localPath)) {
      await api('/api/workspace-cancel', { method: 'POST', body: { selectionId: result.selectionId } }).catch(() => {});
      setWorkspaceEditStatus('这个文件夹已在列表中。', 'error');
      return;
    }
    if (workspaceEditSelectionId) {
      api('/api/workspace-cancel', { method: 'POST', body: { selectionId: workspaceEditSelectionId } }).catch(() => {});
    }
    workspaceEditSelectionId = result.selectionId;
    workspaceEditFolderChanged = result.folderChanged === true;
    workspaceEditLocalPath = result.localPath || '';
    $('#workspace-edit-folder-name').textContent = result.folderName;
    $('#workspace-edit-folder-name').setAttribute('data-i18n-ignore', '');
    $('#workspace-edit-local-path').textContent = workspaceEditLocalPath;
    $('#workspace-edit-local-path').setAttribute('data-i18n-ignore', '');
    setWorkspaceEditStatus('', 'info');
  } catch (error) {
    setWorkspaceEditStatus(error.message || '无法选择文件夹，请重试。', 'error');
  } finally {
    actionInProgress = false;
    updateManagementControls();
  }
});

workspacePickButton.addEventListener('click', async () => {
  if (actionInProgress || workspaceEditMounts.length >= 8) return;
  actionInProgress = true;
  updateManagementControls();
  setWorkspaceEditStatus('正在打开系统文件夹选择窗口…', 'pending');
  try {
    const result = await api('/api/workspace-pick', {
      method: 'POST',
      body: { language: languagePicker.language, workspace: workspaceEditWorkspace },
    });
    if (result.cancelled) {
      setWorkspaceEditStatus('已取消文件夹选择。', 'info');
      return;
    }
    if ([workspaceEditLocalPath, ...workspaceEditMounts.map((mount) => mount.localPath)].includes(result.localPath)) {
      await api('/api/workspace-cancel', { method: 'POST', body: { selectionId: result.selectionId } }).catch(() => {});
      setWorkspaceEditStatus('这个文件夹已在列表中。', 'error');
      return;
    }
    workspaceEditMounts.push({ ...result, readOnly: true });
    renderWorkspaceEditMounts();
    setWorkspaceEditStatus('', 'info');
  } catch (error) {
    setWorkspaceEditStatus(error.message || '无法选择文件夹，请重试。', 'error');
  } finally {
    actionInProgress = false;
    updateManagementControls();
  }
});

workspaceEditMountList.addEventListener('change', (event) => {
  const checkbox = event.target.closest('input[type="checkbox"][data-edit-mount-index]');
  if (!checkbox) return;
  const mount = workspaceEditMounts[Number(checkbox.dataset.editMountIndex)];
  if (mount) mount.readOnly = !checkbox.checked;
});
workspaceEditMountList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove-edit-mount-index]');
  if (!button || actionInProgress) return;
  const index = Number(button.dataset.removeEditMountIndex);
  const [mount] = workspaceEditMounts.splice(index, 1);
  if (mount?.selectionId) {
    api('/api/workspace-cancel', { method: 'POST', body: { selectionId: mount.selectionId } }).catch(() => {});
  }
  renderWorkspaceEditMounts();
});

workspaceEditForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const profile = workspaceProfiles.find((item) => item.workspace === workspaceEditWorkspace);
  const labelInput = $('#workspace-edit-label');
  const label = labelInput.value.trim();
  if (!profile) return;
  if (!label || label.length > 80) {
    labelInput.setCustomValidity('工作区显示名称需要为 1 到 80 个字符。');
    labelInput.reportValidity();
    return;
  }
  labelInput.setCustomValidity('');
  setWorkspaceEditStatus('', 'info');
  const readOnly = !workspaceAccessMode.checked;
  const mountsChanged = workspaceEditMounts.length !== (profile.mounts || []).length
    || workspaceEditMounts.some((mount, index) => mount.selectionId
      || mount.id !== profile.mounts?.[index]?.id
      || mount.readOnly !== profile.mounts?.[index]?.readOnly);
  const runtimeChanged = workspaceEditFolderChanged || readOnly !== profile.readOnly || mountsChanged;
  const change = {
    type: 'workspace-edit',
    workspace: workspaceEditWorkspace,
    label,
    folderName: $('#workspace-edit-folder-name').textContent,
    localPath: workspaceEditLocalPath,
    readOnly,
    selectionId: workspaceEditSelectionId,
    mounts: workspaceEditMounts.map((mount) => ({ ...mount })),
    runtimeChanged,
  };
  workspaceEditSubmitting = true;
  workspaceEditDialog.close();
  showWorkspaceConfirmation(change);
});

$('#workspace-edit-cancel').addEventListener('click', () => {
  workspaceEditDialog.close();
});

workspaceEditDialog.addEventListener('close', () => {
  if (workspaceEditSubmitting) {
    workspaceEditSubmitting = false;
    return;
  }
  workspaceEditFolderChanged = false;
  cancelWorkspaceEditSelections();
  workspaceEditWorkspace = '';
});

workspaceDeleteButton.addEventListener('click', () => {
  const profile = workspaceProfiles.find((item) => item.workspace === workspaceSelect.value);
  if (!profile?.deletable) return;
  pendingWorkspaceDeletion = profile.workspace;
  const active = profile.workspace === currentWorkspace;
  const running = currentProjectState === 'running';
  $('#workspace-delete-name').textContent = `${profile.label || profile.workspace} · ${profile.folderName}`;
  $('#workspace-delete-name').setAttribute('data-i18n-ignore', '');
  $('#workspace-delete-description').textContent = active
    ? running
      ? '这是当前工作区。确认后会切回默认工作区并重启设备一次；设备登录状态会保留。'
      : '这是当前工作区。确认后会切回默认工作区；设备保持停止。'
    : '确认后只移除这份本机工作区配置。';
  $('#workspace-delete-effect').textContent = active
    ? '本机文件会保留；设备状态卷（如存在）不会删除'
    : '本机文件、当前容器和设备状态卷都会保留';
  openDialog(workspaceDeleteDialog);
});

workspaceDeleteDialog.addEventListener('close', async () => {
  const workspace = pendingWorkspaceDeletion;
  pendingWorkspaceDeletion = null;
  if (workspaceDeleteDialog.returnValue !== 'confirm' || !workspace || actionInProgress) return;
  actionInProgress = true;
  updateManagementControls();
  let deletionSucceeded = false;
  try {
    const result = await api('/api/workspace-delete', { method: 'POST', body: { workspace } });
    deletionSucceeded = true;
    workspaceEditDialog.close('deleted');
    currentWorkspace = result.workspace;
    if (result.job) {
      lastJobId = result.job.id;
      renderJob(result.job);
    }
    await refreshWorkspaces();
    await refresh();
    showNotice(result.restarted
      ? '工作区配置已删除，设备正在默认工作区重启；原文件和设备状态已保留。'
      : '工作区配置已删除；文件、容器和状态卷均保留。', false);
  } catch (error) {
    if (deletionSucceeded) showNotice('工作区已删除，但控制台未能刷新状态。', true);
    else setWorkspaceEditStatus(error.message || '无法删除工作区，请重试。', 'error');
    await refreshWorkspaces().catch(() => {});
  } finally {
    actionInProgress = false;
    updateManagementControls();
  }
});

workspaceCreateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const rawName = workspaceNameInput.value.trim();
  const workspace = rawName.toLowerCase();
  const nameHelp = $('#workspace-name-help');
  if (!/^[a-z0-9][a-z0-9_-]{0,27}$/.test(workspace)) {
    workspaceNameInput.setCustomValidity(translateText('名称需要以字母或数字开头，并且只使用字母、数字、下划线或连字符。', languagePicker.language));
    nameHelp.textContent = translateText('名称需要以字母或数字开头，并且只使用字母、数字、下划线或连字符，最多 28 个字符。', languagePicker.language);
    workspaceNameInput.reportValidity();
    return;
  }
  workspaceNameInput.setCustomValidity('');
  workspaceNameInput.value = workspace;
  if (rawName !== workspace) nameHelp.textContent = translateText('创建时会转换成小写。', languagePicker.language);
  workspaceCreateStatus.hidden = false;
  workspaceCreateStatus.dataset.kind = 'pending';
  workspaceCreateStatus.textContent = translateText('正在保存工作区…', languagePicker.language);
  actionInProgress = true;
  updateManagementControls();
  try {
    const folders = newWorkspaceFolders.map(({ selectionId, readOnly }) => ({ selectionId, readOnly }));
    const result = await api('/api/workspace-create', { method: 'POST', body: { workspace, folders } });
    renderWorkspaceProfiles({
      selectionEnabled: workspaceSelectionEnabled,
      selectedWorkspace: result.workspace,
      workspaces: result.workspaces,
    });
    workspaceNameInput.value = '';
    newWorkspaceFolders = [];
    renderNewWorkspaceFolders();
    workspaceCreateDialog.close();
    showNotice(translateText('工作区已保存。当前工作区和正在运行的设备均未切换；可从列表中选择它。', languagePicker.language), false);
  } catch (error) {
    workspaceCreateStatus.textContent = translateText(error.message || '无法保存工作区，请重试。', languagePicker.language);
    workspaceCreateStatus.dataset.kind = 'error';
    workspaceCreateStatus.hidden = false;
  } finally {
    actionInProgress = false;
    updateManagementControls();
  }
});

workspaceNameInput.addEventListener('input', () => {
  const value = workspaceNameInput.value.trim();
  const normalized = value.toLowerCase();
  workspaceNameInput.setCustomValidity('');
  $('#workspace-name-help').textContent = translateText(value && value !== normalized
    ? '创建时会转换成小写。'
    : '使用 1–28 个字母、数字、下划线或连字符；大写字母会自动转成小写。', languagePicker.language);
});

workspaceConfirmDialog.addEventListener('close', () => {
  const change = pendingWorkspaceChange;
  if (change?.type === 'workspace-edit' && workspaceConfirmDialog.returnValue !== 'confirm') {
    pendingWorkspaceChange = null;
    workspaceEditSubmitting = false;
    openDialog(workspaceEditDialog);
    return;
  }
  if (workspaceConfirmDialog.returnValue === 'backdrop') {
    const selectionId = pendingWorkspaceChange?.selectionId;
    if (selectionId) api('/api/workspace-cancel', { method: 'POST', body: { selectionId } }).catch(() => {});
    pendingWorkspaceChange = null;
    workspaceEditSelectionId = null;
    return;
  }
  if (workspaceConfirmDialog.returnValue === 'confirm') {
    applyPendingWorkspaceChange();
    return;
  }
  if (pendingWorkspaceChange?.create) openDialog(workspaceCreateDialog);
  pendingWorkspaceChange = null;
});

mountApplyButton.addEventListener('click', () => {
  if (mountsDirty) showWorkspaceConfirmation({ type: 'mounts' });
});

mountResetButton.addEventListener('click', () => updateMountDraft('/api/mount-reset', {}));

connectivityButton.addEventListener('click', () => {
  openDialog(connectivityDialog);
  refresh();
});

$('#connectivity-close').addEventListener('click', () => connectivityDialog.close());

async function refreshOutput() {
  const data = await api(`/api/output?after=${lastSequence}`);
  const newRun = Boolean(data.job && data.job.id !== lastJobId);
  if (data.job && data.job.id !== lastJobId) {
    lastJobId = data.job.id;
    lastSequence = 0;
    transientOutput = '';
    currentAuthorizationUrl = '';
    authorizationPromptedRunId = null;
    resetAuthorizationFeedback();
    updateAuthorizationEntry();
  }
  if (data.job?.external) {
    transientOutput = data.snapshot || '';
    externalRunActive = true;
  } else {
    for (const line of data.lines || []) {
      transientOutput += `${line.text}\n`;
      lastSequence = line.sequence;
    }
    if (externalRunActive && !data.job) {
      externalRunActive = false;
      outputState.textContent = '已保存';
      currentAuthorizationUrl = '';
      updateAuthorizationEntry();
      if (logsDialog.open) await loadRunHistory({ selectRunId: currentRunId });
    }
  }
  if (transientOutput.length > 64 * 1024) transientOutput = transientOutput.slice(-64 * 1024);
  renderCurrentLogPreview();
  if (data.job) {
    renderJob(data.job);
    if (data.job.kind === 'start') currentRunId = data.job.id;
  }
  if (logsDialog.open && newRun) await loadRunHistory();
  else if (logsDialog.open && selectedRunId && selectedRunId === currentRunId) showSelectedRunLog({ runId: selectedRunId });
}

function formatResourceTime(value) {
  return formatLocalTime(value, languagePicker.language);
}

function setResourceValues(metrics) {
  $('#cpu-value').textContent = metrics?.cpu || '—';
  $('#memory-value').textContent = metrics?.memory || '—';
  $('#network-io-value').textContent = metrics?.network || '—';
  $('#block-io-value').textContent = metrics?.blockIo || '—';
  $('#process-count-value').textContent = Number.isFinite(metrics?.processes) ? String(metrics.processes) : '—';
}

function updateResourceControls() {
  const running = currentProjectState === 'running';
  refreshStorageButton.disabled = !running || storageRequestInProgress || actionInProgress;
}

function renderResourceSnapshot(data) {
  const metrics = data.running ? data.metrics : null;
  const metricsVisible = Boolean(metrics);
  $('#resource-metrics').hidden = !metricsVisible;
  $('#resource-empty').hidden = metricsVisible;
  $('#resource-empty').textContent = data.running
    ? 'Docker 暂未返回资源用量。'
    : '设备运行后显示 CPU 和内存用量。';
  $('#resource-updated').hidden = !metricsVisible;
  $('#resource-updated').textContent = formatResourceTime(data.updatedAt || metrics?.updatedAt);
  setResourceValues(metrics);
  updateResourceControls();
}

async function refreshResourceMetrics() {
  if (!token || document.hidden || currentProjectState !== 'running' || resourceRequestInProgress) return;
  resourceRequestInProgress = true;
  lastResourcePollAt = Date.now();
  updateResourceControls();
  try {
    const data = await api('/api/resources');
    renderResourceSnapshot(data);
  } catch (error) {
    if ($('#resource-metrics').hidden) $('#resource-empty').textContent = error.message;
  } finally {
    resourceRequestInProgress = false;
    updateResourceControls();
  }
}

function renderPersistentStorage() {
  const empty = '—';
  if (storageStatus === 'loading') {
    storageValue.textContent = '正在读取…';
    storageUpdated.textContent = '正在更新';
    $('#device-state-storage').textContent = empty;
    $('#tool-home-storage').textContent = empty;
  } else if (storageStatus === 'success') {
    storageUpdated.textContent = `读取成功 · ${formatResourceTime(storageUpdatedAt)}`;
  } else if (storageStatus === 'unavailable') {
    storageValue.textContent = '设备运行时可读取';
    storageUpdated.textContent = '尚未更新';
    $('#device-state-storage').textContent = empty;
    $('#tool-home-storage').textContent = empty;
  } else if (storageStatus === 'error') {
    storageValue.textContent = '读取失败';
    storageUpdated.textContent = '请重试';
    $('#device-state-storage').textContent = empty;
    $('#tool-home-storage').textContent = empty;
  } else {
    storageValue.textContent = '尚未更新';
    storageUpdated.textContent = '按需读取';
    $('#device-state-storage').textContent = empty;
    $('#tool-home-storage').textContent = empty;
  }
}

async function refreshPersistentStorage() {
  if (currentProjectState !== 'running') {
    storageStatus = 'unavailable';
    renderPersistentStorage();
    return;
  }
  if (storageRequestInProgress) return;
  storageRequestInProgress = true;
  refreshStorageButton.disabled = true;
  storageStatus = 'loading';
  renderPersistentStorage();
  try {
    const data = await api('/api/resources/storage');
    if (!data.available) {
      storageStatus = 'unavailable';
      renderPersistentStorage();
      return;
    }
    storageStatus = 'success';
    storageUpdatedAt = data.updatedAt;
    storageValue.textContent = formatBytes(data.bytes);
    $('#device-state-storage').textContent = formatBytes(data.deviceStateBytes);
    $('#tool-home-storage').textContent = formatBytes(data.toolConfigBytes);
    renderPersistentStorage();
  } catch (error) {
    storageStatus = 'error';
    storageUpdatedAt = null;
    renderPersistentStorage();
  } finally {
    storageRequestInProgress = false;
    updateResourceControls();
  }
}

refreshStorageButton.addEventListener('click', refreshPersistentStorage);
$('#more-resource-details').addEventListener('click', () => {
  openDialog(resourceDialog);
  refreshResourceMetrics();
  refreshPersistentStorage();
});
$('#resource-details-close').addEventListener('click', () => resourceDialog.close());

async function refresh() {
  if (pollInProgress || !token || document.hidden) return;
  pollInProgress = true;
  let statusReceived = false;
  try {
    const data = await api('/api/status');
    statusReceived = true;
    renderStatus(data.status, data.job);
    let workspaceChanged = false;
    if (Number.isSafeInteger(data.workspaceRevision)) {
      if (lastWorkspaceRevision !== null && data.workspaceRevision !== lastWorkspaceRevision) {
        await refreshWorkspaces();
        showNotice('工作区已在命令行中更新，未应用的网页草稿已重置。', false);
        workspaceChanged = true;
      }
      lastWorkspaceRevision = data.workspaceRevision;
    }
    if (data.status.state === 'running') {
      if (!lastResourcePollAt || Date.now() - lastResourcePollAt >= 10_000) refreshResourceMetrics();
    } else {
      lastResourcePollAt = 0;
      renderResourceSnapshot({ running: false });
    }
    await refreshOutput();
    if (data.status.state === 'running' && !workspaceChanged) showNotice('', false);
  } catch (error) {
    if (!statusReceived) {
      statusUnavailable = true;
      currentProjectState = 'unknown';
      renderStatusFreshness();
    }
    if (!lock.hidden) return;
    showNotice(error.message);
  } finally {
    pollInProgress = false;
  }
}

async function runAction(action) {
  if (actionInProgress) return;
  actionInProgress = true;
  showNotice(['build', 'pull'].includes(action) ? '正在准备设备镜像，可能需要几分钟。' : action === 'start' ? '正在启动设备。需要授权时会弹出官方页面入口，请核对设备码后自行批准。' : '正在停止设备。');
  renderJob({ phase: ['build', 'pull'].includes(action) ? 'building' : action === 'start' ? 'starting' : 'stopping', kind: action });
  try {
    const result = await api(`/api/${action}`, { method: 'POST' });
    if (result.job) {
      if (result.job.id !== lastJobId) {
        lastJobId = result.job.id;
        lastSequence = 0;
        transientOutput = '';
        currentAuthorizationUrl = '';
        authorizationPromptedRunId = null;
        resetAuthorizationFeedback();
        updateAuthorizationEntry();
      }
      renderJob(result.job);
    }
    showNotice(['build', 'pull'].includes(action) ? '镜像准备已开始。' : action === 'start' ? '设备正在启动。' : '已请求停止设备，状态会自动更新。', false);
  } catch (error) {
    showNotice(error.message);
  } finally {
    actionInProgress = false;
    await refresh();
  }
}

startButton.addEventListener('click', startWithPreflight);
function openImageSetup() { openDialog($('#image-setup-dialog')); }
buildButton.addEventListener('click', openImageSetup);
$('#image-options-button').addEventListener('click', openImageSetup);
$('#image-setup-close').addEventListener('click', () => $('#image-setup-dialog').close());
$('#download-image-button').addEventListener('click', () => { $('#image-setup-dialog').close(); runAction('pull'); });
$('#source-build-button').addEventListener('click', () => { $('#image-setup-dialog').close(); runAction('build'); });
stopButton.addEventListener('click', () => openDialog(stopDialog));
stopDialog.addEventListener('close', () => {
  if (stopDialog.returnValue === 'confirm') runAction('stop');
});

function proxyModeLabel(mode) {
  return ({
    direct: '直连',
    system: '跟随系统 HTTP(S) 代理',
    manual: '手动 HTTP(S) 代理',
    project: '使用项目配置',
  })[mode] || '使用项目配置';
}

function renderNetworkSettings() {
  const draftMode = proxyModeInputs.find((input) => input.checked)?.value || savedProxyMode;
  const manualUrl = proxyInput.value.trim();
  const dirty = draftMode !== savedProxyMode || (draftMode === 'manual' && Boolean(manualUrl));
  const manualNeedsUrl = draftMode === 'manual' && savedProxyMode !== 'manual' && !manualUrl;
  proxySavedModeLabel.textContent = translateText(
    proxyModeLoaded ? proxyModeLabel(savedProxyMode) : networkSaveState.startsWith('正在读取') ? '正在读取…' : '未能读取',
    languagePicker.language,
  );
  proxyDraftModeLabel.textContent = translateText(proxyModeLoaded ? proxyModeLabel(draftMode) : '—', languagePicker.language);
  proxyRuntimeModeLabel.textContent = translateText(({
    running: '设备正在运行；本机接口不公开当前实际使用的代理模式。',
    stopped: '设备已停止；保存设置将在下次构建或启动时使用。',
    partial: '设备状态异常；无法确认当前容器使用的代理模式。',
    unknown: '暂无法读取本机设备状态。',
  })[currentProjectState] || '暂无法读取本机设备状态。', languagePicker.language);
  for (const input of proxyModeInputs) {
    input.checked = input.value === draftMode;
    input.disabled = !proxyModeLoaded || networkSaveBusy;
  }
  proxyInput.disabled = !proxyModeLoaded || networkSaveBusy;
  manualProxyFields.hidden = draftMode !== 'manual';
  proxySaveButton.disabled = !proxyModeLoaded || networkSaveBusy || !dirty || manualNeedsUrl;
  proxySaveButton.textContent = translateText(networkSaveBusy ? '正在保存…' : '保存设置', languagePicker.language);

  if (networkSaveBusy) {
    proxySaveStatus.textContent = translateText('正在保存网络设置…', languagePicker.language);
    proxySaveStatus.dataset.kind = 'pending';
  } else if (networkSaveState) {
    proxySaveStatus.textContent = translateText(networkSaveState, languagePicker.language);
  } else if (manualNeedsUrl) {
    proxySaveStatus.textContent = translateText('请填写完整的 HTTP(S) 代理地址后保存。', languagePicker.language);
    proxySaveStatus.dataset.kind = 'pending';
  } else if (dirty) {
    proxySaveStatus.textContent = translateText('有尚未保存的修改。', languagePicker.language);
    proxySaveStatus.dataset.kind = 'pending';
  } else {
    proxySaveStatus.textContent = translateText('没有未保存的修改。', languagePicker.language);
    proxySaveStatus.dataset.kind = '';
  }
}

async function refreshProxyMode() {
  const data = await api('/api/proxy');
  savedProxyMode = ['project', 'system', 'manual', 'direct'].includes(data.mode) ? data.mode : 'project';
  proxyModeLoaded = true;
  for (const input of proxyModeInputs) input.checked = input.value === savedProxyMode;
  proxyInput.value = '';
  networkSaveState = '';
  renderNetworkSettings();
}

networkButton.addEventListener('click', async () => {
  proxyModeLoaded = false;
  networkSaveState = '正在读取已保存的网络模式…';
  proxySaveStatus.dataset.kind = 'pending';
  openDialog(networkDialog);
  renderNetworkSettings();
  try {
    await refreshProxyMode();
  } catch {
    networkSaveState = '无法读取已保存的网络模式。请关闭窗口后重试。';
    proxySaveStatus.dataset.kind = 'error';
    renderNetworkSettings();
  }
});

$('#network-close').addEventListener('click', () => networkDialog.close());
for (const input of proxyModeInputs) input.addEventListener('change', () => {
  networkSaveState = '';
  renderNetworkSettings();
});
proxyInput.addEventListener('input', () => {
  networkSaveState = '';
  renderNetworkSettings();
});

networkForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (networkSaveBusy) return;
  const selectedMode = proxyModeInputs.find((input) => input.checked)?.value || savedProxyMode;
  const mode = selectedMode === 'project' ? 'inherit' : selectedMode === 'manual' ? 'proxy' : selectedMode;
  const proxyUrl = proxyInput.value.trim();
  if (selectedMode === 'manual' && !proxyUrl) {
    networkSaveState = '请填写完整的 HTTP(S) 代理地址后保存。';
    proxySaveStatus.dataset.kind = 'error';
    renderNetworkSettings();
    return;
  }

  networkSaveBusy = true;
  networkSaveState = '';
  renderNetworkSettings();
  try {
    const result = await api('/api/proxy', {
      method: 'POST',
      body: { mode, ...(selectedMode === 'manual' ? { proxyUrl } : {}) },
    });
    savedProxyMode = ['project', 'system', 'manual', 'direct'].includes(result.mode) ? result.mode : selectedMode;
    for (const input of proxyModeInputs) input.checked = input.value === savedProxyMode;
    proxyInput.value = '';
    networkSaveState = '设置已保存，将在下次构建或启动时使用；当前运行中的容器不变。';
    proxySaveStatus.dataset.kind = 'success';
  } catch (error) {
    networkSaveState = error.message || '无法保存网络设置，请重试。';
    proxySaveStatus.dataset.kind = 'error';
  } finally {
    networkSaveBusy = false;
    renderNetworkSettings();
  }
});

const diagnosticSetupLinks = {
  node: 'https://nodejs.org/en/download/',
  'docker-cli': 'https://docs.docker.com/get-started/get-docker/',
  compose: 'https://docs.docker.com/compose/install/',
  engine: 'https://docs.docker.com/desktop/',
};

async function runDiagnostics() {
  $('#diagnostics-retry').disabled = true;
  diagnosticsDescription.textContent = '启动前自动检查本机环境；缺少条件时会暂停启动并显示处理方法。检查不会安装软件或访问云端。';
  diagnosticsList.replaceChildren();
  const loading = document.createElement('li');
  loading.className = 'diagnostic-loading';
  loading.textContent = '正在检查启动条件…';
  diagnosticsList.append(loading);
  diagnosticsList.setAttribute('aria-busy', 'true');
  diagnosticsToggle.hidden = true;
  diagnosticsToggle.setAttribute('aria-expanded', 'false');
  diagnosticsStartButton.hidden = true;
  diagnosticsStartButton.disabled = true;
  diagnosticsUpdated.textContent = '启动前正在检查本机条件…';
  diagnosticsSummary.textContent = '正在检查…';
  let result = null;
  try {
    result = await api('/api/diagnostics');
    const data = result;
    diagnosticsList.replaceChildren();
    const labels = { ok: '正常', warning: '待准备', error: '需要处理', info: '说明' };
    if (!Array.isArray(data.checks) || !data.checkedAt) throw new Error('本机检查返回格式无效。');
    const checks = data.checks;
    const collapsibleChecks = checks.filter((check) => ['ok', 'info'].includes(check.status)).length;
    diagnosticsToggle.hidden = collapsibleChecks === 0;
    diagnosticsToggle.setAttribute('aria-expanded', 'true');
    diagnosticsToggle.textContent = '仅显示需关注项';
    for (const check of checks) {
      const row = document.createElement('li');
      row.className = 'diagnostic-row';
      row.dataset.status = check.status;
      row.hidden = false;
      const label = document.createElement('strong');
      label.className = 'diagnostic-label';
      const mark = document.createElement('span');
      mark.className = 'diagnostic-mark';
      mark.setAttribute('aria-hidden', 'true');
      label.append(mark, document.createTextNode(translateText(check.label, languagePicker.language)));
      const content = document.createElement('div');
      const detail = document.createElement('div');
      detail.className = 'diagnostic-detail';
      const status = document.createElement('span');
      status.className = 'diagnostic-status';
      status.textContent = translateText(labels[check.status] || '状态', languagePicker.language);
      const description = document.createElement('span');
      description.textContent = translateText(check.detail, languagePicker.language);
      detail.append(status, document.createTextNode(' · '), description);
      content.append(detail);
      if (check.action) {
        const action = document.createElement('div');
        action.className = 'diagnostic-action';
        action.textContent = translateText(check.action, languagePicker.language);
        content.append(action);
      }
      if (['error', 'warning'].includes(check.status) && diagnosticSetupLinks[check.id]) {
        const link = document.createElement('a');
        link.className = 'diagnostic-help-link';
        link.href = diagnosticSetupLinks[check.id];
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = translateText('打开官方安装说明', languagePicker.language);
        content.append(link);
      }
      if (check.id === 'image' && check.status === 'warning' && currentProjectState !== 'running') {
        const prepare = document.createElement('button');
        prepare.type = 'button';
        prepare.className = 'button button-secondary diagnostic-prepare-button';
        prepare.textContent = translateText('准备设备镜像', languagePicker.language);
        prepare.addEventListener('click', () => {
          diagnosticsDialog.close();
          openImageSetup();
        });
        content.append(prepare);
      }
      row.append(label, content);
      diagnosticsList.append(row);
    }
    const failures = checks.filter((check) => check.status === 'error').length;
    const warnings = checks.filter((check) => check.status === 'warning').length;
    diagnosticsSummary.textContent = translateText(failures ? `${failures} 项需要处理` : warnings ? `${warnings} 项待准备` : '本机条件正常', languagePicker.language);
    const locale = languagePicker.language === 'zh' ? 'zh-CN' : 'en-US';
    diagnosticsUpdated.textContent = translateText(`检查时间：${new Date(data.checkedAt).toLocaleString(locale)}`, languagePicker.language);
    const blocked = checks.some((check) => ['error', 'warning'].includes(check.status));
    if (pendingStartAfterDiagnostics && !blocked) {
      diagnosticsStartButton.hidden = false;
      diagnosticsStartButton.disabled = false;
      diagnosticsSummary.textContent = translateText('本机条件通过', languagePicker.language);
      diagnosticsDescription.textContent = '本机条件通过，可继续启动设备。';
    }
  } catch (error) {
    diagnosticsList.replaceChildren();
    const failure = document.createElement('li');
    failure.className = 'diagnostic-failure';
    failure.textContent = translateText(error.message || '本机检查未能完成，请稍后重试。', languagePicker.language);
    diagnosticsList.append(failure);
    diagnosticsUpdated.textContent = translateText('检查未完成', languagePicker.language);
    diagnosticsSummary.textContent = translateText('检查失败', languagePicker.language);
    result = null;
  } finally {
    diagnosticsList.setAttribute('aria-busy', 'false');
    $('#diagnostics-retry').disabled = false;
  }
  return result;
}

async function startWithPreflight() {
  if (actionInProgress) return;
  pendingStartAfterDiagnostics = false;
  actionInProgress = true;
  startButton.disabled = true;
  updateManagementControls();
  showNotice('启动前正在检查本机条件…', false);
  const result = await runDiagnostics();
  actionInProgress = false;
  startButton.disabled = false;
  updateManagementControls();
  if (!result) {
    pendingStartAfterDiagnostics = true;
    diagnosticsDescription.textContent = '启动已暂停，因为本机条件检查未能完成。请修复检查服务后重新检查；设备尚未启动。';
    openDialog(diagnosticsDialog);
    return;
  }
  const blockers = result.checks.filter((check) => ['error', 'warning'].includes(check.status));
  if (blockers.length) {
    pendingStartAfterDiagnostics = true;
    diagnosticsDescription.textContent = '启动已暂停。请按下方说明解决缺项，并在此弹窗内重新检查；设备尚未启动。';
    openDialog(diagnosticsDialog);
    return;
  }
  showNotice('本机条件检查通过，正在启动设备。', false);
  await runAction('start');
}

$('#diagnostics-retry').addEventListener('click', () => runDiagnostics());
$('#diagnostics-close').addEventListener('click', () => diagnosticsDialog.close());
diagnosticsStartButton.addEventListener('click', () => {
  if (diagnosticsStartButton.disabled || !pendingStartAfterDiagnostics) return;
  pendingStartAfterDiagnostics = false;
  diagnosticsDialog.close('start');
  runAction('start');
});
diagnosticsDialog.addEventListener('close', () => {
  if (diagnosticsDialog.returnValue === 'start') return;
  pendingStartAfterDiagnostics = false;
  diagnosticsStartButton.hidden = true;
});

diagnosticsToggle.addEventListener('click', () => {
  const expanded = diagnosticsToggle.getAttribute('aria-expanded') === 'true';
  const nextExpanded = !expanded;
  diagnosticsToggle.setAttribute('aria-expanded', String(nextExpanded));
  diagnosticsToggle.textContent = nextExpanded ? '仅显示需关注项' : '显示全部检查';
  for (const row of diagnosticsList.children) row.hidden = !nextExpanded && ['ok', 'info'].includes(row.dataset.status);
});

function updateAuthorizationEntry() {
  let safeUrl = '';
  try {
    const parsed = new URL(currentAuthorizationUrl);
    if (isSupportedAuthorizationUrl(parsed)) safeUrl = parsed.toString();
  } catch {}
  if (!safeUrl) {
    if (authorizationDialog.open) authorizationDialog.close();
    authorizationLink.removeAttribute('href');
    authorizationCode.textContent = '';
    resetAuthorizationFeedback();
    return;
  }
  authorizationLink.href = safeUrl;
  try {
    authorizationCode.textContent = new URL(safeUrl).searchParams.get('user_code') || '';
  } catch {
    authorizationCode.textContent = '';
  }
  if (currentRunId && authorizationPromptedRunId !== currentRunId) {
    authorizationPromptedRunId = currentRunId;
    if (!authorizationDialog.open) openDialog(authorizationDialog);
  }
}

$('#authorization-close').addEventListener('click', () => authorizationDialog.close());

authorizationLink.addEventListener('click', () => {
  authorizationState.textContent = '正在等待确认';
  authorizationFeedbackDetail.textContent = '请在 Desktop Commander 官方页面核对设备码并自行完成授权。返回后可检查本机状态；本机容器运行状态不等同于授权成功。';
  authorizationCheckButton.hidden = false;
});

authorizationCheckButton.addEventListener('click', () => {
  // Acknowledgement dismisses this run's prompt; it is not cloud verification.
  authorizationPromptedRunId = currentRunId;
  authorizationDialog.close();
  showNotice('已返回控制台。请在 ChatGPT、Claude 或 Desktop Commander 中确认设备在线；本机控制台不会代为确认云端授权。', false);
});

document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && !(dialog === workspaceCreateDialog && actionInProgress)) dialog.close('backdrop');
  });
});

function renderRunHistory() {
  logsList.replaceChildren();
  for (const run of runHistory) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.runId = run.id;
    button.setAttribute('aria-current', String(run.id === selectedRunId));
    const title = document.createElement('span');
    title.textContent = run.workspace;
    const detail = document.createElement('small');
    const date = new Date(run.startedAt);
    detail.textContent = `${date.toLocaleString(languagePicker.language === 'zh' ? 'zh-CN' : 'en-US')} · ${run.active ? '运行中' : `${Math.max(1, Math.round(run.sizeBytes / 1024))} KB`}`;
    button.append(title, detail);
    button.addEventListener('click', () => showSelectedRunLog({ runId: run.id }));
    item.append(button);
    logsList.append(item);
  }
}

async function loadRunHistory({ preferCurrent = false, selectRunId = null } = {}) {
  try {
    const data = await api('/api/logs');
    runHistory = data.runs || [];
    const listedIds = new Set(runHistory.map((run) => run.id));
    currentRunId = data.currentRunId && listedIds.has(data.currentRunId)
      ? data.currentRunId
      : listedIds.has(currentRunId) ? currentRunId : null;
    if (selectRunId && listedIds.has(selectRunId)) selectedRunId = selectRunId;
    else if (preferCurrent || !listedIds.has(selectedRunId)) selectedRunId = currentRunId || runHistory[0]?.id || null;
    renderRunHistory();
    $('#logs-summary').textContent = runHistory.length
      ? `最近 ${runHistory.length} 次运行 · ${runHistory.some((run) => run.active) ? '当前设备日志持续更新' : '本机保存'}`
      : '还没有保存的设备运行记录。';
    if (selectedRunId) await showSelectedRunLog({ runId: selectedRunId });
    else {
      $('#logs-selected-label').textContent = '启动设备后，这里会显示本次运行和历史记录。';
      setFixedLogMessage('尚无设备运行记录。');
      updateAuthorizationEntry();
    }
  } catch (error) {
    $('#logs-summary').textContent = error.message;
  }
}

async function showSelectedRunLog({ runId = selectedRunId } = {}) {
  if (!runId) return;
  selectedRunId = runId;
  renderRunHistory();
  const selected = runHistory.find((run) => run.id === runId);
  $('#logs-selected-label').textContent = selected
    ? `${selected.workspace} · ${new Date(selected.startedAt).toLocaleString(languagePicker.language === 'zh' ? 'zh-CN' : 'en-US')} · ${selected.filename}`
    : translateText('读取本次运行日志…', languagePicker.language);
  if (runId === currentRunId && selected?.active) {
    if (transientOutput) setLogOutput(transientOutput);
    else setFixedLogMessage('正在等待容器输出…');
    logContent.scrollTop = logContent.scrollHeight;
    updateAuthorizationEntry();
    return;
  }
  currentAuthorizationUrl = '';
  updateAuthorizationEntry();
  try {
    const data = await api(`/api/logs?id=${encodeURIComponent(runId)}`);
    if (data.text) setLogOutput(data.text);
    else setFixedLogMessage('这次运行没有日志输出。');
    logContent.scrollTop = logContent.scrollHeight;
  } catch (error) {
    setLogOutput(translateText(error.message, languagePicker.language));
  }
}

$('#logs-open-button').addEventListener('click', () => {
  openDialog(logsDialog);
  loadRunHistory({ preferCurrent: true });
});
$('#logs-refresh').addEventListener('click', loadRunHistory);
$('#logs-close').addEventListener('click', () => logsDialog.close());

token = loadSessionToken();
if (!token) {
  lockPage();
} else {
  lock.hidden = true;
  refreshWorkspaces().catch((error) => showNotice(error.message));
  refresh();
  window.setInterval(refresh, 5_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });
}
