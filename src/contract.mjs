/**
 * ReleaseGuard contract: versions, limits, error codes and JSON Schemas.
 * Single source for the validator, the HTTP adapter, the OpenAPI document and future adapters (MCP tool schema).
 * No I/O.
 */

/** URL major version. A breaking change to request or report gets a new prefix (/v2). */
export const API_VERSION = 'v1';
/** Report shape. Minor = additive fields, major = breaking (only together with a new API_VERSION). */
export const SCHEMA_VERSION = '1.3';
/** Behaviour of the free rules in src/rules.mjs. Changes whenever one is added, removed or reports differently. Rule packs carry their own version. */
export const RULESET_VERSION = '0.3.0';
/** Must equal "version" in package.json (checked by tests/contract.test.mjs). */
export const TOOL_VERSION = '0.5.0';

export const LIMITS = Object.freeze({
  /** Request body and CLI manifest file. */
  maxBodyBytes: 64 * 1024,
  maxLockfiles: 20,
  maxLockfileNameLength: 128,
  maxProjectNameLength: 150,
});

export const SEVERITIES = Object.freeze(/** @type {const} */ (['error', 'warning', 'info']));

/** Every error the HTTP adapter can return, with its status. The CLI reuses the codes on stderr. */
export const ERRORS = Object.freeze({
  invalid_json: { status: 400, message: 'Request body is not valid JSON.' },
  invalid_request: { status: 400, message: 'Request does not match the expected shape.' },
  not_found: { status: 404, message: 'Unknown path. See GET /v1/openapi.json for available operations.' },
  method_not_allowed: { status: 405, message: 'Method not allowed for this path.' },
  payload_too_large: { status: 413, message: `Request body exceeds ${LIMITS.maxBodyBytes} bytes.` },
  unsupported_media_type: { status: 415, message: 'Content-Type must be application/json.' },
  internal_error: { status: 500, message: 'Unexpected server error.' },
});

/** @typedef {keyof typeof ERRORS} ErrorCode */
/** @typedef {(typeof SEVERITIES)[number]} Severity */

/**
 * @typedef {object} ReleaseCheckInput
 * @property {Record<string, unknown>} manifest Parsed package.json content.
 * @property {string[]} [lockfiles] Names or paths of lockfiles present in the project. Contents are never read.
 * @property {string[]} [targets] Hosting platforms the project deploys to. Only names known to a loaded rule pack are accepted.
 */

/**
 * @typedef {object} Finding
 * @property {string} ruleId
 * @property {Severity} severity
 * @property {string} message
 * @property {Record<string, unknown>} evidence
 * @property {string} remediation
 */

/**
 * @typedef {object} ReleaseCheckReport
 * @property {string} schemaVersion
 * @property {string} rulesetVersion
 * @property {string} toolVersion
 * @property {{ name: string, version: string }[]} rulePacks
 * @property {string} project
 * @property {{ next: boolean, expo: boolean, convex: boolean }} frameworks
 * @property {'issues' | 'review'} status
 * @property {{ errors: number, warnings: number, info: number }} counts
 * @property {Finding[]} findings
 * @property {string} disclaimer
 */

/**
 * A rule pack adds rules that need maintained data. The core never loads one by itself: an adapter passes it to
 * analyze() because the user asked for it. `targets` are the platform names the pack understands.
 * @typedef {object} RulePack
 * @property {string} name
 * @property {string} version
 * @property {readonly string[]} targets
 * @property {readonly import('./rules.mjs').Rule[]} rules
 */

/** Invalid caller input. Extends TypeError so existing callers that catch TypeError keep working. */
export class InputError extends TypeError {
  /**
   * @param {string} message
   * @param {string} path Dotted path to the offending value, e.g. "manifest.dependencies.next".
   */
  constructor(message, path) {
    super(message);
    this.name = 'InputError';
    /** @type {'invalid_request'} */
    this.code = 'invalid_request';
    this.path = path;
  }
}

/** Shape of every rule id, free or from a pack. */
export const RULE_ID_PATTERN = '^RG-[A-Z]+(-[A-Z]+)+$';

const stringMap = (/** @type {string} */ description) => ({
  type: 'object',
  description,
  additionalProperties: { type: 'string' },
});

/**
 * JSON Schema (2020-12) of everything that crosses the API boundary.
 * Only states constraints the validator in validate.mjs actually enforces.
 * @param {readonly RulePack[]} [packs] loaded rule packs; their targets become the allowed values of "targets"
 */
export function buildSchemas(packs = []) {
  const targets = [...new Set(packs.flatMap((pack) => pack.targets))];
  return {
    ReleaseCheckRequest: {
      type: 'object',
      additionalProperties: false,
      required: ['manifest'],
      properties: {
        manifest: {
          type: 'object',
          description:
            'Parsed package.json content. Only the listed properties are evaluated; all other properties are ignored.',
          properties: {
            name: { description: 'Used as project label when it is a string.' },
            private: { description: 'Evaluated by RG-WORKSPACE-PRIVATE.' },
            dependencies: stringMap('Package name to version spec.'),
            devDependencies: stringMap('Package name to version spec.'),
            scripts: stringMap('Script name to command. Commands are never executed and never echoed.'),
            packageManager: { type: 'string', description: 'Corepack style, e.g. "pnpm@10.0.0".' },
            workspaces: { type: ['array', 'object'] },
            engines: { description: 'engines.node is evaluated when it is a string; other content is ignored.' },
          },
          additionalProperties: true,
        },
        lockfiles: {
          type: 'array',
          maxItems: LIMITS.maxLockfiles,
          items: { type: 'string', maxLength: LIMITS.maxLockfileNameLength },
          description:
            'Names or paths of lockfiles that exist in the project. Only the file name is evaluated; contents are never read.',
        },
        targets: {
          type: 'array',
          items: targets.length > 0 ? { type: 'string', enum: targets } : { type: 'string' },
          description:
            'Hosting platforms the project deploys to. A platform is only accepted when a loaded rule pack knows it; without such a pack any value is rejected as invalid_request.',
        },
      },
    },
    Finding: {
      type: 'object',
      additionalProperties: false,
      required: ['ruleId', 'severity', 'message', 'evidence', 'remediation'],
      properties: {
        ruleId: { type: 'string', pattern: RULE_ID_PATTERN, description: 'Free rules: see docs. Rule packs add their own ids.' },
        severity: { type: 'string', enum: [...SEVERITIES] },
        message: { type: 'string' },
        evidence: {
          type: 'object',
          description: 'Machine-readable facts that triggered the rule. Shape depends on ruleId. Rules based on vendor data add "source" (vendor URL) and "verifiedOn" (date the fact was last checked there).',
          additionalProperties: true,
        },
        remediation: { type: 'string' },
      },
    },
    ReleaseCheckReport: {
      type: 'object',
      additionalProperties: false,
      required: [
        'schemaVersion', 'rulesetVersion', 'toolVersion', 'rulePacks', 'project', 'frameworks', 'status', 'counts', 'findings',
        'disclaimer',
      ],
      properties: {
        schemaVersion: { type: 'string', description: 'Version of this report shape.', examples: [SCHEMA_VERSION] },
        rulesetVersion: { type: 'string', description: 'Version of the rule catalog.', examples: [RULESET_VERSION] },
        toolVersion: { type: 'string', description: 'Version of ReleaseGuard.', examples: [TOOL_VERSION] },
        rulePacks: {
          type: 'array',
          description: 'Rule packs that were loaded for this report, in load order. Empty for the free rules alone.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'version'],
            properties: { name: { type: 'string' }, version: { type: 'string' } },
          },
        },
        project: { type: 'string', maxLength: LIMITS.maxProjectNameLength },
        frameworks: {
          type: 'object',
          additionalProperties: false,
          required: ['next', 'expo', 'convex'],
          properties: { next: { type: 'boolean' }, expo: { type: 'boolean' }, convex: { type: 'boolean' } },
        },
        status: {
          type: 'string',
          enum: ['issues', 'review'],
          description:
            '"issues" when at least one finding has severity error, otherwise "review". There is no "passed": static manifest checks cannot certify a release.',
        },
        counts: {
          type: 'object',
          additionalProperties: false,
          required: ['errors', 'warnings', 'info'],
          properties: {
            errors: { type: 'integer', minimum: 0 },
            warnings: { type: 'integer', minimum: 0 },
            info: { type: 'integer', minimum: 0 },
          },
        },
        findings: {
          type: 'array',
          description: 'Deterministic order: rule catalog order, then package or file name.',
          items: { $ref: '#/components/schemas/Finding' },
        },
        disclaimer: { type: 'string' },
      },
    },
    Health: {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'mode', 'apiVersion', 'toolVersion', 'rulesetVersion'],
      properties: {
        status: { type: 'string', const: 'ok' },
        mode: { type: 'string', const: 'local-preview' },
        apiVersion: { type: 'string', examples: [API_VERSION] },
        toolVersion: { type: 'string', examples: [TOOL_VERSION] },
        rulesetVersion: { type: 'string', examples: [RULESET_VERSION] },
      },
    },
    Error: {
      type: 'object',
      additionalProperties: false,
      required: ['error'],
      properties: {
        error: {
          type: 'object',
          additionalProperties: false,
          required: ['code', 'message'],
          properties: {
            code: { type: 'string', enum: Object.keys(ERRORS), description: 'Stable, machine-readable.' },
            message: { type: 'string', description: 'Human-readable. Wording may change.' },
            path: {
              type: 'string',
              description: 'Only for invalid_request: dotted path to the offending value.',
              examples: ['manifest.dependencies.next'],
            },
          },
        },
      },
    },
  };
}
