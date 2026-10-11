# RG-WORKSPACE-PRIVATE: A workspace root is not marked private

Severity: **info**

## Reports when

`workspaces` is set and `private` is not `true`.

## Why it matters

A workspace root is normally not meant to be published. `"private": true` prevents an accidental `npm publish` of the whole repository; Yarn 1 even requires it.

## Example

A `package.json` that triggers the rule:

```json
{
  "name": "my-monorepo",
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
```

## Fix

Add `"private": true` to the root manifest.

## Limits and known false alarms

- Reported for the rare root package that is published on purpose.

[All rules](README.md)
