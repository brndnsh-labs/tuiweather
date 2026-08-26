import { describe, expect, test } from "bun:test";
import {
  buildDaylightRow,
  buildDaylightSegments,
  type DaylightBarProps,
  daylightProgress,
} from "../../src/components/DaylightBar";

const SUNRISE = "2026-08-25T06:22:00Z";
const SUNSET = "2026-08-25T20:03:00Z";
const MIDDAY = "2026-08-25T13:12:30Z";
const PRE_DAWN = "2026-08-25T04:00:00Z";
const LATE_NIGHT = "2026-08-25T23:30:00Z";

function props(overrides: Partial<DaylightBarProps> = {}): DaylightBarProps {
  return {
    sunriseUtc: SUNRISE,
    sunsetUtc: SUNSET,
    nowUtc: MIDDAY,
    utcOffsetSeconds: 0,
    width: 40,
    timeFormat: "12h",
    ...overrides,
  };
}

describe("daylightProgress", () => {
  test("midday maps to halfway through the day", () => {
    const state = daylightProgress(Date.parse(MIDDAY), Date.parse(SUNRISE), Date.parse(SUNSET));
    expect(state).toEqual({ progress: 0.5, isNight: false });
  });

  test("clamps before sunrise and after sunset with night flagged", () => {
    expect(daylightProgress(Date.parse(PRE_DAWN), Date.parse(SUNRISE), Date.parse(SUNSET))).toEqual(
      {
        progress: 0,
        isNight: true,
      },
    );
    expect(
      daylightProgress(Date.parse(LATE_NIGHT), Date.parse(SUNRISE), Date.parse(SUNSET)),
    ).toEqual({ progress: 1, isNight: true });
  });

  test("the sunrise and sunset instants themselves count as day", () => {
    expect(daylightProgress(Date.parse(SUNRISE), Date.parse(SUNRISE), Date.parse(SUNSET))).toEqual({
      progress: 0,
      isNight: false,
    });
    expect(daylightProgress(Date.parse(SUNSET), Date.parse(SUNRISE), Date.parse(SUNSET))).toEqual({
      progress: 1,
      isNight: false,
    });
  });

  test("degenerate sunset <= sunrise yields null", () => {
    expect(
      daylightProgress(Date.parse(MIDDAY), Date.parse(SUNSET), Date.parse(SUNRISE)),
    ).toBeNull();
    expect(
      daylightProgress(Date.parse(MIDDAY), Date.parse(SUNRISE), Date.parse(SUNRISE)),
    ).toBeNull();
  });

  test("non-finite inputs yield null", () => {
    expect(daylightProgress(Number.NaN, 0, 1)).toBeNull();
    expect(daylightProgress(0, Number.NaN, 1)).toBeNull();
    expect(daylightProgress(0, 1, Number.NaN)).toBeNull();
  });
});

describe("buildDaylightSegments", () => {
  test("emits dim / accent / dim runs for a daytime row", () => {
    const segments = buildDaylightSegments(props());
    expect(segments?.map((segment) => segment.kind)).toEqual(["dim", "accent", "dim"]);
    expect(segments?.[1]?.text).toBe("●");
  });

  test("night rows use the hollow dim marker", () => {
    const before = buildDaylightSegments(props({ nowUtc: PRE_DAWN }));
    expect(before?.map((segment) => segment.kind)).toEqual(["dim", "dim", "dim"]);
    expect(before?.[1]).toEqual({ text: "○", kind: "dim" });

    const after = buildDaylightSegments(props({ nowUtc: LATE_NIGHT }));
    expect(after?.[1]).toEqual({ text: "○", kind: "dim" });
  });
});

describe("buildDaylightRow", () => {
  test("renders labeled 12h track consuming the full budget", () => {
    expect(buildDaylightRow(props({ width: 40 }))).toBe(
      `↑ 6:22 AM ${"─".repeat(9)}●${"─".repeat(9)} ↓ 8:03 PM`,
    );
  });

  test("renders labeled 24h track consuming the full budget", () => {
    expect(buildDaylightRow(props({ width: 40, timeFormat: "24h" }))).toBe(
      `↑ 06:22 ${"─".repeat(11)}●${"─".repeat(11)} ↓ 20:03`,
    );
  });

  test("marker rounding is deterministic and half-up", () => {
    expect(buildDaylightRow(props({ width: 41 }))).toBe(
      `↑ 6:22 AM ${"─".repeat(10)}●${"─".repeat(9)} ↓ 8:03 PM`,
    );
  });

  test("applies utcOffsetSeconds via formatClock, never device-local time", () => {
    const row = buildDaylightRow(props({ utcOffsetSeconds: -25200, width: 44 }));
    expect(row?.startsWith("↑ 11:22 PM ")).toBe(true);
    expect(row?.endsWith("↓ 1:03 PM")).toBe(true);
  });

  test("before sunrise pins the hollow marker to the left end", () => {
    expect(buildDaylightRow(props({ nowUtc: PRE_DAWN }))).toBe(
      `↑ 6:22 AM ○${"─".repeat(18)} ↓ 8:03 PM`,
    );
  });

  test("after sunset pins the hollow marker to the right end", () => {
    expect(buildDaylightRow(props({ nowUtc: LATE_NIGHT }))).toBe(
      `↑ 6:22 AM ${"─".repeat(18)}○ ↓ 8:03 PM`,
    );
  });

  test("missing sunrise or sunset renders nothing", () => {
    expect(buildDaylightRow(props({ sunriseUtc: null }))).toBeNull();
    expect(buildDaylightRow(props({ sunsetUtc: null }))).toBeNull();
  });

  test("sunset <= sunrise renders nothing", () => {
    expect(buildDaylightRow(props({ sunriseUtc: SUNSET, sunsetUtc: SUNRISE }))).toBeNull();
    expect(buildDaylightRow(props({ sunsetUtc: SUNRISE }))).toBeNull();
  });

  test("narrow widths drop labels first, keeping an arrowed track", () => {
    const row = buildDaylightRow(props({ width: 20 }));
    expect(row).toBe(`↑ ${"─".repeat(7)}●${"─".repeat(7)} ↓`);
    expect(/\d/.test(row ?? "")).toBe(false);
  });

  test("minimum width still fits an unlabeled track", () => {
    expect(buildDaylightRow(props({ width: 12 }))).toBe(`↑ ───●─── ↓`);
  });

  test("below the floor it renders nothing", () => {
    expect(buildDaylightRow(props({ width: 11 }))).toBeNull();
    expect(buildDaylightRow(props({ width: 0 }))).toBeNull();
  });

  test("every emitted row stays within width-1 and carries exactly one marker", () => {
    for (let width = 12; width <= 96; width++) {
      for (const timeFormat of ["12h", "24h"] as const) {
        for (const now of [MIDDAY, PRE_DAWN, LATE_NIGHT]) {
          const row = buildDaylightRow(props({ width, timeFormat, nowUtc: now }));
          if (typeof row !== "string") continue;
          expect(row.length).toBe(width - 1);
          expect(row.startsWith("↑")).toBe(true);
          expect(row.includes("↓")).toBe(true);
          const markers = [...row].filter((char) => char === "●" || char === "○").length;
          expect(markers).toBe(1);
        }
      }
    }
  });
});
