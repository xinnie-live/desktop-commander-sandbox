import { posix, win32 } from 'node:path';

const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/g;
const MAX_TARGET_SEGMENT_BYTES = 180;

function truncateUtf8(value, maxBytes = MAX_TARGET_SEGMENT_BYTES) {
  let output = '';
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > maxBytes) break;
    output += character;
    bytes += size;
  }
  return output;
}

function folderSegment(directory) {
  const pathApi = win32.isAbsolute(directory) ? win32 : posix;
  let leaf = pathApi.basename(directory).replace(CONTROL_CHARACTERS, '\uFFFD');
  if (!leaf || leaf === '.' || leaf === '..') leaf = 'folder';
  return truncateUtf8(leaf) || 'folder';
}

function validateMount(mount) {
  if (!mount || !/^mount-[a-f0-9]{12}$/.test(mount.id) || typeof mount.directory !== 'string' || !mount.directory) {
    throw new Error('额外挂载配置无效。');
  }
}

export function mountTargetsFor(mounts) {
  if (!Array.isArray(mounts) || !mounts.length) throw new Error('生成挂载路径需要至少一个挂载目录。');
  const ids = new Set();
  for (const mount of mounts) {
    validateMount(mount);
    if (ids.has(mount.id)) throw new Error('额外挂载 ID 不能重复。');
    ids.add(mount.id);
  }

  const segments = mounts.map((mount) => folderSegment(mount.directory));
  for (let attempt = 0; attempt <= mounts.length; attempt += 1) {
    const groups = new Map();
    segments.forEach((segment, index) => {
      const group = groups.get(segment) || [];
      group.push(index);
      groups.set(segment, group);
    });
    const collisions = [...groups.values()].filter((group) => group.length > 1);
    if (!collisions.length) {
      return new Map(mounts.map((mount, index) => [mount.id, `/mnt/remote-device/${segments[index]}`]));
    }
    for (const group of collisions) {
      for (const index of group) {
        const idSuffix = mounts[index].id.slice('mount-'.length);
        segments[index] = `${truncateUtf8(segments[index], MAX_TARGET_SEGMENT_BYTES - idSuffix.length - 2)}--${idSuffix}`;
      }
    }
  }
  throw new Error('无法为同名挂载生成唯一容器路径。');
}

export function composeTargetForMount(mount, mounts = [mount]) {
  validateMount(mount);
  const targets = mountTargetsFor(mounts);
  const target = targets.get(mount.id);
  if (!target) throw new Error('挂载配置不在当前挂载清单中。');
  return target;
}

export function renderMountsCompose(mounts) {
  if (!Array.isArray(mounts) || !mounts.length) throw new Error('生成挂载覆盖文件需要至少一个挂载目录。');
  const targets = mountTargetsFor(mounts);
  const entries = mounts.map((mount) => {
    if (typeof mount.readOnly !== 'boolean') {
      throw new Error('额外挂载配置无效。');
    }
    return [
      '      - type: bind',
      `        source: ${JSON.stringify(mount.directory).replaceAll('$', () => '$$')}`,
      `        target: ${JSON.stringify(targets.get(mount.id)).replaceAll('$', () => '$$')}`,
      `        read_only: ${mount.readOnly}`,
      '        bind:',
      '          create_host_path: false',
    ].join('\n');
  });
  return `services:\n  remote-device:\n    volumes:\n${entries.map((entry) => `${entry}\n`).join('')}`;
}
