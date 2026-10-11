# RG-DEP-DUPLICATE: A package is in dependencies and in devDependencies

Severity: **warning**

## Reports when

The same package name appears in both `dependencies` and `devDependencies`.

## Why it matters

Package managers resolve this differently, and the two version ranges drift apart over time. Which one ends up in production is then unclear.

## Example

A `package.json` that triggers the rule:

```json
{
  "dependencies": {
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "zod": "^3.23.0"
  }
}
```

## Fix

Keep the entry in the section where the package is really needed and delete the other one.

## Limits and known false alarms

- Credentials inside version URLs are replaced by `***` in the finding.

[All rules](README.md)
