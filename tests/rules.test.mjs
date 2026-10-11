import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyze } from '../src/check.mjs';
import { redactSpec } from '../src/rules.mjs';

/** @param {string} name */
const example = async (name) => JSON.parse(await readFile(new URL(`../examples/${name}`, import.meta.url), 'utf8'));
/** @param {import('../src/contract.mjs').ReleaseCheckReport} report */
const ruleIds = (report) => report.findings.map((finding) => finding.ruleId);

test('example manifests produce the documented findings', async () => {
  const healthy = analyze({ manifest: await example('healthy.json') });
  assert.deepEqual(healthy.findings, []);
  assert.equal(healthy.status, 'review');

  const risky = analyze({ manifest: await example('next-risky.json'), lockfiles: ['pnpm-lock.yaml'] });
  assert.deepEqual(ruleIds(risky), [
    'RG-NEXT-DOM', 'RG-NEXT-BUILD', 'RG-DEP-DUPLICATE', 'RG-DEP-UNPINNED', 'RG-DEP-UNPINNED', 'RG-LOCKFILE-MISMATCH',
  ]);
  assert.deepEqual(risky.counts, { errors: 0, warnings: 5, info: 1 });
  assert.deepEqual(risky.frameworks, { next: true, expo: false, convex: true });
});

test('status is "issues" only when an error finding exists', () => {
  assert.equal(analyze({ manifest: { dependencies: { next: '^15' } } }).status, 'issues');
  assert.equal(analyze({ manifest: { dependencies: { next: '^15', react: '^19' } } }).status, 'review');
});

test('report does not depend on property order of the input', () => {
  const deps = { zod: '*', next: 'latest', Alpha: '*', react: '^19', 'react-dom': '*', '@scope/b': 'latest' };
  const reversed = Object.fromEntries(Object.entries(deps).reverse());
  const a = analyze({ manifest: { name: 'x', dependencies: deps, devDependencies: { zod: '^3', react: '*' } } });
  const b = analyze({ manifest: { devDependencies: { react: '*', zod: '^3' }, dependencies: reversed, name: 'x' } });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('repeated runs are byte-identical', () => {
  const input = { manifest: { dependencies: { next: 'latest', expo: '*' }, workspaces: ['a'] }, lockfiles: ['yarn.lock'] };
  const first = JSON.stringify(analyze(input));
  for (let i = 0; i < 5; i += 1) assert.equal(JSON.stringify(analyze(structuredClone(input))), first);
});

test('findings are sorted by code unit, independent of the machine locale', () => {
  const report = analyze({ manifest: { dependencies: { b: '*', a: '*', B: '*', 'ä': '*', '@x/y': '*', 10: '*', 9: '*' } } });
  assert.deepEqual(
    report.findings.map((finding) => finding.evidence.name),
    ['10', '9', '@x/y', 'B', 'a', 'b', 'ä'],
  );
});

test('lockfile names that collide with Object.prototype are not treated as lockfiles', () => {
  const lockfiles = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf'];
  assert.deepEqual(analyze({ manifest: { packageManager: 'pnpm@10' }, lockfiles }).findings, []);
});

test('dependency names that collide with Object.prototype are plain names', () => {
  const manifest = JSON.parse('{"dependencies":{"__proto__":"*","constructor":"^1"},"devDependencies":{"constructor":"^1"}}');
  const report = analyze({ manifest });
  assert.deepEqual(ruleIds(report), ['RG-DEP-DUPLICATE', 'RG-DEP-UNPINNED']);
  assert.equal(report.findings[0]?.evidence.name, 'constructor');
  assert.equal(report.findings[1]?.evidence.name, '__proto__');
  assert.deepEqual(report.frameworks, { next: false, expo: false, convex: false });
});

test('lockfile mismatch uses the file name of a path, once per file', () => {
  const report = analyze({
    manifest: { packageManager: 'npm@10.9.0' },
    lockfiles: ['apps/web/yarn.lock', 'C:\\repo\\pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'README.md'],
  });
  assert.deepEqual(
    report.findings.map((finding) => finding.evidence.lockfile),
    ['pnpm-lock.yaml', 'yarn.lock'],
  );
});

test('lockfile mismatch needs a recognizable packageManager', () => {
  for (const packageManager of [undefined, '', 'pnpm', 'deno@2', ' pnpm@10']) {
    assert.deepEqual(analyze({ manifest: { packageManager }, lockfiles: ['yarn.lock'] }).findings, []);
  }
});

test('credentials inside version specs are never echoed', () => {
  assert.equal(redactSpec('git+https://user:s3cret@github.com/acme/lib.git#v1'), 'git+https://***@github.com/acme/lib.git#v1');
  assert.equal(redactSpec('https://token@registry.example.com/lib.tgz'), 'https://***@registry.example.com/lib.tgz');
  assert.equal(redactSpec('^19.0.0'), '^19.0.0');
  assert.equal(redactSpec('npm:@scope/pkg@^1.0.0'), 'npm:@scope/pkg@^1.0.0');

  const spec = 'git+https://ci-bot:ghp_secretsecret@github.com/acme/lib.git';
  const report = analyze({ manifest: { dependencies: { lib: spec }, devDependencies: { lib: spec } } });
  assert.equal(JSON.stringify(report).includes('ghp_secretsecret'), false);
  assert.equal(report.findings[0]?.evidence.dependencies, 'git+https://***@github.com/acme/lib.git');
});

test('script commands are never echoed', () => {
  const report = analyze({ manifest: { dependencies: { next: '*' }, scripts: { deploy: 'curl -H "Authorization: tok_123"' } } });
  assert.equal(JSON.stringify(report).includes('tok_123'), false);
});

test('project name is taken from the manifest and capped', () => {
  assert.equal(analyze({ manifest: { name: 'a'.repeat(500) } }).project.length, 150);
});
