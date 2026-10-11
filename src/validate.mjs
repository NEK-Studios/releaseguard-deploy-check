/** Input validation for analyze(). Pure: no I/O, throws InputError with the path of the offending value. */
import { InputError, LIMITS } from './contract.mjs';

/** @typedef {import('./contract.mjs').ReleaseCheckInput} ReleaseCheckInput */
/** @typedef {Record<string, string>} StringMap */

/**
 * @typedef {object} ValidInput
 * @property {Record<string, unknown>} manifest
 * @property {StringMap} deps
 * @property {StringMap} devDeps
 * @property {StringMap} scripts
 * @property {string | undefined} packageManager
 * @property {string[]} lockfiles
 * @property {string | undefined} enginesNode engines.node when it is a string
 * @property {readonly string[]} targets
 */

const INPUT_KEYS = new Set(['manifest', 'lockfiles', 'targets']);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * @param {unknown} value
 * @param {string} path
 * @returns {StringMap}
 */
function stringMap(value, path) {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new InputError(`${path} must be an object`, path);
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') throw new InputError(`${path}.${key} must be a string`, `${path}.${key}`);
  }
  return /** @type {StringMap} */ (value);
}

/**
 * @param {unknown} input
 * @param {readonly string[]} [knownTargets] platform names the loaded rule packs understand
 * @returns {ValidInput}
 */
export function validateInput(input, knownTargets = []) {
  if (!isRecord(input) || !isRecord(input.manifest)) {
    throw new InputError(
      'Input must be { manifest: a package.json object, lockfiles?: string[] }',
      isRecord(input) ? 'manifest' : '',
    );
  }
  for (const key of Object.keys(input)) {
    if (!INPUT_KEYS.has(key)) throw new InputError(`Unknown property ${JSON.stringify(key)}`, key);
  }
  const { manifest } = input;
  const deps = stringMap(manifest.dependencies, 'manifest.dependencies');
  const devDeps = stringMap(manifest.devDependencies, 'manifest.devDependencies');
  const scripts = stringMap(manifest.scripts, 'manifest.scripts');

  const lockfiles = input.lockfiles ?? [];
  if (
    !Array.isArray(lockfiles) ||
    lockfiles.length > LIMITS.maxLockfiles ||
    lockfiles.some((name) => typeof name !== 'string' || name.length > LIMITS.maxLockfileNameLength)
  ) {
    throw new InputError(`lockfiles must be a list of up to ${LIMITS.maxLockfiles} filename strings`, 'lockfiles');
  }

  const targets = input.targets ?? [];
  if (!Array.isArray(targets) || targets.some((target) => !knownTargets.includes(target))) {
    throw new InputError(
      knownTargets.length > 0
        ? `targets must be a list of: ${knownTargets.join(', ')}`
        : 'targets needs a rule pack that knows the platform; none is loaded',
      'targets',
    );
  }

  const { packageManager, workspaces, engines } = manifest;
  if (packageManager !== undefined && typeof packageManager !== 'string') {
    throw new InputError('manifest.packageManager must be a string', 'manifest.packageManager');
  }
  if (workspaces !== undefined && !Array.isArray(workspaces) && !isRecord(workspaces)) {
    throw new InputError('manifest.workspaces must be a list or object', 'manifest.workspaces');
  }
  // engines is lenient on purpose: real manifests carry odd values there, and a wrong type only means "not evaluated".
  const enginesNode = isRecord(engines) && typeof engines.node === 'string' ? engines.node : undefined;
  return { manifest, deps, devDeps, scripts, packageManager, lockfiles, enginesNode, targets: [...new Set(targets)] };
}
