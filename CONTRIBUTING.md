# Contributing

Thanks for helping build tuiweather. This is a small, opinionated codebase; the fastest path to a merged PR is to keep changes tight and let the gates do the reviewing.

## Setup

Requires [Bun](https://bun.sh) >= 1.3.

```sh
bun install
bun run dev        # run the TUI locally
```

## Gates

CI runs all three on every PR and they are required checks on `main`. Run them locally before pushing:

| Command | Purpose |
| --- | --- |
| `bun run typecheck` | `tsc --noEmit` (strict) |
| `bun run lint` | Biome check (lint + format) |
| `bun run test` | bun test |

`bun run fmt` autofixes formatting. All three gates must pass twice consecutively before merge.

## Ground rules

- Read [AGENTS.md](AGENTS.md) first — it documents the architecture, hard rules, and known OpenTUI quirks.
- Strict TypeScript everywhere; no non-null assertions unless proven safe with a comment explaining why.
- No comments unless requested or genuinely load-bearing.
- Metric units are stored, cached, and computed internally; convert for display only inside `src/lib/weather/format.ts`.
- Time series are indexed by absolute UTC instants plus `utc_offset_seconds`, never array positions or device-local time.
- Single-cell Unicode glyphs only — no emoji presentation, no variation selectors.
- Dependencies are kept minimal; additions require justification in the PR description.
- Conventional commits (`feat:`, `fix:`, `chore:`, ...).

## Tests

- Tests live under `test/`, mirroring the `src/` layout.
- No network in tests: HTTP responses are recorded JSON fixtures under `test/fixtures/`.
- UI snapshot goldens are updated with `bun test -u`; treat `.snap` diffs like code and review them line by line. A golden change must be visually intentional.
- When touching store behavior, prefer injected fakes (fetchers, geocoders, timers) over real waits.

## PR checklist

1. Gates green (typecheck, lint, test).
2. New behavior has tests; bug fixes have a regression test.
3. Snapshot diffs justified if present.
4. README/config docs updated when user-facing surface changes.

## Releases

Releases are tag-driven and cut from `main` by a maintainer:

```sh
./scripts/release.sh <major|minor|patch>
```

The script verifies a clean, synced tree, bumps `package.json`, prepends a changelog section generated from conventional commits, tags `vX.Y.Z`, and pushes. The `release` workflow then builds cross-platform binaries, attaches them to the GitHub release with checksums, and publishes to npm.

See [docs/RELEASING.md](docs/RELEASING.md) for the package boundary, first-publish bootstrap, authentication flow, and release verification.
