# AGENTS.md

Guidance for humans and AI agents working in this repository.

## What this is

tuiweather — a keyboard-driven terminal weather app built with Bun + TypeScript + OpenTUI (`@opentui/react`).
Data source: Open-Meteo (free, no key, non-commercial). Config: TOML at `~/.config/tuiweather/config.toml`.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Run the TUI locally |
| `bun run build` | Bundle to `dist/` |
| `bun run typecheck` | `tsc --noEmit` (strict) |
| `bun run lint` | Biome check (lint + format) |
| `bun run fmt` | Biome autofix |
| `bun run test` | bun test |

**Verify before done:** after any change, run `typecheck`, `lint`, and `test`. All three must pass.
CI runs the same gates on every PR; they are required checks on `main`.

## Architecture

```
src/
  index.tsx              entry: arg parsing (--one-line), renderer boot
  app/                   shell, global keymap, store (zustand), refresh scheduler
  components/            presentational primitives (Sparkline, RangeBar, Panel, Glyph)
  features/              current/ hourly/ daily/ nowcast/ details/ search/
  lib/weather/types.ts   DOMAIN MODEL — Condition enum, CurrentObs, NormalizedForecast
  lib/providers/
    types.ts             WeatherProvider interface
    openmeteo/           client, zod schemas, normalize, WMO table  <- only place WMO codes exist
  lib/weather/           derive.ts (nowcast rules), format.ts (units/display), cache.ts (TTL)
  lib/config/            zod schema, load/save (atomic tmp+rename)
  theme/                 day/night palette tokens
  viewport/              breakpoint definitions + debounced hooks
test/                    unit tests, fixtures, snapshot goldens
scripts/                 dev-only scripts (smoke)
```

Dependency direction is one-way: `lib/` must never import from `app/`, `features/`, or `components/`.
The UI consumes domain types from `lib/weather/types.ts` only — provider response shapes (including
WMO weather codes) must not leak past `lib/providers/<provider>/`.

## Hard rules (non-negotiable)

1. **Metric internally.** All stored/cached/computed values are metric. Convert to display units only inside `lib/weather/format.ts`.
2. **Absolute time everywhere.** Index time series by UTC instants plus `utc_offset_seconds`, never by array position or device-local time. Open-Meteo returns local-naive ISO strings when `timezone=auto`; conversion to absolute instants happens once, in the provider's normalize step.
3. **Preceding-interval semantics.** Open-Meteo precipitation values are sums over the *preceding* interval: bucket labeled T covers T-15min to T. Nowcast logic must account for this shift; tests encode it explicitly.
4. **Single-cell glyphs only.** Use Unicode glyphs without variation selectors (`☀ ☁ ☂ ⚡ ▁▂▃▄▅▆▇█ ↑↗→`). No emoji presentation — it breaks terminal alignment.
5. **Responsive floors.** Breakpoint tiers: lg ≥96, md 68–95, sm 48–67, xs 32–47 cols. Below 32 cols clamp and ellipsis-truncate; never crash or overflow. Resize handling is debounced (~100ms).
6. **Atomic config writes** (tmp + rename). Bump `schema_version` on breaking config changes and add a migration.
7. **Secrets discipline.** API keys resolve env var > config file; keys are never logged or embedded in error messages. (Reserved for future providers; Open-Meteo needs none.)
8. **No network in tests.** HTTP responses live as recorded JSON fixtures under `test/fixtures/`.

## Conventions

- Strict TypeScript; no non-null assertions unless proven safe with a comment explaining why.
- No comments unless requested or genuinely load-bearing.
- Conventional commits (`feat:`, `fix:`, `chore:`...); PRs must pass all CI checks before merge.
- Tests colocate under `test/` mirroring `src/` layout; snapshot goldens update via `bun test -u` and are reviewed like code.
- Keep dependencies minimal; additions require justification in the PR description.
