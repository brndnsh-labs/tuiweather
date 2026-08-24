import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app/App";
import { buildOneLine } from "./app/oneline";
import { appStore } from "./app/store";
import { loadConfig } from "./lib/config/load";
import type { TuiConfig } from "./lib/config/schema";
import { fetchForecast, OPENMETEO_PROVIDER_ID } from "./lib/providers/openmeteo/client";
import type { WeatherProvider } from "./lib/providers/types";
import { cachedForecast } from "./lib/weather/cache";

interface CliArgs {
  oneLine: boolean;
  location: string | null;
}

class UsageError extends Error {}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { oneLine: false, location: null };
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

function stderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function resolveSlugFromConfig(
  config: TuiConfig,
  locationArg: string | null,
): { slug: string; latitude: number; longitude: number } | { error: string } {
  if (locationArg !== null) {
    const match = config.locations.find((loc) => loc.slug === locationArg);
    if (!match) return { error: `unknown location "${locationArg}"` };
    return { slug: match.slug, latitude: match.latitude, longitude: match.longitude };
  }
  const fallback =
    config.locations.find((loc) => loc.slug === config.default_location) ?? config.locations[0];
  if (!fallback) return { error: "no locations configured" };
  return { slug: fallback.slug, latitude: fallback.latitude, longitude: fallback.longitude };
}

async function runOneLine(locationArg: string | null): Promise<number> {
  const config = await loadConfig();
  const resolved = resolveSlugFromConfig(config, locationArg);
  if ("error" in resolved) {
    stderr(resolved.error);
    return 2;
  }
  const provider: WeatherProvider = {
    id: OPENMETEO_PROVIDER_ID,
    getForecast: (location) => fetchForecast(location),
  };
  const { forecast } = await cachedForecast(
    provider,
    { latitude: resolved.latitude, longitude: resolved.longitude },
    { maxAgeMinutes: config.refresh_minutes },
  );
  process.stdout.write(`${buildOneLine(forecast, config.units, new Date().toISOString())}\n`);
  return 0;
}

async function runTui(locationArg: string | null): Promise<number> {
  const config = await loadConfig();
  const resolved = resolveSlugFromConfig(config, locationArg);
  if ("error" in resolved) {
    stderr(resolved.error);
    return 2;
  }
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  renderer.on("destroy", () => appStore.getState().dispose());
  createRoot(renderer).render(<App initialSlug={resolved.slug} />);
  return 0;
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(Bun.argv.slice(2));
  } catch (e) {
    stderr(e instanceof Error ? e.message : String(e));
    stderr("usage: tuiweather [--one-line] [--location <slug>]");
    return 2;
  }
  try {
    if (args.oneLine) return await runOneLine(args.location);
    return await runTui(args.location);
  } catch (e) {
    stderr(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

process.exitCode = await main();
