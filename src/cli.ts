import packageJson from "../package.json";

export interface CliArgs {
  command: "run" | "help" | "version";
  oneLine: boolean;
  location: string | null;
}

export class UsageError extends Error {}

export const VERSION = packageJson.version;

export const USAGE = "usage: tuiweather [--one-line] [--location <slug>]";

export const HELP_TEXT = `${USAGE}

Options:
  --one-line          Print one status line and exit
  --location <slug>   Use a configured location
  -h, --help          Show help
  -v, --version       Show version
`;

export function parseArgs(argv: string[]): CliArgs {
  if (argv.includes("--help") || argv.includes("-h")) {
    if (argv.length !== 1) throw new UsageError("--help cannot be combined with other arguments");
    return { command: "help", oneLine: false, location: null };
  }
  if (argv.includes("--version") || argv.includes("-v")) {
    if (argv.length !== 1) {
      throw new UsageError("--version cannot be combined with other arguments");
    }
    return { command: "version", oneLine: false, location: null };
  }

  const args: CliArgs = { command: "run", oneLine: false, location: null };
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
    } else {
      throw new UsageError(`unknown argument "${arg ?? ""}"`);
    }
    i += 1;
  }
  return args;
}
