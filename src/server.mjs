/** LOCAL preview API only. Never bind to 0.0.0.0 or expose this without production auth/rate limits. */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { analyze } from './check.mjs';
import { API_VERSION, ERRORS, InputError, LIMITS, RULESET_VERSION, TOOL_VERSION } from './contract.mjs';
import { buildOpenApiDocument } from './openapi.mjs';

/** @typedef {import('./contract.mjs').ErrorCode} ErrorCode */

/** Oversized bodies are read and discarded up to this size so the client reliably receives the 413. */
const DRAIN_BYTES = 16 * LIMITS.maxBodyBytes;

class HttpError extends Error {
  /**
   * @param {ErrorCode} code
   * @param {{ unreadBody?: boolean }} [options] Set when the request body was not consumed: the connection cannot be reused.
   */
  constructor(code, { unreadBody = false } = {}) {
    super(ERRORS[code].message);
    this.code = code;
    this.unreadBody = unreadBody;
  }
}
/** The client went away or sent far more than DRAIN_BYTES: nothing left to answer. */
const ABORTED = Symbol('aborted');

/**
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 * @param {http.OutgoingHttpHeaders} [headers]
 */
function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

/**
 * The one error shape of this API: { error: { code, message, path? } }.
 * @param {http.ServerResponse} res
 * @param {ErrorCode} code
 * @param {{ message?: string, path?: string, headers?: http.OutgoingHttpHeaders }} [extra]
 */
function sendError(res, code, { message = ERRORS[code].message, path, headers } = {}) {
  sendJson(res, ERRORS[code].status, { error: { code, message, ...(path ? { path } : {}) } }, headers);
}

/** @param {string | undefined} url Request target; query strings are ignored. */
function pathnameOf(url) {
  try {
    return new URL(url ?? '', 'http://localhost').pathname;
  } catch {
    return undefined;
  }
}

/**
 * @param {http.IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    /** @type {Buffer[]} */
    let chunks = [];
    req.on('data', (/** @type {Buffer} */ chunk) => {
      bytes += chunk.length;
      if (bytes > DRAIN_BYTES) req.destroy();
      else if (bytes > LIMITS.maxBodyBytes) chunks = [];
      else chunks.push(chunk);
    });
    req.on('end', () => {
      if (bytes > LIMITS.maxBodyBytes) reject(new HttpError('payload_too_large'));
      else resolve(Buffer.concat(chunks));
    });
    req.on('error', () => reject(ABORTED));
    req.on('close', () => reject(ABORTED));
  });
}

/**
 * @param {http.IncomingMessage} req
 * @returns {Promise<unknown>}
 */
async function readJson(req) {
  const mediaType = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') throw new HttpError('unsupported_media_type', { unreadBody: true });
  if (Number(req.headers['content-length']) > DRAIN_BYTES) throw new HttpError('payload_too_large', { unreadBody: true });
  const body = await readBody(req);
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError('invalid_json');
  }
}

/**
 * @param {object} [options] Seams for tests and for a future gateway (metering, entitlements) around the pure core.
 * @param {typeof analyze} [options.analyze]
 * @param {readonly import('./contract.mjs').RulePack[]} [options.packs] chosen by whoever starts the server; a request can never name one
 * @param {(error: unknown) => void} [options.onInternalError]
 */
export function createApp({ analyze: runCheck = analyze, packs = [], onInternalError = (error) => console.error(error) } = {}) {
  const openApiDocument = buildOpenApiDocument();

  /** @type {Map<string, Map<string, (req: http.IncomingMessage) => unknown>>} */
  const routes = new Map();
  /** @param {string} method @param {string} path @param {(req: http.IncomingMessage) => unknown} handler */
  const route = (method, path, handler) => routes.set(path, (routes.get(path) ?? new Map()).set(method, handler));

  route('GET', '/health', () => ({
    status: 'ok', mode: 'local-preview', apiVersion: API_VERSION, toolVersion: TOOL_VERSION, rulesetVersion: RULESET_VERSION,
  }));
  route('GET', `/${API_VERSION}/openapi.json`, () => openApiDocument);
  route('POST', `/${API_VERSION}/release-check`, async (req) =>
    runCheck(/** @type {import('./contract.mjs').ReleaseCheckInput} */ (await readJson(req)), { packs }));

  const server = http.createServer(async (req, res) => {
    try {
      const path = pathnameOf(req.url);
      const methods = path === undefined ? undefined : routes.get(path);
      if (!methods) return sendError(res, 'not_found');
      const handler = methods.get(req.method ?? '');
      if (!handler) return sendError(res, 'method_not_allowed', { headers: { allow: [...methods.keys()].join(', ') } });
      return sendJson(res, 200, await handler(req));
    } catch (error) {
      if (error === ABORTED) return undefined;
      if (error instanceof InputError) return sendError(res, error.code, { message: error.message, path: error.path });
      if (error instanceof HttpError) {
        return sendError(res, error.code, { headers: error.unreadBody ? { connection: 'close' } : {} });
      }
      onInternalError(error);
      return sendError(res, 'internal_error');
    }
  });
  // A local preview needs no long-lived requests; short timeouts keep stalled clients from holding sockets.
  server.headersTimeout = 5_000;
  server.requestTimeout = 10_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 4318);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`releaseguard: usage: PORT must be an integer between 0 and 65535, got ${JSON.stringify(process.env.PORT)}`);
    process.exit(1);
  }
  createApp().listen(port, '127.0.0.1', () => console.log(`ReleaseGuard local preview: http://127.0.0.1:${port}`));
}
