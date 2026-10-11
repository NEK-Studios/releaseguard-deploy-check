/** File access shared by the adapters that read from disk (CLI, GitHub Action). The core never imports this. */
import { access, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { LIMITS } from './contract.mjs';
import { LOCKFILE_NAMES } from './rules.mjs';

export class FileError extends Error {
  /**
   * @param {'file_error' | 'payload_too_large' | 'invalid_json'} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'FileError';
    this.code = code;
  }
}

/**
 * @param {string} filename
 * @returns {Promise<unknown>} parsed JSON; shape is validated later by analyze()
 * @throws {FileError}
 */
export async function readManifestFile(filename) {
  let raw;
  try {
    // Check the size before reading so a wrong path to a huge file is rejected without loading it.
    if ((await stat(filename)).size > LIMITS.maxBodyBytes) {
      throw new FileError('payload_too_large', `${filename} exceeds ${LIMITS.maxBodyBytes} bytes`);
    }
    raw = await readFile(filename, 'utf8');
  } catch (error) {
    if (error instanceof FileError) throw error;
    const reason = /** @type {NodeJS.ErrnoException} */ (error).code ?? 'unknown';
    throw new FileError('file_error', `cannot read ${filename} (${reason})`);
  }
  try {
    // Windows editors often save package.json with a byte order mark, which JSON.parse rejects.
    return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    throw new FileError('invalid_json', `${filename} is not valid JSON`);
  }
}

/**
 * Names of known lockfiles that exist in a directory, in catalog order. Contents are never read.
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
export async function detectLockfiles(directory) {
  const found = await Promise.all(
    LOCKFILE_NAMES.map((name) => access(join(directory, name)).then(() => name, () => undefined)),
  );
  return found.filter((name) => name !== undefined);
}
