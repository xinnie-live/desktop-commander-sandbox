import { composeTargetForMount } from './mount-compose.mjs';

const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/g;

export function folderDisplayName(directory) {
  if (typeof directory !== 'string' || !directory) return 'folder';
  const segments = directory.split(/[\\/]+/).filter(Boolean);
  const leaf = segments.at(-1) || 'root';
  return leaf.replace(CONTROL_CHARACTERS, '\uFFFD').slice(0, 120) || 'folder';
}

export function publicMountSummary(mount, mounts = [mount]) {
  return {
    id: mount.id,
    folderName: folderDisplayName(mount.directory),
    // This path is only returned to the authenticated loopback dashboard so the
    // local user can verify the exact host-to-container mapping. Other output
    // is still passed through the host-path redactor.
    localPath: mount.directory,
    target: composeTargetForMount(mount, mounts),
    readOnly: mount.readOnly,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createHostPathRedactor(hostPaths) {
  const paths = [...new Set(hostPaths.filter((entry) => typeof entry === 'string' && entry.length
    && entry !== '/' && entry !== '\\' && !/^[a-z]:[\\/]*$/iu.test(entry)))]
    .flatMap((entry) => [entry, entry.replaceAll('\\', '/'), entry.replaceAll('/', '\\')])
    .sort((left, right) => right.length - left.length);
  const patterns = [...new Set(paths)].map((hostPath) => ({
    pattern: new RegExp(`${escapeRegExp(hostPath)}(?=$|[\\\\/\\s"'<>|,;:)}\\]])`, 'gi'),
    replacement: folderDisplayName(hostPath),
  }));
  return (value) => {
    let output = String(value);
    for (const { pattern, replacement } of patterns) output = output.replace(pattern, () => replacement);
    return output;
  };
}

export function redactHostPaths(value, hostPaths) {
  return createHostPathRedactor(hostPaths)(value);
}
