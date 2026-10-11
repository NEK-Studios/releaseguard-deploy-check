/**
 * Loads rule packs for the adapters that start from a command line (CLI, hook, MCP server, GitHub Action).
 * A pack is code: loading one runs it with the rights of this process. Packs are therefore only ever named by the
 * person who starts the tool (flag or workflow input), never by a request, a manifest or a hook event.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RULE_ID_PATTERN, SEVERITIES } from './contract.mjs';
import { RULE_IDS } from './rules.mjs';

/** @typedef {import('./contract.mjs').RulePack} RulePack */

export class PackError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'PackError';
    /** @type {'pack_error'} */
    this.code = 'pack_error';
  }
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isStringList = (/** @type {unknown} */ value) => Array.isArray(value) && value.every((item) => typeof item === 'string');

/**
 * @param {unknown} pack default export of a pack module
 * @param {string} specifier as given by the user, for messages
 * @param {Set<string>} takenIds rule ids of the free rules and of packs loaded before; extended with this pack's ids
 * @returns {RulePack}
 */
function checkPack(pack, specifier, takenIds) {
  /** @param {string} problem @returns {never} */
  const reject = (problem) => {
    throw new PackError(`"${specifier}" is not a rule pack: ${problem}`);
  };
  if (!isRecord(pack)) return reject('the default export must be an object');
  if (typeof pack.name !== 'string' || typeof pack.version !== 'string') return reject('name and version must be strings');
  if (!isStringList(pack.targets)) return reject('targets must be a list of strings');
  if (!Array.isArray(pack.rules)) return reject('rules must be a list');
  for (const rule of pack.rules) {
    if (!isRecord(rule) || typeof rule.id !== 'string' || !new RegExp(RULE_ID_PATTERN).test(rule.id)) {
      return reject(`every rule needs an id matching ${RULE_ID_PATTERN}`);
    }
    if (!SEVERITIES.some((severity) => severity === rule.severity)) return reject(`rule ${rule.id} has an unknown severity`);
    if (typeof rule.summary !== 'string' || typeof rule.check !== 'function') return reject(`rule ${rule.id} needs summary and check`);
    if (takenIds.has(rule.id)) return reject(`rule id ${rule.id} is already in use`);
    takenIds.add(rule.id);
  }
  return /** @type {RulePack} */ (/** @type {unknown} */ (pack));
}

/**
 * @param {readonly string[]} specifiers paths (relative to cwd) or package names (resolved from cwd)
 * @param {string} [cwd]
 * @returns {Promise<RulePack[]>} in the given order
 * @throws {PackError}
 */
export async function loadPacks(specifiers, cwd = process.cwd()) {
  const fromCwd = createRequire(pathToFileURL(resolve(cwd, 'package.json')));
  const takenIds = new Set(RULE_IDS);
  /** @type {RulePack[]} */
  const packs = [];
  for (const specifier of specifiers) {
    let module;
    try {
      const isPath = /^\.{0,2}[\\/]|^[A-Za-z]:[\\/]/.test(specifier);
      module = await import(pathToFileURL(fromCwd.resolve(isPath ? resolve(cwd, specifier) : specifier)).href);
    } catch (error) {
      const reason = /** @type {NodeJS.ErrnoException} */ (error).code ?? (error instanceof Error ? error.name : 'unknown');
      throw new PackError(`cannot load rule pack "${specifier}" (${reason})`);
    }
    packs.push(checkPack(module.default, specifier, takenIds));
  }
  return packs;
}
