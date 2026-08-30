import { describe, expect, test } from "bun:test";
import { testRender } from "@opentui/react/test-utils";
import { lerpHex } from "../../src/components/RangeBar";
import { Hero } from "../../src/features/current/Hero";
import type { DisplayPrefs } from "../../src/lib/config/schema";
import { tempWarmthT } from "../../src/lib/weather/format";
import type { CurrentObs } from "../../src/lib/weather/types";
import { DARK_INK, NIGHT_ACCENTS, type Palette } from "../../src/theme/palette";
import { ThemeContext } from "../../src/theme/tokens";

const palette: Palette = { ...DARK_INK, ...NIGHT_ACCENTS };

const prefs: DisplayPrefs = {
  temp: "metric",
  wind: "metric",
  precip: "metric",
  pressure: "metric",
  timeFormat: "24h",
};

function makeObs(temperatureC: number): CurrentObs {
  return {
    timeUtc: "2026-08-24T16:15:00.000Z",
    temperatureC,
    apparentC: temperatureC,
    humidityPct: 50,
    condition: "clear",
    windSpeedKmh: 10,
    windDirectionDeg: 0,
    windGustKmh: null,
    pressureHpa: null,
    dewPointC: null,
    visibilityM: null,
    uvIndex: null,
    isDay: true,
  };
}

function hexToInts(hex: string): [number, number, number] {
  const body = hex.replace("#", "");
  return [
    Number.parseInt(body.slice(0, 2), 16),
    Number.parseInt(body.slice(2, 4), 16),
    Number.parseInt(body.slice(4, 6), 16),
  ];
}

function rgbaToHex(rgba: { toInts(): [number, number, number, number] }): string {
  const [r, g, b] = rgba.toInts();
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function expectedTempHex(celsius: number): string {
  return lerpHex(palette.tempCold, palette.tempWarm, tempWarmthT(celsius));
}

async function collectFgHexes(
  obs: CurrentObs,
  opts: { mini?: boolean; compact?: boolean },
): Promise<Set<string>> {
  const setup = await testRender(
    <ThemeContext.Provider value={palette}>
      <Hero obs={obs} prefs={prefs} mini={opts.mini} compact={opts.compact} />
    </ThemeContext.Provider>,
    { width: 60, height: 12 },
  );
  try {
    await setup.flush();
    const frame = setup.captureSpans();
    const hexes = new Set<string>();
    for (const line of frame.lines) {
      for (const span of line.spans) {
        if (span.text.trim().length === 0) continue;
        hexes.add(rgbaToHex(span.fg));
      }
    }
    return hexes;
  } finally {
    await setup.renderer.destroy();
  }
}

describe("Hero temperature color", () => {
  test("cold fixture renders cold-shifted hue in mini", async () => {
    const hexes = await collectFgHexes(makeObs(-10), { mini: true });
    expect(hexes.has(expectedTempHex(-10))).toBe(true);
    expect(hexes.has(palette.tempWarm.toLowerCase())).toBe(false);
    expect(hexToInts(expectedTempHex(-10))).toEqual(hexToInts(palette.tempCold));
  });

  test("cold fixture renders cold-shifted hue in compact", async () => {
    const hexes = await collectFgHexes(makeObs(-10), { compact: true });
    expect(hexes.has(expectedTempHex(-10))).toBe(true);
    expect(hexes.has(palette.tempWarm.toLowerCase())).toBe(false);
  });

  test("cold fixture renders cold-shifted hue in full", async () => {
    const hexes = await collectFgHexes(makeObs(-10), {});
    expect(hexes.has(expectedTempHex(-10))).toBe(true);
    expect(hexes.has(palette.tempWarm.toLowerCase())).toBe(false);
  });

  test("hot fixture renders warm hue in mini", async () => {
    const hexes = await collectFgHexes(makeObs(35), { mini: true });
    expect(hexes.has(expectedTempHex(35))).toBe(true);
    expect(hexToInts(expectedTempHex(35))).toEqual(hexToInts(palette.tempWarm));
  });

  test("hot fixture renders warm hue in compact", async () => {
    const hexes = await collectFgHexes(makeObs(35), { compact: true });
    expect(hexes.has(expectedTempHex(35))).toBe(true);
  });

  test("hot fixture renders warm hue in full", async () => {
    const hexes = await collectFgHexes(makeObs(35), {});
    expect(hexes.has(expectedTempHex(35))).toBe(true);
  });

  test("mid temperature maps between cold and warm", async () => {
    const warmHex = expectedTempHex(35);
    const coldHex = expectedTempHex(-10);
    const midHex = expectedTempHex(17.5);
    expect(midHex).not.toBe(warmHex);
    expect(midHex).not.toBe(coldHex);
    const [cr, cg, cb] = hexToInts(coldHex);
    const [wr, wg, wb] = hexToInts(warmHex);
    const [mr, mg, mb] = hexToInts(midHex);
    expect(mr).toBeGreaterThan(Math.min(cr, wr));
    expect(mr).toBeLessThan(Math.max(cr, wr));
    expect(mg).toBeGreaterThan(Math.min(cg, wg));
    expect(mg).toBeLessThan(Math.max(cg, wg));
    expect(mb).toBeGreaterThan(Math.min(cb, wb));
    expect(mb).toBeLessThan(Math.max(cb, wb));
    const hexesMini = await collectFgHexes(makeObs(17.5), { mini: true });
    expect(hexesMini.has(midHex)).toBe(true);
  });
});
