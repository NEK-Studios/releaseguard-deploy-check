import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { analyze } from '../src/check.mjs';
import { RULES } from '../src/rules.mjs';

const pages = new URL('../docs/rules/', import.meta.url);
/** @param {string} name */
const page = (name) => readFile(new URL(name, pages), 'utf8');

test('there is exactly one page per rule, plus the index', async () => {
  assert.deepEqual((await readdir(pages)).sort(), ['README.md', ...RULES.map((rule) => `${rule.id}.md`)].sort());
});

test('every page states the real severity and its example really triggers the rule', async () => {
  for (const rule of RULES) {
    const text = await page(`${rule.id}.md`);
    assert.match(text, new RegExp(`^# ${rule.id}: `), rule.id);
    assert.ok(text.includes(`Severity: **${rule.severity}**`), `${rule.id}: severity`);
    const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(text)?.[1] ?? 'null');
    // An example is either a bare package.json or a full request with lockfile names.
    const report = analyze('manifest' in example ? example : { manifest: example });
    assert.ok(report.findings.some((finding) => finding.ruleId === rule.id), `${rule.id}: the example does not trigger the rule`);
  }
});

test('the index lists every rule in catalog order with its severity', async () => {
  const rows = [...(await page('README.md')).matchAll(/^\| \[(RG-[A-Z-]+)\]\(\1\.md\) \| (\w+) \|/gm)].map(([, id, severity]) => ({ id, severity }));
  assert.deepEqual(rows, RULES.map(({ id, severity }) => ({ id, severity })));
});
