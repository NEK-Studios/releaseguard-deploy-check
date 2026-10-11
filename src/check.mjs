/** ReleaseGuard core: conservative static manifest checks, no external I/O or arbitrary code execution. */
import { LIMITS, RULESET_VERSION, SCHEMA_VERSION, TOOL_VERSION } from './contract.mjs';
import { RULES } from './rules.mjs';
import { validateInput } from './validate.mjs';

export { RULESET_VERSION };

/**
 * Same input, same tool, ruleset and pack versions: byte-identical report. No clock, no randomness, no locale.
 * @param {import('./contract.mjs').ReleaseCheckInput} input
 * @param {{ packs?: readonly import('./contract.mjs').RulePack[] }} [options] rule packs the caller chose to load
 * @returns {import('./contract.mjs').ReleaseCheckReport}
 * @throws {import('./contract.mjs').InputError} when the input does not match the request schema
 */
export function analyze(input, { packs = [] } = {}) {
  const valid = validateInput(input, packs.flatMap((pack) => pack.targets));
  // Free rules first, then packs in load order: the order of findings stays stable when a pack is added.
  const rules = [...RULES, ...packs.flatMap((pack) => pack.rules)];
  const { manifest, deps, devDeps } = valid;
  /** @param {string} pkg */
  const has = (pkg) => Object.hasOwn(deps, pkg) || Object.hasOwn(devDeps, pkg);

  const findings = rules.flatMap((rule) =>
    rule.check(valid).map((hit) => ({ ruleId: rule.id, severity: rule.severity, ...hit })),
  );
  /** @param {import('./contract.mjs').Severity} severity */
  const count = (severity) => findings.filter((finding) => finding.severity === severity).length;
  const errors = count('error');

  return {
    schemaVersion: SCHEMA_VERSION,
    rulesetVersion: RULESET_VERSION,
    toolVersion: TOOL_VERSION,
    rulePacks: packs.map(({ name, version }) => ({ name, version })),
    project: typeof manifest.name === 'string' ? manifest.name.slice(0, LIMITS.maxProjectNameLength) : '(unnamed)',
    frameworks: { next: has('next'), expo: has('expo'), convex: has('convex') },
    status: errors > 0 ? 'issues' : 'review',
    counts: { errors, warnings: count('warning'), info: count('info') },
    findings,
    disclaimer: 'Static manifest checks only. This does not build the project, verify version compatibility, or certify release readiness.',
  };
}
