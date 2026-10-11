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
