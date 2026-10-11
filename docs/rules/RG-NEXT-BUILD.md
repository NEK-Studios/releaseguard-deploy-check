# RG-NEXT-BUILD: A Next.js package declares no build script

Severity: **info**

## Reports when

`next` is declared and `scripts` has no entry named `build`.

## Why it matters

Hosting platforms and CI pipelines usually run `npm run build`. Without the script they fall back to a default, or fail.

## Example

A `package.json` that triggers the rule:

```json
{
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "scripts": {
    "dev": "next dev"
  }
}
```

## Fix

Add `"build": "next build"` if this package is a deployable app.

## Limits and known false alarms

- Reported even when the build runs under another script name or is defined outside `package.json`, for example in a CI file or a task runner.

[All rules](README.md)
