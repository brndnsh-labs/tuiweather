# Review routing

No reviewer agents exist yet — this table is the backlog. Until they're written, `/review` falls back to the general reviewer checking AGENTS.md hard rules.

| Path glob | Reviewer agent | Responsible for |
| --- | --- | --- |
| `src/lib/providers/**`, `test/providers/**` | provider-boundary (missing) | WMO codes and Open-Meteo response shapes never leak past `openmeteo/`; zod schemas match recorded fixtures; naive-local ISO strings become absolute instants exactly once, in normalize |
| `src/lib/weather/**`, `test/weather/**` | domain (missing) | metric-only storage/compute; display conversion only in `format.ts`; time series indexed by UTC instants + `utc_offset_seconds`; preceding-interval precipitation shift honored in `derive.ts` nowcast rules |
| `src/lib/config/**`, `test/config/**` | config (missing) | zod schema discipline; atomic tmp+rename writes; every `schema_version` bump ships a migration |
| `src/app/**`, `src/features/**`, `src/components/**`, `src/theme/**`, `src/viewport/**`, `test/ui/**`, `test/app/**`, `test/components/**`, `test/features/**` | TUI (missing) | breakpoint floors lg ≥96 / md 68–95 / sm 48–67 / xs 32–47 with clamp+ellipsis below 32; single-cell glyphs, no variation selectors or emoji presentation; ~100ms resize debounce kept; single-line strings narrower than their box |
| any `test/**` | test-fidelity (missing) | fixtures instead of network; injected fakes over real waits; golden diffs intentional |

Fallback: paths matching nothing get general review against the AGENTS.md hard rules.
