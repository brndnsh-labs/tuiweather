# Releasing tuiweather

Publishing is an explicit external release gate. A commit, merge, version bump, or successful dry run does not authorize a public npm or GitHub release.

## Release architecture

Pushing a `v*` tag runs `.github/workflows/release.yml`:

1. `prepare` verifies the tag is on `main` and matches `package.json`, runs all gates, packs the npm tarball once, cross-compiles the standalone binaries for `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, and `windows-x64`, smoke-tests the Linux host binary, and uploads short-lived workflow artifacts.
2. `windows-smoke` downloads the Windows artifact on `windows-latest` and asserts `tuiweather.exe --version` matches the tag. A failure here blocks publish.
3. `npm-publish` runs only after both `prepare` and `windows-smoke` succeed, downloads that exact tarball and publishes it through npm trusted publishing with GitHub OIDC and provenance. No npm token is stored in GitHub.
4. `github-release` runs only after npm succeeds and attaches the standalone archives (`tuiweather-linux-x64.tar.gz`, `tuiweather-linux-arm64.tar.gz`, `tuiweather-darwin-x64.tar.gz`, `tuiweather-darwin-arm64.tar.gz`, `tuiweather-windows-x64.tar.gz` plus `.sha256`) to the GitHub release.

The workflow pins Bun, npm, and every Action used by the release. Dependabot proposes weekly Action pin updates.

## One-time trusted-publisher setup (completed)

This setup was completed before the first supported release and is recorded here for provenance — a maintainer arriving after `v0.3.x` does not need to repeat it. The bootstrap package `tuiweather@0.0.0` was the first publish; `v0.1.0` was the first supported release. `latest` tracks the current version.

The setup consisted of an `npm` deployment environment on this repository, with npm trusting that environment for the `release.yml` workflow:

```sh
gh api --method PUT repos/brndnsh-labs/tuiweather/environments/npm
npm --version
npm trust github tuiweather \
  --file release.yml \
  --repo brndnsh-labs/tuiweather \
  --environment npm \
  --allow-publish \
  --yes
npm trust list tuiweather
```

Managing trusted publishers requires npm 11.15.0 or newer. The release workflow uses npm 12.0.2; its publish job must retain `id-token: write` permission.

In a headless shell, npm prints an authorization URL. Open it on another machine and approve the request there. Browser success is not command success: verify the CLI exit status and confirm the relationship with `npm trust list tuiweather`.

## Release preflight

`scripts/release.sh` requires a clean `main` checkout exactly synchronized with `origin/main`. It automatically runs:

```sh
bun run typecheck
bun run lint
bun run test
bun run build
npm pack --dry-run --json
```

The package must contain `bin/`, `dist/`, `README.md`, `LICENSE`, and `package.json`. It must not contain source, tests, scripts, CI configuration, or repository instructions.

## Release

After explicit approval for the exact version and both public release surfaces:

```sh
./scripts/release.sh <major|minor|patch>
```

The script bumps `package.json`, updates `CHANGELOG.md`, creates `vX.Y.Z`, and atomically pushes the release commit and that exact tag. Pick the bump type from the shipped changes: `fix:` subjects → `patch`, `feat:` subjects → `minor`, breaking changes → `major`.

Watch the workflow:

```sh
gh run list --workflow release.yml --limit 1
gh run watch <run-id>
```

Verify both public surfaces independently after the workflow succeeds:

```sh
npm view tuiweather version dist-tags --json
bunx tuiweather --version
gh release view vX.Y.Z
gh release view vX.Y.Z --json assets --jq '.assets[].name' | grep -E 'tuiweather-(linux-x64|linux-arm64|darwin-x64|darwin-arm64|windows-x64)\.tar\.gz'
```

If a job fails, fix the cause and rerun only the failed jobs when safe. Never retry an npm publish after the version is visible in the registry; npm versions are immutable.
