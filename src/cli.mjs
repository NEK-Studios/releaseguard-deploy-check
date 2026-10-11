#!/usr/bin/env node
/** Offline CLI. Exit codes: 0 = no error findings, 2 = at least one error finding, 1 = invalid input or usage. */
import { parseArgs } from 'node:util';
import { analyze } from './check.mjs';
import { InputError, TOOL_VERSION } from './contract.mjs';
import { FileError, readManifestFile } from './files.mjs';
import { hookCommand } from './hook.mjs';
import { MCP_USAGE, serveStdio } from './mcp.mjs';
import { PackError, loadPacks } from './packs.mjs';

const USAGE = `Usage: releaseguard <package.json> [--lockfile <name>]... [--pack <path>]... [--target <platform>]...

Checks a package.json manifest offline and prints a JSON report to stdout.

Options:
  --lockfile <name>  Name of a lockfile that exists in the project (repeatable). Contents are not read.
  --pack <path>      Rule pack to load (repeatable): a folder (starting with ./ or absolute) or an installed
                     package. Packs are code; load only packs you trust.
  --target <name>    Hosting platform the project deploys to (repeatable). Needs a rule pack that knows it.
  --version          Print the tool version.
  -h, --help         Print this help.

Exit codes: 0 = no error findings, 2 = at least one error finding, 1 = invalid input or usage.

Hook for coding agents: releaseguard hook --help
MCP server (stdio):     releaseguard mcp --help`;

/** @param {string} code @param {string} message */
function fail(code, message) {
  console.error(`releaseguard: ${code}: ${message}`);
  return 1;
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>} exit code
 */
async function main(argv) {
  if (argv[0] === 'hook') {
    const { code, stdout, stderr } = await hookCommand(argv.slice(1), process.stdin);
    process.stdout.write(stdout);
    process.stderr.write(stderr);
    return code;
  }
  if (argv[0] === 'mcp') {
    let options;
    try {
      options = parseArgs({ args: argv.slice(1), options: { pack: { type: 'string', multiple: true }, help: { type: 'boolean', short: 'h' } } });
    } catch (error) {
      return fail('usage', `${error instanceof Error ? error.message : 'invalid arguments'}\n\n${MCP_USAGE}`);
    }
    if (options.values.help) {
      console.log(MCP_USAGE);
      return 0;
    }
    try {
      await serveStdio(process.stdin, process.stdout, { packs: await loadPacks(options.values.pack ?? []) });
    } catch (error) {
      if (error instanceof PackError) return fail(error.code, error.message);
      throw error;
    }
    return 0;
  }
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        lockfile: { type: 'string', multiple: true },
        pack: { type: 'string', multiple: true },
        target: { type: 'string', multiple: true },
        version: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    return fail('usage', `${error instanceof Error ? error.message : 'invalid arguments'}\n\n${USAGE}`);
  }
  if (args.values.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.values.version) {
    console.log(TOOL_VERSION);
    return 0;
  }
  const [filename, ...rest] = args.positionals;
  if (!filename || rest.length > 0) return fail('usage', `expected exactly one manifest file\n\n${USAGE}`);

  try {
    const manifest = /** @type {Record<string, unknown>} */ (await readManifestFile(filename));
    const packs = await loadPacks(args.values.pack ?? []);
    const report = analyze({ manifest, lockfiles: args.values.lockfile ?? [], targets: args.values.target ?? [] }, { packs });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.counts.errors > 0 ? 2 : 0;
  } catch (error) {
    if (error instanceof InputError || error instanceof FileError || error instanceof PackError) return fail(error.code, error.message);
    throw error;
  }
}

process.exitCode = await main(process.argv.slice(2));
