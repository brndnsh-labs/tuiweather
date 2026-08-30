# tuiweather

Keyboard-driven terminal weather app: Dark Sky-style rain nowcasting, hourly and daily forecasts, and fast location search in a responsive TUI. Powered by [Open-Meteo](https://open-meteo.com) — free, keyless weather data.

## Features

- **Rain nowcast** — minute-level "umbrella in N min" warnings derived from 15-minute precipitation buckets (Open-Meteo only; NWS has no minute-level precipitation feed — the nowcast panel hides and the watch bell stays inactive under `provider = "nws"`, nothing renders a false "Dry")
- **Hourly + daily forecast** — sparkline temperature strip, emoji condition icons, precipitation probabilities, and (md+ widths) a UV/humidity/visibility summary row
- **Location search** — type `/`, search the Open-Meteo geocoder, enter to add; locations persist to config
- **Guided first run** — choose units and find a location without editing a config file
- **Units** — metric/imperial toggle persisted across runs
- **Themes** — day/night accent palettes follow the forecast location's sunrise/sunset; text ink adapts to your terminal's background
- **Air quality** — US AQI with category label in the details grid, from the Open-Meteo Air Quality API
- **Responsive layout** — four breakpoint tiers down to 32 columns; clamps gracefully below that
- **One-line mode** — a single status line for tmux bars and prompts

## Install

Requires Node.js to run: the package declares `engines.node >= 20`, and the command-line
paths (`--version`, `--help`, `--one-line`) work on any such Node; the interactive TUI
needs Node >= 26.4.0, enforced at runtime by the launcher. Install globally with npm:

```sh
npm install --global tuiweather
```

or with the Bun package manager:

```sh
bun install --global tuiweather
```

or run without installing:

```sh
npx tuiweather --version
bunx tuiweather --version
```

Standalone binaries for macOS, Linux, and Windows (x64) are attached to each [GitHub release](https://github.com/brndnsh-labs/tuiweather/releases). On Windows (no Node or Bun required), in cmd.exe or any shell with `curl.exe` on PATH:

```sh
curl.exe -Lo tuiweather-windows-x64.tar.gz https://github.com/brndnsh-labs/tuiweather/releases/latest/download/tuiweather-windows-x64.tar.gz
tar -xzf tuiweather-windows-x64.tar.gz
.\tuiweather.exe --version
```

### macOS Gatekeeper

Release binaries are unsigned, so macOS may refuse to open them with an "unidentified developer" warning. Remove the quarantine attribute after downloading:

```sh
xattr -d com.apple.quarantine /path/to/tuiweather
```

## Usage

Run `tuiweather` with no arguments for the full TUI.

On the first run, tuiweather opens a short keyboard tour, asks for metric or imperial units, and
lets you search for your first location. Press `s` on the welcome step to skip for now and see the
empty main view, or `o` from the help overlay to re-run setup later. The completed setup is written
atomically to the normal config path before weather data loads.

Use `tuiweather --help` for command-line options and `tuiweather --version` to print the installed version.

| Key | Action |
| --- | --- |
| `r` | Refresh current location (bypasses cache) |
| `[` / `]` | Previous / next location |
| `l` | Open the locations overlay: switch, set default, delete, reorder |
| `1`–`9` | Jump to location N by sidebar order (1-based; no-op out of range) |
| `u` | Toggle metric / imperial units |
| `/` | Search locations |
| `d` | Delete active location (press twice to confirm) |
| `j` / `k` | Move sidebar focus down/up (lg tier only, wraps) |
| `enter` | Activate focused location (lg tier) |
| `s` | Set focused (or active when no focus) as default location |
| `J` / `K` | Move focused location down/up in sidebar order (lg tier) |
| `↑` / `↓` | Scroll the main panel when content overflows |
| `?` | Toggle help overlay |
| `o` | Re-run setup (from help overlay) |
| `esc` | Clear sidebar focus if set; otherwise close help overlay or quit |
| `q` | Quit |

While the search overlay is open it owns the keyboard: type to search, up/down to move the cursor, enter to add the highlighted result, esc to cancel. Number, focus, and reorder keys are ignored while the search input is focused (same as `d`/`r`).

The locations overlay (`l`) also owns the keyboard while open: up/down (or `j`/`k`) to move the cursor, enter or `1`–`9` to switch, `s` to set the cursor row as default, `d` twice to delete it, `J`/`K` to reorder it, `/` to jump into search, esc to close.

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

### Watch mode

`tuiweather watch` polls the nowcast on an interval and rings the terminal bell (`\a`) when rain
starts — leave it running in a pane and get pinged before you need the umbrella:

```sh
tuiweather watch                # poll every refresh_minutes
tuiweather watch --interval 5   # poll every 5 minutes (1–120)
tuiweather watch --location seattle
```

Each poll prints the one-line status (prefixed with the location label). The bell rings only on a
dry → wet transition, not on every poll. Rain already in progress when the watch starts does not
bell. The bell depends on the minute-level nowcast, which is Open-Meteo only: under
`provider = "nws"` the nowcast panel hides and the bell stays inactive — nothing renders a false
"Dry". Desktop notifications are a planned follow-up.

## Configuration

Config lives at `~/.config/tuiweather/config.toml` (respects `XDG_CONFIG_HOME`). Every field is optional unless marked required; unknown fields are ignored.

```toml
schema_version = 3
time_format = "auto"
refresh_minutes = 10
theme = "auto"
provider = "openmeteo"
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
| `schema_version` | integer | `3` | Required; currently always `3`. Version 1 and 2 files are migrated in place on load |
| `time_format` | `12h` / `24h` / `auto` | `"auto"` | `auto` picks 12h when temperature units are imperial, else 24h |
| `refresh_minutes` | integer | `10` | Minimum `1` |
| `reduced_motion` | boolean | `false` | Replace the animated loading spinner with a static indicator |
| `theme` | `day` / `night` / `auto` | `"auto"` | Accent palette; `auto` follows the location's sunrise/sunset. Text ink always adapts to your terminal's background |
| `provider` | `openmeteo` / `nws` | `"openmeteo"` | Weather data source. Open-Meteo is the default full-feature experience; NWS is the official US source fallback — works: conditions, temperatures, precipitation probabilities; goes quiet: minute-level nowcast (panel hides, watch bell inactive), hourly/daily precip amounts (blank bars/chips), air quality |
| `daily_days` | integer | `7` | `1`–`16` forecast days |
| `hourly_hours` | integer | `24` | `12`–`48` forecast hours |
| `default_location` | string | none | Must match a `[[locations]]` slug |
| `units.temp` | `metric` / `imperial` | legacy `units`, else `imperial` | Display unit for temperatures |
| `units.wind` | `metric` / `imperial` | legacy `units`, else `imperial` | Display unit for wind speed and visibility |
| `units.precip` | `metric` / `imperial` | legacy `units`, else `imperial` | Display unit for precipitation amounts |
| `units.pressure` | `metric` / `imperial` | legacy `units`, else `imperial` | Display unit for pressure; `metric` → hPa (rounded), `imperial` → inHg to 2 decimals; falls back to `imperial` when unset |
| `panels.nowcast` | boolean | `true` | Show/hide the nowcast banner |
| `panels.details` | boolean | `true` | Show/hide the details grid |
| `panels.hourly` | boolean | `true` | Show/hide the hourly strip |
| `panels.daily` | boolean | `true` | Show/hide the daily list |

Each `[units]` field can be set independently, so mixed display such as °C temperatures with mph wind works everywhere including one-line mode. The legacy top-level `units = "metric" | "imperial"` scalar is still accepted and acts as the fallback for any `[units]` field you omit; when neither the field nor the legacy scalar is set, the unit falls back to `imperial`. Because TOML forbids a key and table with the same name, saved configs contain either the scalar (uniform prefs) or the full `[units]` table (mixed prefs), never both.

Each `[[locations]]` entry:

| Field | Type | Constraints |
| --- | --- | --- |
| `slug` | string | Required; lowercase kebab-case (`^[a-z0-9]+(-[a-z0-9]+)*$`) |
| `label` | string | Required; 1–80 chars, shown in header/sidebar |
| `latitude` | number | Required; `-90`–`90` |
| `longitude` | number | Required; `-180`–`180` |

Locations added through the search overlay are appended here automatically. Press `s` (focused or active) to set `default_location` and `J`/`K` (lg tier, focused) to reorder `[[locations]]`. Writes are atomic (temp file plus rename).

## Data attribution

Weather data by [Open-Meteo](https://open-meteo.com), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Open-Meteo's free tier is offered for non-commercial use; see [open-meteo.com/terms](https://open-meteo.com/terms) before relying on it commercially. When `provider = "nws"` is configured, forecast data comes from the National Weather Service ([api.weather.gov](https://api.weather.gov)).

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
