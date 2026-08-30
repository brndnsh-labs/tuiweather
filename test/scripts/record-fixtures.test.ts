import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  buildFixtureRecords,
  checkFixtureDrift,
  type FetchJson,
  formatBytes,
  formatFixture,
  parseArgs,
  RECORD_LOCATIONS,
  UsageError,
} from "../../scripts/record-fixtures";
import { buildPointsUrl, NWS_HEADERS } from "../../src/lib/providers/nws/client";
import { buildAirQualityUrl } from "../../src/lib/providers/openmeteo/aq";
import { buildForecastUrl } from "../../src/lib/providers/openmeteo/client";
import { forecastResponseSchema } from "../../src/lib/providers/openmeteo/schemas";

interface Call {
  url: string;
  headers?: Record<string, string>;
}

function fakeFetchJson(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const fetchJson: FetchJson = async (url, headers) => {
    calls.push({ url, headers });
    if (!(url in routes)) throw new Error(`unrouted url: ${url}`);
    return routes[url];
  };
  return { calls, fetchJson };
}

const PORTLAND_URL = buildForecastUrl(RECORD_LOCATIONS.portland);
const TOKYO_URL = buildForecastUrl(RECORD_LOCATIONS.tokyo);
const AQ_URL = buildAirQualityUrl(RECORD_LOCATIONS.aqPortland);

describe("parseArgs", () => {
  test("defaults to every provider with no network mode", () => {
    expect(parseArgs([])).toEqual({ compare: false, providers: ["openmeteo", "nws", "aq"] });
  });

  test("parses --compare and provider tokens, dropping duplicates", () => {
    expect(parseArgs(["--compare", "nws", "nws", "aq"])).toEqual({
      compare: true,
      providers: ["nws", "aq"],
    });
  });

  test('"all" expands to every provider', () => {
    expect(parseArgs(["all", "nws"]).providers).toEqual(["openmeteo", "nws", "aq"]);
  });

  test("rejects unknown arguments", () => {
    expect(() => parseArgs(["--oops"])).toThrow(UsageError);
  });
});

describe("open-meteo collection", () => {
  const portlandBody = { marker: "portland-raw" };
  const tokyoBody = { marker: "tokyo-raw" };
  const aqBody = { marker: "aq-raw" };

  test("requests the exact production URLs and stores raw bodies", async () => {
    const { calls, fetchJson } = fakeFetchJson({
      [PORTLAND_URL]: portlandBody,
      [TOKYO_URL]: tokyoBody,
      [AQ_URL]: aqBody,
    });
    const outcomes = await buildFixtureRecords(fetchJson, ["openmeteo", "aq"]);

    expect(outcomes.map((o) => (o.status === "ok" ? o.record.path : o.message))).toEqual([
      "openmeteo/portland.json",
      "openmeteo/tokyo.json",
      "openmeteo/portland-aq.json",
    ]);
    expect(calls.map((c) => c.url)).toEqual([PORTLAND_URL, TOKYO_URL, AQ_URL]);
    expect(calls.every((c) => c.headers === undefined)).toBe(true);

    const records = outcomes.flatMap((o) => (o.status === "ok" ? [o.record] : []));
    expect(records[0]).toMatchObject({ url: PORTLAND_URL, schema: forecastResponseSchema });
    expect(records[0]?.body).toBe(portlandBody);
    expect(records[1]?.body).toBe(tokyoBody);
    expect(records[2]?.body).toBe(aqBody);
  });
});

const POINTS_URL = buildPointsUrl(RECORD_LOCATIONS.nwsPortland);
const HOURLY_URL = "https://api.weather.gov/gridpoints/ZZZ/1,2/forecast/hourly";
const DAILY_URL = "https://api.weather.gov/gridpoints/ZZZ/1,2/forecast";
const STATIONS_URL = "https://api.weather.gov/gridpoints/ZZZ/1,2/stations";
const OBS_URL = "https://api.weather.gov/stations/KTEST/observations/latest";

const pointsBody = {
  properties: {
    cwa: "ZZZ",
    gridId: "ZZZ",
    gridX: 1,
    gridY: 2,
    forecast: DAILY_URL,
    forecastHourly: HOURLY_URL,
    observationStations: STATIONS_URL,
    timeZone: "Etc/Test",
  },
};
const forecastBody = (marker: string) => ({ properties: { periods: [], marker } });
const stationsBody = { features: [{ id: "https://api.weather.gov/stations/KTEST" }] };
const obsBody = {
  properties: {
    timestamp: "2026-08-30T12:00:00+00:00",
    textDescription: "test obs",
    temperature: { value: 20 },
  },
};

describe("nws chain collection", () => {
  test("follows points -> dependent urls -> station observation in order", async () => {
    const { calls, fetchJson } = fakeFetchJson({
      [POINTS_URL]: pointsBody,
      [HOURLY_URL]: forecastBody("hourly"),
      [DAILY_URL]: forecastBody("daily"),
      [STATIONS_URL]: stationsBody,
      [OBS_URL]: obsBody,
    });
    const outcomes = await buildFixtureRecords(fetchJson, ["nws"]);

    expect(calls.map((c) => c.url)).toEqual([
      POINTS_URL,
      HOURLY_URL,
      DAILY_URL,
      STATIONS_URL,
      OBS_URL,
    ]);
    expect(calls.every((c) => JSON.stringify(c.headers) === JSON.stringify(NWS_HEADERS))).toBe(
      true,
    );
    expect(outcomes.map((o) => (o.status === "ok" ? o.record.path : o.message))).toEqual([
      "nws/points.json",
      "nws/hourly.json",
      "nws/daily.json",
      "nws/stations.json",
      "nws/obs.json",
    ]);
    const records = outcomes.flatMap((o) => (o.status === "ok" ? [o.record] : []));
    expect(records.map((r) => r.url)).toEqual([
      POINTS_URL,
      HOURLY_URL,
      DAILY_URL,
      STATIONS_URL,
      OBS_URL,
    ]);
    expect(records[0]?.body).toBe(pointsBody);
    expect(records[4]?.body).toBe(obsBody);
  });

  test("an empty stations list fails the whole nws chain without throwing", async () => {
    const { fetchJson } = fakeFetchJson({
      [POINTS_URL]: pointsBody,
      [HOURLY_URL]: forecastBody("hourly"),
      [DAILY_URL]: forecastBody("daily"),
      [STATIONS_URL]: { features: [] },
    });
    const outcomes = await buildFixtureRecords(fetchJson, ["nws"]);
    expect(outcomes).toEqual([
      {
        status: "error",
        path: "nws",
        message: "nws observation stations list is empty; cannot record an observation",
      },
    ]);
  });
});

describe("failure containment", () => {
  test("an unrouted provider yields an error outcome, not a throw", async () => {
    const { fetchJson } = fakeFetchJson({});
    const outcomes = await buildFixtureRecords(fetchJson, ["openmeteo", "nws"]);
    expect(outcomes.map((o) => o.status)).toEqual(["error", "error", "error"]);
    expect(outcomes.map((o) => (o.status === "error" ? o.path : ""))).toEqual([
      "openmeteo",
      "openmeteo",
      "nws",
    ]);
  });
});

describe("checkFixtureDrift", () => {
  const schema = z.object({ count: z.number() });

  test("live responses matching the schema are reported clean", async () => {
    const { fetchJson } = fakeFetchJson({ "https://example.test/a": { count: 1 } });
    const outcomes = await buildFixtureRecords(fetchJson, []);
    expect(outcomes).toEqual([]);
    const reports = checkFixtureDrift([
      { status: "ok", record: { path: "x/a.json", url: "u", schema, body: { count: 1 } } },
    ]);
    expect(reports).toEqual([{ path: "x/a.json", ok: true, detail: "matches recorded schema" }]);
  });

  test("a drifted field is reported with its schema path", () => {
    const reports = checkFixtureDrift([
      {
        status: "ok",
        record: { path: "x/a.json", url: "u", schema, body: { count: "many" } },
      },
    ]);
    expect(reports[0]?.ok).toBe(false);
    expect(reports[0]?.detail).toContain("schema drift");
    expect(reports[0]?.detail).toContain("count");
  });

  test("a fetch error is reported as drift on the provider path", () => {
    const reports = checkFixtureDrift([{ status: "error", path: "nws", message: "HTTP 500" }]);
    expect(reports).toEqual([{ path: "nws", ok: false, detail: "HTTP 500" }]);
  });
});

describe("fixture rendering", () => {
  test("formats as pretty JSON with a trailing newline", () => {
    expect(formatFixture({ a: 1 })).toBe('{\n  "a": 1\n}\n');
  });

  test("formats byte sizes in KB", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
  });
});
