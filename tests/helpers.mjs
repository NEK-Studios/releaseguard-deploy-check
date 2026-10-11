import { createApp } from '../src/server.mjs';

/**
 * Starts the app on a random local port, runs fn with its base URL and always closes the server.
 * @param {(baseUrl: string) => Promise<void>} fn
 * @param {Parameters<typeof createApp>[0]} [options]
 */
export async function withServer(fn, options) {
  const server = createApp(options).listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

/** @param {string} baseUrl @param {unknown} body @param {Record<string, string>} [headers] */
export const postJson = (baseUrl, body, headers = { 'content-type': 'application/json' }) =>
  fetch(`${baseUrl}/v1/release-check`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
