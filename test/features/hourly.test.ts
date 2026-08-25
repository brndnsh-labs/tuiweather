import { describe, expect, test } from "bun:test";
import {
  hourLabelsRow,
  precipBars,
  seriesWidthFor,
  sliceUpcoming,
} from "../../src/features/hourly/HourlyStrip";
import type { HourlyPoint } from "../../src/lib/weather/types";

const NOW = "2026-08-24T16:15:00.000Z";

function hourlyPoints(count: number, startUtc = "2026-08-24T17:00:00.000Z"): HourlyPoint[] {
  const base = Date.parse(startUtc);
  return Array.from({ length: count }, (_, i) => ({
    timeUtc: new Date(base + i * 3600_000).toISOString(),
    temperatureC: 10 + i,
    apparentC: 10 + i,
    precipMm: 0,
    precipProbabilityPct: null,
    condition: "clear" as const,
    windSpeedKmh: 5,
    windGustKmh: null,
    windDirectionDeg: 180,
    humidityPct: null,
    uvIndex: null,
    isDay: true,
  }));
}

describe("sliceUpcoming", () => {
  test("keeps only points at or after now, capped to max", () => {
    const past = {
      ...hourlyPoints(1, "2026-08-24T15:00:00.000Z")[0],
      timeUtc: "2026-08-24T15:00:00.000Z",
    };
    const points = [past, ...hourlyPoints(3)];
    const sliced = sliceUpcoming(points as HourlyPoint[], NOW, 2);
    expect(sliced.map((p) => p.timeUtc)).toEqual([
      "2026-08-24T17:00:00.000Z",
      "2026-08-24T18:00:00.000Z",
    ]);
  });
});

describe("seriesWidthFor", () => {
  test("fills the available width for large point counts", () => {
    expect(seriesWidthFor(48, 90)).toBe(84);
  });

  test("caps upscaling so sparse series do not smear", () => {
    expect(seriesWidthFor(4, 90)).toBe(12);
  });

  test("reserves the label gutter plus one safety column", () => {
    expect(seriesWidthFor(48, 20)).toBe(Math.max(1, 20 - 5 - 1));
  });
});

describe("hourLabelsRow", () => {
  test("is a fixed-width row including the gutter", () => {
    const row = hourLabelsRow(hourlyPoints(48), -25200, 70, "12h");
    expect(row.length).toBe(75);
  });

  test("aligns labels under the resampled series", () => {
    const row = hourLabelsRow(hourlyPoints(48), -25200, 70, "12h");
    expect(row.startsWith(" ".repeat(5))).toBe(true);
    expect(row.slice(5, 8)).toBe("10a");
  });

  test("24h labels render two-digit hours", () => {
    const row = hourLabelsRow(hourlyPoints(48), -25200, 70, "24h");
    expect(row.slice(5, 7)).toBe("10");
    expect(row).toContain("00");
  });

  test("empty input renders an empty row", () => {
    expect(hourLabelsRow([], 0, 40, "12h")).toBe("");
  });
});

describe("precipBars", () => {
  test("dry windows render uniform track cells", () => {
    expect(precipBars([0, 0, 0])).toBe("░░░");
  });

  test("wet values scale onto the ramp relative to the window max", () => {
    expect(precipBars([0.1, 0.2])).toBe("▄█");
    expect(precipBars([0.05, 0.1, 0.2])).toBe("▂▄█");
  });
});
