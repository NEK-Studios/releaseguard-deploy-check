import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze } from '../src/check.mjs';
import { PackError, loadPacks } from '../src/packs.mjs';
import { RULES } from '../src/rules.mjs';
import { postJson, withServer } from './helpers.mjs';

const dirs = /** @type {string[]} */ ([]);
after(() => Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))));

/** @param {Record<string, string>} files relative path → content @returns {Promise<string>} directory */
async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'releaseguard-pack-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, '..'), { recursive: true });
    await writeFile(join(dir, name), content);
  }
  return dir;
}

/** A minimal pack as a customer could receive it. @param {string} body default export expression */
const packFiles = (body) => ({ 'pack/package.json': '{"name":"demo-pack","type":"module","main":"index.mjs"}', 'pack/index.mjs': `export default ${body};` });
const demoRule = "{ id: 'RG-DEMO-RULE', severity: 'info', summary: 'demo', check: () => [{ message: 'hello', evidence: {}, remediation: 'none' }] }";

test('without a pack the tool has exactly the free rules', () => {
  const report = analyze({ manifest: { engines: { node: '18.x' }, packageManager: 'pnpm@11.0.0', dependencies: { convex: '^1.0.0' } } });
  assert.deepEqual(report.findings, []);
  assert.deepEqual(report.rulePacks, []);
  assert.equal(RULES.length, 8);
});

test('a pack adds its rules after the free ones and is named in the report', async () => {
  const dir = await project(packFiles(`{ name: 'demo', version: '1.2.3', targets: ['fly'], rules: [${demoRule}] }`));
  const [pack, ...rest] = await loadPacks(['./pack'], dir);
  assert.deepEqual(rest, []);
  assert.ok(pack);
  const report = analyze({ manifest: { dependencies: { lodash: '*' } }, targets: ['fly'] }, { packs: [pack] });
  assert.deepEqual(report.rulePacks, [{ name: 'demo', version: '1.2.3' }]);
  assert.deepEqual(report.findings.map((finding) => finding.ruleId), ['RG-DEP-UNPINNED', 'RG-DEMO-RULE']);
  assert.deepEqual(report.counts, { errors: 0, warnings: 1, info: 1 });
});

test('packs resolve from the working directory: relative path, absolute path, installed package', async () => {
  const dir = await project({
    ...packFiles("{ name: 'by-path', version: '1.0.0', targets: [], rules: [] }"),
    'node_modules/@scope/installed/package.json': '{"name":"@scope/installed","type":"module","exports":"./main.mjs"}',
    'node_modules/@scope/installed/main.mjs': "export default { name: 'installed', version: '2.0.0', targets: [], rules: [] };",
  });
  const packs = await loadPacks(['./pack', join(dir, 'pack'), 'pack/index.mjs'.replace('pack/', './pack/'), '@scope/installed'], dir);
  assert.deepEqual(packs.map((pack) => pack.name), ['by-path', 'by-path', 'by-path', 'installed']);
});

test('anything that is not a well-formed pack is rejected before it can run as rules', async () => {
  const cases = /** @type {const} */ ([
    ['42', /the default export must be an object/],
    ["{ name: 'x', targets: [], rules: [] }", /name and version must be strings/],
    ["{ name: 'x', version: '1', targets: 'fly', rules: [] }", /targets must be a list of strings/],
    ["{ name: 'x', version: '1', targets: [], rules: {} }", /rules must be a list/],
    ["{ name: 'x', version: '1', targets: [], rules: [{ id: 'demo', severity: 'info', summary: 's', check() {} }] }", /every rule needs an id matching/],
    ["{ name: 'x', version: '1', targets: [], rules: [{ id: 'RG-DEMO-RULE', severity: 'fatal', summary: 's', check() {} }] }", /unknown severity/],
    ["{ name: 'x', version: '1', targets: [], rules: [{ id: 'RG-DEMO-RULE', severity: 'info', summary: 's' }] }", /needs summary and check/],
    ["{ name: 'x', version: '1', targets: [], rules: [{ id: 'RG-NEXT-REACT', severity: 'info', summary: 's', check() {} }] }", /rule id RG-NEXT-REACT is already in use/],
    [`{ name: 'x', version: '1', targets: [], rules: [${demoRule}, ${demoRule}] }`, /rule id RG-DEMO-RULE is already in use/],
  ]);
  for (const [body, message] of cases) {
    const dir = await project(packFiles(body));
    await assert.rejects(loadPacks(['./pack'], dir), (error) => {
      assert.ok(error instanceof PackError);
      assert.equal(error.code, 'pack_error');
      assert.match(error.message, message);
      return true;
    });
  }
  const dir = await project(packFiles(`{ name: 'x', version: '1', targets: [], rules: [${demoRule}] }`));
  await assert.rejects(loadPacks(['./pack', './pack'], dir), /rule id RG-DEMO-RULE is already in use/, 'the same pack twice');
});

test('a pack that cannot be found or throws on load is a pack_error without internal details', async () => {
  const dir = await project({ 'broken/package.json': '{"type":"module","main":"index.mjs"}', 'broken/index.mjs': "throw new Error('secret detail');" });
  await assert.rejects(loadPacks(['./missing'], dir), /^PackError: cannot load rule pack "\.\/missing" \(MODULE_NOT_FOUND\)$/);
  await assert.rejects(loadPacks(['not-installed-pack'], dir), /cannot load rule pack "not-installed-pack" \(MODULE_NOT_FOUND\)/);
  await assert.rejects(loadPacks(['./broken'], dir), (error) => {
    assert.ok(error instanceof PackError);
    assert.doesNotMatch(error.message, /secret detail/);
    return true;
  });
});

test('the local API uses packs chosen at start and never lets a request name one', () => withServer(async (baseUrl) => {
  const input = { manifest: { engines: { node: '18.x' } }, targets: ['fly'] };
  const ok = await postJson(baseUrl, input);
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).rulePacks, [{ name: 'demo', version: '1.0.0' }]);
  for (const body of [{ ...input, packs: ['./pack'] }, { ...input, pack: './pack' }]) {
    const response = await postJson(baseUrl, body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, 'invalid_request');
  }
}, { packs: [{ name: 'demo', version: '1.0.0', targets: ['fly'], rules: [] }] }));

