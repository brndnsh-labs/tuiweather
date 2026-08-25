# Gates

What each gate is for, beyond the command:

- **typecheck** (`tsc --noEmit`, strict) — catches unit and time-semantics violations expressible in types. Non-null assertions require a proven-safe justification comment.
- **lint** (`biome check` = lint + format) — formatting drift fails CI outright; `bun run fmt` before pushing, don't fix on merge.
- **test** (`bun test`) — new behavior ships with tests; bug fixes ship with a regression test. No network: HTTP lives as fixtures under `test/fixtures/`. Goldens update only via `bun test -u` and are reviewed line by line — a `.snap` diff must be visually intentional.
- **build** (`bun run build`) — the shipped artifact must bundle standalone with `@opentui/core-*` external; CI runs it inside the same required `verify` job.

Repo rules around gates:

- All gates green **twice consecutively** before merge (flake guard — don't waive it).
- CI installs with `--frozen-lockfile`: manifest changes must carry `bun.lock` updates in the same PR.
