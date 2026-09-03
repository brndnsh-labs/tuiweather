import { describe, expect, test } from "bun:test";
import { rowLine } from "../../src/features/locations/LocationsOverlay";
import { displayWidth } from "../../src/lib/weather/format";

describe("rowLine", () => {
  test("keeps a one-cell spare below the width for long labels", () => {
    const line = rowLine(
      "1",
      "▸",
      false,
      "A very long location label that must truncate",
      " 22°",
      30,
    );
    expect(displayWidth(line)).toBeLessThanOrEqual(29);
  });

  test("keeps the spare for wide glyphs and emoji tails", () => {
    const line = rowLine("2", "●", true, "東京Honolulu東京Honolulu東京", " ⛅️ 22°", 30);
    expect(displayWidth(line)).toBeLessThanOrEqual(29);
  });

  test("an exact-fill label leaves the spare instead of filling the row", () => {
    // prefix "1▸  " (4) + tail " 22°" (4) = 8; a 22-wide label fills 30 exactly.
    const line = rowLine("1", "▸", false, "x".repeat(22), " 22°", 30);
    expect(displayWidth(line)).toBeLessThanOrEqual(29);
  });

  test("short labels still render prefix, label, and tail intact", () => {
    const line = rowLine("1", "○", false, "Portland", " 72°", 30);
    expect(line).toContain("Portland");
    expect(line).toContain("72°");
    expect(displayWidth(line)).toBeLessThanOrEqual(29);
  });
});
