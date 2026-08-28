import { describe, expect, test } from "bun:test";
import {
  buildPalette,
  contrastRatio,
  DARK_INK,
  DAY_ACCENTS,
  ensureContrast,
  isDarkBackground,
  LIGHT_INK,
  NIGHT_ACCENTS,
  relativeLuminance,
} from "../../src/theme/palette";

describe("color math", () => {
  test("relativeLuminance matches WCAG reference values", () => {
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#808080")).toBeCloseTo(0.2159, 3);
    expect(relativeLuminance("#ff0000")).toBeCloseTo(0.2126, 4);
    expect(relativeLuminance("not-a-color")).toBeNull();
  });

  test("contrastRatio returns 21 for black on white and is symmetric", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
  });

  test("isDarkBackground classifies luminance at the midpoint and fails safe", () => {
    expect(isDarkBackground("#16161e")).toBe(true);
    expect(isDarkBackground("#f4f6fb")).toBe(false);
    expect(isDarkBackground(null)).toBe(true);
    expect(isDarkBackground("garbage")).toBe(true);
  });

  test("ensureContrast leaves passing colors untouched and repairs failing ones", () => {
    expect(ensureContrast("#c0caf5", "#16161e", 4.5)).toBe("#c0caf5");
    const fixed = ensureContrast("#565f89", "#16161e", 4.5);
    expect(contrastRatio(fixed, "#16161e")).toBeGreaterThanOrEqual(4.5);
    const fixedLight = ensureContrast("#8990b3", "#ffffff", 4.5);
    expect(contrastRatio(fixedLight, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("buildPalette ink/sky split", () => {
  test("ink follows the terminal, accents follow the sun", () => {
    const nightTerminalDaytime = buildPalette("auto", true, "dark", null);
    expect(nightTerminalDaytime.fg).toBe(DARK_INK.fg);
    expect(nightTerminalDaytime.surface).toBe(DARK_INK.surface);
    expect(nightTerminalDaytime.accent).toBe(DAY_ACCENTS.accent);

    const dayTerminalNighttime = buildPalette("auto", false, "light", null);
    expect(dayTerminalNighttime.fg).toBe(LIGHT_INK.fg);
    expect(dayTerminalNighttime.accent).toBe(NIGHT_ACCENTS.accent);
  });

  test("explicit theme still pins accents only", () => {
    const p = buildPalette("night", true, "dark", null);
    expect(p.accent).toBe(NIGHT_ACCENTS.accent);
    expect(p.fg).toBe(DARK_INK.fg);
  });

  test("fg and fgDim meet the 4.5:1 floor against both stock surfaces", () => {
    for (const ink of ["dark", "light"] as const) {
      const base = ink === "dark" ? DARK_INK : LIGHT_INK;
      const p = buildPalette("auto", true, ink, null);
      expect(contrastRatio(p.fg, base.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(p.fgDim, base.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("off-midpoint terminal backgrounds get a repaired fgDim", () => {
    const muddy = "#5c6370";
    const p = buildPalette("auto", true, "dark", muddy);
    expect(contrastRatio(p.fg, muddy)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.fgDim, muddy)).toBeGreaterThanOrEqual(4.5);
  });
});
