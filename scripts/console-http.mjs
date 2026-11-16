// HTTP helpers for the local console: response hardening, bearer-token
// comparison, bounded JSON bodies, and redaction of public responses.
import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';

export const DEFAULT_CONSOLE_PORT = 53707;

export function consolePort(value = process.env.REMOTE_DEVICE_CONSOLE_PORT) {
  if (value === undefined) return DEFAULT_CONSOLE_PORT;
  if (!/^(0|[1-9][0-9]{0,4})$/.test(value) || Number(value) > 65535) {
    throw new Error('REMOTE_DEVICE_CONSOLE_PORT must be an integer between 0 and 65535 (0 is for isolated tests).');
  }
  return Number(value);
}

export function sanitizePublicValue(value, redactText, allowLocalPaths = false, allowRawLogText = false) {
  if (typeof value === 'string') return allowRawLogText ? value : redactText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizePublicValue(item, redactText, allowLocalPaths, allowRawLogText));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      // Only explicitly allowlisted workspace/mount responses may expose path
      // fields. Full log text is preserved only on the authenticated log routes.
      if (allowLocalPaths && ['localPath', 'workspaceLocalPath'].includes(key) && typeof item === 'string') return [key, item];
      return [key, sanitizePublicValue(item, redactText, allowLocalPaths, allowRawLogText && ['lines', 'text'].includes(key))];
    }));
  }
  return value;
}

export function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  res.setHeader('Cache-Control', 'no-store');
}

export function safeTokenEqual(candidate, token) {
  if (typeof candidate !== 'string' || candidate.length > 200) return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function readSmallJsonBody(req, maxBytes = 128) {
  const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new Error('请求格式不正确。');
  }
  const contentEncoding = String(req.headers['content-encoding'] || 'identity').trim().toLowerCase();
  if (contentEncoding !== 'identity') throw new Error('不支持压缩的操作请求。');
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error('请求内容过长。');
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString('utf8');
    if (Buffer.byteLength(body, 'utf8') > maxBytes) throw new Error('请求内容过长。');
  }
  if (!body) return {};
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('请求内容不是有效 JSON。');
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('请求内容格式不正确。');
  return parsed;
}

export function openConsoleUrl(url) {
  const opener = process.platform === 'darwin'
    ? ['open', [url], {}]
    : process.platform === 'win32'
      ? ['cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], { windowsVerbatimArguments: true }]
      : ['xdg-open', [url], {}];
  try {
    const child = spawn(opener[0], opener[1], { stdio: 'ignore', ...opener[2] });
    child.once('error', () => console.log('Could not open a browser automatically. Open the URL above on this computer.'));
  } catch {
    console.log('Open the URL above in a browser on this computer.');
  }
}
