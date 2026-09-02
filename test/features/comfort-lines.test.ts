import { describe, expect, test } from "bun:test";
import { buildGoOutLine, buildHeadsUpLine } from "../../src/features/comfort/ComfortLines";
import { resolveDisplayPrefs, tuiConfigSchema } from "../../src/lib/config/schema";
import type { ComfortWindow } from "../../src/lib/weather/derive";

const IMPERIAL = resolveDisplayPrefs(
  tuiConfigSchema.parse({ schema_version: 4, time_format: "12h", units: "imperial" }),
);
const METRIC = resolveDisplayPrefs(
  tuiConfigSchema.parse({ schema_version: 4, time_format: "12h", units: "metric" }),
);

function window(overrides: Partial<ComfortWindow> = {}): ComfortWindow {
  return {
    startUtc: "2026-08-24T14:00:00Z",
    endUtc: "2026-08-24T17:00:00Z",
    meanScore: 1,
    temperatureC: 21.7,
    windSpeedKmh: 12,
    windGustKmh: null,
    uvIndex: 3,
    precipMm: 0,
    ...overrides,
  };
}

describe("buildGoOutLine", () => {
  test("renders the range, dryness, temp, wind, and uv fields", () => {
    const line = buildGoOutLine(window(), 0, IMPERIAL, 80);
    expect(line).toBe("go out    2–5 PM · dry · 71° · light wind · uv 3");
  });

  test("omits the uv clause when the window has no reading", () => {
    const line = buildGoOutLine(window({ uvIndex: null }), 0, IMPERIAL, 80);
    expect(line).not.toContain("uv");
  });

  test("truncates cleanly at a narrow width instead of wrapping", () => {
    const line = buildGoOutLine(window(), 0, IMPERIAL, 20);
    expect(line.length).toBeLessThanOrEqual(20);
  });

  test("a window spanning a full day or more reads 'all day', not a same-hour range", () => {
    const allDay = window({
      startUtc: "2026-08-24T14:00:00Z",
      endUtc: "2026-08-25T14:00:00Z",
    });
    const line = buildGoOutLine(allDay, 0, IMPERIAL, 80);
    expect(line).toContain("all day");
    expect(line).not.toContain("2–2");
  });
});

describe("buildHeadsUpLine", () => {
  test("a wet window renders the rain intensity and a metric-or-imperial rate", () => {
    const heavy = window({ precipMm: 10.16, windGustKmh: 34 });
    expect(buildHeadsUpLine(heavy, 0, IMPERIAL, 80)).toBe(
      "heads up  2–5 PM · heavy rain · 0.40 in/h",
    );
    expect(buildHeadsUpLine(heavy, 0, METRIC, 80)).toBe(
      "heads up  2–5 PM · heavy rain · 10.2 mm/h",
    );
  });

  test("a dry, gusty window describes a wind hazard, not a rain one", () => {
    const line = buildHeadsUpLine(window({ precipMm: 0, windGustKmh: 55 }), 0, IMPERIAL, 80);
    expect(line).toContain("high wind");
    expect(line).not.toContain("rain");
    expect(line).toContain("gusts");
  });

  test("a merely-gusty-not-hazardous window omits the gusts clause", () => {
    const line = buildHeadsUpLine(window({ precipMm: 2, windGustKmh: 20 }), 0, IMPERIAL, 80);
    expect(line).not.toContain("gusts");
  });
});
