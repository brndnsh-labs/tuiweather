# Releasing tuiweather

Publishing is an explicit external release gate. A commit, merge, version bump, or successful dry run does not authorize `npm publish`.

## First-publish bootstrap

The npm package must exist before GitHub Actions can be registered as its trusted publisher. Bootstrap the package once from a clean, synced `main` checkout while `package.json` is still at `0.0.0`:

```sh
BROWSER=echo npm login --auth-type=web
npm whoami
npm pack --dry-run --json
npm publish --access public --tag next
npm trust github tuiweather --file release.yml --repo brndnsh-labs/tuiweather --allow-publish -y
```

In a headless shell, npm prints an authorization URL and waits. Open that URL on another machine, approve the request there, and leave the original command running until it reports success.

The bootstrap publish uses the `next` dist-tag so `0.0.0` does not become the default install. After trusted publishing is configured, the normal v0.1.0 release publishes `latest` through GitHub Actions with OIDC and provenance.

## Release preflight

Run from clean, synced `main`:

```sh
bun run typecheck
bun run lint
bun run test
bun run build
npm pack --dry-run --json
```

Inspect the package list. It must contain `bin/`, `dist/`, `README.md`, `LICENSE`, and `package.json`. It must not contain source, tests, scripts, CI configuration, or repository instructions.

## Release

After explicit approval for the exact version and public npm registry:

```sh
./scripts/release.sh <major|minor|patch>
```

The script creates and pushes the version commit and tag. GitHub Actions verifies the package, creates the GitHub release artifacts, and publishes npm through the trusted `release.yml` workflow.

Verify the registry independently after the workflow succeeds:

```sh
npm view tuiweather version dist-tags --json
bunx tuiweather --version
```
