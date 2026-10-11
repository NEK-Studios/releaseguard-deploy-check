#!/bin/sh
# Sends examples/request.json to a local ReleaseGuard API and prints the report. Needs curl 7.76 or newer.
curl --silent --show-error --fail-with-body -X POST "${RELEASEGUARD_URL:-http://127.0.0.1:4318}/v1/release-check" \
  -H "Content-Type: application/json" \
  --data-binary "@$(dirname "$0")/../request.json"
