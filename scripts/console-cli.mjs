import { createInterface } from 'node:readline/promises';

function stripGlobalOptions(args) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--project' || arg === '--workspace') {
      index += 1;
      continue;
    }
    if (arg.startsWith('--project=') || arg.startsWith('--workspace=')) continue;
    result.push(arg);
  }
  return result;
}

function parseOptions(args, valueNames = [], flagNames = []) {
  const values = new Map();
  const flags = new Set();
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const equals = arg.indexOf('=');
    const name = equals < 0 ? arg : arg.slice(0, equals);
    if (valueNames.includes(name)) {
      const value = equals < 0 ? args[++index] : arg.slice(equals + 1);
      if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
      values.set(name, [...(values.get(name) || []), value]);
    } else if (flagNames.includes(arg)) {
      flags.add(arg);
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, values, flags };
}

function one(parsed, name) {
  const values = parsed.values.get(name) || [];
  if (values.length > 1) throw new Error(`${name} may be provided only once.`);
  return values[0];
}

function modeFromFlags(parsed, fallback) {
  if (parsed.flags.has('--read-only') && parsed.flags.has('--read-write')) {
    throw new Error('Choose either --read-only or --read-write.');
  }
  return parsed.flags.has('--read-only') ? true : parsed.flags.has('--read-write') ? false : fallback;
}

export function printMapping(title, directory, readOnly, mounts, renderMounts) {
  console.log(title);
  console.log(`  ${directory} -> /workspace (${readOnly ? 'read-only' : 'read/write'})`);
  for (const mount of renderMounts(mounts)) {
    console.log(`  ${mount.localPath} -> ${mount.target} (${mount.readOnly ? 'read-only' : 'read/write'}, ${mount.id})`);
  }
}

export async function confirmApply(yes, prompt = 'Apply this change? [y/N] ') {
  if (yes) return;
  if (!process.stdin.isTTY) throw new Error('Confirmation requires a terminal; pass --yes to explicitly apply from a script.');
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await input.question(prompt);
    if (!/^y(?:es)?$/i.test(answer.trim())) throw new Error('Change cancelled.');
  } finally {
    input.close();
  }
}

async function readProxyUrl() {
  if (!process.stdin.isTTY) {
    let value = '';
    for await (const chunk of process.stdin) {
      value += chunk.toString('utf8');
      if (value.length > 2048) throw new Error('Proxy URL is too long.');
    }
    return value.trim();
  }
  return new Promise((resolve, reject) => {
    let value = '';
    process.stdout.write('Proxy URL (hidden): ');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (error) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u0003') return finish(new Error('Cancelled.'));
        if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
        else if (character >= ' ' && character !== '\u007f') value += character;
        if (value.length > 2048) return finish(new Error('Proxy URL is too long.'));
      }
    };
    process.stdin.on('data', onData);
  });
}

function requirePositionals(parsed, count, usage) {
  if (parsed.positionals.length !== count) throw new Error(`Usage: ${usage}`);
}

function findWorkspace(profiles, name) {
  const profile = profiles.find((item) => item.workspace === name);
  if (!profile) throw new Error(`Workspace not found: ${name}`);
  return profile;
}

function printWorkspace(profile, renderMounts) {
  printMapping(
    `Workspace ${profile.workspace} (${profile.label})${profile.selected ? ' [active]' : ''}`,
    profile.localPath,
    profile.readOnly,
    profile.mounts.map((mount) => ({ id: mount.id, directory: mount.localPath, readOnly: mount.readOnly })),
    renderMounts,
  );
}

async function workspaceCreate(args, api) {
  const parsed = parseOptions(args, ['--main', '--mount-ro', '--mount-rw'], ['--read-only', '--read-write', '--yes']);
  requirePositionals(parsed, 1, 'workspace create <name> [--main <absolute-path>] [--mount-ro <path>] [--mount-rw <path>] [--read-only] [--yes]');
  const name = parsed.positionals[0];
  api.validateNewWorkspaceName(name);
  const mainPath = one(parsed, '--main');
  if (!mainPath && (parsed.values.has('--mount-ro') || parsed.values.has('--mount-rw'))) {
    throw new Error('Specify --main when adding mounts to a new workspace.');
  }
  const primary = mainPath ? await api.preparePath(mainPath, 'workspace-create') : null;
  const readOnly = modeFromFlags(parsed, Boolean(primary));
  const mountInputs = [
    ...(parsed.values.get('--mount-ro') || []).map((path) => ({ path, readOnly: true })),
    ...(parsed.values.get('--mount-rw') || []).map((path) => ({ path, readOnly: false })),
  ];
  const mounts = [];
  const folders = primary ? [{ selectionId: primary.selectionId, readOnly }] : [];
  for (const input of mountInputs) {
    const prepared = await api.preparePath(input.path, 'workspace-create');
    mounts.push({ id: prepared.mountId, directory: prepared.directory, readOnly: input.readOnly });
    folders.push({ selectionId: prepared.selectionId, readOnly: input.readOnly });
  }
  const directory = primary?.directory || api.defaultPath(name);
  await api.validatePlan(directory, readOnly, mounts);
  printMapping(`Create workspace ${name}`, directory, readOnly, mounts, api.renderMounts);
  await confirmApply(parsed.flags.has('--yes'));
  api.refreshSelections(folders.map((folder) => folder.selectionId));
  await api.createWorkspace(name, folders);
  console.log(`Saved workspace ${name}. It is not active until selected.`);
}

async function workspaceEdit(args, api) {
  const parsed = parseOptions(
    args,
    ['--main', '--label', '--mount-ro', '--mount-rw', '--remove-mount', '--mount-mode'],
    ['--read-only', '--read-write', '--yes'],
  );
  requirePositionals(parsed, 1, 'workspace edit <name> [--main <path>] [--label <text>] [--mount-ro <path>] [--mount-rw <path>] [--remove-mount <id>] [--mount-mode <id>:ro|rw] [--yes]');
  const name = parsed.positionals[0];
  const profile = findWorkspace(await api.listWorkspaces(), name);
  const primary = one(parsed, '--main');
  const preparedPrimary = primary ? await api.preparePath(primary, 'workspace-edit', name) : null;
  const directory = preparedPrimary?.directory || profile.localPath;
  const readOnly = modeFromFlags(parsed, profile.readOnly);
  const label = api.validateLabel(one(parsed, '--label') || profile.label);
  const mounts = profile.mounts.map((mount) => ({ id: mount.id, directory: mount.localPath, readOnly: mount.readOnly }));
  const removed = new Set(parsed.values.get('--remove-mount') || []);
  for (const id of removed) {
    if (!mounts.some((mount) => mount.id === id)) throw new Error(`Mount not found: ${id}`);
  }
  const kept = mounts.filter((mount) => !removed.has(mount.id));
  for (const update of parsed.values.get('--mount-mode') || []) {
    const match = update.match(/^(mount-[a-f0-9]{12}):(ro|rw)$/);
    if (!match) throw new Error('--mount-mode must be <id>:ro or <id>:rw.');
    const [, id, mode] = match;
    const mount = kept.find((item) => item.id === id);
    if (!mount) throw new Error(`Mount not found: ${id}`);
    mount.readOnly = mode === 'ro';
  }
  const newMounts = [];
  for (const path of parsed.values.get('--mount-ro') || []) {
    const prepared = await api.preparePath(path, 'workspace-edit-mount', name);
    newMounts.push({ prepared, readOnly: true });
  }
  for (const path of parsed.values.get('--mount-rw') || []) {
    const prepared = await api.preparePath(path, 'workspace-edit-mount', name);
    newMounts.push({ prepared, readOnly: false });
  }
  const finalMounts = [
    ...kept,
    ...newMounts.map(({ prepared, readOnly: mode }) => ({ id: prepared.mountId, directory: prepared.directory, readOnly: mode })),
  ];
  await api.validatePlan(directory, readOnly, finalMounts);
  printMapping(`Edit workspace ${name} (${label})`, directory, readOnly, finalMounts, api.renderMounts);
  await confirmApply(parsed.flags.has('--yes'));
  api.refreshSelections([
    ...(preparedPrimary ? [preparedPrimary.selectionId] : []),
    ...newMounts.map(({ prepared }) => prepared.selectionId),
  ]);
  const result = await api.editWorkspace({
    workspace: name,
    label,
    readOnly,
    ...(preparedPrimary ? { selectionId: preparedPrimary.selectionId } : {}),
    mounts: [
      ...kept.map((mount) => ({ mountId: mount.id, readOnly: mount.readOnly })),
      ...newMounts.map(({ prepared, readOnly: mode }) => ({ selectionId: prepared.selectionId, readOnly: mode })),
    ],
  });
  console.log(result.restarted ? 'Workspace saved; the running device is restarting.' : 'Workspace saved.');
  await api.waitForRestart(result);
}

async function workspaceCommand(args, api) {
  const [action, ...rest] = args;
  if (action === 'list') {
    const parsed = parseOptions(rest);
    requirePositionals(parsed, 0, 'workspace list');
    for (const profile of await api.listWorkspaces()) printWorkspace(profile, api.renderMounts);
    return;
  }
  if (action === 'show') {
    const parsed = parseOptions(rest);
    requirePositionals(parsed, 1, 'workspace show <name>');
    printWorkspace(findWorkspace(await api.listWorkspaces(), parsed.positionals[0]), api.renderMounts);
    return;
  }
  if (action === 'create') return workspaceCreate(rest, api);
  if (action === 'edit') return workspaceEdit(rest, api);
  if (action === 'switch' || action === 'delete') {
    const parsed = parseOptions(rest, [], ['--yes']);
    requirePositionals(parsed, 1, `workspace ${action} <name> [--yes]`);
    const name = parsed.positionals[0];
    const profile = findWorkspace(await api.listWorkspaces(), name);
    printWorkspace(profile, api.renderMounts);
    console.log(action === 'delete' ? 'The profile will be removed; its host folders will be preserved.' : 'The selected profile will become active.');
    await confirmApply(parsed.flags.has('--yes'));
    const result = action === 'delete' ? await api.deleteWorkspace(name) : await api.switchWorkspace(name);
    console.log(result.restarted ? 'Applied; the running device is restarting.' : 'Applied.');
    await api.waitForRestart(result);
    return;
  }
  throw new Error('Usage: workspace <list|show|create|edit|switch|delete> ...');
}

async function mountCommand(args, api) {
  const [action, ...rest] = args;
  const active = (await api.listWorkspaces()).find((profile) => profile.selected);
  if (!active) throw new Error('No active workspace.');
  if (action === 'list') {
    if (rest.length) throw new Error('Usage: mount list');
    printWorkspace(active, api.renderMounts);
    return;
  }
  if (action === 'add') {
    const parsed = parseOptions(rest, [], ['--read-only', '--read-write', '--yes']);
    requirePositionals(parsed, 1, 'mount add <absolute-path> [--read-only] [--yes]');
    return workspaceEdit([active.workspace, modeFromFlags(parsed, true) ? '--mount-ro' : '--mount-rw', parsed.positionals[0], ...(parsed.flags.has('--yes') ? ['--yes'] : [])], api);
  }
  if (action === 'remove') {
    const parsed = parseOptions(rest, [], ['--yes']);
    requirePositionals(parsed, 1, 'mount remove <id> [--yes]');
    return workspaceEdit([active.workspace, '--remove-mount', parsed.positionals[0], ...(parsed.flags.has('--yes') ? ['--yes'] : [])], api);
  }
  if (action === 'mode') {
    const parsed = parseOptions(rest, [], ['--yes']);
    requirePositionals(parsed, 2, 'mount mode <id> <ro|rw> [--yes]');
    return workspaceEdit([active.workspace, '--mount-mode', `${parsed.positionals[0]}:${parsed.positionals[1]}`, ...(parsed.flags.has('--yes') ? ['--yes'] : [])], api);
  }
  throw new Error('Usage: mount <list|add|remove|mode> ...');
}

export async function runTerminalCli(rawArgs, api) {
  const [command, ...args] = stripGlobalOptions(rawArgs);
  if (command === 'workspace') return workspaceCommand(args, api);
  if (command === 'mount') return mountCommand(args, api);
  if (command === 'resources' || command === 'storage') {
    if (args.length) throw new Error(`Usage: ${command}`);
    console.log(JSON.stringify(await (command === 'resources' ? api.resources() : api.storage()), null, 2));
    return;
  }
  if (command === 'logs') {
    if (args[0] === 'list' && args.length === 1) {
      console.log(JSON.stringify(await api.listLogs(), null, 2));
      return;
    }
    if (args[0] === 'show' && args.length === 2) {
      const result = await api.readLog(args[1]);
      process.stdout.write(result.text);
      return;
    }
    throw new Error('Usage: logs list | logs show <run-id>');
  }
  if (command === 'pull') {
    requirePositionals(parseOptions(args, [], []), 0, 'pull');
    return api.runAction('pull');
  }
  if (command === 'build' || command === 'start') {
    const parsed = parseOptions(args, command === 'start' ? ['--proxy', '--main', '--mount-ro', '--mount-rw'] : ['--proxy'], command === 'start' ? ['--read-only', '--read-write', '--yes', '--no-open'] : []);
    requirePositionals(parsed, 0, `${command} [--proxy project|direct|system|manual]${command === 'start' ? ' [--main <absolute-path>] [--mount-ro <absolute-path>] [--mount-rw <absolute-path>] [--read-only|--read-write] [--yes] [--no-open]' : ''}`);
    const mode = one(parsed, '--proxy') || 'project';
    if (!['project', 'direct', 'system', 'manual'].includes(mode)) throw new Error('Invalid proxy mode.');
    await api.setProxy(mode, mode === 'manual' ? await readProxyUrl() : undefined);
    if (command === 'start') {
      await api.prepareStartMapping({
        main: one(parsed, '--main'),
        mountRo: parsed.values.get('--mount-ro') || [],
        mountRw: parsed.values.get('--mount-rw') || [],
        readOnly: modeFromFlags(parsed, undefined),
        yes: parsed.flags.has('--yes'),
      });
      return api.runAction(command, { openBrowser: !parsed.flags.has('--no-open') });
    }
    return api.runAction(command);
  }
  return false;
}

export function printHelp({ project, workspace }) {
  console.log(`Desktop Commander Sandbox local controller

Usage: node scripts/console.mjs <command> [options]

Commands:
  doctor        Check local prerequisites (read-only)
  dashboard     Open the local web console (--no-open disables browser launch)
  status        Show project and image status
  pull          Download the fixed release image from GHCR
  build         Build the device image (--proxy project|direct|system|manual)
  start         Start device and local web console in one foreground process
  stop          Stop the device and preserve local state
  workspace     List, show, create, edit, switch, or delete profiles
  mount         List, add, remove, or change active workspace mounts
  resources     Show fixed container resource metrics
  storage       Show fixed application-volume usage
  logs          List or show local run logs

Options:
  --project <name>    Select a separate Compose project
  --workspace <name>  Select a workspace profile by name

Run workspace, mount, or logs without a subcommand to see syntax. REMOTE_DEVICE_PROJECT and
REMOTE_DEVICE_WORKSPACE are also supported. Current project: ${project};
workspace: ${workspace}`);
}
