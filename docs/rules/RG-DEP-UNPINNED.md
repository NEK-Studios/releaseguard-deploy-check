# RG-DEP-UNPINNED: A dependency uses a floating version

Severity: **warning**

## Reports when

A version in `dependencies` or `devDependencies` is exactly `*` or `latest`.

## Why it matters

A floating version means the next install can pull a new major release without any change in your repository.

## Example

A `package.json` that triggers the rule:

```json
{
  "dependencies": {
    "lodash": "*",
    "left-pad": "latest"
  }
}
```

## Fix

Replace it with a reviewed range such as `^4.17.21` and commit a lockfile.

## Limits and known false alarms

- Other floating forms are not reported: `x`, `>=0`, an empty string, other dist-tags such as `next` or `canary`, and git URLs without a commit.
- If a package is in both sections, only the entry in `dependencies` is evaluated.

[All rules](README.md)
