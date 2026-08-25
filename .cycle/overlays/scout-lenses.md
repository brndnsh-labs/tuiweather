# Scout lenses

What each lens looks for *here*, with the real smells.

## Boundary leaks
- WMO code literals (0, 51, 61, 71, 95…) or Open-Meteo field names (`temperature_2m`, `precipitation_probability`) anywhere outside `src/lib/providers/openmeteo/`.
- Any file under `src/lib/` importing from `app/`, `features/`, or `components/` — dependency direction is one-way.
- Provider response shapes reaching components instead of `CurrentObs` / `NormalizedForecast` from `lib/weather/types.ts`.

## Time semantics
- Forecast arrays indexed by position, or labels built from device-local `new Date()` instead of UTC instants + `utc_offset_seconds`.
- Nowcast reading bucket T as covering T→T+15; Open-Meteo precipitation sums cover T−15→T (preceding interval).
- Naive-local ISO strings compared as if absolute.

## Unit leaks
- Imperial conversion anywhere outside `lib/weather/format.ts`.
- Non-metric values stored in cache or store state.
- `°F` arithmetic in `features/` — display-only math belongs behind format.ts.

## Terminal alignment
- Emoji presentation or variation-selector glyphs (U+FE0F) — breaks single-cell alignment.
- Single-line strings exactly at container width: last glyph wraps onto a new row and shifts everything below (`seriesWidthFor` exists for this).
- Char grids built per slot (`cells[i] = "10a"` emits three chars for one slot) instead of writing `label[k]` into individual slots.
- `°` routed through ascii-font rendering — the tiny font lacks it.

## Test fidelity
- Network calls in tests — every HTTP response must be a recorded fixture under `test/fixtures/`.
- Goldens regenerated to force green rather than to record an intended visual change.
- Real timers/waits where injected fakes (fetchers, geocoders, timers) belong.
