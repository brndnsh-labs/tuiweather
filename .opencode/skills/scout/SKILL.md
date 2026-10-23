---
name: scout
description: Find tuiweather's next work in the code itself — sweep read-only across security · performance · hygiene · context · a11y lenses, verify every finding against the real code, dedupe, and file the few worth keeping as actionable issues with the fix drafted. Finds and files; never fixes. Usage `/scout` (all lenses, tightly capped) or `/scout <lens>` (one lens, deeper).
---
<!-- cycle:rendered template=skills/scout.md.tmpl hash=3433b559ddeb — managed by the-cycle; edit the template, not this file -->

# /scout — find work the code is hiding

**Shared rules in `.opencode/skills/DOCTRINE.md` — read it if not already in context.** Filing — dedup,
format, routing by certainty, budget — is §2.

**Scout finds and files; it never fixes, branches, or merges.** The surfaces it's best at spotting
are often §5 brake surfaces, where a speculative fix shipped without a human look is how incidents
happen.

## Lenses

Sweep all lenses in parallel read-only agents by default; a named lens gets one deeper pass.

- **`security`** — trust boundaries, secrets, authn/authz, dependency CVEs.
- **`performance`** — payload weight, render cost, queries and indexes, polling, needless work.
- **`hygiene`** — type-safety erosion, dead code, drift between near-duplicate modules.
- **`context`** — do `CLAUDE.md`, the docs, and comments still describe the code? Each finding names
  the wrong inference a cold reader would draw *and* the artifact that should fix it.
- **`a11y`** — semantics, focus, touch targets, reduced motion, meaning carried by color alone.

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
- `°` routed through custom-font rendering — font-rendered text has no degree glyph. Plain `text` handles it.

## Test fidelity
- Network calls in tests — every HTTP response must be a recorded fixture under `test/fixtures/`.
- Goldens regenerated to force green rather than to record an intended visual change.
- Real timers/waits where injected fakes (fetchers, geocoders, timers) belong.

## Rules

- **Verify before filing.** Every candidate is a hypothesis until you've read the cited line. A
  misread on the slate teaches Brandon to distrust the rest.
- **File the fix already drafted** — evidence (`file:line` + a quote, and the sibling that already
  does it right, if any), the failure scenario, the concrete fix, and Acceptance a gate or a look
  can verify. Can't draft a fix → it's an observation for the report, unless it's a real defect
  needing a design call (file it as `status:needs-decision` with options sketched).
- **Budget:** about 2 per lens on a full sweep, 3–5 on a single lens. Zero is a success.

### Broader threads are a handoff, not an implicit wider sweep

When a finding exposes a pattern that probably repeats elsewhere, gather just enough evidence to
show it's credible, distinguish likely surfaces from verified ones, and finish the current sweep.
In the report, describe the pattern, the confirmed and likely surfaces, whether one issue is
sufficient or several independent issues are warranted, and the focused follow-up `/scout <lens>`
pass that would investigate it. Do **not** automatically broaden the current sweep, file
speculative related issues, or open an umbrella.

## Steps

1. Sweep → candidates with citations.
2. Verify each against the real file; drop what doesn't survive.
3. Dedup against open and recently closed issues (§2).
4. Rank, cut to budget, and show the slate — each with lens, evidence, drafted fix, routing, and
   whether it touches a §5 brake. Then file in the same turn.
5. File: `gh issue create --title "<title>" --body "<body>" --label "scout"`, then route by certainty (§2).
6. Report what was filed, what was found but not filed (and why), any credible **broader thread**
   handoff from above, and point at `/next`.
