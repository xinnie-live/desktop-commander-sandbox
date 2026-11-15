export function isSupportedAuthorizationUrl(value) {
  try {
    const url = new URL(value);
    const code = url.searchParams.get('user_code');
    const supportedPath = url.pathname === '/device/verify'
      || url.pathname === '/verify-device' && url.searchParams.get('verify_device') === 'true';
    return url.protocol === 'https:' && url.hostname === 'mcp.desktopcommander.app'
      && supportedPath && Boolean(code) && /^[a-z0-9-]{4,32}$/i.test(code);
  } catch {
    return false;
  }
}
