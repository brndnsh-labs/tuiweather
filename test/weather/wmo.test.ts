import { describe, expect, test } from "bun:test";
import {
  conditionGlyph,
  conditionLabel,
  WMO_TABLE,
  wmoToCondition,
} from "../../src/lib/providers/openmeteo/wmo";
import type { Condition } from "../../src/lib/weather/types";

const DOCUMENTED_CODES = [
  0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86,
  95, 96, 99,
];

const CONDITIONS: Condition[] = [
  "clear",
  "mostly-clear",
  "partly-cloudy",
  "overcast",
  "fog",
  "drizzle",
  "rain",
  "heavy-rain",
  "freezing-rain",
  "snow",
  "heavy-snow",
  "sleet",
  "thunderstorm",
  "hail",
];

describe("wmoToCondition", () => {
  test("maps every documented code to a defined condition", () => {
    for (const code of DOCUMENTED_CODES) {
      expect(CONDITIONS).toContain(wmoToCondition(code));
    }
  });

  test("covers exactly the documented codes and nothing else", () => {
    const tableCodes = Object.keys(WMO_TABLE)
      .map(Number)
      .sort((a, b) => a - b);
    expect(tableCodes).toEqual([...DOCUMENTED_CODES].sort((a, b) => a - b));
  });

  test("maps representative codes correctly", () => {
    expect(wmoToCondition(0)).toBe("clear");
    expect(wmoToCondition(2)).toBe("partly-cloudy");
    expect(wmoToCondition(45)).toBe("fog");
    expect(wmoToCondition(57)).toBe("freezing-rain");
    expect(wmoToCondition(65)).toBe("heavy-rain");
    expect(wmoToCondition(75)).toBe("heavy-snow");
    expect(wmoToCondition(82)).toBe("heavy-rain");
    expect(wmoToCondition(95)).toBe("thunderstorm");
    expect(wmoToCondition(99)).toBe("hail");
  });

  test("falls back to a defined condition for undocumented codes", () => {
    expect(CONDITIONS).toContain(wmoToCondition(1234));
    expect(CONDITIONS).toContain(wmoToCondition(-1));
  });
});

describe("condition glyphs and labels", () => {
  test("every condition has a single-code-point glyph without variation selectors", () => {
    for (const condition of CONDITIONS) {
      const glyph = conditionGlyph(condition);
      expect(glyph.length).toBeGreaterThan(0);
      expect([...glyph].length).toBe(1);
      expect(glyph.includes("\uFE0F")).toBe(false);
      expect(glyph.includes("\u200D")).toBe(false);
    }
  });

  test("every condition has a human-readable label", () => {
    for (const condition of CONDITIONS) {
      const label = conditionLabel(condition);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(condition);
    }
  });

  test("uses the documented safe glyph set", () => {
    const safeSet = new Set(["☀", "🌤", "☁", "🌫", "🌦", "🌧", "❄", "🌨", "⛈"]);
    for (const condition of CONDITIONS) {
      expect(safeSet.has(conditionGlyph(condition))).toBe(true);
    }
  });
});
