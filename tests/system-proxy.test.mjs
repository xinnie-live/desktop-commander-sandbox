import assert from 'node:assert/strict';
import test from 'node:test';
import {
  configFromLinuxEnvironment,
  normalizeProxyUrl,
  parseGnomeProxySettings,
  parseMacProxySettings,
  parseWindowsProxySettings,
  proxyUrlForContainer,
} from '../scripts/system-proxy.mjs';

test('maps a loopback proxy to the host gateway name without changing its credentials', () => {
  assert.equal(
    proxyUrlForContainer('http://sample-user:sample-secret@127.0.0.1:18080'),
    'http://sample-user:sample-secret@host.docker.internal:18080/',
  );
  assert.equal(proxyUrlForContainer('http://127.0.0.2:3128'), 'http://host.docker.internal:3128/');
  assert.equal(proxyUrlForContainer('http://proxy.example:8080'), 'http://proxy.example:8080/');
});

test('accepts only complete HTTP(S) proxy URLs', () => {
  assert.equal(normalizeProxyUrl('https://proxy.example:8443'), 'https://proxy.example:8443/');
  assert.throws(() => normalizeProxyUrl('file:///tmp'), /HTTP\(S\)/);
  assert.throws(() => normalizeProxyUrl('http://proxy.example:8080/path'), /不支持路径/);
});

test('parses macOS manual HTTP and HTTPS proxy settings', () => {
  const result = parseMacProxySettings([
    'HTTPEnable : 1',
    'HTTPProxy : 127.0.0.1',
    'HTTPPort : 18080',
    'HTTPSEnable : 1',
    'HTTPSProxy : proxy.example',
    'HTTPSPort : 8443',
    'ExceptionsList : <array> {',
    '  <string>*.internal</string>',
    '}',
  ].join('\n'));
  assert.deepEqual(result, {
    http: 'http://host.docker.internal:18080/',
    https: 'http://proxy.example:8443/',
    noProxy: 'localhost,127.0.0.1,::1,host.docker.internal,*.internal',
  });
});

test('rejects macOS PAC and SOCKS-only settings instead of silently using direct networking', () => {
  assert.throws(() => parseMacProxySettings('ProxyAutoConfigEnable : 1'), /PAC/);
  assert.throws(() => parseMacProxySettings('SOCKSEnable : 1'), /SOCKS/);
});

test('parses Windows per-protocol and shared manual proxy settings', () => {
  const result = parseWindowsProxySettings([
    '    ProxyEnable    REG_DWORD    0x1',
    '    ProxyServer    REG_SZ    http=127.0.0.1:18080;https=secure-proxy.example:9443',
    '    ProxyOverride    REG_SZ    *.internal;localhost;<local>',
  ].join('\n'));
  assert.deepEqual(result, {
    http: 'http://host.docker.internal:18080/',
    https: 'http://secure-proxy.example:9443/',
    noProxy: 'localhost,127.0.0.1,::1,host.docker.internal,*.internal',
  });
  assert.deepEqual(parseWindowsProxySettings('ProxyEnable REG_DWORD 0x0\nProxyServer REG_SZ stale:8080'), { http: '', https: '' });
  assert.deepEqual(parseWindowsProxySettings('ProxyServer REG_SZ stale:8080'), { http: '', https: '' });
  assert.throws(() => parseWindowsProxySettings('AutoConfigURL REG_SZ https://proxy.example/config.pac'), /PAC/);
  assert.throws(() => parseWindowsProxySettings('ProxyEnable REG_DWORD 0x1\nProxyServer REG_SZ socks=127.0.0.1:1080'), /SOCKS/);
});

test('uses Linux proxy environment variables and validates their protocols', () => {
  assert.deepEqual(configFromLinuxEnvironment({ http_proxy: 'http://127.0.0.1:3128', no_proxy: '*.internal,example.com' }), {
    http: 'http://host.docker.internal:3128/',
    https: 'http://host.docker.internal:3128/',
    noProxy: 'localhost,127.0.0.1,::1,host.docker.internal,*.internal,example.com',
  });
  assert.deepEqual(configFromLinuxEnvironment({ HTTPS_PROXY: 'https://proxy.example:8443' }), {
    http: 'https://proxy.example:8443/',
    https: 'https://proxy.example:8443/',
    noProxy: 'localhost,127.0.0.1,::1,host.docker.internal',
  });
  assert.throws(() => configFromLinuxEnvironment({ ALL_PROXY: 'socks5://proxy.example:1080' }), /HTTP\(S\)/);
  assert.equal(configFromLinuxEnvironment({}), null);
});

test('parses GNOME manual mode and rejects automatic PAC mode', () => {
  assert.deepEqual(parseGnomeProxySettings("'manual'", {
    httpHost: '127.0.0.1', httpPort: '3128', httpsHost: '', httpsPort: '0',
  }), {
    http: 'http://host.docker.internal:3128/',
    https: 'http://host.docker.internal:3128/',
    noProxy: 'localhost,127.0.0.1,::1,host.docker.internal',
  });
  assert.deepEqual(parseGnomeProxySettings("'none'", {}), { http: '', https: '' });
  assert.throws(() => parseGnomeProxySettings("'auto'", {}), /PAC/);
});
