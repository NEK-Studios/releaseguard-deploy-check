import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { analyze } from '../src/check.mjs';
import { API_VERSION, ERRORS, LIMITS, RULESET_VERSION, TOOL_VERSION } from '../src/contract.mjs';
import { postJson, withServer } from './helpers.mjs';

/**
 * Every error uses the same envelope and the same hardening headers.
 * @param {Response} response
 * @param {import('../src/contract.mjs').ErrorCode} code
 */
async function assertError(response, code) {
  assert.equal(response.status, ERRORS[code].status);
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const body = await response.json();
  assert.deepEqual(Object.keys(body), ['error']);
  assert.equal(body.error.code, code);
  assert.equal(typeof body.error.message, 'string');
  return body.error;
}

/** Sends a body without Content-Length (chunked), which fetch cannot do for strings. */
function postChunked(/** @type {string} */ baseUrl, /** @type {number} */ totalBytes) {
  return new Promise((resolve) => {
    const req = http.request(`${baseUrl}/v1/release-check`, { method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let text = '';
      res.setEncoding('utf8').on('data', (chunk) => { text += chunk; }).on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', (error) => resolve({ error }));
    const chunk = Buffer.alloc(16 * 1024, 0x20);
    for (let sent = 0; sent < totalBytes; sent += chunk.length) req.write(chunk);
    req.end();
  });
}

test('health reports versions', () => withServer(async (baseUrl) => {
  const response = await fetch(`${baseUrl}/health?probe=1`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'ok', mode: 'local-preview', apiVersion: API_VERSION, toolVersion: TOOL_VERSION, rulesetVersion: RULESET_VERSION,
  });
}));

test('release-check returns exactly what the core returns', () => withServer(async (baseUrl) => {
  const input = { manifest: { name: 'demo', dependencies: { next: 'latest' }, packageManager: 'npm@10' }, lockfiles: ['yarn.lock'] };
  const response = await postJson(baseUrl, input, { 'content-type': 'application/json; charset=utf-8' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-security-policy'), "default-src 'none'");
  assert.deepEqual(await response.json(), analyze(input));
}));

test('unknown paths and other API versions are 404', () => withServer(async (baseUrl) => {
  for (const path of ['/', '/v1', '/v1/release-check/', '/v2/release-check', '/V1/release-check', '/health/x']) {
    await assertError(await fetch(`${baseUrl}${path}`), 'not_found');
  }
}));

test('wrong method is 405 with an Allow header', () => withServer(async (baseUrl) => {
  const get = await fetch(`${baseUrl}/v1/release-check`);
  assert.equal(get.headers.get('allow'), 'POST');
  await assertError(get, 'method_not_allowed');
  const post = await fetch(`${baseUrl}/health`, { method: 'POST' });
  assert.equal(post.headers.get('allow'), 'GET');
  await assertError(post, 'method_not_allowed');
  await assertError(await fetch(`${baseUrl}/v1/openapi.json`, { method: 'DELETE' }), 'method_not_allowed');
}));

test('only application/json is accepted', () => withServer(async (baseUrl) => {
  for (const type of ['text/plain', 'application/jsonx', 'application/x-www-form-urlencoded', 'application/json-seq']) {
    await assertError(await postJson(baseUrl, { manifest: {} }, { 'content-type': type }), 'unsupported_media_type');
  }
  await assertError(await fetch(`${baseUrl}/v1/release-check`, { method: 'POST' }), 'unsupported_media_type');
}));

test('malformed JSON is invalid_json and does not echo the input', () => withServer(async (baseUrl) => {
  for (const body of ['nope', '{"manifest":', '', `${'['.repeat(20_000)}`]) {
    const error = await assertError(await postJson(baseUrl, body), 'invalid_json');
    assert.equal(error.message, ERRORS.invalid_json.message);
  }
}));

test('schema violations are invalid_request with the path of the offending value', () => withServer(async (baseUrl) => {
  const cases = [
    [{ manifest: { dependencies: { next: 10 } } }, 'manifest.dependencies.next'],
    [{ manifest: {}, lockfiles: 'yarn.lock' }, 'lockfiles'],
    [{ manifest: {}, extra: true }, 'extra'],
    [{}, 'manifest'],
    [null, undefined],
    [[], undefined],
    ['"valid JSON, but a string"', undefined],
    ['42', undefined],
  ];
  for (const [body, path] of cases) {
    const error = await assertError(await postJson(baseUrl, body), 'invalid_request');
    assert.equal(error.path, path);
  }
}));

test('body limit: exactly 64 KiB passes, one byte more is 413', () => withServer(async (baseUrl) => {
  const pad = (/** @type {number} */ size) => {
    const base = JSON.stringify({ manifest: { description: '' } });
    return JSON.stringify({ manifest: { description: 'x'.repeat(size - base.length) } });
  };
  assert.equal(Buffer.byteLength(pad(LIMITS.maxBodyBytes)), LIMITS.maxBodyBytes);
  assert.equal((await postJson(baseUrl, pad(LIMITS.maxBodyBytes))).status, 200);
  await assertError(await postJson(baseUrl, pad(LIMITS.maxBodyBytes + 1)), 'payload_too_large');
  // The server keeps working for the next client.
  assert.equal((await postJson(baseUrl, { manifest: {} })).status, 200);
}));

test('body limit also holds without Content-Length', () => withServer(async (baseUrl) => {
  const result = await postChunked(baseUrl, 4 * LIMITS.maxBodyBytes);
  assert.equal(result.status, 413);
  assert.equal(JSON.parse(result.text).error.code, 'payload_too_large');
}));

test('far oversized uploads are cut off and do not take the server down', () => withServer(async (baseUrl) => {
  const result = await postChunked(baseUrl, 32 * LIMITS.maxBodyBytes);
  assert.ok(result.error || result.status === 413, 'connection is dropped or answered with 413');
  assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
}));

test('unexpected failures are 500 without internal details', async () => {
  /** @type {unknown[]} */
  const reported = [];
  await withServer(async (baseUrl) => {
    const response = await postJson(baseUrl, { manifest: {} });
    const error = await assertError(response, 'internal_error');
    assert.equal(error.message, ERRORS.internal_error.message);
    assert.equal(JSON.stringify(error).includes('db password'), false);
  }, {
    analyze: () => { throw new Error('db password is hunter2'); },
    onInternalError: (error) => reported.push(error),
  });
  assert.equal(reported.length, 1);
});
