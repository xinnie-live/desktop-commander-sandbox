import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Exercise the actual doctor with synthetic process/platform and Docker replies.
// No Docker commands, real configuration, or host directories are accessed.
const source = await readFile(new URL('../scripts/console.mjs', import.meta.url), 'utf8');
const doctor = source.slice(source.indexOf('function printDoctorCheck('), source.indexOf('function runComposeCapture('));
async function run(platform, failure) {
  const calls = [], lines = [];
  const context = vm.createContext({
    console: { log: line => lines.push(line) },
    process: { platform, arch: 'x64', versions: { node: '22.21.0' }, getuid: () => 1000 },
    MINIMUM_COMPOSE_VERSION: '2.24.1', PROJECT: 'trial', WORKSPACE: 'default',
    PROJECT_OVERRIDE: null, EXPLICIT_WORKSPACE: false,
    isComposeVersionSupported: version => version === '2.24.1',
    composeArgs: args => ['compose', ...args],
    inspectFixedMountDirectories: async () => ({ status: 'ok' }),
    runDockerCapture: async args => {
      calls.push(args.join(' '));
      if (args[0] === '--version') return { code: failure === 'cli' ? 127 : 0, stdout: 'Docker trial' };
      if (args[1] === 'version') return { code: failure === 'compose' ? 1 : 0, stdout: failure === 'compose-old' ? '2.23.0' : '2.24.1' };
      if (args[0] === 'info') return { code: failure === 'engine' ? 1 : 0, stdout: '29.0.0' };
      return { code: failure === 'config' ? 1 : 0, stdout: '' };
    },
  });
  await vm.runInContext(`${doctor}\nrunDoctor()`, context);
  return { calls, output: lines.join('\n'), exitCode: context.process.exitCode };
}

for (const [platform, link] of [['win32', 'windows-install'], ['darwin', 'mac-install'], ['linux', 'engine/install']]) {
  test(`missing Docker gives ${platform} installation guidance without cascading failures`, async () => {
    const result = await run(platform, 'cli');
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.calls, ['--version']);
    assert.match(result.output, new RegExp(link));
    assert.match(result.output, /PATH/);
    if (platform === 'win32') assert.match(result.output, /No separate Ubuntu\/Linux desktop or Linux terminal is needed/);
    assert.match(result.output, /Skipped:/);
    assert.equal((result.output.match(/✗/g) || []).length, 1);
    assert.doesNotMatch(result.output, /fixed configuration could not be loaded/);
  });
}
for (const [failure, count] of [['compose', 2], ['compose-old', 2], ['engine', 3]]) {
  test(`${failure} failure stops dependent checks`, async () => {
    const result = await run('win32', failure);
    assert.equal(result.exitCode, 1);
    assert.equal(result.calls.length, count);
    assert.equal((result.output.match(/✗/g) || []).length, 1);
    assert.doesNotMatch(result.output, /fixed configuration could not be loaded/);
  });
}
test('valid dependencies check configuration and real configuration failures remain visible', async () => {
  const ready = await run('win32');
  assert.equal(ready.exitCode, undefined);
  assert.match(ready.output, /ready to open the console/);
  assert.equal(ready.calls.length, 4);
  const invalid = await run('win32', 'config');
  assert.equal(invalid.exitCode, 1);
  assert.match(invalid.output, /fixed configuration could not be loaded/);
});
