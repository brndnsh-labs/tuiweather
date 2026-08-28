import { describe, expect, test } from "bun:test";
import { buildOneLine } from "../../src/app/oneline";
import { runWatch, shouldBell } from "../../src/app/watch";
import type { DisplayPrefs } from "../../src/lib/config/schema";
import { deriveNowcast, describeNowcast } from "../../src/lib/weather/derive";
import type {
  CurrentObs,
  DailyPoint,
  NormalizedForecast,
  PrecipInterval,
} from "../../src/lib/weather/types";

const NOW = "2026-08-24T12:00:00.000Z";
const MIN_MS = 60_000;

function prefsOf(units: "metric" | "imperial"): DisplayPrefs {
  return {
    temp: units,
    wind: units,
    precip: units,
    pressure: units,
    timeFormat: units === "imperial" ? "12h" : "24h",
  };
}

const METRIC = prefsOf("metric");

function bucket(startOffsetMin: number, precipMm: number): PrecipInterval {
  const startMs = Date.parse(NOW) + startOffsetMin * MIN_MS;
  return {
    startUtc: new Date(startMs).toISOString(),
    endUtc: new Date(startMs + 15 * MIN_MS).toISOString(),
    precipMm,
    probabilityPct: null,
  };
}

function currentObs(overrides: Partial<CurrentObs> = {}): CurrentObs {
  return {
    timeUtc: NOW,
    temperatureC: 22.2222,
    apparentC: 21.1111,
    humidityPct: 50,
    condition: "clear",
    windSpeedKmh: 9.6563,
    windDirectionDeg: 315,
    windGustKmh: null,
    pressureHpa: null,
    cloudCoverPct: null,
    dewPointC: null,
    visibilityM: null,
    uvIndex: null,
    precipLast1hMm: null,
    isDay: true,
    ...overrides,
  };
}

function dailyPoint(overrides: Partial<DailyPoint> = {}): DailyPoint {
  return {
    dateLocal: "2026-08-24",
    condition: "clear",
    tempMinC: 14.4444,
    tempMaxC: 23.8889,
    precipSumMm: 0,
    precipProbabilityMaxPct: null,
    uvIndexMax: null,
    sunriseUtc: null,
    sunsetUtc: null,
    windSpeedMaxKmh: null,
    windGustMaxKmh: null,
    ...overrides,
  };
}

interface ForecastOverrides {
  current?: Partial<CurrentObs>;
  minutely15?: PrecipInterval[];
  daily?: DailyPoint[];
}

function makeForecast(overrides: ForecastOverrides = {}): NormalizedForecast {
  return {
    providerId: "stub",
    location: { latitude: 45.52, longitude: -122.68 },
    timezone: "America/Los_Angeles",
    utcOffsetSeconds: -7 * 3600,
    fetchedAtUtc: NOW,
    current: currentObs(overrides.current),
    minutely15: overrides.minutely15 ?? [bucket(-15, 0), bucket(0, 0)],
    hourly: [],
    daily: overrides.daily ?? [dailyPoint()],
  };
}

describe("shouldBell", () => {
  test("truth table", () => {
    const dry = { kind: "dry" } as const;
    const starting = { kind: "starting", startsInMin: 15, intensity: "heavy" } as const;
    const ongoing = { kind: "ongoing", endsInMin: null, intensity: "heavy" } as const;
    const stopping = { kind: "stopping", endsInMin: 10 } as const;

    expect(shouldBell(dry, starting)).toBe(true);
    expect(shouldBell(dry, ongoing)).toBe(true);
    expect(shouldBell(dry, stopping)).toBe(true);
    expect(shouldBell(starting, starting)).toBe(false);
    expect(shouldBell(ongoing, stopping)).toBe(false);
    expect(shouldBell(stopping, starting)).toBe(false);
    expect(shouldBell(dry, dry)).toBe(false);
  });
});

describe("runWatch", () => {
  test("dry→starting rings once, not again on still-starting, and reports poll count", async () => {
    const dryForecast = makeForecast({ minutely15: [bucket(-15, 0), bucket(0, 0)] });
    const startingForecast = makeForecast({
      minutely15: [bucket(-15, 0), bucket(0, 0), bucket(15, 0.5), bucket(30, 0.2)],
    });
    const forecasts = [dryForecast, startingForecast, startingForecast];
    let idx = 0;
    const fetch = async () => ({
      forecast: forecasts[idx++] ?? startingForecast,
      stale: false,
    });
    const writes: string[] = [];
    const sleep = async (_ms: number) => {};

    const polls = await runWatch({
      fetch,
      prefs: METRIC,
      intervalMs: 60_000,
      write: (t) => writes.push(t),
      maxPolls: 3,
      nowUtc: () => NOW,
      sleep,
      label: null,
    });

    expect(polls).toBe(3);

    const dryLine = buildOneLine(dryForecast, METRIC, NOW);
    const startingLine = buildOneLine(startingForecast, METRIC, NOW);
    const expectedDescribe = describeNowcast(deriveNowcast(startingForecast, NOW));

    const statusWrites = writes.filter((w) => w !== "\x07" && w !== `${expectedDescribe}\n`);
    expect(statusWrites.length).toBe(3);
    expect(statusWrites[0]).toBe(`${dryLine}\n`);
    expect(statusWrites[1]).toBe(`${startingLine}\n`);
    expect(statusWrites[2]).toBe(`${startingLine}\n`);

    for (const w of statusWrites) {
      expect(w).toContain(dryLine === w.slice(0, -1) ? dryLine : startingLine);
    }

    const bellCount = writes.filter((w) => w === "\x07").length;
    expect(bellCount).toBe(1);
    expect(writes).toContain(`${expectedDescribe}\n`);
    expect(writes.filter((w) => w === `${expectedDescribe}\n`).length).toBe(1);
  });

  test("first poll already starting does not bell", async () => {
    const startingForecast = makeForecast({
      minutely15: [bucket(-15, 0), bucket(0, 0), bucket(15, 0.5)],
    });
    const writes: string[] = [];
    const polls = await runWatch({
      fetch: async () => ({ forecast: startingForecast, stale: false }),
      prefs: METRIC,
      intervalMs: 60_000,
      write: (t) => writes.push(t),
      maxPolls: 1,
      nowUtc: () => NOW,
      sleep: async () => {},
      label: null,
    });
    expect(polls).toBe(1);
    expect(writes.filter((w) => w === "\x07").length).toBe(0);
    const expectedLine = buildOneLine(startingForecast, METRIC, NOW);
    expect(writes[0]).toBe(`${expectedLine}\n`);
  });

  test("prefixes status line with label when provided", async () => {
    const dryForecast = makeForecast({ minutely15: [bucket(-15, 0), bucket(0, 0)] });
    const startingForecast = makeForecast({
      minutely15: [bucket(-15, 0), bucket(0, 0), bucket(15, 0.5)],
    });
    const forecasts = [dryForecast, startingForecast];
    let idx = 0;
    const writes: string[] = [];
    const polls = await runWatch({
      fetch: async () => ({ forecast: forecasts[idx++] ?? startingForecast, stale: false }),
      prefs: METRIC,
      intervalMs: 60_000,
      write: (t) => writes.push(t),
      maxPolls: 2,
      nowUtc: () => NOW,
      sleep: async () => {},
      label: "Portland",
    });
    expect(polls).toBe(2);
    const dryLine = buildOneLine(dryForecast, METRIC, NOW);
    const startingLine = buildOneLine(startingForecast, METRIC, NOW);
    const expectedDescribe = describeNowcast(deriveNowcast(startingForecast, NOW));
    expect(writes[0]).toBe(`Portland: ${dryLine}\n`);
    expect(writes[1]).toBe(`Portland: ${startingLine}\n`);
    expect(writes).toContain(`${expectedDescribe}\n`);
    expect(writes.filter((w) => w === "\x07").length).toBe(1);

    const emptyWrites: string[] = [];
    await runWatch({
      fetch: async () => ({ forecast: dryForecast, stale: false }),
      prefs: METRIC,
      intervalMs: 60_000,
      write: (t) => emptyWrites.push(t),
      maxPolls: 1,
      nowUtc: () => NOW,
      sleep: async () => {},
      label: "",
    });
    expect(emptyWrites[0]).toBe(`${dryLine}\n`);
  });
});
