import assert from 'node:assert/strict';
import test from 'node:test';
import { folderDisplayName, publicMountSummary, redactHostPaths } from '../scripts/public-data.mjs';

test('local dashboard mount summaries include the host path for mapping review', () => {
  const hostPath = '/tmp/synthetic/private folder';
  const summary = publicMountSummary({
    id: 'mount-012345abcdef',
    directory: hostPath,
    readOnly: true,
  });

  assert.deepEqual(summary, {
    id: 'mount-012345abcdef',
    folderName: 'private folder',
    localPath: hostPath,
    target: '/mnt/remote-device/private folder',
    readOnly: true,
  });
  assert.equal(summary.localPath, hostPath);
});

test('path redaction covers exact host paths, descendants, and Windows separators', () => {
  assert.equal(
    redactHostPaths('folder /tmp/synthetic/private 尚未创建', ['/tmp/synthetic/private']),
    'folder private 尚未创建',
  );
  assert.equal(
    redactHostPaths('cannot read /tmp/synthetic/private/file.txt', ['/tmp/synthetic/private']),
    'cannot read private/file.txt',
  );
  assert.equal(
    redactHostPaths('cannot read C:\\Users\\synthetic\\private\\file.txt', ['C:\\Users\\synthetic\\private']),
    'cannot read private\\file.txt',
  );
  assert.equal(
    redactHostPaths('cannot read c:/users/SYNTHETIC/PRIVATE/file.txt', ['C:\\Users\\Synthetic\\Private']),
    'cannot read Private/file.txt',
  );
});

test('folder labels are bounded and safe for display', () => {
  assert.equal(folderDisplayName('/tmp/a\nfolder'), 'a�folder');
  assert.equal(folderDisplayName('/'), 'root');
  assert.equal(folderDisplayName('C:\\Users\\Example\\Documents'), 'Documents');
});
