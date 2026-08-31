import { describe, expect, test } from "bun:test";
import {
  localDateAtOffset,
  localDayBounds,
  sliceHourlyForLocalDay,
} from "../../src/features/daydetail/DayDetailOverlay";
import type { HourlyPoint } from "../../src/lib/weather/types";

function hourly(timeUtc: string): HourlyPoint {
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
