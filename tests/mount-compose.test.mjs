import assert from 'node:assert/strict';
import test from 'node:test';
import { composeTargetForMount, renderMountsCompose } from '../scripts/mount-compose.mjs';

test('mount targets use folder names and enforce per-mount read-only bind mounts', () => {
  const yaml = renderMountsCompose([
    { id: 'mount-012345abcdef', directory: '/tmp/研究 file', readOnly: true },
    { id: 'mount-fedcba987654', directory: 'C:\\Users\\Example\\$draft', readOnly: false },
  ]);
  assert.match(yaml, /target: "\/mnt\/remote-device\/研究 file"\n        read_only: true/);
  assert.ok(yaml.includes(`source: ${JSON.stringify('C:\\Users\\Example\\$draft').replaceAll('$', () => '$$')}`));
  assert.match(yaml, /target: "\/mnt\/remote-device\/\$\$draft"\n        read_only: false/);
  assert.equal(composeTargetForMount({ id: 'mount-012345abcdef', directory: '/tmp/研究 file' }), '/mnt/remote-device/研究 file');
  assert.throws(() => renderMountsCompose([{ id: '../bad', directory: '/tmp', readOnly: false }]), /挂载配置无效/);
});

test('duplicate folder names get stable unique container targets', () => {
  const mounts = [
    { id: 'mount-012345abcdef', directory: '/Users/a/docs', readOnly: true },
    { id: 'mount-fedcba987654', directory: 'C:\\Users\\b\\docs', readOnly: false },
  ];
  assert.equal(composeTargetForMount(mounts[0], mounts), '/mnt/remote-device/docs--012345abcdef');
  assert.equal(composeTargetForMount(mounts[1], mounts), '/mnt/remote-device/docs--fedcba987654');
  const yaml = renderMountsCompose(mounts);
  assert.ok(yaml.includes('target: "/mnt/remote-device/docs--012345abcdef"'));
  assert.ok(yaml.includes('target: "/mnt/remote-device/docs--fedcba987654"'));
});

test('generated target collisions with a naturally named folder are also resolved', () => {
  const mounts = [
    { id: 'mount-012345abcdef', directory: '/Users/a/docs', readOnly: true },
    { id: 'mount-fedcba987654', directory: '/Users/b/docs', readOnly: true },
    { id: 'mount-111111111111', directory: '/Users/c/docs--012345abcdef', readOnly: true },
  ];
  const targets = mounts.map((mount) => composeTargetForMount(mount, mounts));
  assert.equal(new Set(targets).size, mounts.length);
});
