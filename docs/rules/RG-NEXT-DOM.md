# RG-NEXT-DOM: Next.js is declared without react-dom

Severity: **warning**

## Reports when

`next` is listed in `dependencies` or `devDependencies`, and `react-dom` is in neither.

## Why it matters

Next.js renders with `react-dom`. Without the declaration, the installed version is whatever another package pulls in, and it can differ from your `react` version.

## Example

A `package.json` that triggers the rule:

```json
{
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0"
  },
  "scripts": {
    "build": "next build"
  }
}
```

## Fix

Add `react-dom` in the same version as `react`.

## Limits and known false alarms

- Same as RG-NEXT-REACT: `peerDependencies` and packages provided by a monorepo root are not seen.

[All rules](README.md)
