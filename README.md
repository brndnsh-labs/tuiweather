# tuiweather

Keyboard-driven terminal weather app: Dark Sky-style rain nowcasting, hourly and daily forecasts, and fast location search in a responsive TUI. Powered by [Open-Meteo](https://open-meteo.com) — free, keyless weather data.

## Features

- **Rain nowcast** — minute-level "umbrella in N min" warnings derived from 15-minute precipitation buckets
- **Hourly + daily forecast** — sparkline temperature strip, condition glyphs, precipitation probabilities
- **Location search** — type `/`, search the Open-Meteo geocoder, enter to add; locations persist to config
- **Units** — metric/imperial toggle persisted across runs
- **Themes** — day, night, or auto (follows sunrise/sunset)
- **Responsive layout** — four breakpoint tiers down to 32 columns; clamps gracefully below that
- **One-line mode** — a single status line for tmux bars and prompts

## Install

All three channels are planned for v0.1.0 and are **not yet available** — this is a pre-release repository. Until then, run from source (see Development).

> Coming in v0.1.0. Pre-release; package not published yet.

```sh
bun install -g tuiweather
```

> Coming in v0.1.0. Pre-release; tap does not exist yet.

```sh
brew install brndnsh-labs/tap/tuiweather
```

> Coming in v0.1.0. Pre-release; binaries are not being attached to releases yet.

Download a standalone binary from [GitHub Releases](https://github.com/brndnsh-labs/tuiweather/releases).

### macOS Gatekeeper

Release binaries are unsigned, so macOS may refuse to open them with an "unidentified developer" warning. Remove the quarantine attribute after downloading:

```sh
xattr -d com.apple.quarantine /path/to/tuiweather
```

## Usage

Run `tuiweather` with no arguments for the full TUI.

| Key | Action |
| --- | --- |
| `r` | Refresh current location (bypasses cache) |
| `[` / `]` | Previous / next location |
| `u` | Toggle metric / imperial units |
| `/` | Search locations |
| `d` | Delete active location |
| `?` | Toggle help overlay |
| `esc` | Close help overlay; quits otherwise |
| `q` | Quit |

While the search overlay is open it owns the keyboard: type to search, up/down to move the cursor, enter to add the highlighted result, esc to cancel.

### One-line mode

`tuiweather --one-line` prints a single line and exits — designed for tmux status bars and shell prompts:

```
☀ 72° fl70 · ☂ in 15min · 55°–79° · ↗7mph nw
```

Segments: current condition with feels-like, umbrella nowcast (omitted when dry), today's low/high, wind arrow with speed and compass point. The middle segment only appears when rain is starting, ongoing, or stopping within the nowcast window. Pass `--location <slug>` to pin a configured location.

In tmux:

```ini
set -g status-interval 600
set -g status-right "#(tuiweather --one-line)"
```

Responses are cached on disk, so frequent invocations stay cheap; cached data older than `refresh_minutes` triggers a refetch.

## Configuration

Config lives at `~/.config/tuiweather/config.toml` (respects `XDG_CONFIG_HOME`). Every field is optional unless marked required; unknown values fail validation with a descriptive error.

```toml
schema_version = 1
units = "imperial"
refresh_minutes = 10
theme = "auto"
daily_days = 7
hourly_hours = 24
default_location = "portland"

[panels]
nowcast = true
details = true
hourly = true
daily = true

[[locations]]
slug = "portland"
label = "Portland"
latitude = 45.5202
longitude = -122.6765
```

| Field | Type | Default | Constraints |
| --- | --- | --- | --- |
| `schema_version` | integer | `1` | Required; currently always `1` |
| `units` | `metric` / `imperial` | `"imperial"` | |
| `refresh_minutes` | integer | `10` | Minimum `1` |
| `theme` | `day` / `night` / `auto` | `"auto"` | `auto` follows local sunrise/sunset |
| `daily_days` | integer | `7` | `1`–`16` forecast days |
| `hourly_hours` | integer | `24` | `12`–`48` forecast hours |
| `default_location` | string | none | Must match a `[[locations]]` slug |
| `panels.nowcast` | boolean | `true` | Show/hide the nowcast banner |
| `panels.details` | boolean | `true` | Show/hide the details grid |
| `panels.hourly` | boolean | `true` | Show/hide the hourly strip |
| `panels.daily` | boolean | `true` | Show/hide the daily list |

Each `[[locations]]` entry:

| Field | Type | Constraints |
| --- | --- | --- |
| `slug` | string | Required; lowercase kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`) |
| `label` | string | Required; 1–80 chars, shown in header/sidebar |
| `latitude` | number | Required; `-90`–`90` |
| `longitude` | number | Required; `-180`–`180` |

Locations added through the search overlay are appended here automatically. Writes are atomic (temp file plus rename).

## Data attribution

Weather data by [Open-Meteo](https://open-meteo.com), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Open-Meteo's free tier is offered for non-commercial use; see [open-meteo.com/terms](https://open-meteo.com/terms) before relying on it commercially.

## Development

Requires [Bun](https://bun.sh) >= 1.3.

```sh
bun install
bun run dev        # run the TUI
bun run test       # unit + snapshot tests
bun run typecheck  # tsc --noEmit
bun run lint       # biome check
```

See [AGENTS.md](AGENTS.md) for architecture and conventions, [CONTRIBUTING.md](CONTRIBUTING.md) for contribution workflow.

## License

[MIT](LICENSE)
