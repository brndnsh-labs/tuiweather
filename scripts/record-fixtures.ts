import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { z } from "zod";
import { buildPointsUrl, NWS_HEADERS } from "../src/lib/providers/nws/client";
import {
  forecastResponseSchema as nwsForecastResponseSchema,
  observationResponseSchema,
  pointsResponseSchema,
  stationsResponseSchema,
} from "../src/lib/providers/nws/schemas";
import { aqResponseSchema, buildAirQualityUrl } from "../src/lib/providers/openmeteo/aq";
import { buildForecastUrl } from "../src/lib/providers/openmeteo/client";
import { forecastResponseSchema } from "../src/lib/providers/openmeteo/schemas";
import type { GeoPoint } from "../src/lib/weather/types";

export type FetchJson = (url: string, headers?: Record<string, string>) => Promise<unknown>;

export type ProviderToken = "openmeteo" | "nws" | "aq";

export interface FixtureRecord {
  path: string;
  url: string;
  schema: z.ZodTypeAny;
  body: unknown;
}

export type FixtureOutcome =
  | { status: "ok"; record: FixtureRecord }
  | { status: "error"; path: string; message: string };

interface FixtureSpec {
  provider: ProviderToken;
  collect: (fetchJson: FetchJson) => Promise<FixtureRecord[]>;
}

export const FIXTURE_ROOT = join(import.meta.dir, "..", "test", "fixtures");

export const RECORD_LOCATIONS = {
  portland: { latitude: 45.5202, longitude: -122.6742 },
  tokyo: { latitude: 35.6762, longitude: 139.6503 },
  aqPortland: { latitude: 45.5, longitude: -122.7 },
  nwsPortland: { latitude: 45.5152, longitude: -122.6784 },
} as const satisfies Record<string, GeoPoint>;

function forecastSpec(name: string, location: GeoPoint): FixtureSpec {
  const path = `openmeteo/${name}.json`;
  return {
    provider: "openmeteo",
    collect: async (fetchJson) => {
      const url = buildForecastUrl(location);
      return [{ path, url, schema: forecastResponseSchema, body: await fetchJson(url) }];
    },
  };
}

const AQ_SPEC: FixtureSpec = {
  provider: "aq",
  collect: async (fetchJson) => {
    const url = buildAirQualityUrl(RECORD_LOCATIONS.aqPortland);
    return [
      {
        path: "openmeteo/portland-aq.json",
        url,
        schema: aqResponseSchema,
        body: await fetchJson(url),
      },
    ];
  },
};

const NWS_SPEC: FixtureSpec = {
  provider: "nws",
  collect: async (fetchJson) => {
    const headers = { ...NWS_HEADERS };
    const pointsUrl = buildPointsUrl(RECORD_LOCATIONS.nwsPortland);
    const pointsBody = await fetchJson(pointsUrl, headers);
    const points = pointsResponseSchema.parse(pointsBody).properties;
    const [hourlyBody, dailyBody, stationsBody] = await Promise.all([
      fetchJson(points.forecastHourly, headers),
      fetchJson(points.forecast, headers),
      fetchJson(points.observationStations, headers),
    ]);
    const station = stationsResponseSchema.parse(stationsBody).features[0];
    if (station === undefined) {
      throw new Error("nws observation stations list is empty; cannot record an observation");
    }
    const obsUrl = `${station.id}/observations/latest`;
    const obsBody = await fetchJson(obsUrl, headers);
    return [
      { path: "nws/points.json", url: pointsUrl, schema: pointsResponseSchema, body: pointsBody },
      {
        path: "nws/hourly.json",
        url: points.forecastHourly,
        schema: nwsForecastResponseSchema,
        body: hourlyBody,
      },
      {
        path: "nws/daily.json",
        url: points.forecast,
        schema: nwsForecastResponseSchema,
        body: dailyBody,
      },
      {
        path: "nws/stations.json",
        url: points.observationStations,
        schema: stationsResponseSchema,
        body: stationsBody,
      },
      { path: "nws/obs.json", url: obsUrl, schema: observationResponseSchema, body: obsBody },
    ];
  },
};

const SPECS: readonly FixtureSpec[] = [
  forecastSpec("portland", RECORD_LOCATIONS.portland),
  forecastSpec("tokyo", RECORD_LOCATIONS.tokyo),
  AQ_SPEC,
  NWS_SPEC,
];

export async function buildFixtureRecords(
  fetchJson: FetchJson,
  providers: readonly ProviderToken[],
): Promise<FixtureOutcome[]> {
  const outcomes: FixtureOutcome[] = [];
  for (const spec of SPECS) {
    if (!providers.includes(spec.provider)) continue;
    try {
      for (const record of await spec.collect(fetchJson)) {
        outcomes.push({ status: "ok", record });
      }
    } catch (cause) {
      outcomes.push({
        status: "error",
        path: spec.provider,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  return outcomes;
}

export interface DriftReport {
  path: string;
  ok: boolean;
  detail: string;
}

export function checkFixtureDrift(outcomes: readonly FixtureOutcome[]): DriftReport[] {
  return outcomes.map((outcome) => {
    if (outcome.status === "error") {
      return { path: outcome.path, ok: false, detail: outcome.message };
    }
    const { record } = outcome;
    const parsed = record.schema.safeParse(record.body);
    if (parsed.success) {
      return { path: record.path, ok: true, detail: "matches recorded schema" };
    }
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { path: record.path, ok: false, detail: `schema drift — ${issues}` };
  });
}

export function formatFixture(body: unknown): string {
  return `${JSON.stringify(body, null, 2)}\n`;
}

export function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export const USAGE = "usage: bun scripts/record-fixtures.ts [--compare] [openmeteo|nws|aq|all]...";

export class UsageError extends Error {}

export function parseArgs(argv: readonly string[]): {
  compare: boolean;
  providers: ProviderToken[];
} {
  let compare = false;
  const tokens: string[] = [];
  for (const arg of argv) {
    if (arg === "--compare") compare = true;
    else if (arg === "all" || arg === "openmeteo" || arg === "nws" || arg === "aq") {
      if (!tokens.includes(arg)) tokens.push(arg);
    } else {
      throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  const providers: ProviderToken[] =
    tokens.length === 0 || tokens.includes("all")
      ? ["openmeteo", "nws", "aq"]
      : tokens.filter((token): token is ProviderToken => token !== "all");
  return { compare, providers };
}

const TIMEOUT_MS = 15_000;

const liveFetchJson: FetchJson = async (url, headers) => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return (await res.json()) as unknown;
};

async function sizeOf(path: string): Promise<number | undefined> {
  const file = Bun.file(path);
  return (await file.exists()) ? file.size : undefined;
}

async function recordToDisk(outcomes: readonly FixtureOutcome[]): Promise<number> {
  let failures = 0;
  for (const outcome of outcomes) {
    if (outcome.status === "error") {
      failures += 1;
      console.error(`FAIL ${outcome.path}: ${outcome.message}`);
      continue;
    }
    const { record } = outcome;
    const target = join(FIXTURE_ROOT, record.path);
    const before = await sizeOf(target);
    await mkdir(dirname(target), { recursive: true });
    const rendered = formatFixture(record.body);
    await writeFile(target, rendered);
    const after = Buffer.byteLength(rendered);
    const delta = before === undefined ? "new" : `${formatBytes(before)} → ${formatBytes(after)}`;
    console.log(`wrote test/fixtures/${record.path} (${record.url}\n                 ${delta})`);
  }
  if (failures === 0) {
    console.log(
      "\nReminder: timing-pinned expectations (e.g. the shared quarter-hour assertions in\n" +
        "test/providers/normalize.test.ts) encode the previous recording window. Run\n" +
        "bun run test and review any time-based failures by hand — do not blind-update.",
    );
  }
  return failures === 0 ? 0 : 1;
}

function reportDrift(outcomes: readonly FixtureOutcome[]): number {
  const reports = checkFixtureDrift(outcomes);
  for (const report of reports) {
    console.log(`${report.ok ? "ok    " : "DRIFT "} ${report.path}: ${report.detail}`);
  }
  const drifted = reports.filter((report) => !report.ok).length;
  console.log(
    drifted === 0
      ? "\nno drift: every live response matched the schema the fixtures are validated against."
      : `\n${drifted} endpoint(s) drifted or failed; re-record with: bun scripts/record-fixtures.ts`,
  );
  return drifted === 0 ? 0 : 1;
}

async function main(argv: readonly string[]): Promise<number> {
  let opts: ReturnType<typeof parseArgs>;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(USAGE);
    return 2;
  }
  const outcomes = await buildFixtureRecords(liveFetchJson, opts.providers);
  return opts.compare ? reportDrift(outcomes) : recordToDisk(outcomes);
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
