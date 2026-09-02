import { describe, expect, test } from "bun:test";
import {
  annotateRows,
  buildTempAreaRows,
  fitNotes,
  hourLabelsRow,
  hourlyDetailRow,
  hourlyInspectRow,
  MIN_WIDE_AREA_SERIES_WIDTH,
  nextInspectTimeUtc,
  PROB_SUMMARY_PCT,
  peakProbability,
  planTempNotes,
  precipBarsAbsolute,
  precipWindowKind,
  segmentRow,
  seriesWidthFor,
  sliceUpcoming,
  TEMP_AREA_ROWS_NARROW,
  TEMP_AREA_ROWS_WIDE,
  TRACE_MM,
  windowIsDry,
} from "../../src/features/hourly/HourlyStrip";
import { displayWidth } from "../../src/lib/weather/format";
import type { Condition, HourlyPoint } from "../../src/lib/weather/types";

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
    visibilityM: null,
    isDay: true,
  }));
}

function withOverrides(point: HourlyPoint, overrides: Partial<HourlyPoint>): HourlyPoint {
  return { ...point, ...overrides };
}

describe("sliceUpcoming", () => {
  test("keeps only points after now, capped to max", () => {
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

  test("drops the just-elapsed end-labeled row when now sits exactly on its boundary", () => {
    const points = hourlyPoints(4, "2026-08-24T17:00:00.000Z");
    const sliced = sliceUpcoming(points, "2026-08-24T17:00:00.000Z", 2);
    expect(sliced.map((p) => p.timeUtc)).toEqual([
      "2026-08-24T18:00:00.000Z",
      "2026-08-24T19:00:00.000Z",
    ]);
  });
});

describe("seriesWidthFor", () => {
  test("fills the available width for large point counts", () => {
    expect(seriesWidthFor(48, 90)).toBe(84);
  });

  test("caps upscaling at two cells per point through twelve points", () => {
    expect(seriesWidthFor(4, 90)).toBe(8);
    expect(seriesWidthFor(12, 90)).toBe(24);
  });

  test("switches to three cells per point beyond twelve points", () => {
    expect(seriesWidthFor(13, 90)).toBe(39);
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

describe("precipBarsAbsolute", () => {
  test("trace and negative amounts render blank space, never ░", () => {
    expect(precipBarsAbsolute([0, 0.04, -0.3])).toBe("   ");
  });

  test("exact threshold boundaries map onto the documented ladder", () => {
    const edges = [0.04, TRACE_MM, 0.15, 0.25, 0.5, 1, 2.5, 5, 10];
    expect(precipBarsAbsolute(edges)).toBe(" ▁▂▃▄▅▆▇█");
  });

  test("bands group as light ▁▂, moderate ▃▄▅, heavy ▆▇, extreme █", () => {
    expect(precipBarsAbsolute([0.06, 0.24])).toBe("▁▂");
    expect(precipBarsAbsolute([0.26, 0.8, 2])).toBe("▃▄▅");
    expect(precipBarsAbsolute([2.6, 6, 9.9])).toBe("▆▇▇");
    expect(precipBarsAbsolute([12, 40])).toBe("██");
  });

  test("empty series renders an empty string", () => {
    expect(precipBarsAbsolute([])).toBe("");
  });
});

describe("windowIsDry", () => {
  test("dry when every amount is under trace and every probability under threshold", () => {
    expect(windowIsDry([0, 0.02, TRACE_MM - 0.01], [null, 10, PROB_SUMMARY_PCT - 1])).toBe(true);
  });

  test("wet when any amount reaches trace", () => {
    expect(windowIsDry([0, TRACE_MM], [null, null])).toBe(false);
  });

  test("wet when any probability reaches the summary threshold even if all dry", () => {
    expect(windowIsDry([0, 0], [5, PROB_SUMMARY_PCT])).toBe(false);
  });
});

describe("precipWindowKind", () => {
  const wetMm = [0.6, 0.6, 0.6, 0.6];

  test("all-wet liquid window reads as rain", () => {
    const conditions: Condition[] = ["rain", "drizzle", "heavy-rain"];
    expect(precipWindowKind(conditions, wetMm.slice(0, 3))).toEqual({
      label: "rain ",
      glyph: "☂",
    });
  });

  test("all-wet frozen window reads as snow across every frozen condition", () => {
    for (const condition of ["snow", "heavy-snow", "sleet", "freezing-rain"] as const) {
      expect(precipWindowKind([condition], [0.6])).toEqual({ label: "snow ", glyph: "❄" });
    }
  });

  test("frozen at exactly half of wet points reads as snow", () => {
    const conditions: Condition[] = ["snow", "snow", "rain", "rain"];
    expect(precipWindowKind(conditions, wetMm)).toEqual({ label: "snow ", glyph: "❄" });
  });

  test("frozen below half of wet points reads as mixed precip", () => {
    const conditions: Condition[] = ["sleet", "freezing-rain", "rain", "drizzle", "heavy-rain"];
    expect(precipWindowKind(conditions, [0.6, 0.6, 0.6, 0.6, 0.6])).toEqual({
      label: "prec ",
      glyph: "☂",
    });
  });

  test("dry hours with frozen conditions never tip a mostly-liquid window", () => {
    expect(precipWindowKind(["snow", "snow", "rain"], [0, TRACE_MM - 0.01, 0.5])).toEqual({
      label: "rain ",
      glyph: "☂",
    });
  });

  test("no wet points falls back to liquid even when conditions are frozen", () => {
    expect(precipWindowKind(["heavy-snow", "snow"], [0, 0])).toEqual({
      label: "rain ",
      glyph: "☂",
    });
  });

  test("empty window falls back to liquid", () => {
    expect(precipWindowKind([], [])).toEqual({ label: "rain ", glyph: "☂" });
  });
});

describe("peakProbability", () => {
  const pts = hourlyPoints(4);

  test("returns null when no probability reaches the summary threshold", () => {
    const window = [
      withOverrides(pts[0] as HourlyPoint, { precipProbabilityPct: 39 }),
      withOverrides(pts[1] as HourlyPoint, { precipProbabilityPct: 0 }),
      withOverrides(pts[2] as HourlyPoint, { precipProbabilityPct: null }),
    ];
    expect(peakProbability(window)).toBeNull();
  });

  test("picks the highest probability and its hour label source", () => {
    const window = [
      withOverrides(pts[0] as HourlyPoint, { precipProbabilityPct: 30 }),
      withOverrides(pts[1] as HourlyPoint, { precipProbabilityPct: 65 }),
      withOverrides(pts[2] as HourlyPoint, { precipProbabilityPct: 45 }),
    ];
    const peak = peakProbability(window);
    expect(peak?.pct).toBe(65);
    expect(peak?.point.timeUtc).toBe(pts[1]?.timeUtc);
  });

  test("resolves ties to the earliest point", () => {
    const window = [
      withOverrides(pts[0] as HourlyPoint, { precipProbabilityPct: 50 }),
      withOverrides(pts[1] as HourlyPoint, { precipProbabilityPct: 80 }),
      withOverrides(pts[2] as HourlyPoint, { precipProbabilityPct: 80 }),
      withOverrides(pts[3] as HourlyPoint, { precipProbabilityPct: 70 }),
    ];
    const peak = peakProbability(window);
    expect(peak?.pct).toBe(80);
    expect(peak?.point.timeUtc).toBe(pts[1]?.timeUtc);
  });
});

describe("buildTempAreaRows", () => {
  test("emits exactly `rows` strings of exactly `width` cells", () => {
    const rows = buildTempAreaRows([0, 5, 10], 4, 6);
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row).toHaveLength(6);
  });

  test("each column reads blank-above then fill-below, never blanks under fill", () => {
    const rows = buildTempAreaRows([1, 7, 3, 9, 2, 5], 4, 12);
    for (let c = 0; c < 12; c++) {
      let seenFill = false;
      for (const row of rows) {
        const ch = row[c];
        if (ch === undefined) continue;
        if (ch !== " ") seenFill = true;
        else expect(seenFill).toBe(false);
      }
    }
  });

  test("the peak column fills its top cell fully; the trough column stays blank on top", () => {
    const rows = buildTempAreaRows([3, 9, 1], 4, 3);
    expect(rows[0]?.[1]).toBe("█");
    expect(rows[0]?.[2]).toBe(" ");
  });

  test("monotonic input yields non-decreasing per-column fill heights", () => {
    const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const rows = buildTempAreaRows(values, 4, values.length);
    const filledAt = (c: number) => rows.filter((row) => row[c] !== " ").length;
    for (let c = 1; c < values.length; c++) {
      expect(filledAt(c)).toBeGreaterThanOrEqual(filledAt(c - 1));
    }
  });

  test("flat series fills the lower half deterministically", () => {
    const rows = buildTempAreaRows([5, 5, 5, 5], 4, 4);
    expect(rows).toEqual(["    ", "    ", "████", "████"]);
  });

  test("degenerate dimensions return no rows", () => {
    expect(buildTempAreaRows([], 4, 10)).toEqual([]);
    expect(buildTempAreaRows([1, 2], 0, 10)).toEqual([]);
    expect(buildTempAreaRows([1, 2], 4, 0)).toEqual([]);
  });
});

describe("planTempNotes", () => {
  test("places hi at the peak column on the top row, lo at the trough on the bottom row", () => {
    const notes = planTempNotes([2, 9, 4, 1], 4, "metric");
    expect(notes).toEqual([
      { row: 0, col: 1, label: "9°" },
      { row: 3, col: 3, label: "1°" },
    ]);
  });

  test("labels honor display units via formatTemp", () => {
    const notes = planTempNotes([0, 10], 2, "imperial");
    expect(notes.map((n) => n.label)).toEqual(["50°", "32°"]);
  });

  test("empty series plans nothing", () => {
    expect(planTempNotes([], 4, "metric")).toEqual([]);
  });
});

describe("annotateRows", () => {
  test("overlays a fitting note at its column", () => {
    const rows = ["     ", "█████"];
    expect(annotateRows(rows, [{ row: 0, col: 2, label: "85°" }])[0]).toBe("  85°");
  });

  test("drops notes that would overflow the row instead of wrapping them", () => {
    const rows = ["  ██████"];
    const drawn = annotateRows(rows, [{ row: 0, col: 6, label: "92°" }]);
    expect(drawn[0]).toBe(rows[0]);
    expect(fitNotes(rows, [{ row: 0, col: 6, label: "92°" }])).toEqual([]);
  });

  test("keeps a note that ends exactly at the last column", () => {
    const rows = ["   █████"];
    expect(fitNotes(rows, [{ row: 0, col: 5, label: "92°" }])).toHaveLength(1);
    expect(annotateRows(rows, [{ row: 0, col: 5, label: "92°" }])[0]).toBe("   ██92°");
  });

  test("ignores notes pointing at missing rows", () => {
    expect(annotateRows(["abc"], [{ row: 3, col: 0, label: "9°" }])).toEqual(["abc"]);
  });
});

describe("segmentRow", () => {
  test("splits annotated runs for dim styling beside accent fill", () => {
    expect(segmentRow("  85°██", [{ row: 0, col: 2, label: "85°" }])).toEqual([
      { text: "  ", dim: false },
      { text: "85°", dim: true },
      { text: "██", dim: false },
    ]);
  });

  test("unmarked rows stay one accent run", () => {
    expect(segmentRow("████", [])).toEqual([{ text: "████", dim: false }]);
  });
});

describe("layout floors", () => {
  test("narrow series width drops the chart to the short row count", () => {
    expect(MIN_WIDE_AREA_SERIES_WIDTH).toBeGreaterThan(TEMP_AREA_ROWS_NARROW);
    expect(TEMP_AREA_ROWS_NARROW).toBeLessThan(TEMP_AREA_ROWS_WIDE);
  });
});

describe("hourlyDetailRow", () => {
  function basePoints(): HourlyPoint[] {
    const pts = hourlyPoints(3);
    return [
      withOverrides(pts[0] as HourlyPoint, { uvIndex: 2.3, humidityPct: 60, visibilityM: 10000 }),
      withOverrides(pts[1] as HourlyPoint, { uvIndex: 5.7, humidityPct: 80, visibilityM: 5000 }),
      withOverrides(pts[2] as HourlyPoint, { uvIndex: 4, humidityPct: 70, visibilityM: 20000 }),
    ];
  }

  test("picks peak uv rounded", () => {
    const pts = basePoints();
    const row = hourlyDetailRow(pts, "metric", 80);
    expect(row).toContain("uv 6");
  });

  test("rh range with varying values uses en dash", () => {
    const pts = basePoints();
    const row = hourlyDetailRow(pts, "metric", 80);
    expect(row).toContain("rh 60–80%");
  });

  test("rh single value when min equals max", () => {
    const pts = hourlyPoints(2).map((p) =>
      withOverrides(p, { uvIndex: null, humidityPct: 55, visibilityM: null }),
    );
    expect(hourlyDetailRow(pts, "metric", 80)).toBe("     rh 55%");
  });

  test("worst visibility is minimum meters formatted via wind units", () => {
    const pts = basePoints();
    expect(hourlyDetailRow(pts, "metric", 80)).toContain("vis 5 km");
    expect(hourlyDetailRow(pts, "imperial", 80)).toContain("vis 3.1 mi");
  });

  test("all-null uv hides uv segment", () => {
    const pts = hourlyPoints(2).map((p) =>
      withOverrides(p, { uvIndex: null, humidityPct: 60, visibilityM: 8000 }),
    );
    const row = hourlyDetailRow(pts, "metric", 80);
    expect(row).not.toContain("uv");
    expect(row).toContain("rh");
    expect(row).toContain("vis");
  });

  test("all three null returns empty string", () => {
    const pts = hourlyPoints(2);
    expect(hourlyDetailRow(pts, "metric", 80)).toBe("");
    expect(hourlyDetailRow([], "metric", 80)).toBe("");
  });

  test("width truncation keeps row at most width - 1 columns", () => {
    const pts = basePoints();
    const width = 20;
    const row = hourlyDetailRow(pts, "metric", width);
    expect(displayWidth(row)).toBeLessThanOrEqual(width - 1);
    expect(row.endsWith("…")).toBe(true);
  });

  test("row is gutter-aligned and single-cell safe", () => {
    const pts = basePoints();
    const row = hourlyDetailRow(pts, "metric", 80);
    expect(row.startsWith("     ")).toBe(true);
    expect(row.includes("·")).toBe(true);
  });
});

describe("hourlyInspectRow", () => {
  const prefs = {
    temp: "imperial",
    wind: "imperial",
    precip: "imperial",
    pressure: "imperial",
    timeFormat: "12h",
  } as const;

  function point(): HourlyPoint {
    return withOverrides(hourlyPoints(1)[0] as HourlyPoint, {
      timeUtc: "2026-08-24T17:00:00.000Z",
      temperatureC: 20,
      apparentC: 18,
      precipMm: 1,
      precipProbabilityPct: 40,
      windSpeedKmh: 10,
      windDirectionDeg: 90,
    });
  }

  test("composes time, temp, feels, precip, and wind for the pointed hour", () => {
    const row = hourlyInspectRow(point(), -25200, prefs, 80);
    expect(row).toContain("10:00 AM");
    expect(row).toContain("68° feels 64°");
    expect(row).toContain("40%");
    expect(row).toContain("mph E");
  });

  test("width truncation keeps row at most width - 1 columns", () => {
    const width = 20;
    const row = hourlyInspectRow(point(), 0, prefs, width);
    expect(displayWidth(row)).toBeLessThanOrEqual(width - 1);
    expect(row.endsWith("…")).toBe(true);
  });

  test("returns empty string for non-positive width", () => {
    expect(hourlyInspectRow(point(), 0, prefs, 0)).toBe("");
  });
});

describe("nextInspectTimeUtc", () => {
  test("advances by delta from the current point", () => {
    const window = hourlyPoints(5);
    const next = nextInspectTimeUtc(window, window[1]?.timeUtc ?? null, 1);
    expect(next).toBe(window[2]?.timeUtc ?? null);
  });

  test("clamps at the last point when moving past the end", () => {
    const window = hourlyPoints(3);
    const next = nextInspectTimeUtc(window, window[2]?.timeUtc ?? null, 1);
    expect(next).toBe(window[2]?.timeUtc ?? null);
  });

  test("clamps at the first point when moving before the start", () => {
    const window = hourlyPoints(3);
    const next = nextInspectTimeUtc(window, window[0]?.timeUtc ?? null, -1);
    expect(next).toBe(window[0]?.timeUtc ?? null);
  });

  test("re-anchors from the window start when the current point aged out (hard rule 2: index by time, not position)", () => {
    const full = hourlyPoints(5);
    // Simulate the clock crossing an hour boundary: the point the user was
    // inspecting (full[0]) drops off the front of the window. A position-keyed
    // cursor would silently relabel whatever now sits at index 0; this must
    // instead re-anchor to a real point still present in the window.
    const shrunk = full.slice(1);
    const next = nextInspectTimeUtc(shrunk, full[0]?.timeUtc ?? null, 1);
    expect(shrunk.some((p) => p.timeUtc === next)).toBe(true);
  });

  test("returns null for an empty window", () => {
    expect(nextInspectTimeUtc([], null, 1)).toBeNull();
  });
});
