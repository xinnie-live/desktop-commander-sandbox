export const MINIMUM_COMPOSE_VERSION = '2.24.1';

export function isComposeVersionSupported(versionOutput) {
  const match = String(versionOutput).match(/(?:^|\s)v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const actual = match.slice(1).map(Number);
  const minimum = MINIMUM_COMPOSE_VERSION.split('.').map(Number);
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true;
    if (actual[index] < minimum[index]) return false;
  }
  return true;
}
