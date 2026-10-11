/**
 * GitHub Action adapter (see action.yml). Runs inside the user's own runner: reads one manifest, detects lockfile
 * names next to it, and reports findings as annotations, a job summary and step outputs. No network access.
 */
import { appendFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { analyze } from './check.mjs';
import { InputError } from './contract.mjs';
import { FileError, detectLockfiles, readManifestFile } from './files.mjs';
import { PackError, loadPacks } from './packs.mjs';

const FAIL_ON = /** @type {const} */ (['error', 'warning', 'never']);
const ANNOTATION = /** @type {const} */ ({ error: 'error', warning: 'warning', info: 'notice' });

/** @param {string} name */
const input = (name) => (process.env[`INPUT_${name.toUpperCase()}`] ?? '').trim();

// Findings quote names from the checked manifest, which in a pull request is attacker-controlled. Without escaping,
// a line break inside a dependency name could start a new workflow command.
/** @param {string} text */
const escapeData = (text) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
/** @param {string} text */
const escapeProperty = (text) => escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
/** @param {string} text */
const escapeCell = (text) =>
  text.replace(/[\r\n]+/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/[|`\\[\]]/g, '\\$&');

/** @param {string} message */
function fail(message) {
  console.log(`::error title=ReleaseGuard::${escapeData(message)}`);
  return 1;
}

/**
 * @param {import('./contract.mjs').ReleaseCheckReport} report
 * @param {string} manifestPath
 */
function summarize(report, manifestPath) {
  const { errors, warnings, info } = report.counts;
  const lines = [
    '### ReleaseGuard',
    '',
    `\`${escapeCell(manifestPath)}\`: ${errors} error(s), ${warnings} warning(s), ${info} info. ` +
      `Ruleset ${report.rulesetVersion}, tool ${report.toolVersion}.`,
    '',
  ];
  if (report.findings.length > 0) {
    lines.push('| Severity | Rule | Finding | Fix |', '|---|---|---|---|');
    for (const finding of report.findings) {
      lines.push(
        `| ${finding.severity} | ${finding.ruleId} | ${escapeCell(finding.message)} | ${escapeCell(finding.remediation)} |`,
      );
    }
    lines.push('');
  }
  lines.push(`_${report.disclaimer}_`, '');
  return lines.join('\n');
}

/** @returns {Promise<number>} exit code */
async function main() {
  const manifestPath = input('manifest') || 'package.json';
  const failOn = input('fail-on') || 'error';
  if (!FAIL_ON.some((value) => value === failOn)) {
    return fail(`Input "fail-on" must be one of ${FAIL_ON.join(', ')}; got "${failOn}".`);
  }
  /** @param {string} name */
  const list = (name) => input(name).split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
  const listed = list('lockfiles');

  let report;
  try {
    const manifest = /** @type {Record<string, unknown>} */ (await readManifestFile(manifestPath));
    const lockfiles = listed.length > 0 ? listed : await detectLockfiles(dirname(manifestPath));
    // Packs are named by the workflow author. Relative paths resolve from the workspace, the step's working directory.
    const packs = await loadPacks(list('packs'));
    report = analyze({ manifest, lockfiles, targets: list('targets') }, { packs });
  } catch (error) {
    if (error instanceof FileError || error instanceof InputError || error instanceof PackError) return fail(`${error.code}: ${error.message}`);
    throw error;
  }

  for (const finding of report.findings) {
    console.log(
      `::${ANNOTATION[finding.severity]} file=${escapeProperty(manifestPath)},title=${escapeProperty(finding.ruleId)}::` +
        escapeData(`${finding.message} ${finding.remediation}`),
    );
  }

  const reportPath = join(process.env.RUNNER_TEMP ?? '.', 'releaseguard-report.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) {
    const { errors, warnings, info } = report.counts;
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `status=${report.status}\nerrors=${errors}\nwarnings=${warnings}\ninfo=${info}\nreport=${reportPath}\n`,
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summarize(report, manifestPath));

  const failing = failOn === 'never' ? 0 : report.counts.errors + (failOn === 'warning' ? report.counts.warnings : 0);
  return failing > 0 ? 1 : 0;
}

process.exitCode = await main();
