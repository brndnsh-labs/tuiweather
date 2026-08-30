import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app/App";
import { buildJsonLine, buildOneLine } from "./app/oneline";
import { appStore, refreshLoopPeriodMs } from "./app/store";
import { runWatch } from "./app/watch";
import type { CliArgs } from "./cli";
import { HELP_TEXT, parseArgs, USAGE, VERSION } from "./cli";
import { loadConfig } from "./lib/config/load";
import { resolveDisplayPrefs, type TuiConfig } from "./lib/config/schema";
import { selectProvider } from "./lib/providers/select";
import { formatFfiUnavailableMessage, probeFfiAvailable } from "./lib/runtime/ffi";
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

function resolveLocationForCli(
  args: CliArgs,
  config: TuiConfig,
): { latitude: number; longitude: number; label: string | null } | { error: string } {
  if (args.latLon) {
    return { latitude: args.latLon.latitude, longitude: args.latLon.longitude, label: null };
  }
  const resolved = resolveSlugFromConfig(config, args.location);
  if ("error" in resolved) return { error: resolved.error };
  return { latitude: resolved.latitude, longitude: resolved.longitude, label: resolved.label };
}

async function runOneLine(args: CliArgs): Promise<number> {
  const config = await loadConfig();
  const resolved = resolveLocationForCli(args, config);
  if ("error" in resolved) {
    const hint = config.locations.length === 0 ? "; run tuiweather to set one up" : "";
    stderr(`${resolved.error}${hint}`);
    return 2;
  }
  const { latitude, longitude, label } = resolved;
  const provider = selectProvider(config.provider);
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
  if (!(await probeFfiAvailable())) {
    stderr(formatFfiUnavailableMessage(process.versions.node));
    return 1;
  }
  const renderer = await createCliRenderer({ exitOnCtrlC: true });
  const appearance = await detectTerminalAppearance(renderer);
  renderer.on("destroy", () => appStore.getState().dispose());
  createRoot(renderer).render(<App initialSlug={initialSlug} appearance={appearance} />);
  return 0;
}

async function runWatchCli(args: CliArgs): Promise<number> {
  const config = await loadConfig();
  const resolved = resolveLocationForCli(args, config);
  if ("error" in resolved) {
    const hint = config.locations.length === 0 ? "; run tuiweather to set one up" : "";
    stderr(`${resolved.error}${hint}`);
    return 2;
  }
  const { latitude, longitude, label } = resolved;
  const provider = selectProvider(config.provider);
  const prefs = resolveDisplayPrefs(config);
  const maxAgeMinutes = args.interval ?? config.refresh_minutes;
  const intervalMs = refreshLoopPeriodMs(maxAgeMinutes);
  const fetcher = () => cachedForecast(provider, { latitude, longitude }, { maxAgeMinutes });
  const write = (text: string) => process.stdout.write(text);
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const onSigint = () => {
    process.exit(0);
  };
  process.on("SIGINT", onSigint);
  try {
    await runWatch({
      fetch: fetcher,
      prefs,
      label,
      intervalMs,
      write,
      sleep,
    });
  } finally {
    process.off("SIGINT", onSigint);
  }
  return 0;
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
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
    if (args.command === "watch") return await runWatchCli(args);
    if (args.oneLine || args.json) return await runOneLine(args);
    return await runTui(args.location);
  } catch (e) {
    stderr(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

process.exitCode = await main();
