import { describe, expect, test } from "bun:test";
import {
  deriveNightSummary,
  localDateAtOffset,
  localDayBounds,
  sliceHourlyForLocalDay,
} from "../../src/features/daydetail/DayDetailOverlay";
import type { HourlyPoint } from "../../src/lib/weather/types";

function hourly(timeUtc: string, overrides: Partial<HourlyPoint> = {}): HourlyPoint {
  return {
    timeUtc,
    temperatureC: 20,
    apparentC: 20,
    precipMm: 0,
    precipProbabilityPct: 0,
    condition: "clear",
    windSpeedKmh: 10,
    windGustKmh: 15,
    windDirectionDeg: 180,
    humidityPct: 50,
    uvIndex: 2,
    visibilityM: 10_000,
    isDay: true,
    ...overrides,
  };
}

describe("local day slicing", () => {
  test("derives UTC bounds from a non-zero offset", () => {
    expect(localDayBounds("2026-08-25", 5.5 * 3600)).toEqual({
      startMs: Date.parse("2026-08-24T18:30:00.000Z"),
      endMs: Date.parse("2026-08-25T18:30:00.000Z"),
    });
    expect(localDateAtOffset("2026-08-24T18:29:59.999Z", 5.5 * 3600)).toBe("2026-08-24");
    expect(localDateAtOffset("2026-08-24T18:30:00.000Z", 5.5 * 3600)).toBe("2026-08-25");
  });

  test("includes the start boundary and excludes the end boundary", () => {
    const points = [
      hourly("2026-08-24T18:29:59.999Z"),
      hourly("2026-08-24T18:30:00.000Z"),
      hourly("2026-08-25T18:29:59.999Z"),
      hourly("2026-08-25T18:30:00.000Z"),
    ];

    expect(sliceHourlyForLocalDay(points, "2026-08-25", 5.5 * 3600).map((p) => p.timeUtc)).toEqual([
      "2026-08-24T18:30:00.000Z",
      "2026-08-25T18:29:59.999Z",
    ]);
  });

  test("invalid local dates fail closed", () => {
    expect(localDayBounds("2026-02-30", 0)).toBeNull();
    expect(sliceHourlyForLocalDay([hourly("2026-02-28T00:00:00.000Z")], "nope", 0)).toEqual([]);
  });
});

describe("deriveNightSummary", () => {
  test("sums precip and finds the min over both night fragments of a day spanning a sunrise and a sunset", () => {
    const points = [
      hourly("2026-08-25T00:00:00.000Z", { temperatureC: 12, precipMm: 0.4, isDay: false }),
      hourly("2026-08-25T01:00:00.000Z", { temperatureC: 9, precipMm: 0.1, isDay: false }),
      hourly("2026-08-25T02:00:00.000Z", { temperatureC: 14, isDay: true }),
      hourly("2026-08-25T03:00:00.000Z", { temperatureC: 22, isDay: true }),
      hourly("2026-08-25T04:00:00.000Z", { temperatureC: 18, precipMm: 0.3, isDay: false }),
      hourly("2026-08-25T05:00:00.000Z", { temperatureC: 15, isDay: false }),
    ];

    expect(deriveNightSummary(points)).toEqual({
      minTempC: 9,
      precipMm: 0.8,
      firstMorningTempC: 12,
    });
  });

  test("all-day points yield no night low but still report the first hour", () => {
    const points = [
      hourly("2026-08-25T00:00:00.000Z", { temperatureC: 16, isDay: true }),
      hourly("2026-08-25T01:00:00.000Z", { temperatureC: 17, isDay: true }),
    ];

    expect(deriveNightSummary(points)).toEqual({
      minTempC: null,
      precipMm: 0,
      firstMorningTempC: 16,
    });
  });

  test("empty day has nothing to report", () => {
    expect(deriveNightSummary([])).toEqual({
      minTempC: null,
      precipMm: 0,
      firstMorningTempC: null,
    });
  });
});
