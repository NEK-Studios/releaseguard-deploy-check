# Rules

Every rule is an observation about one `package.json`. Findings come in catalog order, and within a rule by package or file name, so the same input always gives the same report.

| Rule | Severity | Reports when |
|---|---|---|
| [RG-NEXT-REACT](RG-NEXT-REACT.md) | error | Next.js is declared without React |
| [RG-NEXT-DOM](RG-NEXT-DOM.md) | warning | Next.js is declared without react-dom |
| [RG-EXPO-RN](RG-EXPO-RN.md) | warning | Expo is declared without react-native |
| [RG-NEXT-BUILD](RG-NEXT-BUILD.md) | info | A Next.js package declares no build script |
| [RG-DEP-DUPLICATE](RG-DEP-DUPLICATE.md) | warning | A package is in dependencies and in devDependencies |
| [RG-DEP-UNPINNED](RG-DEP-UNPINNED.md) | warning | A dependency uses a floating version |
| [RG-WORKSPACE-PRIVATE](RG-WORKSPACE-PRIVATE.md) | info | A workspace root is not marked private |
| [RG-LOCKFILE-MISMATCH](RG-LOCKFILE-MISMATCH.md) | warning | packageManager does not match a lockfile |

## What the rules do not do

- They do not check whether versions are compatible with each other.
- They read one manifest: no workspace packages, no lockfile contents, no `node_modules`.
- `peerDependencies`, `optionalDependencies`, `overrides` and `resolutions` are not evaluated.
- The status is `issues` (at least one error finding) or `review`. There is no "passed".

## Rule packs

Rules that depend on maintained vendor data, such as platform rules, are not part of this catalog. They come as separate rule packs that you load with `--pack`. A pack is code: only load packs you trust. The report lists every loaded pack with its version under `rulePacks`.
