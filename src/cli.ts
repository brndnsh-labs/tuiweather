import packageJson from "../package.json";

export interface CliArgs {
  command: "run" | "help" | "version";
  oneLine: boolean;
  location: string | null;
  latLon: { latitude: number; longitude: number } | null;
  json: boolean;
}

export class UsageError extends Error {}

export const VERSION = packageJson.version;

export const USAGE =
  "usage: tuiweather [--one-line] [--location <slug> | --lat <num> --lon <num>] [--json]";

export const HELP_TEXT = `${USAGE}

Options:
  --one-line          Print one status line and exit
  --location <slug>   Use a configured location
  --lat <num>         Latitude (-90 to 90); requires --lon
  --lon <num>         Longitude (-180 to 180); requires --lat
  --json              Print one-line output as compact JSON instead of plain text
  -h, --help          Show help
  -v, --version       Show version
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

export function parseArgs(argv: string[]): CliArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    if (argv.length !== 1) throw new UsageError("--help cannot be combined with other arguments");
    return { command: "help", oneLine: false, location: null, latLon: null, json: false };
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    if (argv.length !== 1) {
      throw new UsageError("--version cannot be combined with other arguments");
    }
    return { command: "version", oneLine: false, location: null, latLon: null, json: false };
  }

  const args: CliArgs = {
    command: "run",
    oneLine: false,
    location: null,
    latLon: null,
    json: false,
  };
  let lat: number | null = null;
  let lon: number | null = null;
  let i = 0;
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
    } else {
      throw new UsageError(`unknown argument "${arg ?? ""}"`);
    }
    i += 1;
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
