import { describe, expect, test } from "bun:test";
import {
  type BarSegment,
  FILL_GLYPH,
  GRADIENT_STEPS,
  lerpHex,
  PAD_GLYPH,
  rangeBarSegments,
  rangeBarSpan,
} from "../../src/components/RangeBar";

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

describe("rangeBarSegments", () => {
  const COLD = "#7dcfff";
  const WARM = "#ff9e64";
  const DIM = "#565f89";
  const MID_COLOR = lerpHex(
    COLD,
    WARM,
    Math.round((GRADIENT_STEPS - 1) / 2) / (GRADIENT_STEPS - 1),
  );

  function totalWidth(segments: BarSegment[]): number {
    return segments.reduce((n, segment) => n + segment.text.length, 0);
  }

  test("produces deterministic quantized segmentation on a fixture", () => {
    const segments = rangeBarSegments(25, 75, 0, 100, 10, COLD, WARM, DIM);
    expect(segments).toEqual([
      { text: "···", fg: DIM },
      { text: FILL_GLYPH, fg: lerpHex(COLD, WARM, 2 / 7) },
      { text: FILL_GLYPH, fg: lerpHex(COLD, WARM, 3 / 7) },
      { text: FILL_GLYPH.repeat(2), fg: lerpHex(COLD, WARM, 4 / 7) },
      { text: FILL_GLYPH, fg: lerpHex(COLD, WARM, 5 / 7) },
      { text: "··", fg: DIM },
    ]);
  });

  test("covers exactly the requested width for a matrix of inputs", () => {
    const fixtures: [number, number, number, number, number][] = [
      [25, 75, 0, 100, 10],
      [0, 100, 0, 100, 24],
      [-20, 40, 0, 100, 12],
      [80, 20, 0, 100, 9],
      [42, 42, 1, 99, 7],
      [Number.NaN, 5, 0, 100, 8],
    ];
    for (const [lo, hi, weekMin, weekMax, width] of fixtures) {
      const segments = rangeBarSegments(lo, hi, weekMin, weekMax, width, COLD, WARM, DIM);
      expect(totalWidth(segments)).toBe(width);
      const { start, end } = rangeBarSpan(lo, hi, weekMin, weekMax, width);
      const first = segments[0];
      const last = segments.at(-1);
      const leadingPad = first && first.fg === DIM ? first.text.length : 0;
      const trailingPad = last && last.fg === DIM ? last.text.length : 0;
      expect(leadingPad).toBe(start);
      expect(trailingPad).toBe(width - end);
    }
  });

  test("out-of-range padding uses dim mid-dots", () => {
    const segments = rangeBarSegments(25, 75, 0, 100, 10, COLD, WARM, DIM);
    const pads = segments.filter((segment) => segment.fg === DIM);
    expect(pads).toHaveLength(2);
    for (const pad of pads) {
      expect(pad.text.length).toBeGreaterThan(0);
      for (const char of pad.text) expect(char).toBe(PAD_GLYPH);
    }
  });

  test("gradient colors advance left-to-right across the week span", () => {
    const ramp = new Map<string, number>();
    for (let step = 0; step < GRADIENT_STEPS; step++) {
      ramp.set(lerpHex(COLD, WARM, step / (GRADIENT_STEPS - 1)), step);
    }
    const segments = rangeBarSegments(0, 100, 0, 100, 32, COLD, WARM, DIM);
    const steps = segments
      .filter((segment) => segment.fg !== DIM)
      .map((segment) => ramp.get(segment.fg));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]).toBeGreaterThanOrEqual(steps[i - 1] ?? Number.NaN);
    }
    expect(steps.at(-1)).toBe(GRADIENT_STEPS - 1);
  });

  test("quantizes to at most 8 distinct colors per bar", () => {
    const segments = rangeBarSegments(0, 100, 0, 100, 64, COLD, WARM, DIM);
    const fillColors = new Set(segments.filter((s) => s.fg !== DIM).map((s) => s.fg));
    expect(fillColors.size).toBeLessThanOrEqual(GRADIENT_STEPS);
    expect(segments.length).toBeLessThanOrEqual(GRADIENT_STEPS + 2);
  });

  test("degenerate hi == lo renders a single midpoint cell", () => {
    const segments = rangeBarSegments(50, 50, 0, 100, 10, COLD, WARM, DIM);
    expect(totalWidth(segments)).toBe(10);
    expect(segments).toEqual([
      { text: "·····", fg: DIM },
      { text: FILL_GLYPH, fg: MID_COLOR },
      { text: "····", fg: DIM },
    ]);
  });

  test("degenerate flat week renders one full-width midpoint chunk", () => {
    const segments = rangeBarSegments(5, 9, 7, 7, 4, COLD, WARM, DIM);
    expect(segments).toEqual([{ text: FILL_GLYPH.repeat(4), fg: MID_COLOR }]);
  });

  test("non-finite inputs stay well-formed hex without NaN leaking into fg", () => {
    const segments = rangeBarSegments(Number.NaN, 5, 0, 100, 8, COLD, WARM, DIM);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.text).toBe(FILL_GLYPH.repeat(8));
    expect(segments[0]?.fg).toMatch(/^#[0-9a-f]{6}$/);
    expect(segments[0]?.fg).toBe(MID_COLOR);
  });

  test("tiny widths never crash and still cover one cell per column", () => {
    expect(rangeBarSegments(25, 75, 0, 100, 1, COLD, WARM, DIM)).toEqual([
      { text: FILL_GLYPH, fg: MID_COLOR },
    ]);
    const two = rangeBarSegments(25, 75, 0, 100, 2, COLD, WARM, DIM);
    expect(totalWidth(two)).toBe(2);
    expect(two[0]).toEqual({ text: PAD_GLYPH, fg: DIM });
    expect(two[1]).toEqual({ text: FILL_GLYPH, fg: MID_COLOR });
  });
});
