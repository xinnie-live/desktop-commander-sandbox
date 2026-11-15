import { spawn } from 'node:child_process';
import { isIP } from 'node:net';
import { join } from 'node:path';

export function normalizeProxyUrl(value) {
  if (typeof value !== 'string' || value.length > 1800 || /[\u0000-\u0020\u007f]/.test(value)) {
    throw new Error('请输入有效的 HTTP(S) 代理地址。');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('代理地址格式不正确，请填写完整的 http:// 或 https:// 地址。');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('代理地址只支持 HTTP(S) 协议和主机/端口，不支持路径、查询参数或片段。');
  }
  return parsed.toString();
}

function buildProxyUrl(host, port = '') {
  const value = String(host || '').trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return normalizeProxyUrl(value);
  const alreadyBracketedIpv6 = /^\[[0-9a-f:.]+\](?::\d+)?$/i.test(value);
  const urlHost = alreadyBracketedIpv6 ? value : isIP(value) === 6 ? `[${value}]` : value;
  const portValue = String(port || '').trim();
  if (portValue && (!/^\d{1,5}$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65_535)) {
    throw new Error('系统代理端口格式无效，请改用手动 HTTP(S) 地址。');
  }
  return normalizeProxyUrl(`http://${urlHost}${portValue ? `:${portValue}` : ''}`);
}

export function proxyUrlForContainer(proxyUrl) {
  if (!proxyUrl) return '';
  const parsed = new URL(proxyUrl);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  const ipv4Parts = hostname.split('.').map(Number);
  const isIpv4Loopback = isIP(hostname) === 4 && ipv4Parts[0] === 127;
  if (['localhost', '127.0.0.1', '::1', '0.0.0.0', '::'].includes(hostname) || isIpv4Loopback) {
    parsed.hostname = 'host.docker.internal';
  }
  return parsed.toString();
}

function normalizeNoProxy(values = []) {
  const entries = Array.isArray(values) ? values : [values];
  const normalized = new Set(['localhost', '127.0.0.1', '::1', 'host.docker.internal']);
  for (const value of entries) {
    for (const entry of String(value || '').split(/[;,]/)) {
      const item = entry.trim();
      if (!item || item.toLowerCase() === '<local>') continue;
      if (/^[a-z0-9.*:/_\-\[\]]+$/i.test(item)) normalized.add(item.toLowerCase());
    }
  }
  return [...normalized].join(',');
}

function completeProxyConfig(httpProxy, httpsProxy = '', bypassList = []) {
  const http = httpProxy || httpsProxy;
  const https = httpsProxy || httpProxy;
  return {
    http: proxyUrlForContainer(http),
    https: proxyUrlForContainer(https),
    noProxy: normalizeNoProxy(bypassList),
  };
}

export function parseMacProxySettings(output) {
  const values = {};
  const exceptions = [];
  let readingExceptions = false;
  for (const line of output.split(/\r?\n/)) {
    if (/ExceptionsList\s*:\s*<array>/i.test(line)) {
      readingExceptions = true;
      continue;
    }
    if (readingExceptions) {
      if (/^\s*}\s*$/.test(line)) {
        readingExceptions = false;
        continue;
      }
      const exception = line.match(/<string>(.*?)<\/string>/);
      if (exception) exceptions.push(exception[1]);
      continue;
    }
    const match = line.match(/^\s*([A-Za-z][A-Za-z0-9]+)\s*:\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^<[^>]+>|<\/[^>]+>$/g, '');
  }
  if (values.ProxyAutoConfigEnable === '1') {
    throw new Error('当前系统使用 PAC 自动代理；请在“网络设置”中填入可用的 HTTP(S) 代理地址。');
  }
  const http = values.HTTPEnable === '1' ? buildProxyUrl(values.HTTPProxy, values.HTTPPort) : '';
  const https = values.HTTPSEnable === '1' ? buildProxyUrl(values.HTTPSProxy, values.HTTPSPort) : '';
  if (!http && !https && values.SOCKSEnable === '1') {
    throw new Error('当前系统只配置了 SOCKS 代理；请提供 HTTP(S) 代理地址。');
  }
  return completeProxyConfig(http, https, exceptions);
}

export function parseWindowsProxySettings(output) {
  const values = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(ProxyEnable|ProxyServer|ProxyOverride|AutoConfigURL)\s+REG_\w+\s+(.*?)\s*$/i);
    if (match) values[match[1].toLowerCase()] = match[2];
  }
  if (values.autoconfigurl) {
    throw new Error('当前 Windows 系统使用 PAC 自动代理；请在“网络设置”中填入可用的 HTTP(S) 代理地址。');
  }
  if (!values.proxyenable || !['0x1', '1'].includes(values.proxyenable.toLowerCase())) return { http: '', https: '' };
  const entries = {};
  let fallback = '';
  for (const item of (values.proxyserver || '').split(';').map((part) => part.trim()).filter(Boolean)) {
    const separator = item.indexOf('=');
    if (separator < 0) fallback = item;
    else entries[item.slice(0, separator).toLowerCase()] = item.slice(separator + 1);
  }
  const http = buildProxyUrl(entries.http || fallback);
  const https = buildProxyUrl(entries.https || entries.http || fallback);
  if (!http && !https && entries.socks) throw new Error('当前 Windows 系统只配置了 SOCKS 代理；请提供 HTTP(S) 代理地址。');
  return completeProxyConfig(http, https, (values.proxyoverride || '').split(';'));
}

export function configFromLinuxEnvironment(env) {
  const http = env.HTTP_PROXY || env.http_proxy || '';
  const https = env.HTTPS_PROXY || env.https_proxy || '';
  const bypass = env.NO_PROXY || env.no_proxy || '';
  if (http || https) return completeProxyConfig(http, https, bypass.split(','));
  const allProxy = env.ALL_PROXY || env.all_proxy || '';
  if (allProxy) {
    if (!/^https?:\/\//i.test(allProxy)) throw new Error('检测到非 HTTP(S) 的 ALL_PROXY；请在“网络设置”中填写 HTTP(S) 地址。');
    return completeProxyConfig(allProxy, allProxy, bypass.split(','));
  }
  return null;
}

export function parseGnomeProxySettings(modeValue, fields) {
  const mode = String(modeValue).trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  if (mode === 'none') return { http: '', https: '' };
  if (mode === 'auto') throw new Error('当前 Linux 系统使用 PAC 自动代理；请手动填写可用的 HTTP(S) 代理地址。');
  if (mode !== 'manual') throw new Error('无法识别当前 Linux 桌面代理模式；请手动填写 HTTP(S) 代理地址。');
  const http = buildProxyUrl(fields.httpHost, fields.httpPort);
  const https = buildProxyUrl(fields.httpsHost, fields.httpsPort);
  const ignoreHosts = String(fields.ignoreHosts || '').match(/'([^']*)'/g)?.map((item) => item.slice(1, -1)) || [];
  return completeProxyConfig(http, https, ignoreHosts);
}

function runHostSettingCommand(program, args, timeoutMs = 4000) {
  return new Promise((resolveRun) => {
    const child = spawn(program, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1000).unref();
    }, timeoutMs);
    const collect = (current, chunk) => (current + chunk.toString('utf8')).slice(-16_000);
    child.stdout.on('data', (chunk) => { stdout = collect(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = collect(stderr, chunk); });
    child.once('error', (error) => {
      clearTimeout(timer);
      resolveRun({ code: 127, stdout, stderr: error.message, timedOut });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolveRun({ code: code ?? 1, stdout, stderr, timedOut });
    });
  });
}

async function readMacSystemProxy() {
  const result = await runHostSettingCommand('/usr/sbin/scutil', ['--proxy']);
  if (result.code !== 0 || result.timedOut) throw new Error('无法读取 macOS 系统代理设置。请手动填写 HTTP(S) 代理地址。');
  return parseMacProxySettings(result.stdout);
}

async function readWindowsSystemProxy() {
  const registryPath = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const result = await runHostSettingCommand(join(systemRoot, 'System32', 'reg.exe'), ['query', registryPath]);
  if (result.code !== 0 || result.timedOut) throw new Error('无法读取当前 Windows 用户的系统代理设置。请手动填写 HTTP(S) 代理地址。');
  return parseWindowsProxySettings(result.stdout);
}

async function readLinuxSystemProxy() {
  const fromEnvironment = configFromLinuxEnvironment(process.env);
  if (fromEnvironment) return fromEnvironment;
  const command = '/usr/bin/gsettings';
  const modeResult = await runHostSettingCommand(command, ['get', 'org.gnome.system.proxy', 'mode']);
  if (modeResult.code !== 0 || modeResult.timedOut) {
    throw new Error('当前 Linux 桌面未提供可读取的系统代理设置；请在“网络设置”中填写 HTTP(S) 代理地址。');
  }
  const mode = modeResult.stdout.trim();
  if (mode.trim().replace(/^['"]|['"]$/g, '').toLowerCase() !== 'manual') return parseGnomeProxySettings(mode, {});

  const [httpHost, httpPort, httpsHost, httpsPort, ignoreHosts] = await Promise.all([
    runHostSettingCommand(command, ['get', 'org.gnome.system.proxy.http', 'host']),
    runHostSettingCommand(command, ['get', 'org.gnome.system.proxy.http', 'port']),
    runHostSettingCommand(command, ['get', 'org.gnome.system.proxy.https', 'host']),
    runHostSettingCommand(command, ['get', 'org.gnome.system.proxy.https', 'port']),
    runHostSettingCommand(command, ['get', 'org.gnome.system.proxy', 'ignore-hosts']),
  ]);
  if ([httpHost, httpPort, httpsHost, httpsPort].some((result) => result.code !== 0 || result.timedOut)) {
    throw new Error('无法读取 GNOME HTTP(S) 代理字段；请手动填写 HTTP(S) 代理地址。');
  }
  const value = (result) => result.stdout.trim().replace(/^['"]|['"]$/g, '');
  return parseGnomeProxySettings(mode, {
    httpHost: value(httpHost),
    httpPort: value(httpPort),
    httpsHost: value(httpsHost),
    httpsPort: value(httpsPort),
    ignoreHosts: value(ignoreHosts),
  });
}

export async function readSystemProxy() {
  if (process.platform === 'darwin') return readMacSystemProxy();
  if (process.platform === 'win32') return readWindowsSystemProxy();
  if (process.platform === 'linux') return readLinuxSystemProxy();
  throw new Error('当前操作系统暂不支持读取系统代理；请手动填写 HTTP(S) 代理地址。');
}
