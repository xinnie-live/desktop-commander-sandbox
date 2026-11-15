// Run-log file constants and ownership check. Logs keep complete container
// stdout/stderr locally; see docs/USAGE.md for retention limits.
import { open } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';

export const MAX_PERSISTED_RUN_BYTES = 10 * 1024 * 1024;
export const MAX_PERSISTED_RUNS = 7;
export const LOG_TRAILER_RESERVE_BYTES = 512;
export const LOG_TRUNCATION_MARKER = Buffer.from('\n[日志达到单文件上限，后续输出未写入。]\n', 'utf8');
export const RUN_LOG_SIGNATURE = Buffer.from('Desktop Commander Sandbox · 本次设备运行\n', 'utf8');

export async function isOwnedRunLog(path) {
  let handle;
  try {
    const noFollow = fsConstants.O_NOFOLLOW || 0;
    handle = await open(path, fsConstants.O_RDONLY | noFollow);
    const prefix = Buffer.alloc(RUN_LOG_SIGNATURE.length);
    const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
    return bytesRead === prefix.length && prefix.equals(RUN_LOG_SIGNATURE);
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
}
