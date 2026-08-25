import { describe, expect, test } from "bun:test";
import { anyPrecipChip, dailyChips } from "../../src/features/daily/DailyList";
import type { DailyPoint } from "../../src/lib/weather/types";

function day(precipProbabilityMaxPct: number | null): DailyPoint {
  return {
    dateLocal: "2026-08-24",
    condition: "rain",
    tempMinC: 10,
    tempMaxC: 20,
    precipSumMm: 1,
    precipProbabilityMaxPct,
    uvIndexMax: null,
    sunriseUtc: null,
    sunsetUtc: null,
    windSpeedMaxKmh: null,
    windGustMaxKmh: null,
  };
}

describe("anyPrecipChip", () => {
  test("chips appear only at or above the 20% threshold", () => {
    expect(anyPrecipChip([day(19), day(null)], true)).toBe(false);
    expect(anyPrecipChip([day(0), day(20)], true)).toBe(true);
  });

  test("showPrecip=false suppresses chips entirely", () => {
    expect(anyPrecipChip([day(90)], false)).toBe(false);
  });
});

describe("dailyChips", () => {
  test("renders one compact chip per day", () => {
    const chips = dailyChips([day(65)], "imperial");
    expect(chips).toBe("Mon☂68°");
  });
});
