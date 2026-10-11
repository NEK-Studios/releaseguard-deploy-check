// Sends examples/request.json to a local ReleaseGuard API and prints the report. Node.js 22+, no packages.
import { readFile } from 'node:fs/promises';

const baseUrl = process.env.RELEASEGUARD_URL ?? 'http://127.0.0.1:4318';
const body = await readFile(new URL('../request.json', import.meta.url), 'utf8');

const response = await fetch(`${baseUrl}/v1/release-check`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body,
});
const result = await response.json();
if (!response.ok) {
  console.error(`${result.error.code}: ${result.error.message}`);
  process.exit(1);
}
console.log(JSON.stringify(result, null, 2));
