import { describe, expect, test } from "bun:test";
import { aqiCategory } from "../../src/lib/weather/format";

describe("aqiCategory", () => {
  test("threshold bands are inclusive", () => {
    expect(aqiCategory(0)).toBe("good");
    expect(aqiCategory(29)).toBe("good");
    expect(aqiCategory(50)).toBe("good");
    expect(aqiCategory(51)).toBe("moderate");
    expect(aqiCategory(75)).toBe("moderate");
    expect(aqiCategory(100)).toBe("moderate");
    expect(aqiCategory(101)).toBe("usg");
    expect(aqiCategory(150)).toBe("usg");
    expect(aqiCategory(151)).toBe("unhealthy");
    expect(aqiCategory(200)).toBe("unhealthy");
    expect(aqiCategory(201)).toBe("very-unhealthy");
    expect(aqiCategory(300)).toBe("very-unhealthy");
    expect(aqiCategory(301)).toBe("hazardous");
    expect(aqiCategory(500)).toBe("hazardous");
  });
});
