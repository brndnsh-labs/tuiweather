# tuiweather

Keyboard-driven terminal weather app: Dark Sky-style rain nowcasting, hourly and daily forecasts, and fast location search in a responsive TUI. Powered by [Open-Meteo](https://open-meteo.com) — free, keyless weather data.

## Features

- **Rain nowcast** — minute-level "umbrella in N min" warnings derived from 15-minute precipitation buckets
- **Hourly + daily forecast** — sparkline temperature strip, condition glyphs, precipitation probabilities
- **Location search** — type `/`, search the Open-Meteo geocoder, enter to add; locations persist to config
- **Guided first run** — choose units and find a location without editing a config file
- **Units** — metric/imperial toggle persisted across runs
- **Themes** — day, night, or auto (follows sunrise/sunset)
- **Responsive layout** — four breakpoint tiers down to 32 columns; clamps gracefully below that
- **One-line mode** — a single status line for tmux bars and prompts

## Install

The npm bootstrap package is available as `tuiweather@0.0.0` while the first supported release is prepared. Install the preview channel with Bun:

```sh
bun install --global tuiweather@next
```

Standalone binaries will be attached beginning with v0.1.0.

Download a standalone binary from [GitHub Releases](https://github.com/brndnsh-labs/tuiweather/releases).

### macOS Gatekeeper

Release binaries are unsigned, so macOS may refuse to open them with an "unidentified developer" warning. Remove the quarantine attribute after downloading:

```sh
xattr -d com.apple.quarantine /path/to/tuiweather
```

## Usage

Run `tuiweather` with no arguments for the full TUI.

On the first run, tuiweather opens a short keyboard tour, asks for metric or imperial units, and
lets you search for your first location. The completed setup is written atomically to the normal
config path before weather data loads.

Use `tuiweather --help` for command-line options and `tuiweather --version` to print the installed version.

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
One-line mode is non-interactive; if no location is configured yet, run `tuiweather` once to
complete setup.

For scripting without a configured location, pass explicit coordinates instead of `--location`
(`--lat` −90..90 and `--lon` −180..180, required together). Add `--json` to print one line of
compact JSON — temperatures, wind, nowcast, today's low/high, and the status line itself — for
piping into `jq`:

```sh
tuiweather --one-line --lat 45.52 --lon -122.67 --json | jq .temperatureC
```

JSON values are always metric regardless of your configured units; the embedded `line` field
matches the plain one-line output, which follows configured units.

## Configuration

Config lives at `~/.config/tuiweather/config.toml` (respects `XDG_CONFIG_HOME`). Every field is optional unless marked required; unknown values fail validation with a descriptive error.

```toml
schema_version = 2
time_format = "auto"
refresh_minutes = 10
theme = "auto"
daily_days = 7
hourly_hours = 24
default_location = "portland"

[units]
temp = "metric"
wind = "imperial"
precip = "metric"
pressure = "metric"

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
| `schema_version` | integer | `2` | Required; currently always `2`. Version 1 files are migrated in place on load |
| `time_format` | `12h` / `24h` / `auto` | `"auto"` | `auto` picks 12h when temperature units are imperial, else 24h |
| `refresh_minutes` | integer | `10` | Minimum `1` |
| `theme` | `day` / `night` / `auto` | `"auto"` | `auto` follows local sunrise/sunset |
| `daily_days` | integer | `7` | `1`–`16` forecast days |
| `hourly_hours` | integer | `24` | `12`–`48` forecast hours |
| `default_location` | string | none | Must match a `[[locations]]` slug |
| `units.temp` | `metric` / `imperial` | legacy `units` | Display unit for temperatures |
| `units.wind` | `metric` / `imperial` | legacy `units` | Display unit for wind speed and visibility |
| `units.precip` | `metric` / `imperial` | legacy `units` | Display unit for precipitation amounts |
| `units.pressure` | `metric` / `imperial` | legacy `units` | Reserved for future pressure display (pressure currently renders as hPa) |
| `panels.nowcast` | boolean | `true` | Show/hide the nowcast banner |
| `panels.details` | boolean | `true` | Show/hide the details grid |
| `panels.hourly` | boolean | `true` | Show/hide the hourly strip |
| `panels.daily` | boolean | `true` | Show/hide the daily list |

Each `[units]` field can be set independently, so mixed display such as °C temperatures with mph wind works everywhere including one-line mode. The legacy top-level `units = "metric" | "imperial"` scalar is still accepted and acts as the fallback for any `[units]` field you omit; because TOML forbids a key and table with the same name, saved configs contain either the scalar (uniform prefs) or the full `[units]` table (mixed prefs), never both.

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
