// Parsers for the fixed Docker / Compose commands the console runs.
// They accept command output only and never build commands themselves.

export function parseComposeJson(output) {
  const trimmed = output.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) return JSON.parse(trimmed);
  return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export function parseDockerStats(stdout) {
  const line = stdout.trim().split(/\r?\n/).find(Boolean);
  if (!line) throw new Error('Docker 未返回容器资源数据。');
  let raw;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new Error('无法解析 Docker 容器资源数据。');
  }
  const memory = String(raw.MemUsage || '').split('/')[0].trim();
  const pidsValue = String(raw.PIDs || '').trim();
  return {
    cpu: String(raw.CPUPerc || '').trim() || null,
    memory: memory || null,
    network: String(raw.NetIO || '').trim() || null,
    blockIo: String(raw.BlockIO || '').trim() || null,
    processes: /^\d+$/.test(pidsValue) ? Number(pidsValue) : null,
    updatedAt: new Date().toISOString(),
  };
}

export function parseFixedDuOutput(output, expectedPath) {
  const match = output.trim().match(/^(\d+)\s+(.+)$/);
  if (!match || match[2] !== expectedPath) throw new Error('持久化数据卷占用结果格式不正确。');
  const bytes = Number(match[1]);
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('持久化数据卷占用结果超出可处理范围。');
  return bytes;
}

export function cleanLogText(value) {
  return value
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '\n')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}
