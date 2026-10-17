# ReleaseGuard Deploy Check

Deterministic `package.json` checks for Next.js, Expo and Convex projects. One JSON report with rule ID, severity, evidence and fix, made for CI and for coding agents.

- **No install, no build, no code execution.** It reads the manifest you pass and the names of your lockfiles.
- **Nothing leaves your machine.** No network requests, no telemetry.
- **Same input, same report.** No AI verdicts, no clock, no randomness.
- **No dependencies.** Node.js 22 or newer is all it needs.

It does not replace `expo-doctor`, `npm audit`, your build or your tests, and it never says "passed". A static manifest check cannot certify a release.

## Quick start

```sh
npx releaseguard-deploy-check package.json --lockfile pnpm-lock.yaml
```

The report goes to stdout. Exit code `0`: no error finding. `2`: at least one error finding. `1`: invalid input.

```json
{
  "status": "issues",
  "counts": { "errors": 1, "warnings": 0, "info": 0 },
  "findings": [
    {
      "ruleId": "RG-NEXT-REACT",
      "severity": "error",
      "message": "Next.js is declared without React.",
      "evidence": { "package": "next", "reactDeclared": false },
      "remediation": "Add a React dependency compatible with the chosen Next.js version."
    }
  ]
}
```

The real report has a few more fields (versions, project name, detected frameworks). See [docs/openapi.json](docs/openapi.json) for the full schema.

## GitHub Actions

```yaml
permissions:
  contents: read

jobs:
  releaseguard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: NEK-Studios/releaseguard-deploy-check@v0
        with:
          manifest: package.json
          fail-on: error   # or: warning, never
```

Findings appear as annotations on the manifest and in the job summary. Lockfiles next to the manifest are detected by name.

## Coding agents

- **Hook** for Claude Code and Codex: checks a `package.json` right after the agent edited it and reports findings back to the agent. Install it once with `npm install --save-dev releaseguard-deploy-check` so the hook starts in a fraction of a second instead of going through `npx` on every edit.
- **MCP server** over stdio with one read-only tool: `npx releaseguard-deploy-check mcp`.
- **Any agent:** add one line to your `AGENTS.md`: "After changing package.json, run `npx releaseguard-deploy-check package.json` and fix every finding with severity error before you commit."

Setup for each of them: [docs/quickstart.md](docs/quickstart.md).

## Rules

| Rule | Severity | Reports when |
|---|---|---|
| [RG-NEXT-REACT](docs/rules/RG-NEXT-REACT.md) | error | `next` is declared but `react` is not |
| [RG-NEXT-DOM](docs/rules/RG-NEXT-DOM.md) | warning | `next` is declared but `react-dom` is not |
| [RG-EXPO-RN](docs/rules/RG-EXPO-RN.md) | warning | `expo` is declared but `react-native` is not |
| [RG-NEXT-BUILD](docs/rules/RG-NEXT-BUILD.md) | info | a Next.js package has no `build` script |
| [RG-DEP-DUPLICATE](docs/rules/RG-DEP-DUPLICATE.md) | warning | a package is in `dependencies` and in `devDependencies` |
| [RG-DEP-UNPINNED](docs/rules/RG-DEP-UNPINNED.md) | warning | a version is `*` or `latest` |
| [RG-WORKSPACE-PRIVATE](docs/rules/RG-WORKSPACE-PRIVATE.md) | info | a workspace root is not marked `private` |
| [RG-LOCKFILE-MISMATCH](docs/rules/RG-LOCKFILE-MISMATCH.md) | warning | `packageManager` names a different manager than a lockfile |

Each page lists what the rule cannot see and when it raises a false alarm. Free linters such as sherif, syncpack and eslint-plugin-package-json cover several of these checks too; if you already run them, you may only need ReleaseGuard for the single JSON report and the agent integration.

## Rule packs

Rules that depend on maintained vendor data are not part of this repository. They come as separate rule packs:

```sh
npx releaseguard-deploy-check package.json --pack ./my-pack --target <platform>
```

A pack is code that runs with the rights of the check, so only load packs you trust. The report lists every loaded pack with its version under `rulePacks`. A platform pack (Node.js versions and pnpm support on Vercel, Node.js requirements of Next.js, Convex and React Native) is in a paid pilot. [tests/fixtures/demo-pack](tests/fixtures/demo-pack) shows the smallest possible pack.

## Local HTTP API

`node src/server.mjs` starts a preview API on `127.0.0.1:4318` with an OpenAPI 3.1 description. It has no authentication and no rate limit and is meant for development only. Examples: [docs/api-examples.md](docs/api-examples.md).

## Privacy and security

- The command line tool, the hook, the MCP server and the GitHub Action make no network requests.
- Script commands from your manifest are never printed. Credentials inside version URLs are replaced by `***` in findings.
- Names from the manifest are escaped before they reach workflow commands, job summaries or an agent.

ReleaseGuard is an independent tool and is not affiliated with Vercel, Expo or Convex.

## Tell us how it went (optional)

The tool sends nothing home, so we only learn whether it helps if you tell us. If you like, open a short
[first check report](https://github.com/NEK-Studios/releaseguard-deploy-check/issues/new?template=first-check.yml): how you ran it, whether the first finding was real, and
what got in the way. Please leave out anything private.

## License

MIT, see [LICENSE](LICENSE). Rule packs are separate works with their own terms.
