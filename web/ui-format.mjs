export function formatMountAccessSummary({ workspaceReadOnly, readWriteCount, readOnlyCount }, language) {
  if (language === 'zh') {
    return `工作区：${workspaceReadOnly ? '只读' : '读写'} · 额外挂载：${readWriteCount} 个读写、${readOnlyCount} 个只读`;
  }
  return `Workspace: ${workspaceReadOnly ? 'read-only' : 'read/write'} · Extra mounts: ${readWriteCount} read/write, ${readOnlyCount} read-only`;
}

/** Decimal byte size for storage readouts, e.g. 1234567 -> "1.23 MB". */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) { value /= 1000; unit += 1; }
  const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** Local time-of-day for a timestamp; empty string when the value is invalid. */
export function formatLocalTime(value, language) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-US');
}
