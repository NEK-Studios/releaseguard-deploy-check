import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOOL_VERSION } from '../src/contract.mjs';

const entry = fileURLToPath(new URL('../src/action.mjs', import.meta.url));
const dirs = /** @type {string[]} */ ([]);
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

/**
 * Runs the action the way the GitHub runner does: inputs as INPUT_* variables, the workspace as working directory.
 * @param {unknown} manifest written as package.json; a string is written verbatim
 * @param {{ inputs?: Record<string, string>, files?: string[] }} [options]
 */
async function runAction(manifest, { inputs = {}, files = [] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'releaseguard-action-'));
  dirs.push(dir);
  await writeFile(join(dir, 'package.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  for (const name of files) await writeFile(join(dir, name), '');
  const env = {
    ...process.env,
    GITHUB_OUTPUT: join(dir, 'output.txt'),
    GITHUB_STEP_SUMMARY: join(dir, 'summary.md'),
    RUNNER_TEMP: dir,
    ...Object.fromEntries(Object.entries(inputs).map(([name, value]) => [`INPUT_${name.toUpperCase()}`, value])),
  };
  /** @type {{ code: number, stdout: string }} */
  const { code, stdout } = await new Promise((resolve) => {
    execFile(process.execPath, [entry], { cwd: dir, env }, (error, out) => {
      resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout: out });
    });
  });
  const read = (/** @type {string} */ name) => readFile(join(dir, name), 'utf8').catch(() => '');
  const outputs = Object.fromEntries((await read('output.txt')).split('\n').filter(Boolean).map((line) => line.split('=')));
  return { code, stdout, outputs, summary: await read('summary.md'), dir };
}

const clean = { name: 'clean', private: true, dependencies: { next: '^15', react: '^19', 'react-dom': '^19' }, scripts: { build: 'next build' } };

test('clean manifest: step passes, outputs and report are written', async () => {
  const { code, stdout, outputs, summary, dir } = await runAction(clean);
  assert.equal(code, 0);
  assert.equal(stdout, '');
  assert.deepEqual(
    { status: outputs.status, errors: outputs.errors, warnings: outputs.warnings, info: outputs.info },
    { status: 'review', errors: '0', warnings: '0', info: '0' },
  );
  const report = JSON.parse(await readFile(/** @type {string} */ (outputs.report), 'utf8'));
  assert.equal(outputs.report, join(dir, 'releaseguard-report.json'));
  assert.equal(report.toolVersion, TOOL_VERSION);
  assert.match(summary, /0 error\(s\), 0 warning\(s\), 0 info/);
});

test('error finding: annotation on the manifest and failing step', async () => {
  const { code, stdout, outputs, summary } = await runAction({ dependencies: { next: '^15', 'react-dom': '^19' } });
  assert.equal(code, 1);
  assert.match(stdout, /^::error file=package\.json,title=RG-NEXT-REACT::Next\.js is declared without React\./m);
  assert.equal(outputs.status, 'issues');
  assert.match(summary, /\| error \| RG-NEXT-REACT \|/);
});

test('fail-on controls when the step fails', async () => {
  const warningsOnly = { dependencies: { lodash: '*' } };
  assert.equal((await runAction(warningsOnly)).code, 0);
  assert.equal((await runAction(warningsOnly, { inputs: { 'fail-on': 'warning' } })).code, 1);
  const errors = { dependencies: { next: '^15' } };
  assert.equal((await runAction(errors, { inputs: { 'fail-on': 'never' } })).code, 0);
  const invalid = await runAction(clean, { inputs: { 'fail-on': 'sometimes' } });
  assert.equal(invalid.code, 1);
  assert.match(invalid.stdout, /^::error title=ReleaseGuard::Input "fail-on" must be one of/);
});

test('lockfiles next to the manifest are detected by name', async () => {
  const manifest = { packageManager: 'pnpm@10.0.0' };
  const detected = await runAction(manifest, { files: ['package-lock.json', 'yarn.lock', 'notes.lock'] });
  assert.match(detected.stdout, /::warning file=package\.json,title=RG-LOCKFILE-MISMATCH::.*package-lock\.json/);
  assert.match(detected.stdout, /RG-LOCKFILE-MISMATCH::.*yarn\.lock/);
  assert.equal(detected.outputs.warnings, '2');
  assert.equal((await runAction(manifest, { files: ['pnpm-lock.yaml'] })).outputs.warnings, '0');
});

test('an explicit lockfiles input replaces detection', async () => {
  const result = await runAction({ packageManager: 'pnpm@10.0.0' }, {
    files: ['pnpm-lock.yaml'],
    inputs: { lockfiles: 'apps/web/yarn.lock,\n bun.lock ' },
  });
  assert.equal(result.outputs.warnings, '2');
});

test('the packs input loads a rule pack and targets enables its platform rules', async () => {
  const manifest = { engines: { node: '20.x' }, packageManager: 'pnpm@11.0.0' };
  assert.equal((await runAction(manifest)).code, 0);
  const packs = fileURLToPath(new URL('./fixtures/demo-pack', import.meta.url));
  const { code, stdout, outputs } = await runAction(manifest, { inputs: { packs, targets: ' demo ' }, files: ['pnpm-lock.yaml'] });
  assert.equal(code, 1);
  assert.match(stdout, /^::error file=package\.json,title=RG-DEMO-TARGET::Demo finding for target "demo"\./m);
  assert.deepEqual([outputs.errors, outputs.warnings], ['1', '0']);
  const unknown = await runAction(manifest, { inputs: { packs, targets: 'netlify' } });
  assert.equal(unknown.code, 1);
  assert.match(unknown.stdout, /^::error title=ReleaseGuard::invalid_request: targets must be a list of: demo/);
  const withoutPack = await runAction(manifest, { inputs: { targets: 'demo' } });
  assert.equal(withoutPack.code, 1);
  assert.match(withoutPack.stdout, /^::error title=ReleaseGuard::invalid_request: targets needs a rule pack/);
  const broken = await runAction(manifest, { inputs: { packs: './no-such-pack' } });
  assert.equal(broken.code, 1);
  assert.match(broken.stdout, /^::error title=ReleaseGuard::pack_error: cannot load rule pack/);
});

test('names from the manifest cannot inject workflow commands or break the summary table', async () => {
  const hostile = 'x\n::set-output name=status::passed\r\n::error::fake|<b>`';
  const { stdout, summary, outputs } = await runAction({ dependencies: { [hostile]: '*' }, devDependencies: { [hostile]: '^1' } });
  for (const line of stdout.split('\n').filter(Boolean)) {
    assert.match(line, /^::warning file=package\.json,title=RG-DEP-(DUPLICATE|UNPINNED)::/, line);
  }
  assert.match(stdout, /%0A::set-output name=status::passed%0D%0A::error::fake/);
  assert.equal(outputs.status, 'review');
  const rows = summary.split('\n').filter((line) => line.startsWith('| warning'));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.split(/(?<!\\)\|/).length, 6, 'exactly four cells');
    assert.equal(row.includes('<b>'), false);
  }
});

test('unreadable or invalid manifests fail with one error annotation', async () => {
  const missing = await runAction(clean, { inputs: { manifest: 'apps/none/package.json' } });
  assert.equal(missing.code, 1);
  assert.match(missing.stdout, /^::error title=ReleaseGuard::file_error: cannot read apps\/none\/package\.json \(ENOENT\)\n$/);
  assert.match((await runAction('{"name":')).stdout, /^::error title=ReleaseGuard::invalid_json: /);
  assert.match((await runAction({ dependencies: { next: 10 } })).stdout, /^::error title=ReleaseGuard::invalid_request: manifest\.dependencies\.next must be a string/);
});
