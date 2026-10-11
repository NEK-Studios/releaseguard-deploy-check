/** Builds the OpenAPI 3.1 document from the contract. docs/openapi.json is generated from this (npm run openapi). */
import { analyze } from './check.mjs';
import { API_VERSION, ERRORS, LIMITS, TOOL_VERSION, buildSchemas } from './contract.mjs';

/** Same content as examples/request.json (checked by tests/openapi.test.mjs). */
export const EXAMPLE_REQUEST = Object.freeze({
  manifest: {
    name: 'releaseguard-demo-next',
    version: '0.0.0',
    private: true,
    packageManager: 'npm@10.9.0',
    dependencies: { next: 'latest', react: '*', convex: '^1.0.0' },
    devDependencies: { react: '^19.0.0' },
    scripts: { dev: 'next dev' },
  },
  lockfiles: ['pnpm-lock.yaml'],
});

const json = (/** @type {object} */ media) => ({ 'application/json': media });

/** @param {import('./contract.mjs').ErrorCode} code @param {string} description */
const errorResponse = (code, description) => ({
  description,
  content: json({
    schema: { $ref: '#/components/schemas/Error' },
    example: { error: { code, message: ERRORS[code].message } },
  }),
});

export function buildOpenApiDocument() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'ReleaseGuard API (local preview)',
      version: TOOL_VERSION,
      summary: 'Deterministic release checks for package.json manifests.',
      description:
        'Unauthenticated LOCAL-only preview. Evaluates a supplied package.json manifest with a fixed rule catalog and ' +
        'returns findings with evidence and remediation. No repository access, no code execution, no remote fetch, ' +
        'no persistence. Do not publish or use as a commercial API until auth, limits and a privacy review are in place.',
    },
    servers: [{ url: 'http://127.0.0.1:4318', description: 'Local preview (npm run dev)' }],
    tags: [{ name: 'checks' }, { name: 'meta' }],
    paths: {
      '/health': {
        get: {
          operationId: 'getHealth',
          tags: ['meta'],
          summary: 'Liveness and versions',
          responses: {
            200: { description: 'Running locally.', content: json({ schema: { $ref: '#/components/schemas/Health' } }) },
          },
        },
      },
      [`/${API_VERSION}/openapi.json`]: {
        get: {
          operationId: 'getOpenApiDocument',
          tags: ['meta'],
          summary: 'This OpenAPI 3.1 document',
          responses: { 200: { description: 'OpenAPI 3.1 document.', content: json({ schema: { type: 'object' } }) } },
        },
      },
      [`/${API_VERSION}/release-check`]: {
        post: {
          operationId: 'createReleaseCheck',
          tags: ['checks'],
          summary: 'Analyze a supplied package manifest',
          description:
            'Synchronous and stateless. The same request always returns the same report for a given toolVersion and ' +
            `rulesetVersion. Request body limit: ${LIMITS.maxBodyBytes} bytes.`,
          requestBody: {
            required: true,
            content: json({
              schema: { $ref: '#/components/schemas/ReleaseCheckRequest' },
              example: EXAMPLE_REQUEST,
            }),
          },
          responses: {
            200: {
              description: 'Findings and advisory status.',
              content: json({
                schema: { $ref: '#/components/schemas/ReleaseCheckReport' },
                example: analyze(EXAMPLE_REQUEST),
              }),
            },
            400: {
              description: 'Body is not valid JSON (invalid_json) or does not match the request schema (invalid_request).',
              content: json({
                schema: { $ref: '#/components/schemas/Error' },
                examples: {
                  invalid_json: { value: { error: { code: 'invalid_json', message: ERRORS.invalid_json.message } } },
                  invalid_request: {
                    value: {
                      error: {
                        code: 'invalid_request',
                        message: 'manifest.dependencies.next must be a string',
                        path: 'manifest.dependencies.next',
                      },
                    },
                  },
                },
              }),
            },
            405: errorResponse('method_not_allowed', 'Wrong HTTP method. The Allow header lists the supported ones.'),
            413: errorResponse('payload_too_large', `Body exceeds ${LIMITS.maxBodyBytes} bytes.`),
            415: errorResponse('unsupported_media_type', 'Content-Type is not application/json.'),
            500: errorResponse('internal_error', 'Unexpected server error. No details are disclosed.'),
          },
        },
      },
    },
    components: { schemas: buildSchemas() },
  };
}
