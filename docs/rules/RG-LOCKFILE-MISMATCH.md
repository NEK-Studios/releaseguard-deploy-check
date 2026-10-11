# RG-LOCKFILE-MISMATCH: packageManager does not match a lockfile

Severity: **warning**

## Reports when

The `packageManager` field names npm, pnpm, yarn or bun, and one of the lockfile names you pass belongs to a different package manager.

## Why it matters

Many platforms choose the package manager from the lockfile they find, not from `packageManager`. A leftover lockfile of another manager can make CI or the host install with the wrong tool.

## Example

Request with the lockfile names of the project:

```json
{
  "manifest": {
    "packageManager": "pnpm@10.4.1"
  },
  "lockfiles": [
    "pnpm-lock.yaml",
    "package-lock.json"
  ]
}
```

## Fix

Delete the lockfile that does not belong to your package manager, or correct `packageManager`.

## Limits and known false alarms

- Only lockfile names are compared; contents are never read.
- The rule only sees the lockfiles you name. The command line needs `--lockfile` for each one; the GitHub Action and the agent hook detect lockfiles next to the manifest.
- Without a `packageManager` field nothing is reported, even with several lockfiles.

[All rules](README.md)
