import { describe, expect, test } from "bun:test";
import { deleteArmLine } from "../../src/app/components/StatusArea";
import { displayWidth } from "../../src/lib/weather/format";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("deleteArmLine", () => {
  test("leaves an ASCII label that fits the budget untouched", () => {
    const line = deleteArmLine("Portland", 40);
    expect(line).toBe("press d again to delete Portland");
    expect(displayWidth(line)).toBeLessThanOrEqual(39);
  });

  test("truncates by cells even when the code-unit count is under budget", () => {
    const line = deleteArmLine("Portland", 32);
    expect(line.endsWith("…")).toBe(true);
    expect(displayWidth(line)).toBeLessThanOrEqual(31);
  });

  test("stays inside the width budget for a CJK/emoji label", () => {
    const line = deleteArmLine("東京Tokyo・City🌆", 32);
    expect(displayWidth(line)).toBeLessThanOrEqual(31);
  });

  test("stays inside the width budget when most of the room is wide glyphs", () => {
    const line = deleteArmLine("☔".repeat(30), 32);
    expect(displayWidth(line)).toBeLessThanOrEqual(31);
  });

  test("truncating with an ellipsis never splits a surrogate pair", () => {
    for (const label of ["🏙️".repeat(30), "東京🌆".repeat(10), "☔".repeat(30)]) {
      const line = deleteArmLine(label, 32);
      expect(LONE_SURROGATE.test(line)).toBe(false);
    }
  });

  test("an undefined width leaves the full line untouched", () => {
    expect(deleteArmLine("東京Tokyo・City🌆", undefined)).toBe(
      "press d again to delete 東京Tokyo・City🌆",
    );
  });
});
