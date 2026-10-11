import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../src/check.mjs';
import { InputError, LIMITS } from '../src/contract.mjs';

/** @param {unknown} input @param {string} path @param {RegExp} message */
function rejects(input, path, message) {
  assert.throws(
    () => analyze(/** @type {any} */ (input)),
    (error) => {
      assert.ok(error instanceof InputError);
      assert.ok(error instanceof TypeError, 'stays a TypeError for existing callers');
      assert.equal(error.code, 'invalid_request');
      assert.equal(error.path, path);
      assert.match(error.message, message);
      return true;
    },
  );
}

test('input must be an object with a manifest object', () => {
  for (const input of [null, undefined, 'x', 42, [], [{ manifest: {} }]]) rejects(input, '', /Input must be/);
  for (const manifest of [null, undefined, 'x', 42, []]) rejects({ manifest }, 'manifest', /Input must be/);
});

test('unknown top-level properties are rejected instead of silently ignored', () => {
  rejects({ manifest: {}, lockfile: ['yarn.lock'] }, 'lockfile', /Unknown property "lockfile"/);
});

test('dependency and script maps must be objects of strings', () => {
  for (const key of ['dependencies', 'devDependencies', 'scripts']) {
    rejects({ manifest: { [key]: [] } }, `manifest.${key}`, /must be an object/);
    rejects({ manifest: { [key]: 'x' } }, `manifest.${key}`, /must be an object/);
    rejects({ manifest: { [key]: { a: '1', b: 2 } } }, `manifest.${key}.b`, /must be a string/);
    rejects({ manifest: { [key]: { a: null } } }, `manifest.${key}.a`, /must be a string/);
  }
});

test('packageManager and workspaces are type checked', () => {
  rejects({ manifest: { packageManager: 10 } }, 'manifest.packageManager', /must be a string/);
  rejects({ manifest: { workspaces: 'packages/*' } }, 'manifest.workspaces', /must be a list or object/);
  assert.doesNotThrow(() => analyze({ manifest: { workspaces: { packages: ['a'] }, packageManager: 'pnpm@10' } }));
});

test('lockfiles are bounded in count and length', () => {
  const longest = 'a'.repeat(LIMITS.maxLockfileNameLength);
  assert.doesNotThrow(() => analyze({ manifest: {}, lockfiles: Array(LIMITS.maxLockfiles).fill(longest) }));
  rejects({ manifest: {}, lockfiles: Array(LIMITS.maxLockfiles + 1).fill('a') }, 'lockfiles', /up to 20/);
  rejects({ manifest: {}, lockfiles: [`${longest}a`] }, 'lockfiles', /up to 20/);
  rejects({ manifest: {}, lockfiles: [1] }, 'lockfiles', /up to 20/);
  rejects({ manifest: {}, lockfiles: 'yarn.lock' }, 'lockfiles', /up to 20/);
});

test('targets must name platforms that a loaded rule pack knows', () => {
  assert.doesNotThrow(() => analyze({ manifest: {}, targets: [] }));
  for (const targets of [['vercel'], 'vercel', [1], { vercel: true }]) {
    rejects({ manifest: {}, targets }, 'targets', /targets needs a rule pack that knows the platform; none is loaded/);
  }
  const packs = [{ name: 'demo', version: '1.0.0', targets: ['vercel', 'fly'], rules: [] }];
  assert.doesNotThrow(() => analyze({ manifest: {}, targets: ['fly', 'vercel'] }, { packs }));
  for (const targets of [['netlify'], ['Vercel'], 'vercel', [1], [null], { vercel: true }]) {
    assert.throws(() => analyze(/** @type {any} */ ({ manifest: {}, targets }), { packs }), /targets must be a list of: vercel, fly/);
  }
});

test('properties that are not evaluated are ignored', () => {
  const report = analyze({ manifest: { name: 42, version: [], peerDependencies: 'x', private: 'yes' } });
  assert.equal(report.project, '(unnamed)');
  assert.deepEqual(report.findings, []);
});
