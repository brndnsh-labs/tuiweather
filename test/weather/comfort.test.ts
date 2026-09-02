import { describe, expect, test } from "bun:test";
import { normalizeForecast } from "../../src/lib/providers/openmeteo/normalize";
import { forecastResponseSchema } from "../../src/lib/providers/openmeteo/schemas";
import { deriveComfortWindows } from "../../src/lib/weather/derive";
import type { HourlyPoint, NormalizedForecast } from "../../src/lib/weather/types";
import portlandFixture from "../fixtures/openmeteo/portland.json";

const DAY = "2026-08-24";
const NOW = `${DAY}T12:00:00.000Z`;
const HOUR_MS = 3_600_000;

function hourAt(n: number): string {
  return new Date(Date.parse(NOW) + n * HOUR_MS).toISOString();
}

function point(hourOffset: number, overrides: Partial<HourlyPoint> = {}): HourlyPoint {
  return {
    timeUtc: hourAt(hourOffset),
    temperatureC: 20,
    apparentC: 20,
    precipMm: 0,
    precipProbabilityPct: 5,
    condition: "clear",
    windSpeedKmh: 10,
    windGustKmh: null,
    windDirectionDeg: 270,
    humidityPct: 50,
    uvIndex: 3,
    visibilityM: 10_000,
    isDay: true,
    ...overrides,
  };
}

function forecast(hourly: HourlyPoint[]): NormalizedForecast {
  return {
    providerId: "openmeteo",
    location: { latitude: 45.52, longitude: -122.68 },
    timezone: "UTC",
    utcOffsetSeconds: 0,
    fetchedAtUtc: NOW,
    hasMinutePrecip: true,
    current: {
      timeUtc: NOW,
      temperatureC: 20,
      apparentC: 20,
      humidityPct: 50,
      condition: "clear",
      windSpeedKmh: 10,
      windDirectionDeg: 270,
      windGustKmh: null,
      pressureHpa: 1013,
      dewPointC: null,
      visibilityM: null,
      uvIndex: 3,
      isDay: true,
    },
    minutely15: [],
    hourly,
    daily: [],
  };
}

const NEXT_24H = Array.from({ length: 24 }, (_, i) => i + 1);

describe("deriveComfortWindows", () => {
  test("an all-wet day never surfaces a go-out window, but does flag a heads-up one", () => {
    const points = NEXT_24H.map((h) => point(h, { precipMm: 3, precipProbabilityPct: 90 }));
    const { goOut, headsUp } = deriveComfortWindows(forecast(points), NOW);
    expect(goOut).toBeNull();
    expect(headsUp).not.toBeNull();
    expect(headsUp?.meanScore).toBe(0);
  });

  test("an all-benign day surfaces a go-out window and never a heads-up one", () => {
    const points = NEXT_24H.map((h) => point(h));
    const { goOut, headsUp } = deriveComfortWindows(forecast(points), NOW);
    expect(goOut).not.toBeNull();
    expect(goOut?.meanScore).toBeGreaterThanOrEqual(0.6);
    expect(headsUp).toBeNull();
  });

  test("a merely chilly, calm night is suppressed rather than flagged as a hazard", () => {
    const points = NEXT_24H.map((h) =>
      point(h, { temperatureC: 2, apparentC: -2, isDay: false, uvIndex: null }),
    );
    const { headsUp } = deriveComfortWindows(forecast(points), NOW);
    expect(headsUp).toBeNull();
  });

  test("the Portland fixture surfaces both windows, keyed by UTC instants", () => {
    const f = normalizeForecast(forecastResponseSchema.parse(portlandFixture));
    const nowUtc = "2026-09-01T23:30:00.000Z";
    const { goOut, headsUp } = deriveComfortWindows(f, nowUtc);

    expect(goOut).not.toBeNull();
    expect(goOut?.meanScore).toBeGreaterThanOrEqual(0.6);
    expect(goOut?.precipMm).toBe(0);
    expect(Date.parse(goOut?.startUtc ?? "")).toBeLessThan(Date.parse(goOut?.endUtc ?? ""));

    expect(headsUp).not.toBeNull();
    expect(headsUp?.meanScore).toBeLessThanOrEqual(0.25);
    expect(headsUp?.precipMm).toBeGreaterThan(0);
    expect(Date.parse(headsUp?.startUtc ?? "")).toBeLessThan(Date.parse(headsUp?.endUtc ?? ""));

    // Windows are keyed by absolute instants, not array position: both fall
    // within the 24h lookahead from nowUtc.
    const horizonMs = Date.parse(nowUtc) + 24 * HOUR_MS;
    for (const w of [goOut, headsUp]) {
      expect(Date.parse(w?.startUtc ?? "")).toBeGreaterThanOrEqual(Date.parse(nowUtc));
      expect(Date.parse(w?.endUtc ?? "")).toBeLessThanOrEqual(horizonMs);
    }
  });

  test("fewer than two upcoming hourly points yields neither window", () => {
    const { goOut, headsUp } = deriveComfortWindows(forecast([point(1)]), NOW);
    expect(goOut).toBeNull();
    expect(headsUp).toBeNull();
  });

  test("a go-out window is never composed across a wet hour, even when doing so would raise its mean", () => {
    // Removing a below-mean (here, zero-scored) hour from an average never
    // lowers it, so an exhaustive mean search would happily straddle a wet
    // hour whenever its two dry neighbors are strong enough to outweigh it —
    // bestDryRun must refuse to consider that window at all, not rely on the
    // score alone.
    const mediocre = { apparentC: 33 }; // dry, but a poor comfort score (~0.3)
    const points = [
      point(1, mediocre),
      point(2, mediocre),
      point(3, mediocre),
      point(4), // great, dry
      point(5, { precipMm: 2, precipProbabilityPct: 90 }), // wet
      point(6), // great, dry
      point(7, mediocre),
      point(8, mediocre),
      point(9, mediocre),
    ];
    const { goOut } = deriveComfortWindows(forecast(points), NOW);
    expect(goOut).not.toBeNull();
    expect(goOut?.precipMm).toBe(0);
    const wetPoint = point(5);
    const wetStartMs = Date.parse(wetPoint.timeUtc) - HOUR_MS;
    const wetEndMs = Date.parse(wetPoint.timeUtc);
    const winStartMs = Date.parse(goOut?.startUtc ?? "");
    const winEndMs = Date.parse(goOut?.endUtc ?? "");
    expect(winStartMs < wetEndMs && winEndMs > wetStartMs).toBe(false);
  });

  test("a gust-only hazard with no rain is still flagged, and describes as a wind hazard not a rain one", () => {
    // Severe enough that the wind factor alone (multiplicative, not averaged
    // against comfort/uv) collapses the score, even though it's otherwise a
    // comfortable, dry reading.
    const points = NEXT_24H.map((h) => point(h, { windSpeedKmh: 50, windGustKmh: 70 }));
    const { headsUp } = deriveComfortWindows(forecast(points), NOW);
    expect(headsUp).not.toBeNull();
    expect(headsUp?.meanScore).toBeLessThanOrEqual(0.25);
    expect(headsUp?.precipMm).toBe(0);
    expect(headsUp?.windGustKmh).toBe(70);
  });
});
