import { describe, expect, test } from "bun:test";
import { lerpHex, rangeBarSpan } from "../../src/components/RangeBar";

describe("rangeBarSpan", () => {
  test("full span covers the whole track", () => {
    expect(rangeBarSpan(0, 100, 0, 100, 10)).toEqual({ start: 0, end: 10 });
  });

  test("partial span positions proportionally inside the track", () => {
    expect(rangeBarSpan(25, 75, 0, 100, 10)).toEqual({ start: 3, end: 8 });
    expect(rangeBarSpan(50, 60, 0, 100, 10)).toEqual({ start: 5, end: 6 });
  });

  test("clamps values outside the week bounds", () => {
    expect(rangeBarSpan(-50, 200, 0, 100, 10)).toEqual({ start: 0, end: 10 });
    expect(rangeBarSpan(-20, 40, 0, 100, 10)).toEqual({ start: 0, end: 4 });
  });

  test("degenerate weekMin == weekMax spans the full width without crashing", () => {
    expect(rangeBarSpan(5, 9, 7, 7, 10)).toEqual({ start: 0, end: 10 });
    expect(rangeBarSpan(7, 7, 7, 7, 4)).toEqual({ start: 0, end: 4 });
  });

  test("swaps inverted lo/hi inputs", () => {
    expect(rangeBarSpan(80, 20, 0, 100, 10)).toEqual({ start: 2, end: 8 });
  });

  test("keeps at least one filled cell for edge-anchored zero-width ranges", () => {
    expect(rangeBarSpan(100, 100, 0, 100, 10)).toEqual({ start: 10, end: 10 });
    expect(rangeBarSpan(30, 30, 0, 100, 10)).toEqual({ start: 3, end: 4 });
  });

  test("non-finite inputs fall back to a full span", () => {
    expect(rangeBarSpan(Number.NaN, 5, 0, 100, 8)).toEqual({ start: 0, end: 8 });
  });
});

describe("lerpHex", () => {
  test("returns endpoints at t=0 and t=1", () => {
    expect(lerpHex("#000000", "#ffffff", 0)).toBe("#000000");
    expect(lerpHex("#000000", "#ffffff", 1)).toBe("#ffffff");
  });

  test("interpolates channels at the midpoint", () => {
    expect(lerpHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  test("clamps out-of-range t", () => {
    expect(lerpHex("#102030", "#304050", -3)).toBe("#102030");
    expect(lerpHex("#102030", "#304050", 9)).toBe("#304050");
  });
});
