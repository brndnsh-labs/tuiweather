import packageJson from "../package.json";
import type { TuiConfig } from "./lib/config/schema";

export interface CliArgs {
  command: "run" | "help" | "version" | "watch";
  oneLine: boolean;
  location: string | null;
  latLon: { latitude: number; longitude: number } | null;
  json: boolean;
  interval: number | null;
}

export class UsageError extends Error {}

export const VERSION = packageJson.version;

export const USAGE =
  "usage: tuiweather [--one-line] [--location <slug> | --lat <num> --lon <num>] [--json]\n       tuiweather watch [--location <slug> | --lat <num> --lon <num>] [--interval <min>]";

export const HELP_TEXT = `${USAGE}

Options:
  --one-line          Print one status line and exit
  --location <slug>   Use a configured location
  --lat <num>         Latitude (-90 to 90); requires --lon
  --lon <num>         Longitude (-180 to 180); requires --lat
  --json              Print one-line output as compact JSON instead of plain text
  --interval <min>    Poll interval in minutes (1-120); only with watch
  -h, --help          Show help
  -v, --version       Show version

Commands:
  watch               Poll the nowcast and ring the bell when rain starts
`;

function parseCoordinate(flag: string, raw: string | undefined, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "" || !Number.isFinite(Number(raw))) {
    throw new UsageError(`${flag} requires a number`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new UsageError(`${flag} must be between ${min} and ${max}`);
  }
  return value;
}

function parseInterval(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "" || !Number.isFinite(Number(raw))) {
    throw new UsageError("--interval requires a number");
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 120) {
    throw new UsageError("--interval must be an integer between 1 and 120");
  }
  return value;
}

export function warnStaleDefault(config: TuiConfig, write: (line: string) => void): void {
  if (
    config.default_location !== undefined &&
    config.locations.length > 0 &&
    !config.locations.some((loc) => loc.slug === config.default_location)
  ) {
    const fallback = config.locations[0]?.slug ?? "";
    let stale = "";
    for (const ch of config.default_location) {
      const code = ch.codePointAt(0) ?? 0;
      if (code > 0x1f && code !== 0x7f) stale += ch;
    }
    write(
      `warning: default_location "${stale}" does not match any [[locations]] slug — using "${fallback}"`,
    );
  }
}

export function parseArgs(argv: string[]): CliArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    if (argv.length !== 1) throw new UsageError("--help cannot be combined with other arguments");
    return {
      command: "help",
      oneLine: false,
      location: null,
      latLon: null,
      json: false,
      interval: null,
    };
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    if (argv.length !== 1) {
      throw new UsageError("--version cannot be combined with other arguments");
    }
    return {
      command: "version",
      oneLine: false,
      location: null,
      latLon: null,
      json: false,
      interval: null,
    };
  }

  const args: CliArgs = {
    command: "run",
    oneLine: false,
    location: null,
    latLon: null,
    json: false,
    interval: null,
  };
  let lat: number | null = null;
  let lon: number | null = null;
  let i = 0;
  if (argv[0] === "watch") {
    args.command = "watch";
    i = 1;
  }
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === "--one-line") {
      args.oneLine = true;
    } else if (arg === "--location") {
      const value = argv[i + 1];
      i += 1;
      if (value === undefined) throw new UsageError("--location requires a slug");
      args.location = value;
    } else if (arg === "--lat") {
      lat = parseCoordinate("--lat", argv[i + 1], -90, 90);
      i += 1;
    } else if (arg === "--lon") {
      lon = parseCoordinate("--lon", argv[i + 1], -180, 180);
      i += 1;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--interval") {
      const raw = argv[i + 1];
      i += 1;
      args.interval = parseInterval(raw);
    } else {
      throw new UsageError(`unknown argument "${arg ?? ""}"`);
    }
    i += 1;
  }
  if (args.interval !== null && args.command !== "watch") {
    throw new UsageError("--interval can only be used with watch");
  }
  if (args.command === "watch") {
    if (args.oneLine) throw new UsageError("--one-line cannot be combined with watch");
    if (args.json) throw new UsageError("--json cannot be combined with watch");
  }
  if ((lat !== null || lon !== null) && args.location !== null) {
    throw new UsageError("--lat/--lon cannot be combined with --location");
  }
  if ((lat === null) !== (lon === null)) {
    throw new UsageError("--lat and --lon must be given together");
  }
  if (lat !== null && lon !== null) {
    args.latLon = { latitude: lat, longitude: lon };
  }
  return args;
}
