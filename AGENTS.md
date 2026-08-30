# AGENTS.md

Guidance for humans and AI agents working in this repository.

## What this is

tuiweather — a keyboard-driven terminal weather app built with Bun + TypeScript + OpenTUI (`@opentui/react`).
Data sources: Open-Meteo (default; free, no key, non-commercial) and NWS `api.weather.gov` (selectable via `provider = "nws"`; US-only, no key, identified by User-Agent). Config: TOML at `~/.config/tuiweather/config.toml`.

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
  index.tsx              entry: renderer boot; CLI parsing (--one-line, --json, watch) in cli.ts
  app/                   shell, global keymap, store (zustand), refresh scheduler
  components/            presentational primitives (Sparkline, RangeBar, DaylightBar)
  features/              current/ (incl. DetailsGrid) hourly/ daily/ nowcast/ search/ locations/ onboarding/
  lib/weather/types.ts   DOMAIN MODEL — Condition enum, CurrentObs, NormalizedForecast
  lib/providers/
    types.ts             WeatherProvider interface, PROVIDER_IDS
    select.ts            selectProvider(id) — the only place provider impls are chosen
    openmeteo/           client, zod schemas, normalize, WMO table, aq (air quality), geocoding
                         <- only place WMO codes exist
    nws/                 client, zod schemas, normalize, condition table
                         <- only place NWS icon codes exist
  lib/weather/           derive.ts (nowcast rules), format.ts (units/display), cache.ts (TTL),
                         condition-display.ts (CONDITION_ICON_CELLS + icon mapping)
  lib/config/            zod schema, load/save (atomic tmp+rename)
  theme/                 palettes: ink (terminal-adaptive) + day/night accents, detection, tokens
  viewport/              breakpoint definitions + debounced hooks
test/                    unit tests, fixtures, snapshot goldens
scripts/                 dev smoke + release tooling (see docs/RELEASING.md)
```

Dependency direction is one-way: `lib/` must never import from `app/`, `features/`, or `components/`.
The UI consumes domain types from `lib/weather/types.ts` only — provider response shapes (including
WMO weather codes and NWS icon codes) must not leak past `lib/providers/<provider>/`.

## Hard rules (non-negotiable)

1. **Metric internally.** All stored/cached/computed values are metric. Convert to display units only inside `lib/weather/format.ts`.
2. **Absolute time everywhere.** Index time series by UTC instants plus `utc_offset_seconds`, never by array position or device-local time. Open-Meteo returns local-naive ISO strings when `timezone=auto`; conversion to absolute instants happens once, in the provider's normalize step.
3. **Preceding-interval semantics.** Open-Meteo precipitation values are sums over the *preceding* interval: bucket labeled T covers T-15min to T. Nowcast logic must account for this shift; tests encode it explicitly.
4. **Two-cell condition icons.** Weather-condition icons are emoji (base codepoint + U+FE0F forced-emoji presentation) and every layout reserves exactly `CONDITION_ICON_CELLS` (2) columns for them; a narrow-rendering terminal leaves a harmless one-cell gap, never drift. Everything else stays single-cell without variation selectors (`☂ ❄ ▁▂▃▄▅▆▇█ ↑↗→ °`) — bars, arrows, and precipitation markers are not condition icons.
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

## OpenTUI quirks

Hard-won knowledge from building this UI against `@opentui/react` 0.5.x. Re-check these when upgrading.

- **Lowercase intrinsics via jsx-runtime.** Elements are `box`, `text`, `span`, `input`, `scrollbox`, etc., provided by the jsx-runtime configured in tsconfig — never React DOM tags, no explicit element import needed.
- **UI tests use `testRender`** from `@opentui/react/test-utils`: capture frames with `setup.captureCharFrame()`, resize with `setup.resize(w, h)`, drive input with `setup.mockInput.pressKeys([...])` / `.pressArrow(...)` / `.pressEnter()`, and pump the render loop with `setup.flush()` (all wrapped in try/finally around `setup.renderer.destroy()`).
- **Escape needs `pressEscape()` plus a tick.** Plain `pressKeys(["escape"])` does not route the same way through the input pipeline; use `mockInput.pressEscape()` and follow with a short real sleep (~30ms) before asserting on frames.
- **No reliable wait for debounced updates.** `waitFor` cannot await debounce timers or async store chains; poll `captureCharFrame()` against a predicate with short sleeps instead (see the `waitUntilFrame` helpers in `test/ui/`).
- **Wait budgets vs bun's per-test timeout.** Any test with a guaranteed multi-second sleep or whose worst-case wait budget (a single budget or a sequential sum) can plausibly elapse on a passing run must set an explicit per-test timeout (e.g. `}, 30_000)`) — bun kills tests at its 5s default first.
- **zustand v5: `create` vs `createStore`.** `create<T>()(fn)` returns a store that doubles as a React hook (components call it selector-style) while still exposing `getState()`/`setState()` for imperative use; vanilla `createStore` returns only the imperative form. Our store instance is passed as a prop and used both ways.
- **The ascii-font tiny font lacks a degree glyph.** Never route `°` through font-based rendering; plain `text` elements handle it fine.
- **`scrollbox` needs `viewportCulling={false}` under char-frame capture**, otherwise captured frames nondeterministically drop rows outside the culled window and goldens flake.
- **Text at exactly the container width can wrap its last glyph** onto an extra row, silently shifting everything below. Keep single-line strings one column narrower than their box (see `seriesWidthFor`).
- **Build char grids per character, not per slot.** `cells[i] = "10a"` makes `join("")` emit three chars for one slot and shifts the rest of the row right; write `label[k]` into individual slots instead (see `hourLabelsRow`).
- **Hide a scrollbox's scrollbar with `scrollbarOptions={{ visible: false }}`.** The default indicator renders as a solid block column that reads like a rendering glitch in captured frames.
- **`ascii-font` accepts two-tone colors.** Pass `color={[primary, secondary]}`; glyph segments tagged `<c1>`/`<c2>` in the font data pick up each entry (e.g. `slick` digits vs its minus sign).
- **`renderer.getPalette()` needs a self-imposed timeout.** The OSC query hangs on terminals that ignore it; race it against your own timer and fall back to dark ink (see `theme/detect.ts`). Boot renders instantly with `FALLBACK_APPEARANCE` (dark) via `AppearanceApp` then swaps to the detected appearance when the ≤300 ms query resolves; the swap is skipped if identical and dropped if the renderer is already destroyed. UI tests via `testRender` never see a real OSC query — test the swap by driving a controllable promise into the appearance wrapper.
- **Condition icons are two-cell emoji.** Base codepoint + U+FE0F; the char renderer gives VS16 its own cell, so base+VS16 = exactly 2 columns — every width math (`BASE_FIXED_WIDTH`, `dailyMetrics`) counts icons via `CONDITION_ICON_CELLS`, never string length. Never rely on *default* emoji presentation (bare ⛅ ☔): OpenTUI measures those as 1 cell while terminals render 2 — always force U+FE0F. `displayWidth`/`truncateCells` in `lib/weather/format.ts` are the cell-aware primitives — use them for anything containing icons.
- **npm artifact runs on Node, not Bun.** The bundle is `--target node` (only `@opentui/core-*` native packages are external — the core JS is bundled, so CLI paths work with zero `node_modules`; native loads lazily at renderer init). Node ≥ 26.4 needs `--experimental-ffi` for that native load, and the flag is version-gated — older Node rejects it at startup (`bad option`) before our code runs. So the shebang stays plain `#!/usr/bin/env node` and `bin/tuiweather.js` is a launcher: under Bun or with flags already present it imports dist directly; on Node ≥ 26.4 it re-execs itself with `--experimental-ffi --disable-warning=ExperimentalWarning` (stdio inherit, exit code propagated); older Node runs CLI-only paths unflagged. `env -S` multi-arg shebangs are gone — never reintroduce them (cmd-shim passes flags verbatim to whatever node is installed). `process.argv` works identically under Bun, so never reintroduce `Bun.argv`; `test/package.test.ts` executes the packed artifact under plain node and the `windows-smoke` CI job pins a Node 24 step — both are the regression guards.
