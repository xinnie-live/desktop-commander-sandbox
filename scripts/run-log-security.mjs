import { isSupportedAuthorizationUrl } from '../web/authorization-url.mjs';

const AUTHORIZATION_URL_PATTERN = /https:\/\/mcp\.desktopcommander\.app\/(?:device\/verify|verify-device)\?[^\s<>"']+/i;

export function extractAuthorizationUrl(value) {
  const match = String(value).match(AUTHORIZATION_URL_PATTERN);
  if (!match) return null;
  try {
    const url = new URL(match[0].replace(/[),.;]+$/, ''));
    if (!isSupportedAuthorizationUrl(url)) return null;
    return url.toString();
  } catch {
    return null;
  }
}
