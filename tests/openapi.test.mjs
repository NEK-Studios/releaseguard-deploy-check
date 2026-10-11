import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyze } from '../src/check.mjs';
import { ERRORS } from '../src/contract.mjs';
import { EXAMPLE_REQUEST, buildOpenApiDocument } from '../src/openapi.mjs';
import { RULE_ID_PATTERN } from '../src/contract.mjs';
import { RULE_IDS } from '../src/rules.mjs';
import { withServer } from './helpers.mjs';

/** @param {string} path */
const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
// Round trip through JSON so the comparison sees what a client sees.
const document = JSON.parse(JSON.stringify(buildOpenApiDocument()));

test('docs/openapi.json is up to date (run "npm run openapi" after contract changes)', async () => {
  assert.deepEqual(await readJson('docs/openapi.json'), document);
});

test('the server serves the same document', () => withServer(async (baseUrl) => {
  const response = await fetch(`${baseUrl}/v1/openapi.json`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), document);
}));

test('document is OpenAPI 3.1 with unique operation ids and resolvable references', () => {
  assert.equal(document.openapi, '3.1.0');
  const operations = Object.values(document.paths).flatMap((item) => Object.values(/** @type {object} */ (item)));
  const ids = operations.map((operation) => operation.operationId);
  assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0));
  assert.equal(new Set(ids).size, ids.length);
  for (const [, name] of JSON.stringify(document).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)) {
    assert.ok(Object.hasOwn(document.components.schemas, /** @type {string} */ (name)), `unresolved $ref ${name}`);
  }
});

test('every documented operation is routed', () => withServer(async (baseUrl) => {
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of Object.keys(/** @type {object} */ (item))) {
      const response = await fetch(`${baseUrl}${path}`, { method: method.toUpperCase() });
      assert.ok(![404, 405].includes(response.status), `${method.toUpperCase()} ${path} is documented but not routed`);
    }
  }
}));

test('documented enums match the code', () => {
  const { schemas } = document.components;
  assert.deepEqual(schemas.Error.properties.error.properties.code.enum, Object.keys(ERRORS));
  // Rule ids are open: packs add their own. The document only fixes their shape.
  assert.equal(schemas.Finding.properties.ruleId.pattern, RULE_ID_PATTERN);
  for (const id of RULE_IDS) assert.match(id, new RegExp(RULE_ID_PATTERN));
  assert.equal(schemas.ReleaseCheckRequest.properties.targets.items.enum, undefined);
});

test('every documented error status exists in the error catalog', () => {
  const statuses = new Set(Object.values(ERRORS).map((error) => String(error.status)));
  const documented = Object.keys(document.paths['/v1/release-check'].post.responses).filter((status) => status !== '200');
  for (const status of documented) assert.ok(statuses.has(status), `status ${status}`);
});

test('documented examples are real: the request file and the computed report', async () => {
  assert.deepEqual(await readJson('examples/request.json'), EXAMPLE_REQUEST);
  const media = document.paths['/v1/release-check'].post;
  assert.deepEqual(media.requestBody.content['application/json'].example, EXAMPLE_REQUEST);
  assert.deepEqual(media.responses['200'].content['application/json'].example, analyze(EXAMPLE_REQUEST));
});
