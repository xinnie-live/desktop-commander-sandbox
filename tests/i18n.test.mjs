import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { detectLanguage, translateText } from '../web/i18n.mjs';
import { formatMountAccessSummary } from '../web/ui-format.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('mount review summary is complete in both interface languages', () => {
  const summary = { workspaceReadOnly: true, readWriteCount: 1, readOnlyCount: 2 };
  assert.equal(formatMountAccessSummary(summary, 'en'), 'Workspace: read-only · Extra mounts: 1 read/write, 2 read-only');
  assert.equal(formatMountAccessSummary(summary, 'zh'), '工作区：只读 · 额外挂载：1 个读写、2 个只读');
});

test('detects Chinese from the browser primary language and defaults other locales to English', () => {
  assert.equal(detectLanguage(['zh-CN', 'en-US']), 'zh');
  assert.equal(detectLanguage(['zh-Hant']), 'zh');
  assert.equal(detectLanguage(['en-US', 'zh-CN']), 'en');
  assert.equal(detectLanguage(['fr-FR']), 'en');
  assert.equal(detectLanguage([]), 'en');
});

test('translates static and dynamic UI strings while preserving surrounding whitespace', () => {
  assert.equal(translateText('  重新检查本机条件  ', 'en'), '  Check local requirements again  ');
  assert.equal(translateText('启动前正在检查本机条件…', 'en'), 'Checking local requirements before startup…');
  assert.equal(translateText('正在检查启动条件…', 'en'), 'Checking startup requirements…');
  assert.equal(
    translateText('可先准备设备镜像；也可点击“启动设备”，系统会先检查本机条件并在缺少镜像时提供准备入口。', 'en'),
    'You can prepare the image first, or select “Start device” to check local requirements and get an image setup option if it is missing.',
  );
  assert.equal(translateText('保存工作区', 'en'), 'Save workspace');
  assert.equal(translateText('允许容器写入', 'en'), 'Allow container write access');
  assert.equal(translateText('未勾选时为只读', 'en'), 'Unchecked means read-only');
  assert.equal(translateText('保存后自动分配容器路径', 'en'), 'Container path assigned when saved');
  assert.equal(translateText('2 个额外挂载', 'en'), '2 extra mounts');
  assert.equal(translateText('主文件夹：只读', 'en'), 'Main folder: read-only');
  assert.equal(translateText('保存独立工作区，不会切换当前工作区或影响正在运行的设备；设备登录状态会沿用。', 'en'), 'Save a separate workspace without switching the active one or affecting a running device. Device sign-in is shared.');
  assert.equal(translateText('工作区文件夹', 'en'), 'Workspace folders');
  assert.equal(translateText('额外挂载', 'en'), 'Extra mounts');
  assert.equal(translateText('逐个选择文件夹：第一项映射到 /workspace，其余作为额外挂载。权限保存在此工作区，切换后生效。', 'en'), 'Add folders one at a time. The first maps to /workspace; others become extra mounts. Permissions are saved here and take effect after switching.');
  assert.equal(translateText('从电脑选择文件夹…', 'en'), 'Choose a folder from this computer…');
  assert.equal(translateText('不选文件夹时，会在项目 sandbox-workspace/ 下创建默认目录。', 'en'), 'No folder selected? A default folder is created under sandbox-workspace/.');
  assert.equal(translateText('1–28 个字符，只用字母、数字、下划线或连字符；大写会转成小写。', 'en'), '1–28 characters; use letters, numbers, underscores, or hyphens. Uppercase is converted to lowercase.');
  assert.equal(translateText('主文件夹 · /workspace', 'en'), 'Main folder · /workspace');
  assert.equal(translateText('额外挂载 2 · 容器路径自动分配', 'en'), 'Extra mount 2 · container path assigned automatically');
  assert.equal(translateText('额外挂载 2访问权限', 'en'), 'Extra mount 2 access');
  assert.equal(translateText('0 / 9', 'en'), '0 / 9');
  assert.equal(
    translateText('可逐个添加电脑上的文件夹；第一项映射为 /workspace，其余作为额外挂载。选择和权限只保存在新工作区中，不会改变当前运行设备。', 'en'),
    'Add folders from your computer one at a time. The first maps to /workspace and the rest become extra mounts. The folders and permissions are saved only in the new workspace and do not change the running device.',
  );
  assert.equal(
    translateText('工作区已保存。当前工作区和正在运行的设备均未切换；可从列表中选择它。', 'en'),
    'Workspace saved. The active workspace and running device were not changed. Select it from the list when you are ready.',
  );
  assert.equal(
    translateText('启动会尝试恢复已保存的设备会话；停止会关闭本机容器并断开远程工具，但会保留本机状态和云端授权。云端在线状态请在 ChatGPT、Claude 或 Desktop Commander 中确认。', 'en'),
    'Start tries to restore the saved device session. Stop closes the local container and disconnects remote tools while preserving local state and cloud authorization. Check ChatGPT, Claude, or Desktop Commander for cloud status.',
  );
  assert.equal(
    translateText('工作区已保存，当前工作区和正在运行的设备均未切换。可稍后从工作区列表中选择它。', 'en'),
    'Workspace saved. The current workspace and running device were not changed. You can select it from the workspace list later.',
  );
  assert.equal(
    translateText('启动已暂停。请按下方说明解决缺项，并在此弹窗内重新检查；设备尚未启动。', 'en'),
    'Startup is paused. Follow the steps below and recheck in this dialog; the device has not started.',
  );
  assert.equal(translateText('显示全部 8 项检查', 'en'), 'Show all 8 checks');
  assert.equal(translateText('1 项需要处理', 'en'), '1 check needs attention');
  assert.equal(translateText('2 项需要处理', 'en'), '2 checks need attention');
  assert.equal(translateText('1 项待准备', 'en'), '1 item needs setup');
  assert.equal(translateText('2 项待准备', 'en'), '2 items need setup');
  assert.equal(translateText('2 个文件夹', 'en'), '2 folders');
  assert.equal(translateText('1 个文件夹', 'en'), '1 folder');
  assert.equal(translateText('default · 1 个文件夹 · 当前', 'en'), 'default · 1 folder · current');
  assert.equal(translateText('review-selected · 2 个文件夹 · 待切换', 'en'), 'review-selected · 2 folders · pending switch');
  assert.equal(translateText('只读（推荐）', 'en'), 'Read-only (recommended)');
  assert.equal(translateText('1 项修改', 'en'), '1 change');
  assert.equal(translateText('切换工作区会恢复该工作区保存的文件夹和权限；设备登录状态沿用。', 'en'), 'Switching restores the folders and permissions saved for that workspace. Device sign-in is shared.');
  assert.equal(translateText('应用后设备最多重启一次。', 'en'), 'Applying changes restarts the device at most once.');
  assert.equal(translateText('持久化数据卷总占用', 'en'), 'Total persistent volume usage');
  assert.equal(translateText('尚无设备运行记录。', 'en'), 'No device run logs yet.');
  assert.equal(translateText('正在等待容器输出…', 'en'), 'Waiting for container output…');
  assert.equal(translateText('当前为 20.1.0；需要 22 或更高版本。', 'en'), 'Current version: 20.1.0; Node.js 22 or later is required.');
  assert.equal(translateText('folder · 2 个文件夹 · 当前 · 文件夹不存在', 'en'), 'folder · 2 folders · current · folder missing');
  assert.equal(translateText(' · 当前', 'en'), ' · current');
  assert.equal(translateText(' · 文件夹不存在', 'en'), ' · folder missing');
  assert.equal(translateText('容器路径：/mnt/example', 'en'), 'Container path: /mnt/example');
  assert.equal(
    translateText('无法读取本机状态；授权结果仍在等待确认。请稍后重试或查看本次运行日志。', 'en'),
    'Could not read local status. Authorization is still unconfirmed; try again later or check this run’s log.',
  );
  assert.equal(translateText('服务可访问（HTTP 200）。', 'en'), 'Service is reachable (HTTP 200).');
  assert.equal(translateText('sandbox-workspace 尚未创建。', 'en'), 'sandbox-workspace has not been created.');
  assert.equal(
    translateText('本机项目工作区配置格式无效；请修复或移除该配置后重试。', 'en'),
    'The local project workspace configuration is invalid. Fix or remove it, then try again.',
  );
  assert.equal(translateText('/Users/example/你好 · 2 个文件夹 · 当前', 'en'), '/Users/example/你好 · 2 folders · current');
  assert.equal(
    translateText('检查时间：10/27/2026。未登录、未配对、未加入设备频道；请在 ChatGPT 或 Claude 中确认设备是否在线。', 'en'),
    'Checked: 10/27/2026. This check does not sign in, pair, or join a device channel. Confirm device status in ChatGPT or Claude.',
  );
  assert.equal(translateText('设备状态', 'zh'), '设备状态');
});

test('English documentation is primary and every published guide links to Simplified Chinese', async () => {
  const documents = [
    'README', 'CONTRIBUTING', 'AGENTS', 'docs/SECURITY_MODEL', 'docs/USAGE', 'docs/AI_WORKFLOW',
  ];
  for (const document of documents) {
    const english = await readFile(resolve(ROOT, `${document}.md`), 'utf8');
    const chinese = await readFile(resolve(ROOT, `${document}.zh-CN.md`), 'utf8');
    assert.match(english, /^\[English\]\([^\n]+\) \| \[简体中文\]\([^\n]+\)$/m, `${document} should link both language versions`);
    assert.match(chinese, /^\[English\]\([^\n]+\) \| \[简体中文\]\([^\n]+\)$/m, `${document}.zh-CN should link both language versions`);
  }
});

test('unknown Chinese service messages remain discoverable through the language switch', () => {
  assert.match(translateText('未知的合成服务错误', 'en'), /Switch the interface language to 中文/);
});

test('image setup translation distinguishes preparation from source builds', () => {
  assert.equal(translateText('准备镜像', 'en'), 'Prepare image');
  assert.equal(translateText('从源码构建', 'en'), 'Build from source');
});

test('workspace dropdown folder counts translate every current, pending and missing combination', () => {
  for (const count of [1, 2, 9]) {
    for (const [status, english] of [['', ''], [' · 当前', ' · current'], [' · 待切换', ' · pending switch']]) {
      for (const missing of [false, true]) {
        const source = `${count} 个文件夹${status}${missing ? ' · 文件夹不存在' : ''}`;
        assert.equal(translateText(source, 'en'), `${count} ${count === 1 ? 'folder' : 'folders'}${english}${missing ? ' · folder missing' : ''}`);
        assert.equal(translateText(source, 'zh'), source);
      }
    }
  }
});
