# API examples

There is no hosted ReleaseGuard API. Everything below runs against the local preview.

Start the local preview first (Node.js 22 or newer, no install step):

```sh
node src/server.mjs
```

It listens on `http://127.0.0.1:4318` only. The contract is [openapi.json](openapi.json) (OpenAPI 3.1, also served at
`GET /v1/openapi.json`). All examples send [examples/request.json](../examples/request.json) and print the report in
[examples/response.json](../examples/response.json). Set `RELEASEGUARD_URL` to use another port.

## Request

`POST /v1/release-check` with `Content-Type: application/json`:

| Field | Required | Meaning |
|---|---|---|
| `manifest` | yes | Your parsed `package.json`. Only the properties listed in the OpenAPI schema are evaluated. |
| `lockfiles` | no | Names of lockfiles in the project. Only names are compared; contents are never read. |
| `targets` | no | Platforms the project deploys to. Only accepted when the server was started with a rule pack that knows the platform; otherwise the request is rejected as `invalid_request`. |

### curl

```sh
#!/bin/sh
# Sends examples/request.json to a local ReleaseGuard API and prints the report. Needs curl 7.76 or newer.
curl --silent --show-error --fail-with-body -X POST "${RELEASEGUARD_URL:-http://127.0.0.1:4318}/v1/release-check" \
  -H "Content-Type: application/json" \
  --data-binary "@$(dirname "$0")/../request.json"
```

### Node.js

```js
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
```

### Python

```python
"""Sends examples/request.json to a local ReleaseGuard API and prints the report. Python 3, standard library only."""
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

base_url = os.environ.get("RELEASEGUARD_URL", "http://127.0.0.1:4318")
body = pathlib.Path(__file__).resolve().parent.parent.joinpath("request.json").read_bytes()

request = urllib.request.Request(
    f"{base_url}/v1/release-check",
    data=body,
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(request, timeout=10) as response:
        report = json.load(response)
except urllib.error.HTTPError as error:
    problem = json.load(error)["error"]
    sys.exit(f"{problem['code']}: {problem['message']}")
print(json.dumps(report, indent=2))
```

The three files are in `examples/api/` and run in the test suite against the real server.

## Response

Status `200` with the report: `schemaVersion`, `rulesetVersion`, `toolVersion`, `project`, `frameworks`, `status`,
`counts`, `findings`, `disclaimer`. Each finding has `ruleId`, `severity` (`error`, `warning`, `info`), `message`,
`evidence` and `remediation`. The full report for the example request is `examples/response.json`.

- `status` is `issues` when at least one finding is an error, otherwise `review`. There is no "passed": a static
  manifest check cannot certify a release.
- The same request with the same `toolVersion` and `rulesetVersion` returns the same bytes.
- Rules and their known false positives: [rules/README.md](rules/README.md).

## Errors

Every error has one shape: `{ "error": { "code": "…", "message": "…", "path": "…" } }`. `code` is stable, `message`
may change, `path` only exists for `invalid_request` and names the offending value.

| Code | Status | When |
|---|---|---|
| `invalid_json` | 400 | The body is not JSON. |
| `invalid_request` | 400 | The body does not match the schema, including unknown top-level properties and unknown targets. |
| `not_found` | 404 | Unknown path. |
| `method_not_allowed` | 405 | Wrong method; the `Allow` header lists the allowed ones. |
| `payload_too_large` | 413 | The body is larger than 64 KiB. |
| `unsupported_media_type` | 415 | `Content-Type` is not `application/json`. |
| `internal_error` | 500 | Unexpected error; no details are returned. |

## Limits

- Request body up to 64 KiB, up to 20 lockfile names of up to 128 characters each.
- Timeouts of the local preview: 5 seconds for the headers, 10 seconds for the whole request.
- Rate limits: none. The local preview has no sign-in and no quota and must not be exposed to a network. A hosted
  API would need both; neither exists, and no quota or price is promised here.

## Data handling

- Nothing is stored: no database, no files, no cache, no request log.
- The manifest is held in memory for the duration of one check. Lockfile contents are never read.
- The report never contains script commands. Credentials inside version URLs are replaced by `***` in evidence.
- Fields such as `author` can contain personal data; they are not evaluated and not returned.
- No analytics, no cookies, no calls to third parties. ReleaseGuard makes no network request at all.

This describes the local preview. A hosted service would need its own privacy notice and review before launch.
