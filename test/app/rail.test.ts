import { describe, expect, test } from "bun:test";
import {
  buildNowSection,
  buildTodayBlock,
  nowSectionRows,
  railFit,
  relativeTicks,
  SIDEBAR_CONTENT_WIDTH,
  todayBlockRows,
  visibleLocationRows,
} from "../../src/app/components/Sidebar";
import { resolveDisplayPrefs, tuiConfigSchema } from "../../src/lib/config/schema";
import { normalizeForecast } from "../../src/lib/providers/openmeteo/normalize";
import { forecastResponseSchema } from "../../src/lib/providers/openmeteo/schemas";
import { displayWidth } from "../../src/lib/weather/format";
import type { NormalizedForecast, PrecipInterval } from "../../src/lib/weather/types";
import portlandFixture from "../fixtures/openmeteo/portland.json";

const NOW = "2026-09-02T12:45:00.000Z";

function fixtureForecast(): NormalizedForecast {
  return normalizeForecast(forecastResponseSchema.parse(portlandFixture));
}

const PREFS = resolveDisplayPrefs(
  tuiConfigSchema.parse({ schema_version: 4, time_format: "12h", units: "imperial" }),
);

/** 15-minute buckets labeled by their END instant, starting at `startMs`. */
function buckets(startMs: number, mms: number[]): PrecipInterval[] {
  return mms.map((precipMm, i) => ({
    startUtc: new Date(startMs + i * 900_000).toISOString(),
    endUtc: new Date(startMs + (i + 1) * 900_000).toISOString(),
    precipMm,
    probabilityPct: null,
  }));
}

describe("relativeTicks", () => {
  test("labels every fourth column, starting at now", () => {
    expect(relativeTicks(12)).toBe("now +1h +2h ");
  });

  test("drops a label that would overflow the strip", () => {
    // 10 columns fits "now" at 0 and "+1h" at 4, but "+2h" at 8 would need 11.
    expect(relativeTicks(10)).toBe("now +1h   ");
  });

  test("writes per character, so every label lands on its own column", () => {
    const row = relativeTicks(9);
    expect(row).not.toBeNull();
    expect(displayWidth(row ?? "")).toBe(9);
    expect(row?.slice(4, 7)).toBe("+1h");
  });

  test("null for a strip with no room", () => {
    expect(relativeTicks(0)).toBeNull();
    expect(relativeTicks(2)).toBeNull();
  });
});

describe("buildNowSection", () => {
  test("returns null when the provider has no minute feed — never a false Dry", () => {
    const forecast = { ...fixtureForecast(), hasMinutePrecip: false };
    expect(buildNowSection(forecast, NOW, SIDEBAR_CONTENT_WIDTH)).toBeNull();
  });

  test("a genuine dry reading keeps the line but drops the flat strip", () => {
    const section = buildNowSection(fixtureForecast(), NOW, SIDEBAR_CONTENT_WIDTH);
    expect(section).not.toBeNull();
    expect(section?.line).toBe("Dry");
    expect(section?.strip).toBeNull();
    expect(section?.ticks).toBeNull();
    expect(section?.tone).toBe("dim");
  });

  test("rain starting renders a strip, ticks, and the warn tone", () => {
    const base = fixtureForecast();
    const nowMs = Date.parse(NOW);
    const forecast: NormalizedForecast = {
      ...base,
      minutely15: buckets(nowMs - 900_000, [0, 0, 0, 0.6, 0.6, 0.6, 0, 0, 0, 0, 0, 0]),
    };
    const section = buildNowSection(forecast, NOW, SIDEBAR_CONTENT_WIDTH);
    expect(section?.tone).toBe("warn");
    expect(section?.line).toContain("starting in");
    expect(section?.strip).not.toBeNull();
    expect(section?.ticks).not.toBeNull();
    expect(displayWidth(section?.strip ?? "")).toBe(displayWidth(section?.ticks ?? ""));
  });

  test("the strip never exceeds the rail's content width", () => {
    const base = fixtureForecast();
    const nowMs = Date.parse(NOW);
    const forecast: NormalizedForecast = {
      ...base,
      minutely15: buckets(nowMs - 900_000, new Array(60).fill(0.6)),
    };
    const section = buildNowSection(forecast, NOW, SIDEBAR_CONTENT_WIDTH);
    expect(displayWidth(section?.strip ?? "")).toBeLessThanOrEqual(SIDEBAR_CONTENT_WIDTH);
  });
});

describe("buildTodayBlock", () => {
  test("fills every row from the fixture's first daily point", () => {
    const block = buildTodayBlock(
      fixtureForecast(),
      PREFS,
      { usAqi: 22, observedAtUtc: NOW },
      SIDEBAR_CONTENT_WIDTH,
      NOW,
    );
    expect(block?.loLabel).toBe("53°");
    expect(block?.hiLabel).toBe("64°");
    expect(block?.precip).toBe("☂ 92% · 0.66 in");
    expect(block?.sun).toBe("↑ 6:33 AM  ↓ 7:46 PM");
    expect(block?.air).toBe("aqi 22 good");
  });

  test("the range row's parts total exactly the content width", () => {
    const block = buildTodayBlock(fixtureForecast(), PREFS, null, SIDEBAR_CONTENT_WIDTH, NOW);
    const total =
      displayWidth(block?.loLabel ?? "") +
      1 +
      (block?.barWidth ?? 0) +
      1 +
      displayWidth(block?.hiLabel ?? "");
    expect(total).toBe(SIDEBAR_CONTENT_WIDTH);
  });

  test("omits the air row when neither UV nor AQI is present", () => {
    const block = buildTodayBlock(fixtureForecast(), PREFS, null, SIDEBAR_CONTENT_WIDTH, NOW);
    expect(block?.air).toBeNull();
  });

  test("null when the forecast carries no daily points", () => {
    const forecast = { ...fixtureForecast(), daily: [] };
    expect(buildTodayBlock(forecast, PREFS, null, SIDEBAR_CONTENT_WIDTH, NOW)).toBeNull();
  });

  test("every row stays inside the content width", () => {
    const block = buildTodayBlock(
      fixtureForecast(),
      PREFS,
      { usAqi: 155, observedAtUtc: NOW },
      SIDEBAR_CONTENT_WIDTH,
      NOW,
    );
    for (const row of [block?.precip, block?.sun, block?.air]) {
      if (row != null) expect(displayWidth(row)).toBeLessThanOrEqual(SIDEBAR_CONTENT_WIDTH);
    }
  });

  test("resolves today by local date, not daily[0], across midnight", () => {
    const base = fixtureForecast();
    const first = base.daily[0];
    expect(first).toBeDefined();
    if (first === undefined) throw new Error("fixture needs a daily point");
    const stale = { ...first, dateLocal: "2026-09-01", tempMinC: -40, tempMaxC: -40 };
    const forecast = { ...base, daily: [stale, ...base.daily] };
    const block = buildTodayBlock(forecast, PREFS, null, SIDEBAR_CONTENT_WIDTH, NOW);
    expect(block?.loLabel).toBe("53°");
    expect(block?.hiLabel).toBe("64°");
  });

  test("falls back to daily[0] when no entry matches today", () => {
    const base = fixtureForecast();
    const forecast = {
      ...base,
      daily: base.daily.filter((day) => day.dateLocal !== "2026-09-02"),
    };
    const block = buildTodayBlock(forecast, PREFS, null, SIDEBAR_CONTENT_WIDTH, NOW);
    expect(block?.loLabel).toBe("53°");
    expect(block?.hiLabel).toBe("62°");
  });
});

describe("railFit", () => {
  test("both sections fit a tall rail", () => {
    expect(railFit(38, 1, 2, 5)).toEqual({ now: true, today: true });
  });

  test("sheds today first when rows run short", () => {
    expect(railFit(6, 1, 2, 5)).toEqual({ now: true, today: false });
  });

  test("sheds the nowcast too rather than half-drawing it", () => {
    expect(railFit(2, 1, 2, 5)).toEqual({ now: false, today: false });
  });

  test("a long location list wins over both sections", () => {
    expect(railFit(10, 9, 2, 5)).toEqual({ now: false, today: false });
  });

  test("a section absent upstream is never reported as fitting", () => {
    expect(railFit(38, 1, 0, 0)).toEqual({ now: false, today: false });
  });
});

describe("visibleLocationRows", () => {
  const slugs = Array.from({ length: 30 }, (_, i) => `loc-${i}`);

  test("a list that fits renders in full, unclamped", () => {
    expect(visibleLocationRows(slugs.slice(0, 5), "loc-0", 24)).toEqual({
      visible: slugs.slice(0, 5),
      hiddenCount: 0,
    });
  });

  test("clamps to available rows, reserving one for the overflow row", () => {
    const { visible, hiddenCount } = visibleLocationRows(slugs, "loc-0", 24);
    expect(visible).toHaveLength(23);
    expect(visible).toEqual(slugs.slice(0, 23));
    expect(hiddenCount).toBe(7);
  });

  test("slides the window so the active slug is never scrolled out", () => {
    const { visible, hiddenCount } = visibleLocationRows(slugs, "loc-29", 24);
    expect(visible).toContain("loc-29");
    expect(visible).toHaveLength(23);
    expect(hiddenCount).toBe(7);
    // The window slides forward just enough to include the active slug.
    expect(visible[visible.length - 1]).toBe("loc-29");
  });

  test("an active slug outside the configured list doesn't crash the window", () => {
    const { visible, hiddenCount } = visibleLocationRows(slugs, "not-configured", 24);
    expect(visible).toHaveLength(23);
    expect(hiddenCount).toBe(7);
  });

  test("zero available rows hides every location", () => {
    expect(visibleLocationRows(slugs, "loc-0", 0)).toEqual({ visible: [], hiddenCount: 30 });
  });

  test("the anchor is caller-supplied — Sidebar passes focus when set, else the active slug", () => {
    // visibleLocationRows itself just windows on whichever slug it's given;
    // Sidebar.tsx picks `focusedSlug ?? activeSlug` so j/k navigation can
    // scroll the window instead of moving focus somewhere invisible (#195).
    const anchoredOnActive = visibleLocationRows(slugs, "loc-0", 24);
    const anchoredOnFocus = visibleLocationRows(slugs, "loc-29", 24);
    expect(anchoredOnActive.visible).not.toContain("loc-29");
    expect(anchoredOnFocus.visible).toContain("loc-29");
  });
});

describe("section row accounting", () => {
  test("counts the rule row plus each rendered row", () => {
    expect(nowSectionRows(null)).toBe(0);
    expect(nowSectionRows({ line: "Dry", strip: null, ticks: null, tone: "dim" })).toBe(2);
    expect(nowSectionRows({ line: "Rain", strip: "▃▃", ticks: "now", tone: "warn" })).toBe(4);
    expect(todayBlockRows(null)).toBe(0);
  });

  test("today's row count tracks which optional rows survived", () => {
    const full = buildTodayBlock(
      fixtureForecast(),
      PREFS,
      { usAqi: 22, observedAtUtc: NOW },
      SIDEBAR_CONTENT_WIDTH,
      NOW,
    );
    expect(todayBlockRows(full)).toBe(5);
    const noAir = buildTodayBlock(fixtureForecast(), PREFS, null, SIDEBAR_CONTENT_WIDTH, NOW);
    expect(todayBlockRows(noAir)).toBe(4);
  });
});
