import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app/App";
import { buildJsonLine, buildOneLine } from "./app/oneline";
import { appStore } from "./app/store";
import type { CliArgs } from "./cli";
import { HELP_TEXT, parseArgs, USAGE, VERSION } from "./cli";
import { loadConfig } from "./lib/config/load";
import { resolveDisplayPrefs, type TuiConfig } from "./lib/config/schema";
import { fetchForecast, OPENMETEO_PROVIDER_ID } from "./lib/providers/openmeteo/client";
import type { WeatherProvider } from "./lib/providers/types";
import { cachedForecast } from "./lib/weather/cache";
import { detectTerminalAppearance } from "./theme/detect";

function stderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function resolveSlugFromConfig(
  config: TuiConfig,
  locationArg: string | null,
): { slug: string; label: string; latitude: number; longitude: number } | { error: string } {
  if (locationArg !== null) {
    const match = config.locations.find((loc) => loc.slug === locationArg);
    if (!match) return { error: `unknown location "${locationArg}"` };
    return {
      slug: match.slug,
      label: match.label,
      latitude: match.latitude,
      longitude: match.longitude,
    };
  }
  const fallback =
    config.locations.find((loc) => loc.slug === config.default_location) ?? config.locations[0];
  if (!fallback) return { error: "no locations configured" };
  return {
    slug: fallback.slug,
    label: fallback.label,
    latitude: fallback.latitude,
    longitude: fallback.longitude,
  };
}

async function runOneLine(args: CliArgs): Promise<number> {
  const config = await loadConfig();
  let latitude: number;
  let longitude: number;
  let label: string | null = null;
  if (args.latLon) {
    ({ latitude, longitude } = args.latLon);
  } else {
    const resolved = resolveSlugFromConfig(config, args.location);
    if ("error" in resolved) {
      const hint = config.locations.length === 0 ? "; run tuiweather to set one up" : "";
      stderr(`${resolved.error}${hint}`);
      return 2;
    }
    latitude = resolved.latitude;
    longitude = resolved.longitude;
    label = resolved.label;
  }
  const provider: WeatherProvider = {
    id: OPENMETEO_PROVIDER_ID,
    getForecast: (location) => fetchForecast(location),
  };
  const { forecast } = await cachedForecast(
    provider,
    { latitude, longitude },
    { maxAgeMinutes: config.refresh_minutes },
  );
  const nowUtc = new Date().toISOString();
  const prefs = resolveDisplayPrefs(config);
  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(buildJsonLine(forecast, { label, latitude, longitude }, prefs, nowUtc))}\n`,
    );
  } else {
    process.stdout.write(`${buildOneLine(forecast, prefs, nowUtc)}\n`);
  }
  return 0;
}

async function runTui(locationArg: string | null): Promise<number> {
  const config = await loadConfig();
  let initialSlug: string | undefined;
  if (locationArg !== null || config.locations.length > 0) {
    const resolved = resolveSlugFromConfig(config, locationArg);
    if ("error" in resolved) {
      const hint = config.locations.length === 0 ? "; run tuiweather to set one up" : "";
      stderr(`${resolved.error}${hint}`);
      return 2;
    }
    initialSlug = resolved.slug;
  }
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  const appearance = await detectTerminalAppearance(renderer);
  renderer.on("destroy", () => appStore.getState().dispose());
  createRoot(renderer).render(<App initialSlug={initialSlug} appearance={appearance} />);
  return 0;
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(Bun.argv.slice(2));
  } catch (e) {
    stderr(e instanceof Error ? e.message : String(e));
    stderr(USAGE);
    return 2;
  }
  if (args.command === "help") {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if (args.command === "version") {
    process.stdout.write(`tuiweather ${VERSION}\n`);
    return 0;
  }
  try {
    if (args.oneLine || args.json) return await runOneLine(args);
    return await runTui(args.location);
  } catch (e) {
    stderr(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

process.exitCode = await main();
