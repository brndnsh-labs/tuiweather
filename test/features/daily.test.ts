import { describe, expect, test } from "bun:test";
import {
  anyPrecipChip,
  CHIP_FULL_RESERVE,
  CHIP_PROB_ONLY_RESERVE,
  dailyChips,
  dailyMetrics,
  precipChip,
} from "../../src/features/daily/DailyList";
import type { DailyPoint } from "../../src/lib/weather/types";

function day(
  precipProbabilityMaxPct: number | null,
  overrides: Partial<DailyPoint> = {},
): DailyPoint {
  return {
    dateLocal: "2026-08-24",
    condition: "rain",
    tempMinC: 10,
    tempMaxC: 20,
    precipSumMm: 1,
    precipProbabilityMaxPct,
    sunriseUtc: null,
    sunsetUtc: null,
    windSpeedMaxKmh: null,
    ...overrides,
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

describe("precipChip", () => {
  test("gated day with real accumulation composes probability + amount", () => {
    expect(precipChip(day(65, { precipSumMm: 7.9 }), "imperial")).toBe("☂ 65% · 0.31 in");
    expect(precipChip(day(65, { precipSumMm: 7.9 }), "metric")).toBe("☂ 65% · 7.9 mm");
  });

  test("zero or trace accumulation keeps a probability-only chip", () => {
    expect(precipChip(day(65, { precipSumMm: 0 }), "imperial")).toBe("☂ 65%");
    expect(precipChip(day(65, { precipSumMm: 0.04 }), "metric")).toBe("☂ 65%");
  });

  test("amount is suppressed when layout degrades to probability-only", () => {
    expect(precipChip(day(65, { precipSumMm: 7.9 }), "imperial", false)).toBe("☂ 65%");
  });

  test("below the gate the chip stays fully hidden, amount included", () => {
    expect(precipChip(day(19, { precipSumMm: 25 }), "imperial")).toBeNull();
    expect(precipChip(day(null, { precipSumMm: 25 }), "metric")).toBeNull();
  });

  test("realistic worst-case chips fit their reserved budget", () => {
    const wet = day(100, { precipSumMm: 99.9 });
    expect(precipChip(wet, "metric")).toBe("☂ 100% · 99.9 mm");
    expect(precipChip(wet, "imperial")).toBe("☂ 100% · 3.93 in");
    expect(precipChip(wet, "metric")?.length).toBeLessThanOrEqual(CHIP_FULL_RESERVE - 1);
    expect(precipChip(day(100, { precipSumMm: 0 }), "imperial")?.length).toBeLessThanOrEqual(
      CHIP_PROB_ONLY_RESERVE - 1,
    );
  });
});

describe("dailyMetrics width budget", () => {
  test("barWidth reserves nothing when no day passes the gate", () => {
    const m = dailyMetrics([day(19, { precipSumMm: 5 })], {
      width: 40,
      columns: 1,
      showPrecip: true,
    });
    expect(m.chipTier).toBe("none");
    expect(m.barWidth).toBe(25);
  });

  test("probability-only chips reserve 7 columns", () => {
    const m = dailyMetrics([day(65, { precipSumMm: 0 })], {
      width: 40,
      columns: 1,
      showPrecip: true,
    });
    expect(m.chipTier).toBe("prob");
    expect(m.barWidth).toBe(18);
  });

  test("any accumulated day reserves the full-chip allowance for all rows", () => {
    const m = dailyMetrics([day(65, { precipSumMm: 0 }), day(80)], {
      width: 40,
      columns: 1,
      showPrecip: true,
    });
    expect(m.chipTier).toBe("full");
    expect(m.barWidth).toBe(6);
    expect(18 - m.barWidth).toBe(CHIP_FULL_RESERVE - CHIP_PROB_ONLY_RESERVE);
  });

  test("showPrecip=false skips every reservation", () => {
    const m = dailyMetrics([day(90)], { width: 40, columns: 1, showPrecip: false });
    expect(m.chipTier).toBe("none");
    expect(m.barWidth).toBe(25);
  });

  test("two-column layout budgets per column width", () => {
    const days = [day(65)];
    expect(dailyMetrics(days, { width: 80, columns: 2, showPrecip: true })).toEqual({
      colWidth: 40,
      barWidth: 6,
      chipTier: "full",
    });
    expect(dailyMetrics(days, { width: 64, columns: 2, showPrecip: true })).toEqual({
      colWidth: 32,
      barWidth: 10,
      chipTier: "prob",
    });
  });
});

describe("degradation ladder at shrinking widths", () => {
  const days = [day(65)];

  test("amount suffix drops first when the full allowance collapses the bar", () => {
    expect(dailyMetrics(days, { width: 35, columns: 1, showPrecip: true })).toEqual({
      colWidth: 35,
      barWidth: 13,
      chipTier: "prob",
    });
    expect(dailyMetrics(days, { width: 32, columns: 1, showPrecip: true })).toEqual({
      colWidth: 32,
      barWidth: 10,
      chipTier: "prob",
    });
  });

  test("whole chip drops next, then the bar clamps at its minimum", () => {
    expect(dailyMetrics(days, { width: 23, columns: 1, showPrecip: true })).toEqual({
      colWidth: 23,
      barWidth: 8,
      chipTier: "none",
    });
    expect(dailyMetrics(days, { width: 22, columns: 1, showPrecip: true })).toEqual({
      colWidth: 22,
      barWidth: 7,
      chipTier: "none",
    });
    expect(dailyMetrics(days, { width: 15, columns: 1, showPrecip: true })).toEqual({
      colWidth: 15,
      barWidth: 2,
      chipTier: "none",
    });
  });
});

describe("dailyChips", () => {
  test("renders one compact chip per day", () => {
    const chips = dailyChips([day(65)], "imperial");
    expect(chips).toBe("Mon\uD83C\uDF27\uFE0F68°");
  });
});
