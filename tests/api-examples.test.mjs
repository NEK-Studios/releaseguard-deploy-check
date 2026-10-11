import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { analyze } from '../src/check.mjs';
import { ERRORS, LIMITS } from '../src/contract.mjs';
import { EXAMPLE_REQUEST } from '../src/openapi.mjs';
import { withServer } from './helpers.mjs';

const root = new URL('../', import.meta.url);
/** @param {string} path */
const read = (path) => readFile(new URL(path, root), 'utf8');
// Round trip through JSON so the comparison sees what a client sees.
const expected = JSON.parse(JSON.stringify(analyze(EXAMPLE_REQUEST)));

/** Whether an interpreter really runs here; on Windows "python3" can be a stub that only opens the Store. */
const runs = (/** @type {string} */ command, /** @type {string[]} */ args) => spawnSync(command, args, { stdio: 'ignore' }).status === 0;

/**
 * Runs one example against the real API on a random local port.
 * @param {string} command
 * @param {string} file path below examples/api/
 */
async function runExample(command, file) {
  const script = fileURLToPath(new URL(`examples/api/${file}`, root));
  let outcome = { code: 1, stdout: '', stderr: 'example did not run' };
  await withServer(async (baseUrl) => {
    outcome = await new Promise((resolve) => {
      execFile(command, [script], { env: { ...process.env, RELEASEGUARD_URL: baseUrl } }, (error, stdout, stderr) => {
        resolve({ code: typeof error?.code === 'number' ? error.code : error ? 1 : 0, stdout, stderr });
      });
    });
  });
  return outcome;
}

test('Node.js example prints the report of the documented request', async () => {
  const { code, stdout, stderr } = await runExample(process.execPath, 'check.mjs');
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), expected);
});

test('Python example prints the same report', { skip: !runs('python3', ['--version']) && 'python3 is not installed' }, async () => {
  const { code, stdout, stderr } = await runExample('python3', 'check.py');
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), expected);
});

test('curl example prints the same report', { skip: !(runs('sh', ['-c', 'curl --version'])) && 'sh or curl is not installed' }, async () => {
  const { code, stdout, stderr } = await runExample('sh', 'check.sh');
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), expected);
});

test('examples/response.json is the computed report (run "npm run openapi" after rule changes)', async () => {
  assert.deepEqual(JSON.parse(await read('examples/response.json')), expected);
});

test('docs/api-examples.md shows the real examples, every error code and the real limits', async () => {
  const doc = await read('docs/api-examples.md');
  for (const file of ['check.sh', 'check.mjs', 'check.py']) {
    assert.ok(doc.includes((await read(`examples/api/${file}`)).trim()), `${file} differs from the snippet in docs/api-examples.md`);
  }
  for (const [code, { status }] of Object.entries(ERRORS)) {
    assert.ok(doc.includes(`| \`${code}\` | ${status} |`), `error ${code} with status ${status} is missing`);
  }
  assert.ok(doc.includes(`${LIMITS.maxBodyBytes / 1024} KiB`));
  assert.ok(doc.includes(`${LIMITS.maxLockfiles} lockfile names`));
});
