import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { translateText } from '../web/i18n.mjs';

// Execute the actual browser status/render functions with a minimal DOM and
// synthetic API. No Docker, browser session, or user data is involved.
const app = await readFile(new URL('../web/app.js', import.meta.url), 'utf8');
const rendering = app.slice(app.indexOf("let currentProjectState = 'unknown';"), app.indexOf('function updateManagementControls()'));
const polling = app.slice(app.indexOf('async function refresh()'), app.indexOf('async function runAction('));
function fixture() {
  const nodes = new Map();
  const element = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { textContent: '', hidden: false, dataset: {}, classList: { toggle() {} }, setAttribute() {} });
    return nodes.get(selector);
  };
  const state = { failStatus: false, failOutput: false, notices: [], reads: 0 };
  const context = vm.createContext({
    $: element, Date, translateText,
    languagePicker: { language: 'en' },
    connectionLocalStatus: element('connection'), networkDialog: { open: false },
    document: { hidden: false }, lock: { hidden: true },
    pollInProgress: false, token: 'synthetic', lastWorkspaceRevision: null,
    lastResourcePollAt: 0, currentImagesReady: false, currentWorkspace: '', currentWorkspaceReadOnly: true,
    renderWorkspaceSelector() {}, updateManagementControls() {}, renderJob() {}, renderNetworkSettings() {},
    refreshWorkspaces: async () => {}, refreshResourceMetrics() {}, renderResourceSnapshot() {},
    showNotice(message) { state.notices.push(message); },
    async api() {
      state.reads++;
      if (state.failStatus) throw new Error('Synthetic status unavailable');
      return { status: { state: 'running', imagesReady: true, workspace: 'trial', project: 'trial', workspaceReadOnly: true } };
    },
    async refreshOutput() { if (state.failOutput) throw new Error('Synthetic log unavailable'); },
  });
  vm.runInContext(`${rendering}\n${polling}`, context);
  return { context, state, element, refresh: () => vm.runInContext('refresh()', context) };
}

test('status failure invalidates running label and recovery restores fresh status', async () => {
  const f = fixture();
  await f.refresh();
  assert.equal(f.element('.overview').dataset.state, 'running');
  f.state.failStatus = true;
  await f.refresh();
  assert.equal(f.element('#project-state').textContent, 'Device status unconfirmed');
  assert.notEqual(f.element('.overview').dataset.state, 'running');
  assert.match(f.element('#status-freshness').textContent, /^Last confirmed:/);
  assert.equal(f.element('#status-freshness').hidden, false);
  assert.equal(vm.runInContext('currentProjectState', f.context), 'unknown');
  assert.match(f.element('#build-guide').textContent, /Start Docker Desktop or Linux Docker Engine/);
  for (const id of ['start', 'build', 'stop', 'image-options', 'source-build', 'download-image']) {
    assert.equal(f.element(`#${id}-button`).disabled, true);
    assert.match(f.element(`#${id}-button`).title, /remote-device:doctor/);
  }
  f.state.failStatus = false;
  await f.refresh();
  assert.equal(f.element('.overview').dataset.state, 'running');
  assert.equal(f.element('#status-freshness').hidden, true);
});

test('a log request failure does not invalidate a successfully read container state', async () => {
  const f = fixture();
  f.state.failOutput = true;
  await f.refresh();
  assert.equal(f.element('.overview').dataset.state, 'running');
  assert.equal(f.element('#status-freshness').hidden, true);
  assert.equal(f.state.notices.at(-1), 'Synthetic log unavailable');
});

test('first status failure and language changes never invent a last-confirmed time', async () => {
  const f = fixture();
  f.state.failStatus = true;
  await f.refresh();
  assert.equal(f.element('#status-freshness').textContent, 'No container status has been received yet.');
  vm.runInContext("languagePicker.language = 'zh'; renderStatusFreshness();", f.context);
  assert.equal(f.element('#project-state').textContent, '设备状态待确认');
  assert.equal(f.element('#status-freshness').textContent, '尚未成功读取容器状态。');
});

test('run history refreshes on job transitions even when the output cursor already knows the job', () => {
  let refreshes = 0;
  const labels = new Map();
  const node = () => ({ hidden: false, disabled: false, textContent: '', classList: { toggle() {} } });
  const context = vm.createContext({
    $: (selector) => { if (!labels.has(selector)) labels.set(selector, node()); return labels.get(selector); }, Date, languagePicker: { language: 'en' },
    currentProjectState: 'running', currentImagesReady: true, actionInProgress: false, statusUnavailable: false,
    currentRunId: null, currentAuthorizationUrl: '', selectedRunId: null,
    logsDialog: { open: true }, outputState: node(),
    buildButton: node(), startButton: node(), stopButton: node(),
    updateManagementControls() {}, updateResourceControls() {}, updateAuthorizationEntry() {},
    renderCurrentLogPreview() {}, resetAuthorizationFeedback() {},
    loadRunHistory() { refreshes++; },
  });
  const source = app.slice(app.indexOf('let renderedJob = null;'), app.indexOf("let currentProjectState = 'unknown';"));
  vm.runInContext(source, context);
  const render = (id, phase) => {
    context.input = { id, phase, kind: 'start', workspace: 'Original trial', startedAt: '2026-11-13T01:00:00Z' };
    vm.runInContext('renderJob(input)', context);
  };
  render('trial-1', 'starting');
  render('trial-1', 'running');
  render('trial-1', 'running');
  assert.equal(refreshes, 2, 'unchanged polling must not reload history');
  labels.get('#current-run-label').textContent = '';
  render('trial-1', 'finished');
  assert.match(labels.get('#current-run-label').textContent, /^Original trial · /, 'run label retains the workspace captured at start');
  render('trial-2', 'starting');
  assert.equal(refreshes, 4, 'stop and restart must update saved/active history');
});

test('completed authorization dismisses the prompt without claiming cloud verification', () => {
  let click;
  let closed = false;
  let notice = '';
  const context = vm.createContext({
    authorizationCheckButton: { addEventListener(event, handler) { click = handler; } },
    authorizationDialog: { close() { closed = true; } },
    currentRunId: 'synthetic-run', authorizationPromptedRunId: null,
    showNotice(message) { notice = message; },
  });
  const begin = app.indexOf("authorizationCheckButton.addEventListener('click', () => {");
  vm.runInContext(app.slice(begin, app.indexOf("document.querySelectorAll('dialog')", begin)), context);
  click();
  assert.equal(closed, true);
  assert.equal(context.authorizationPromptedRunId, 'synthetic-run');
  assert.match(notice, /不会代为确认云端授权/);
});

test('image preparation and device startup are sequential primary actions', () => {
  const nodes = new Map();
  const node = () => ({ hidden: false, disabled: false, textContent: '', classList: { toggle() {} } });
  const build = node(), start = node(), stop = node();
  const context = vm.createContext({
    $: key => { if (!nodes.has(key)) nodes.set(key, node()); return nodes.get(key); },
    currentProjectState: 'stopped', currentImagesReady: false, actionInProgress: false, statusUnavailable: false,
    currentRunId: null, logsDialog: { open: false }, outputState: node(),
    buildButton: build, startButton: start, stopButton: stop,
    updateManagementControls() {}, updateResourceControls() {},
  });
  vm.runInContext(app.slice(app.indexOf('let renderedJob = null;'), app.indexOf("let currentProjectState = 'unknown';")), context);
  vm.runInContext('renderJob(null)', context);
  assert.equal(build.hidden, false);
  assert.equal(start.hidden, true);
  context.currentImagesReady = true;
  vm.runInContext('renderJob(null)', context);
  assert.equal(build.hidden, true);
  assert.equal(start.hidden, false);
  context.currentProjectState = 'running';
  vm.runInContext('renderJob(null)', context);
  assert.equal(start.hidden, true);
  assert.equal(stop.hidden, false);
  context.statusUnavailable = true;
  vm.runInContext('renderJob(null)', context);
  assert.equal(start.disabled, true);
  assert.equal(build.disabled, true);
  assert.equal(stop.disabled, true);
  context.statusUnavailable = false;
  vm.runInContext('renderJob(null)', context);
  assert.equal(stop.disabled, false);
});
