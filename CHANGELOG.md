# Changelog

All notable changes to this project are documented here.

## v0.2.0 (2026-08-25)

Code-identical re-cut of v0.1.0 published back-to-back on release day; contains no changes over v0.1.0. `latest` points here.

## v0.1.0 (2026-08-25)

First supported release: keyboard-driven terminal weather app with Dark Sky-style rain nowcasting, hourly/daily forecasts, location search, guided first-run setup, responsive tiers down to 32 columns, and a scriptable `--one-line` / `--json` mode. Powered by Open-Meteo.

### Features

- feat: 24h clocks and per-quantity units (config schema v2) (#9)
- feat: scripting mode with --json and ad-hoc --lat/--lon (#8)
- feat: minute-level precip bars in the nowcast banner (#7)

### Fixes

- fix: populate sidebar conditions by prefetching saved locations (#6)

### Other

- test: raise CI budget for the packed-artifact test (65b5452)
- chore: format cycle config (3201f27)
- chore: install the-cycle pipeline (lean, github, codex+opencode+claude) (20e7d6b)
- ci: harden npm release pipeline (c11492b)
- docs: focus install guidance on npm (7777342)
- chore: replace release-please with direct release script (8610600)
- chore: release pipeline (4ab7057)
- chore: polish pass (70feee8)
- chore: bootstrap repository (4db130d)
