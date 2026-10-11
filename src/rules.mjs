/**
 * Free rule catalog. Each rule is a pure function of the validated manifest and reports observations only.
 * Rules that need maintained vendor data live in rule packs (see docs/rules/README.md), never here.
 * Catalog order is the order of findings in the report, so new rules are appended, never inserted.
 */

/** @typedef {import('./contract.mjs').Severity} Severity */
/** @typedef {import('./validate.mjs').ValidInput} ValidInput */

/**
 * @typedef {object} Hit
 * @property {string} message
 * @property {Record<string, unknown>} evidence
 * @property {string} remediation
 */

/**
 * @typedef {object} Rule
 * @property {string} id
 * @property {Severity} severity
 * @property {string} summary
 * @property {(input: ValidInput) => Hit[]} check
 */

const own = Object.hasOwn;
/** Code unit order: identical on every machine, unlike localeCompare. @param {string} a @param {string} b */
const byCodeUnit = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** @param {ValidInput} input @param {string} pkg */
const has = ({ deps, devDeps }, pkg) => own(deps, pkg) || own(devDeps, pkg);
/** Version specs may be URLs with credentials (git+https://user:token@host/…); never echo those. @param {string} spec */
export const redactSpec = (spec) => spec.replace(/\/\/[^/@\s]+@/g, '//***@');

const LOCKFILE_MANAGERS = new Map([
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
]);

/** @type {readonly Rule[]} */
export const RULES = Object.freeze([
  {
    id: 'RG-NEXT-REACT',
    severity: 'error',
    summary: 'Next.js is declared without React.',
    check: (input) =>
      has(input, 'next') && !has(input, 'react')
        ? [{
            message: 'Next.js is declared without React.',
            evidence: { package: 'next', reactDeclared: false },
            remediation: 'Add a React dependency compatible with the chosen Next.js version.',
          }]
        : [],
  },
  {
    id: 'RG-NEXT-DOM',
    severity: 'warning',
    summary: 'Next.js is declared without react-dom.',
    check: (input) =>
      has(input, 'next') && !has(input, 'react-dom')
        ? [{
            message: 'Next.js is declared without react-dom.',
            evidence: { package: 'next', reactDomDeclared: false },
            remediation: 'Review the official Next.js install requirements for your version.',
          }]
        : [],
  },
  {
    id: 'RG-EXPO-RN',
    severity: 'warning',
    summary: 'Expo is declared without react-native.',
    check: (input) =>
      has(input, 'expo') && !has(input, 'react-native')
        ? [{
            message: 'Expo is declared without react-native.',
            evidence: { package: 'expo', reactNativeDeclared: false },
            remediation: 'Check Expo SDK package compatibility using expo-doctor and install matching react-native.',
          }]
        : [],
  },
  {
    id: 'RG-NEXT-BUILD',
    severity: 'info',
    summary: 'A Next.js package declares no build script.',
    check: (input) =>
      has(input, 'next') && !own(input.scripts, 'build')
        ? [{
            message: 'No build script is declared for this Next.js package.',
            evidence: { nextDeclared: true, script: 'build' },
            remediation: 'If this is a deployable app, add and verify an appropriate build script.',
          }]
        : [],
  },
  {
    id: 'RG-DEP-DUPLICATE',
    severity: 'warning',
    summary: 'A package appears in dependencies and devDependencies.',
    check: ({ deps, devDeps }) =>
      Object.keys(deps)
        .filter((name) => own(devDeps, name))
        .sort(byCodeUnit)
        .map((name) => ({
          message: `Dependency ${name} appears in dependencies and devDependencies.`,
          evidence: {
            name,
            dependencies: redactSpec(/** @type {string} */ (deps[name])),
            devDependencies: redactSpec(/** @type {string} */ (devDeps[name])),
          },
          remediation: 'Choose the intended dependency scope and remove the duplicate declaration.',
        })),
  },
  {
    id: 'RG-DEP-UNPINNED',
    severity: 'warning',
    summary: 'A dependency uses a floating "*" or "latest" version.',
    check: ({ deps, devDeps }) =>
      Object.entries({ ...devDeps, ...deps })
        .filter(([, spec]) => spec.trim() === '*' || spec.trim() === 'latest')
        .sort(([a], [b]) => byCodeUnit(a, b))
        .map(([name, spec]) => ({
          message: `Dependency ${name} uses a floating ${spec} version.`,
          evidence: { name, version: spec },
          remediation: 'Specify a reviewed version range and commit a lockfile.',
        })),
  },
  {
    id: 'RG-WORKSPACE-PRIVATE',
    severity: 'info',
    summary: 'A workspace root is not explicitly private.',
    check: ({ manifest }) =>
      manifest.workspaces !== undefined && manifest.private !== true
        ? [{
            message: 'Workspace root is not explicitly private.',
            evidence: { workspacesDeclared: true, private: manifest.private ?? null },
            remediation: 'If this is a non-publishable root, set private: true.',
          }]
        : [],
  },
  {
    id: 'RG-LOCKFILE-MISMATCH',
    severity: 'warning',
    summary: 'The declared packageManager does not match a lockfile.',
    check: ({ packageManager, lockfiles }) => {
      const pm = /^(npm|pnpm|yarn|bun)@/.exec(packageManager ?? '')?.[1];
      if (!pm) return [];
      const names = new Set(lockfiles.map((file) => /** @type {string} */ (file.split(/[\\/]/).at(-1))));
      return [...names]
        .sort(byCodeUnit)
        .map((file) => ({ file, lockPm: LOCKFILE_MANAGERS.get(file) }))
        .filter(({ lockPm }) => lockPm !== undefined && lockPm !== pm)
        .map(({ file, lockPm }) => ({
          message: `Declared packageManager (${pm}) does not match ${file}.`,
          evidence: { packageManager: pm, lockfile: file, lockfileManager: lockPm },
          remediation: 'Verify and standardize the package manager and lockfile.',
        }));
    },
  },
]);

export const RULE_IDS = Object.freeze(RULES.map((rule) => rule.id));
/** File names the lockfile rule understands; adapters use this to detect lockfiles on disk. */
export const LOCKFILE_NAMES = Object.freeze([...LOCKFILE_MANAGERS.keys()]);
