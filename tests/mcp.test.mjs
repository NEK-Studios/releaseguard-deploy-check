import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyze } from '../src/check.mjs';
import { LIMITS, TOOL_VERSION, buildSchemas } from '../src/contract.mjs';
import { MCP_PROTOCOL_VERSION, MCP_TOOL_NAME } from '../src/mcp.mjs';

const root = new URL('../', import.meta.url);
const entry = fileURLToPath(new URL('src/cli.mjs', root));

const VERSION = 'io.modelcontextprotocol/protocolVersion';
const CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
const SERVER_INFO = 'io.modelcontextprotocol/serverInfo';
/** Request metadata every request of the stateless protocol carries (MCP 2026-07-28). */
const meta = { [VERSION]: MCP_PROTOCOL_VERSION, 'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0' }, [CAPABILITIES]: {} };

/**
 * Starts the real server the way an MCP client does, writes the messages to stdin and closes it.
 * @param {unknown[]} messages a string is written verbatim as one line
 * @param {{ eol?: string, args?: string[] }} [options]
 * @returns {Promise<{ code: number | null, replies: any[], stdout: string, stderr: string }>}
 */
const session = (messages, { eol = '\n', args = [] } = {}) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [entry, 'mcp', ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('close', (code) => {
      const lines = stdout.split('\n').filter(Boolean);
      // Usage and help output is plain text, not JSON-RPC.
      /** @type {any[]} */
      let replies;
      try {
        replies = lines.map((line) => JSON.parse(line));
      } catch {
        replies = [];
      }
      resolve({ code, replies, stdout, stderr });
    });
    child.stdin.end(messages.map((message) => (typeof message === 'string' ? message : JSON.stringify(message)) + eol).join(''));
  });

/** @param {string | number} id @param {string} method @param {Record<string, unknown>} [params] */
const modern = (id, method, params = {}) => ({ jsonrpc: '2.0', id, method, params: { ...params, _meta: meta } });
/** @param {string | number} id @param {unknown} args */
const call = (id, args) => modern(id, 'tools/call', { name: MCP_TOOL_NAME, arguments: args });
const noReact = { manifest: { name: 'web', dependencies: { next: '^15', 'react-dom': '^19' } }, lockfiles: ['pnpm-lock.yaml'] };

test('server/discover: versions, tools capability and server identity', async () => {
  const { code, replies, stderr } = await session([modern('d1', 'server/discover')]);
  assert.equal(code, 0);
  assert.equal(stderr, '');
  assert.equal(replies.length, 1);
  const { jsonrpc, id, result } = replies[0];
  assert.deepEqual([jsonrpc, id, result.resultType], ['2.0', 'd1', 'complete']);
  assert.ok(result.supportedVersions.includes(MCP_PROTOCOL_VERSION));
  assert.deepEqual(result.capabilities, { tools: {} });
  assert.deepEqual(result._meta[SERVER_INFO], { name: 'releaseguard', title: 'ReleaseGuard', version: TOOL_VERSION });
  assert.equal(typeof result.instructions, 'string');
});

test('tools/list: one read-only tool whose schemas come from the contract', async () => {
  const { replies } = await session([modern(1, 'tools/list')]);
  const { result } = replies[0];
  assert.equal(result.resultType, 'complete');
  assert.equal(result.tools.length, 1);
  const [tool] = result.tools;
  assert.equal(tool.name, MCP_TOOL_NAME);
  assert.match(tool.name, /^[A-Za-z0-9_.-]{1,128}$/);
  assert.ok(tool.description.length > 0);
  const schemas = JSON.parse(JSON.stringify(buildSchemas()));
  assert.deepEqual(tool.inputSchema, schemas.ReleaseCheckRequest);
  assert.deepEqual(tool.outputSchema.required, schemas.ReleaseCheckReport.required);
  assert.deepEqual(tool.outputSchema.properties.findings.items, schemas.Finding);
  // MCP clients must not fetch references, so the schemas have to be self-contained.
  assert.doesNotMatch(JSON.stringify(tool), /"\$ref"/);
  assert.deepEqual(tool.annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
});

test('tools/call: the report as structured content and as text, identical to analyze()', async () => {
  const { replies } = await session([call(2, noReact)]);
  const { id, result } = replies[0];
  const expected = JSON.parse(JSON.stringify(analyze(noReact)));
  assert.equal(id, 2);
  assert.deepEqual([result.resultType, result.isError], ['complete', false]);
  assert.deepEqual(result.structuredContent, expected);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, 'text');
  assert.deepEqual(JSON.parse(result.content[0].text), expected);
  assert.equal(expected.findings[0].ruleId, 'RG-NEXT-REACT');
});

test('same call, same bytes', async () => {
  const { stdout } = await session([call(1, noReact), call(1, noReact)]);
  const [first, second] = stdout.split('\n');
  assert.ok(first);
  assert.equal(first, second);
});

test('invalid tool input is a tool error the model can act on, in the error shape of the HTTP API', async () => {
  const cases = /** @type {[unknown, string][]} */ ([
    [{ manifest: { dependencies: { next: 10 } } }, 'manifest.dependencies.next'],
    [{ manifest: {}, targets: ['netlify'] }, 'targets'],
    [{ manifest: {}, extra: true }, 'extra'],
    [{}, 'manifest'],
  ]);
  const { replies } = await session(cases.map(([args], index) => call(index, args)));
  for (const [index, [, path]] of cases.entries()) {
    const { result, error } = replies[index];
    assert.equal(error, undefined);
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    const body = JSON.parse(result.content[0].text);
    assert.deepEqual(Object.keys(body), ['error']);
    assert.deepEqual([body.error.code, body.error.path], ['invalid_request', path]);
    assert.equal(typeof body.error.message, 'string');
  }
});

test('protocol errors use JSON-RPC error codes', async () => {
  const cases = /** @type {[unknown, number, unknown][]} */ ([
    ['{"jsonrpc":"2.0","id":1,', -32700, null],
    ['[]', -32600, null],
    [{ jsonrpc: '2.0', id: null, method: 'tools/list', params: { _meta: meta } }, -32600, null],
    [{ jsonrpc: '1.0', id: 3, method: 'tools/list', params: { _meta: meta } }, -32600, 3],
    [{ jsonrpc: '2.0', id: 4, result: {} }, -32600, 4],
    [modern(5, 'resources/list'), -32601, 5],
    [modern(6, 'tools/call', { name: 'other_tool', arguments: {} }), -32602, 6],
    [modern(7, 'tools/call', { name: MCP_TOOL_NAME, arguments: [] }), -32602, 7],
    [{ jsonrpc: '2.0', id: 8, method: 'tools/list', params: [] }, -32602, 8],
    [modern(9, 'tools/list', { cursor: 'page-2' }), -32602, 9],
  ]);
  const { replies, stderr } = await session(cases.map(([message]) => message));
  assert.equal(stderr, '');
  assert.equal(replies.length, cases.length);
  for (const [index, [, code, id]] of cases.entries()) {
    assert.deepEqual([replies[index].error.code, replies[index].id], [code, id], JSON.stringify(replies[index]));
    assert.equal(replies[index].result, undefined);
  }
});

test('request metadata: missing fields are invalid params, other versions are answered with the supported list', async () => {
  const { replies } = await session([
    { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: { [VERSION]: MCP_PROTOCOL_VERSION } } },
    { jsonrpc: '2.0', id: 3, method: 'tools/list', params: { _meta: { ...meta, [VERSION]: '1900-01-01' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/list', params: { _meta: { ...meta, [VERSION]: 20260728 } } },
  ]);
  assert.equal(replies[0].error.code, -32602);
  assert.match(replies[0].error.message, /protocolVersion/);
  assert.equal(replies[1].error.code, -32602);
  assert.match(replies[1].error.message, /clientCapabilities/);
  assert.equal(replies[2].error.code, -32022);
  assert.equal(replies[2].error.data.requested, '1900-01-01');
  assert.ok(replies[2].error.data.supported.includes(MCP_PROTOCOL_VERSION));
  assert.equal(replies[3].error.code, -32602);
});

test('notifications are never answered', async () => {
  const { replies } = await session([
    { jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', method: 'tools/list', params: { _meta: meta } },
    modern('after', 'ping'),
  ]);
  assert.deepEqual(replies.map((reply) => reply.id), ['after']);
  assert.equal(replies[0].result.resultType, 'complete');
});

test('clients of earlier protocol versions can still open with initialize', async () => {
  const { replies } = await session([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'old', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: MCP_TOOL_NAME, arguments: noReact } },
    { jsonrpc: '2.0', id: 4, method: 'ping' },
  ]);
  assert.equal(replies.length, 4);
  assert.equal(replies[0].result.protocolVersion, '2025-06-18');
  assert.deepEqual(replies[0].result.capabilities, { tools: {} });
  assert.deepEqual(replies[0].result.serverInfo, { name: 'releaseguard', title: 'ReleaseGuard', version: TOOL_VERSION });
  assert.equal(replies[1].result.tools[0].name, MCP_TOOL_NAME);
  assert.equal(replies[2].result.structuredContent.status, 'issues');
  assert.equal(replies[3].error, undefined);

  const unknown = await session([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } }]);
  assert.equal(unknown.replies[0].result.protocolVersion, '2025-11-25');
});

test('an oversized message is rejected and the server keeps serving', async () => {
  const big = call('big', { manifest: { description: 'x'.repeat(LIMITS.maxBodyBytes * 2) } });
  const { code, replies } = await session([big, call('next', noReact)]);
  assert.equal(code, 0);
  assert.equal(replies.length, 2);
  assert.deepEqual([replies[0].error.code, replies[0].id], [-32600, null]);
  assert.match(replies[0].error.message, /exceeds \d+ bytes/);
  assert.equal(replies[1].id, 'next');
  assert.equal(replies[1].result.isError, false);
});

test('every reply is one line of JSON; Windows line endings and blank lines are accepted', async () => {
  const tricky = call(1, { manifest: { name: 'line\nbreak', dependencies: { 'a\nb': '*' } } });
  const { stdout, replies } = await session([tricky, '', modern(2, 'ping')], { eol: '\r\n' });
  assert.equal(stdout.split('\n').filter(Boolean).length, 2);
  assert.ok(stdout.endsWith('\n'));
  assert.doesNotMatch(stdout, /\r/);
  assert.deepEqual(replies.map((reply) => reply.id), [1, 2]);
});

test('replies never contain script commands or credentials from version URLs', async () => {
  const { stdout, stderr } = await session([
    call(1, {
      manifest: {
        scripts: { deploy: 'curl -H "Authorization: Bearer s3cr3t" https://example.com' },
        dependencies: { next: '^15', lib: 'git+https://user:t0ken@example.com/lib.git' },
        devDependencies: { lib: 'git+https://user:t0ken@example.com/lib.git' },
      },
    }),
  ]);
  assert.match(stdout, /RG-DEP-DUPLICATE/);
  assert.doesNotMatch(stdout + stderr, /s3cr3t|t0ken|curl/);
});

test('a rule pack given at start makes its targets usable', async () => {
  const packDir = fileURLToPath(new URL('./fixtures/demo-pack', import.meta.url));
  const call = modern(2, 'tools/call', { name: MCP_TOOL_NAME, arguments: { manifest: {}, targets: ['demo'] } });
  const without = await session([modern(1, 'tools/list'), call]);
  assert.equal(without.replies[0].result.tools[0].inputSchema.properties.targets.items.enum, undefined);
  assert.equal(without.replies[1].result.isError, true);
  const withPack = await session([modern(1, 'tools/list'), call], { args: ['--pack', packDir] });
  assert.deepEqual(withPack.replies[0].result.tools[0].inputSchema.properties.targets.items.enum, ['demo']);
  assert.equal(withPack.replies[1].result.structuredContent.findings[0].ruleId, 'RG-DEMO-TARGET');
  assert.equal(withPack.replies[1].result.structuredContent.rulePacks[0].name, 'demo-pack');
  const broken = await session([], { args: ['--pack', './no-such-pack'] });
  assert.equal(broken.code, 1);
  assert.match(broken.stderr, /^releaseguard: pack_error: cannot load rule pack/);
});

test('usage: "mcp" takes only --pack and --help', async () => {
  const help = await session([], { args: ['--help'] });
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^Usage: releaseguard mcp/);
  const extra = await session([], { args: ['extra'] });
  assert.equal(extra.code, 1);
  assert.match(extra.stderr, /^releaseguard: usage: /);
  assert.equal(extra.stdout, '');
});

