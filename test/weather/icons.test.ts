import { describe, expect, test } from "bun:test";
import {
  CONDITION_ICON_CELLS,
  conditionGlyph,
  conditionIcon,
} from "../../src/lib/weather/condition-display";
import { displayWidth, truncateCells } from "../../src/lib/weather/format";
import type { Condition } from "../../src/lib/weather/types";

const ALL_CONDITIONS: Condition[] = [
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

describe("conditionIcon", () => {
  test("every condition has a forced-emoji icon occupying exactly two cells", () => {
    for (const condition of ALL_CONDITIONS) {
      const icon = conditionIcon(condition);
      expect(icon).toContain("\uFE0F");
      expect(displayWidth(icon)).toBe(CONDITION_ICON_CELLS);
    }
  });

  test("icons are pairwise distinct per condition family", () => {
    const distinct = new Set(ALL_CONDITIONS.map(conditionIcon));
    expect(distinct.size).toBe(ALL_CONDITIONS.length);
  });

  test("conditionGlyph stays single-cell for scripted output", () => {
    for (const condition of ALL_CONDITIONS) {
      expect(displayWidth(conditionGlyph(condition))).toBe(1);
      expect(conditionGlyph(condition)).not.toContain("\uFE0F");
    }
  });
});

describe("displayWidth / truncateCells", () => {
  test("counts plain text one cell per char", () => {
    expect(displayWidth("plain 65°")).toBe(9);
  });

  test("counts emoji+VS16 as two cells and bare VS16 as one", () => {
    expect(displayWidth("x☁️z")).toBe(4);
    expect(displayWidth("☁️")).toBe(2);
    expect(displayWidth("\uFE0F")).toBe(1);
    expect(displayWidth("🌧️")).toBe(2);
  });

  test("truncateCells never splits a surrogate pair and budgets cells not units", () => {
    const text = `x☁️z ${conditionIcon("rain")} tail`;
    const cut = truncateCells(text, 6);
    expect(displayWidth(cut)).toBeLessThanOrEqual(6);
    expect(cut.endsWith("…")).toBe(true);
    for (const char of Array.from(cut)) {
      expect(char).not.toBe("\uD83C");
    }
  });

  test("truncateCells passes through when already fitting", () => {
    expect(truncateCells("☀️ok", 4)).toBe("☀️ok");
    expect(truncateCells("plain", 5)).toBe("plain");
  });
});
