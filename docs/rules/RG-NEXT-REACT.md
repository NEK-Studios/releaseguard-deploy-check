# RG-NEXT-REACT: Next.js is declared without React

Severity: **error**

## Reports when

`next` is listed in `dependencies` or `devDependencies`, and `react` is in neither.

## Why it matters

Next.js needs React at build time and at run time. A manifest that does not declare it only works as long as something else happens to install React.

## Example

A `package.json` that triggers the rule:

```json
{
  "dependencies": {
    "next": "^16.0.0",
    "react-dom": "^19.0.0"
  },
  "scripts": {
    "build": "next build"
  }
}
```

## Fix

Add `react` to `dependencies` in a version your Next.js release supports, then install again and commit the lockfile.

## Limits and known false alarms

- Libraries that list `react` only in `peerDependencies` are reported although that is correct for them.
- A workspace package that gets `react` from the monorepo root is reported too: only this one manifest is read.

[All rules](README.md)
