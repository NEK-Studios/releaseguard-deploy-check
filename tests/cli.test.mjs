import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, TOOL_VERSION } from '../src/contract.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'releaseguard-'));
after(() => rm(dir, { recursive: true, force: true }));

/**
 * Runs the real CLI in a child process.
 * @param {...string} args
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
const cli = (...args) =>
  new Promise((resolve) => {
    execFile(process.execPath, ['src/cli.mjs', ...args], { cwd: root }, (error, stdout, stderr) => {
      resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr });
    });
  });

/** @param {string} name @param {string | Buffer} content */
async function file(name, content) {
  const path = join(dir, name);
  await writeFile(path, content);
  return path;
}

test('clean manifest: exit 0 and a JSON report on stdout', async () => {
  const { code, stdout, stderr } = await cli('examples/healthy.json');
  assert.equal(code, 0);
  assert.equal(stderr, '');
  const report = JSON.parse(stdout);
  assert.deepEqual(report.findings, []);
  assert.equal(report.toolVersion, TOOL_VERSION);
});

test('warnings only: exit 0, lockfiles are repeatable', async () => {
  const { code, stdout } = await cli('examples/next-risky.json', '--lockfile', 'pnpm-lock.yaml', '--lockfile', 'yarn.lock');
  assert.equal(code, 0);
  const mismatches = JSON.parse(stdout).findings.filter((/** @type {{ ruleId: string }} */ f) => f.ruleId === 'RG-LOCKFILE-MISMATCH');
  assert.equal(mismatches.length, 2);
});

test('error finding: exit 2', async () => {
  const path = await file('no-react.json', JSON.stringify({ dependencies: { next: '^15', 'react-dom': '^19' } }));
  const { code, stdout } = await cli(path);
  assert.equal(code, 2);
  assert.equal(JSON.parse(stdout).status, 'issues');
});

test('--pack loads a rule pack and --target enables its platform rules', async () => {
  const path = await file('node18.json', JSON.stringify({ engines: { node: '18.x' } }));
  assert.deepEqual(JSON.parse((await cli(path)).stdout).findings, []);
  const withoutPack = await cli(path, '--target', 'demo');
  assert.equal(withoutPack.code, 1);
  assert.match(withoutPack.stderr, /^releaseguard: invalid_request: targets needs a rule pack that knows the platform; none is loaded/);
  const { code, stdout } = await cli(path, '--pack', './tests/fixtures/demo-pack', '--target', 'demo');
  assert.equal(code, 2);
  const report = JSON.parse(stdout);
  assert.equal(report.findings[0].ruleId, 'RG-DEMO-TARGET');
  assert.deepEqual(report.rulePacks, [{ name: 'demo-pack', version: '1.0.0' }]);
  const unknown = await cli(path, '--pack', './tests/fixtures/demo-pack', '--target', 'netlify');
  assert.equal(unknown.code, 1);
  assert.match(unknown.stderr, /^releaseguard: invalid_request: targets must be a list of: demo/);
  const broken = await cli(path, '--pack', './no-such-pack');
  assert.equal(broken.code, 1);
  assert.equal(broken.stdout, '');
  assert.match(broken.stderr, /^releaseguard: pack_error: cannot load rule pack ".\/no-such-pack"/);
});

test('a byte order mark is tolerated', async () => {
  const path = await file('bom.json', String.fromCharCode(0xfeff) + JSON.stringify({ name: 'bom' }));
  const { code, stdout } = await cli(path);
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout).project, 'bom');
});

test('invalid input: exit 1, error code on stderr, nothing on stdout', async () => {
  const cases = [
    [[join(dir, 'missing.json')], /^releaseguard: file_error: /],
    [[dir], /^releaseguard: (file_error|invalid_json): /],
    [[await file('broken.json', '{"name":')], /^releaseguard: invalid_json: /],
    [[await file('array.json', '[]')], /^releaseguard: invalid_request: /],
    [[await file('types.json', '{"dependencies":{"next":10}}')], /^releaseguard: invalid_request: manifest\.dependencies\.next must be a string/],
    [[await file('big.json', Buffer.alloc(LIMITS.maxBodyBytes + 1, 0x20))], /^releaseguard: payload_too_large: /],
    [['examples/healthy.json', '--lockfile', 'a'.repeat(LIMITS.maxLockfileNameLength + 1)], /^releaseguard: invalid_request: /],
  ];
  for (const [args, pattern] of cases) {
    const { code, stdout, stderr } = await cli(.../** @type {string[]} */ (args));
    assert.equal(code, 1, stderr);
    assert.equal(stdout, '');
    assert.match(stderr, /** @type {RegExp} */ (pattern));
  }
});

test('usage errors: exit 1 with usage text', async () => {
  for (const args of [[], ['a.json', 'b.json'], ['--lockfile'], ['examples/healthy.json', '--unknown']]) {
    const { code, stdout, stderr } = await cli(...args);
    assert.equal(code, 1);
    assert.equal(stdout, '');
    assert.match(stderr, /^releaseguard: usage: /);
    assert.match(stderr, /Usage: releaseguard/);
  }
});

test('--help and --version: exit 0', async () => {
  const help = await cli('--help');
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^Usage: releaseguard/);
  const version = await cli('--version');
  assert.deepEqual([version.code, version.stdout.trim()], [0, TOOL_VERSION]);
});
