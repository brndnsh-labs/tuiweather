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
  theme/                 palettes: ink (terminal-adaptive) + day/night accents, detection, tokens
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

## OpenTUI quirks

Hard-won knowledge from building this UI against `@opentui/react` 0.5.x. Re-check these when upgrading.

- **Lowercase intrinsics via jsx-runtime.** Elements are `box`, `text`, `span`, `input`, `scrollbox`, etc., provided by the jsx-runtime configured in tsconfig — never React DOM tags, no explicit element import needed.
- **UI tests use `testRender`** from `@opentui/react/test-utils`: capture frames with `setup.captureCharFrame()`, resize with `setup.resize(w, h)`, drive input with `setup.mockInput.pressKeys([...])` / `.pressArrow(...)` / `.pressEnter()`, and pump the render loop with `setup.flush()` (all wrapped in try/finally around `setup.renderer.destroy()`).
- **Escape needs `pressEscape()` plus a tick.** Plain `pressKeys(["escape"])` does not route the same way through the input pipeline; use `mockInput.pressEscape()` and follow with a short real sleep (~30ms) before asserting on frames.
- **No reliable wait for debounced updates.** `waitFor` cannot await debounce timers or async store chains; poll `captureCharFrame()` against a predicate with short sleeps instead (see the `waitUntilFrame` helpers in `test/ui/`).
- **zustand v5: `create` vs `createStore`.** `create<T>()(fn)` returns a store that doubles as a React hook (components call it selector-style) while still exposing `getState()`/`setState()` for imperative use; vanilla `createStore` returns only the imperative form. Our store instance is passed as a prop and used both ways.
- **The ascii-font tiny font lacks a degree glyph.** Never route `°` through font-based rendering; plain `text` elements handle it fine.
- **`scrollbox` needs `viewportCulling={false}` under char-frame capture**, otherwise captured frames nondeterministically drop rows outside the culled window and goldens flake.
- **Text at exactly the container width can wrap its last glyph** onto an extra row, silently shifting everything below. Keep single-line strings one column narrower than their box (see `seriesWidthFor`).
- **Build char grids per character, not per slot.** `cells[i] = "10a"` makes `join("")` emit three chars for one slot and shifts the rest of the row right; write `label[k]` into individual slots instead (see `hourLabelsRow`).
- **Hide a scrollbox's scrollbar with `scrollbarOptions={{ visible: false }}`.** The default indicator renders as a solid block column that reads like a rendering glitch in captured frames.
- **`ascii-font` accepts two-tone colors.** Pass `color={[primary, secondary]}`; glyph segments tagged `<c1>`/`<c2>` in the font data pick up each entry (e.g. `slick` digits vs its minus sign).
- **`renderer.getPalette()` needs a self-imposed timeout.** The OSC query hangs on terminals that ignore it; race it against your own timer and fall back to dark ink (see `theme/detect.ts`). UI tests via `testRender` never see it — detection is injected as an `appearance` prop at boot.
