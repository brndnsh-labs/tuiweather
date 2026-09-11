# Changelog

All notable changes to this project are documented here.

## v0.5.0 (2026-09-11)

### Features
- feat(ui): restore aligned daily rows with hi/lo trend strip (f07ac2d)
- feat: redesign terminal interface as a weather observatory (#218) (4406da1)
- feat(ui): add a glyph legend to the help overlay (#217) (98646af)
- feat: narrow-lg polish for ~100-col terminals (#215) (683d12c)
- feat(ui): derive a "go out" window and a heads-up window from the hourly forecast (#198) (03fca24)
- feat(ui): fill the lg sidebar with a persistent status rail (#196) (24f0198)
- feat(ui): day/night split + nightly overview in the day detail overlay (#192) (5907e52)
- feat(ui): expandable minutely-15 precip timeline under the nowcast banner (#191) (f4bd3d5)
- feat(ui): page the daily list through the extended 14-day Open-Meteo range (#188) (92e72e8)
- feat(ui): hourly inspect cursor for the HourlyStrip chart (#187) (c29ee23)
- feat(ui): add day detail overlay (#183) (76bcb60)

### Fixes
- fix: remove unchecked indexed-access cast in bestDryRun (#207) (a340de7)
- fix: reserve a one-cell spare in XsChips and LocationsOverlay rows (#206) (4552e18)
- fix: resolve 'today' by local date instead of daily[0] in sidebar and one-line output (#204) (3983772)
- fix(ui): clamp the sidebar location list to the rail's row budget (#197) (f9b3209)

### Other
- Merge pull request #220 from brndnsh-labs/feat/daily-aligned-rows-trend-strip (3aac8e8)
- chore(deps): bump opentui to 0.5.11, react to 19.3.0, zod to 4.6.1, biome to 2.5.13 (#219) (b843fff)
- chore(deps): bump the github-actions group across 1 directory with 2 updates (#211) (04a1c95)
- chore: bump opentui to 0.5.10, zod to 4.5.4, biome to 2.5.12 (#214) (3c2aea2)
- chore: serve recorded fixtures from a local stub in CI smoke (#213) (8e09686)
- chore: retry transient upstream failures in windows-smoke one-line calls (#210) (8ddfe3f)
- chore: give the two 4s-sleep store tests an explicit bun timeout (#208) (53d9db9)
- perf: skip air-quality fetch when the provider has no getAirQuality (#205) (0d55d97)
- refactor(ui): make the daily list always single-column (#190) (d0bd3e1)
- chore: add guard test for AGENTS.md architecture-map drift (#186) (a304191)
- chore(skills): sync the-cycle pipeline to 98f02a0 (#181) (c5b0d7b)

## v0.4.0 (2026-08-30)

### Features
- feat(config): add ink escape hatch for failed palette detection (schema v4) (#141) (29558bd)
- feat: ship a windows-x64 standalone binary with a blocking release smoke (#164) (c839dc2)
- feat: bare esc on the main view is a no-op instead of quit (#161) (2822b42)
- feat: reduced_motion option for a static loading indicator (#163) (8ceed08)
- feat(ui): add onboarding skip and re-run setup (#136) (a5ff85c)

### Fixes
- fix: repair stale default_location on save instead of warning forever (#170) (edfb635)
- fix(config): surface validation details and make stale default_location survivable (#138) (8f40d57)
- fix: Hero mini/compact share the full tier's cold-to-warm temp hue (#162) (e30bc08)
- fix(config): create the config dir with 0700 (#155) (dfd5cc8)
- fix: actionable error when the TUI boots on a pre-FFI runtime (#159) (ec83960)
- fix(providers): cap provider response body size (#154) (a947fe9)
- fix(providers): include sanitized network cause in pre-response error messages (#142) (66a00d2)
- fix(security): reject off-host redirects in the NWS client (#139) (95c477c)
- fix(ui): surface action errors and stop closing search overlay on failed add (#137) (9ab44d0)

### Other
- chore: add fixture recorder with --compare drift detection (#175) (b740e34)
- chore(cache): sweep orphaned files left behind by cache-key version bumps (#173) (7aeade5)
- refactor(providers): trim dead payload and domain fields; version the cache envelope (#172) (94479a5)
- test: explicit timeouts for tests whose wait budgets beat the 5s default (#169) (57eaece)
- chore: add bun run verify one-shot gate script, used by CI (#168) (0692738)
- docs: update RELEASING.md to the post-first-release npm state (#157) (f1a038e)
- test: give persist-waiting sidebar tests an explicit 30s timeout (#165) (d3eac5b)
- perf: render the first frame before palette detection resolves (#160) (220cf63)
- docs: state the imperial terminal default for display units (#158) (95d44ee)
- refactor(providers): consolidate error-body handling into http.ts (#156) (2641033)
- docs: add locations/, condition-display.ts, and cli.ts to the architecture map (#143) (eb4b904)
- perf(nws): memoize immutable points/station metadata between refreshes (#140) (fdc9dc7)

## v0.3.7 (2026-08-29)

### Other
- test: poll config file in locations delete/default tests to fix flake (#123) (26a8c0a)

## v0.3.6 (2026-08-29)

### Fixes
- fix: make Windows verification reliable (#121) (ffc36eb)

## v0.3.5 (2026-08-29)

### Fixes
- fix: Windows cache dir + relax engines floor (#119) (87b71f6)
- fix: gate --experimental-ffi behind a bin launcher so pre-FFI Node keeps CLI paths (#116) (8145064)

## v0.3.4 (2026-08-29)

### Fixes
- fix: resolve config path on Windows via os.homedir fallback (#114) (8e8c00f)

## v0.3.3 (2026-08-29)

### Fixes
- fix: ship a Node-target ESM bundle so npm installs run without Bun (#110) (e4ac8a0)

### Other
- docs: record npm-artifact Node-runtime knowledge in AGENTS quirks (0fcda5b)
- chore: add windows-latest CI smoke job for the npm install surface (#112) (20d0e71)

## v0.3.2 (2026-08-29)

### Features
- feat(ui): swap footer delete hint for l locations (#108) (c5b1974)
- feat(ui): locations overlay for switch + manage from one discoverable surface (#106) (bf8f0a4)

## v0.3.1 (2026-08-29)

### Features
- feat: capability-aware nowcast so NWS stops reporting a false Dry (#104) (bb0f649)

### Fixes
- fix: route label truncation through cell-aware primitives (#95) (7659417)
- fix: make lg footer hint width-aware so it never wraps (#93) (3c4d9f7)
- fix: pin NWS fetches to the api.weather.gov allowlist (#100) (915e902)
- fix: derive NWS User-Agent from package.json version instead of stale 0.1 literal (#92) (#99) (f6f12cd)
- fix: schedule refresh loops with a margin below the cache TTL (#97) (13a243c)
- fix: sliceUpcoming honors end-labeled intervals at exact-boundary now (#96) (5cd3540)
- fix: sanitize geocoder names at the provider boundary (#94) (9e0d7c9)

### Other
- docs: qualify nowcast/watch-bell/precip bars as Open-Meteo-only under provider=nws (#101) (cc8d4d4)
- docs: CONTRIBUTING glyph rule mirrors the two-cell emoji icon contract (#90) (#98) (849b654)
- test: sidebar persist-wait budget covers fsynced config saves on loaded CI (#83) (ad58ddb)

## v0.3.0 (2026-08-29)

### Features
- feat: location sidebar navigation and reordering (#46) (cc7331a)
- feat: NWS as a selectable second weather provider (#45) (6facbb7)
- feat: US AQI air-quality cell in the details grid (#44) (2ed5f0e)
- feat: honor units.pressure in the details grid (#43) (ca92ae3)
- feat: hourly uv/humidity/visibility summary row at md+ widths (#42) (eb1b32a)
- feat: rain-start watch mode with terminal bell (#41) (f67a907)
- feat: emoji condition icons with two-cell slots (#17) (770d2c5)
- feat: vertical density, precipitation clarity, and safety polish for the main views (#12) (a71c283)

### Fixes
- fix: sidebar labels disambiguate by region and reserve the temp tail (#80) (8fb85b4)
- fix: help overlay is fully modal (#78) (5d73824)
- fix: NWS hourly rows honor the end-labeled domain contract (#77) (c31d607)
- fix: toggleUnits preserves mixed unit_prefs (#76) (3c7c282)
- fix: todayPrecipWindow includes the bucket containing now (#73) (909d3d9)
- fix: NWS daily precip max covers the night segment (#71) (64eaf84)
- fix: attribute the active data provider in the help overlay and README (#69) (04cab5f)
- fix: clear ghost sidebar focus below lg so s always targets the visible location (#66) (b1caa80)
- fix: nowcast states the real remaining horizon instead of 'at least 2 hr' (#65) (5aa8711)
- fix: truncate the DetailsGrid air cell to its half-width budget (#64) (9d635f1)
- fix: advance time-driven UI between refreshes with a 30s ticker (#40) (233bfec)
- fix: clamp help overlay to narrow viewports instead of overflowing (#30) (ca3a160)
- fix: write cache entries 0o600 via atomic tmp+rename (#29) (487b48c)
- fix: sanitize server-supplied error reasons before they reach the terminal (#28) (79c3e03)
- fix: validate cached forecast envelopes with zod before trusting them (#27) (ac81a83)
- fix: share one in-flight fetch per slug in loadForecast (#32) (df6c664)
- fix: bound geocoder coordinates and persist before applying config (#26) (7a9ff9c)
- fix: blend palettes with the terminal's theme (#16) (addad2c)
- fix(release): deterministic changelog section generation (#13) (9036925)

### Other
- perf: scope the 30s tick to time-dependent subtrees (#81) (ccd79b2)
- refactor: provider-neutral condition display and geocoding contracts (#79) (48b0411)
- docs: config ignores unknown fields (README matched strict validation the schema does not have) (#75) (6b6b80c)
- chore: bump zod 4.5.1 -> 4.5.2 (patch) (#74) (12a2fd4)
- test: replace fixed sleeps with polling helpers (#72) (365cc99)
- refactor: extract shared provider HTTP/sanitizer helpers (#70) (308677c)
- docs: update AGENTS.md provider map and data-source line for the NWS/AQ work (#67) (a9410f8)
- chore: record NWS API fixtures and add qwen-spark agent for #39 experiment (d8fd2e8)
- chore: add muse-spark implementer subagent definition (910532b)
- chore(deps): bump @opentui/core, @opentui/react, zod, biome (#33) (02cbd9f)
- docs: align AGENTS.md architecture map with the real tree (#31) (ed1a3cc)
- chore: update cycle skills (c4db60b)
- docs: install guidance for the supported release; repair changelog sections (4f9140e)

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
