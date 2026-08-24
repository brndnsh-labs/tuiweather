import { describe, expect, test } from "bun:test";
import { SPARKLINE_RAMP, sparklineChars } from "../../src/components/Sparkline";

describe("sparklineChars", () => {
  test("two-point series maps min/max onto the ramp ends", () => {
    expect(sparklineChars([0, 10])).toBe("▁█");
    expect(sparklineChars([10, 0])).toBe("█▁");
  });

  test("mid values land on intermediate ramp steps", () => {
    expect(SPARKLINE_RAMP).toHaveLength(8);
    expect(sparklineChars([0, 4, 10])).toBe("▁▄█");
  });

  test("flat series renders mid blocks", () => {
    expect(sparklineChars([5, 5, 5])).toBe("▄▄▄");
    expect(sparklineChars([42])).toBe("▄");
  });

  test("empty input is null-safe", () => {
    expect(sparklineChars([])).toBe("–");
  });

  test("resamples down to the requested width via bucket averaging", () => {
    expect(sparklineChars([0, 2, 4, 6, 8, 10], 3)).toBe("▁▅█");
    expect(sparklineChars([0, 10], 1)).toHaveLength(1);
  });

  test("upsamples when width exceeds the series length", () => {
    expect(sparklineChars([0, 10], 4)).toBe("▁▁██");
  });

  test("defaults width to the number of values", () => {
    const out = sparklineChars([3, 1, 4, 1, 5, 9, 2, 6]);
    expect(out).toHaveLength(8);
    for (const ch of out) {
      expect(SPARKLINE_RAMP.includes(ch as (typeof SPARKLINE_RAMP)[number])).toBe(true);
    }
  });
});
