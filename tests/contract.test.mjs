import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { analyze } from '../src/check.mjs';
import { RULESET_VERSION, SCHEMA_VERSION, SEVERITIES, TOOL_VERSION, buildSchemas } from '../src/contract.mjs';
import { RULES, RULE_IDS } from '../src/rules.mjs';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));

test('tool version matches package.json', () => {
  assert.equal(TOOL_VERSION, pkg.version);
});

test('runtime has no third-party dependencies', async () => {
  assert.equal(pkg.dependencies, undefined);
  for (const file of await readdir(new URL('src/', root))) {
    const source = await readFile(new URL(`src/${file}`, root), 'utf8');
    for (const [, specifier] of source.matchAll(/^\s*(?:import|export)\b[^'"]*from\s+['"]([^'"]+)['"]/gm)) {
      assert.match(specifier ?? '',/^(node:|\.\/)/, `${file} imports ${specifier}`);
    }
  }
});

test('rule catalog has unique, well-formed ids and known severities', () => {
  assert.equal(new Set(RULE_IDS).size, RULE_IDS.length);
  for (const rule of RULES) {
    assert.match(rule.id, /^RG-[A-Z]+(-[A-Z]+)+$/);
    assert.ok(SEVERITIES.includes(rule.severity), rule.id);
    assert.ok(rule.summary.length > 0, rule.id);
  }
});

test('report carries all three versions', () => {
  const report = analyze({ manifest: {} });
  assert.deepEqual(
    [report.schemaVersion, report.rulesetVersion, report.toolVersion],
    [SCHEMA_VERSION, RULESET_VERSION, TOOL_VERSION],
  );
});

test('report and finding have exactly the documented properties, in the documented order', () => {
  const schemas = buildSchemas();
  const report = analyze({ manifest: { dependencies: { next: '^15' } } });
  assert.deepEqual(Object.keys(report), schemas.ReleaseCheckReport.required);
  assert.deepEqual(Object.keys(report), Object.keys(schemas.ReleaseCheckReport.properties));
  assert.ok(report.findings.length > 0);
  for (const finding of report.findings) {
    assert.deepEqual(Object.keys(finding), schemas.Finding.required);
    assert.ok(RULE_IDS.includes(finding.ruleId));
  }
});
