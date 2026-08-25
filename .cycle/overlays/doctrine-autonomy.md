# Judgment calls

- Golden diff you can't visually explain → stop. Never `-u` your way back to green.
- New dependency → stop and justify; additions require a case in the PR description.

What the §5 brake names mean here:

- **user-config schema & migrations** — a `schema_version` bump requires a migration; writes to `~/.config/tuiweather/config.toml` stay atomic (tmp + rename).
- **secrets handling** — keys resolve env var > config file and are never logged or embedded in error messages (reserved for future providers; Open-Meteo needs none today).
- **release/publish plumbing** — `scripts/release.sh`, `.github/workflows/release.yml`, npm publish; public and effectively irreversible once tagged.

Also surface before building:

- Adding a weather provider or touching the WMO table → propose the normalize plan (fixtures, instant conversion) first; WMO codes may exist only under `src/lib/providers/<provider>/`.
- Changing breakpoint tiers or the glyph set → user-visible contract; flag it in the issue before building.
