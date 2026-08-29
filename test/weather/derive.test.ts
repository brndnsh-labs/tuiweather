import { describe, expect, test } from "bun:test";
import {
  deriveNowcast,
  describeNowcast,
  precipGlyph,
  todayPrecipWindow,
  upcomingPrecipSeries,
  WET_MM,
} from "../../src/lib/weather/derive";
import type { NormalizedForecast, PrecipInterval } from "../../src/lib/weather/types";

const DAY = "2026-08-24";
const MIN = 60_000;

function instant(hhmm: string): string {
  return `${DAY}T${hhmm}:00.000Z`;
}

function buckets(specs: Array<[endLabel: string, precipMm: number]>): PrecipInterval[] {
  return specs.map(([endLabel, precipMm]) => {
    const endUtc = instant(endLabel);
    const startUtc = new Date(Date.parse(endUtc) - 15 * MIN).toISOString();
    return { startUtc, endUtc, precipMm, probabilityPct: null };
  });
}

function forecast(minutely15: PrecipInterval[]): NormalizedForecast {
  return {
    providerId: "openmeteo",
    location: { latitude: 45.52, longitude: -122.68 },
    timezone: "UTC",
    utcOffsetSeconds: 0,
    fetchedAtUtc: instant("14:00"),
    current: {
      timeUtc: instant("14:00"),
      temperatureC: 18,
      apparentC: 17.5,
      humidityPct: 62,
      condition: "rain",
      windSpeedKmh: 12,
      windDirectionDeg: 270,
      windGustKmh: null,
      pressureHpa: 1013,
      cloudCoverPct: 90,
      dewPointC: null,
      visibilityM: null,
      uvIndex: null,
      precipLast1hMm: null,
      isDay: true,
    },
    minutely15,
    hourly: [],
    daily: [],
  };
}

describe("WET_MM", () => {
  test("wet threshold is 0.03 mm per 15-minute bucket", () => {
    expect(WET_MM).toBe(0.03);
  });
});

describe("deriveNowcast truth table", () => {
  test("case 1: wet bucket containing now is wet-NOW (stopping), never starting", () => {
    const f = forecast(
      buckets([
        ["13:45", 0],
        ["14:00", 0],
        ["14:15", 0.2],
        ["14:30", 0],
      ]),
    );
    const n = deriveNowcast(f, instant("14:12"));
    expect(n).toEqual({ kind: "stopping", endsInMin: 3 });
    expect(n.kind).not.toBe("starting");
    expect(describeNowcast(n)).toBe("Rain stopping in 3 min");
  });

  test("case 2: dry now, next wet bucket [15:00,15:15) anchors startsInMin=48 at its START", () => {
    const f = forecast(
      buckets([
        ["14:00", 0],
        ["14:15", 0],
        ["14:30", 0],
        ["14:45", 0],
        ["15:15", 0.5],
      ]),
    );
    const n = deriveNowcast(f, instant("14:12"));
    expect(n).toEqual({ kind: "starting", startsInMin: 48, intensity: "heavy" });
    expect(describeNowcast(n)).toBe("Heavy rain starting in 48 min");
  });

  test("case 3: two-bucket wet stretch [14:00,14:30) with dry follower stops in 18 min", () => {
    const f = forecast(
      buckets([
        ["14:00", 0],
        ["14:15", 0.2],
        ["14:30", 0.3],
        ["14:45", 0],
      ]),
    );
    const n = deriveNowcast(f, instant("14:12"));
    expect(n).toEqual({ kind: "stopping", endsInMin: 18 });
    expect(describeNowcast(n)).toBe("Rain stopping in 18 min");
  });

  test("case 4: wet now reaching the end of known data is ongoing with null end", () => {
    const singleBucket = forecast(buckets([["14:15", 0.2]]));
    const nA = deriveNowcast(singleBucket, instant("14:12"));
    expect(nA).toEqual({ kind: "ongoing", endsInMin: null, horizonMin: 3, intensity: "moderate" });
    expect(describeNowcast(nA)).toBe("Rain for at least 3 min");

    const twoTrailingBuckets = forecast(
      buckets([
        ["14:15", 0.2],
        ["14:30", 0.3],
      ]),
    );
    expect(deriveNowcast(twoTrailingBuckets, instant("14:20"))).toEqual({
      kind: "ongoing",
      endsInMin: null,
      horizonMin: 10,
      intensity: "moderate",
    });
  });

  test("ongoing horizon reflects remaining series minutes and expires at series end", () => {
    const f = forecast(
      buckets([
        ["14:00", 0],
        ["14:15", 0],
        ["14:30", 0.2],
        ["14:45", 0.3],
      ]),
    );
    const n = deriveNowcast(f, instant("14:20"));
    expect(n).toEqual({ kind: "ongoing", endsInMin: null, horizonMin: 25, intensity: "moderate" });
    expect(describeNowcast(n)).toBe("Rain for at least 25 min");

    const f15 = forecast(
      buckets([
        ["14:15", 0],
        ["14:30", 0.5],
      ]),
    );
    const n15 = deriveNowcast(f15, instant("14:15"));
    expect(n15).toEqual({ kind: "ongoing", endsInMin: null, horizonMin: 15, intensity: "heavy" });
    expect(describeNowcast(n15)).toBe("Rain for at least 15 min");

    expect(deriveNowcast(f15, instant("14:30"))).toEqual({ kind: "dry" });
  });

  test("case 5: no wet buckets anywhere is dry", () => {
    const allDry = forecast(
      buckets([
        ["14:00", 0],
        ["14:15", 0.02],
        ["14:30", 0],
      ]),
    );
    expect(deriveNowcast(allDry, instant("14:12"))).toEqual({ kind: "dry" });
    expect(deriveNowcast(forecast([]), instant("14:12"))).toEqual({ kind: "dry" });
    expect(describeNowcast({ kind: "dry" })).toBe("Dry");
  });

  test("case 6a: now before the first known bucket is dry even if rain follows", () => {
    const f = forecast(buckets([["14:15", 0.5]]));
    expect(deriveNowcast(f, instant("13:50"))).toEqual({ kind: "dry" });
  });

  test("case 6b: now after the last known bucket is dry", () => {
    const trailingOnly = forecast(buckets([["14:15", 0.5]]));
    expect(deriveNowcast(trailingOnly, instant("14:20"))).toEqual({ kind: "dry" });

    const withTail = forecast(
      buckets([
        ["14:15", 0.5],
        ["14:30", 0],
        ["14:45", 0],
      ]),
    );
    expect(deriveNowcast(withTail, instant("14:20"))).toEqual({ kind: "dry" });
  });
});

describe("deriveNowcast rules", () => {
  test("buckets are sorted defensively; shuffled input matches sorted result", () => {
    const ordered = forecast(
      buckets([
        ["14:00", 0],
        ["14:15", 0.2],
        ["14:30", 0],
      ]),
    );
    const shuffled = forecast([...ordered.minutely15].reverse());
    const fromOrdered = deriveNowcast(ordered, instant("14:05"));
    expect(deriveNowcast(shuffled, instant("14:05"))).toEqual(fromOrdered);
    expect(fromOrdered.kind).toBe("stopping");
  });

  test("gaps between buckets count as dry and terminate a stretch", () => {
    const f = forecast(
      buckets([
        ["14:15", 0.2],
        ["15:00", 0],
        ["15:15", 0.3],
      ]),
    );
    const n = deriveNowcast(f, instant("14:12"));
    expect(n).toEqual({ kind: "stopping", endsInMin: 3 });
  });

  test("WET_MM boundary is inclusive", () => {
    const exactlyWet = forecast(buckets([["14:15", 0.03]]));
    expect(deriveNowcast(exactlyWet, instant("14:10")).kind).toBe("ongoing");

    const justBelow = forecast(buckets([["14:15", 0.029]]));
    expect(deriveNowcast(justBelow, instant("14:10")).kind).toBe("dry");
  });

  test("intensity bands on an upcoming bucket: <0.1 light, <0.4 moderate, else heavy", () => {
    const startingWith = (precipMm: number) =>
      deriveNowcast(
        forecast(
          buckets([
            ["14:00", 0],
            ["14:30", precipMm],
          ]),
        ),
        instant("14:00"),
      );

    expect(startingWith(0.09)).toMatchObject({
      kind: "starting",
      startsInMin: 15,
      intensity: "light",
    });
    expect(startingWith(0.1)).toMatchObject({ kind: "starting", intensity: "moderate" });
    expect(startingWith(0.39)).toMatchObject({ kind: "starting", intensity: "moderate" });
    expect(startingWith(0.4)).toMatchObject({ kind: "starting", intensity: "heavy" });
  });
});

describe("precipGlyph", () => {
  test("boundary table: below WET_MM is dry floor, then light/moderate/heavy bands", () => {
    expect(precipGlyph(0)).toBe("▁");
    expect(precipGlyph(0.029)).toBe("▁");
    expect(precipGlyph(WET_MM)).toBe("▃");
    expect(precipGlyph(0.031)).toBe("▃");
    expect(precipGlyph(0.099)).toBe("▃");
    expect(precipGlyph(0.1)).toBe("▅");
    expect(precipGlyph(0.399)).toBe("▅");
    expect(precipGlyph(0.4)).toBe("█");
    expect(precipGlyph(2.5)).toBe("█");
  });
});

describe("upcomingPrecipSeries", () => {
  test("starts at the bucket whose [start,end) contains now, in time order", () => {
    const f = forecast(
      buckets([
        ["14:00", 0],
        ["14:15", 0.2],
        ["14:30", 0.5],
        ["14:45", 0],
      ]),
    );
    // Bucket labeled 14:15 spans [14:00,14:15) and contains 14:12.
    expect(upcomingPrecipSeries(f, instant("14:12"))).toEqual([0.2, 0.5, 0]);
  });

  test("drops buckets that have fully elapsed by now", () => {
    const f = forecast(
      buckets([
        ["14:00", 0],
        ["14:15", 0.2],
        ["14:30", 0.5],
      ]),
    );
    // At 14:20 the containing bucket is the one labeled 14:30 ([14:15,14:30)).
    expect(upcomingPrecipSeries(f, instant("14:20"))).toEqual([0.5]);
  });

  test("empty when now is outside the data window on either side", () => {
    const f = forecast(buckets([["14:15", 0.5]]));
    expect(upcomingPrecipSeries(f, instant("13:50"))).toEqual([]);
    expect(upcomingPrecipSeries(f, instant("14:15"))).toEqual([]);
    expect(upcomingPrecipSeries(forecast([]), instant("14:12"))).toEqual([]);
  });

  test("sorts shuffled input defensively like deriveNowcast", () => {
    const ordered = forecast(
      buckets([
        ["14:00", 0],
        ["14:15", 0.2],
        ["14:30", 0.7],
      ]),
    );
    const shuffled = forecast([...ordered.minutely15].reverse());
    expect(upcomingPrecipSeries(shuffled, instant("14:05"))).toEqual([0.2, 0.7]);
  });
});

describe("describeNowcast strings", () => {
  test("starting word map and any-minute branch", () => {
    expect(describeNowcast({ kind: "starting", startsInMin: 9, intensity: "light" })).toBe(
      "Light rain starting in 9 min",
    );
    expect(describeNowcast({ kind: "starting", startsInMin: 4, intensity: "moderate" })).toBe(
      "Rain starting in 4 min",
    );
    expect(describeNowcast({ kind: "starting", startsInMin: 2, intensity: "heavy" })).toBe(
      "Heavy rain starting in 2 min",
    );
    expect(describeNowcast({ kind: "starting", startsInMin: 0, intensity: "light" })).toBe(
      "Light rain starting any minute",
    );
  });

  test("stopping and ongoing variants", () => {
    expect(describeNowcast({ kind: "stopping", endsInMin: 7 })).toBe("Rain stopping in 7 min");
    expect(
      describeNowcast({ kind: "ongoing", endsInMin: null, horizonMin: 42, intensity: "heavy" }),
    ).toBe("Rain for at least 42 min");
    expect(
      describeNowcast({ kind: "ongoing", endsInMin: 5, horizonMin: 10, intensity: "heavy" }),
    ).toBe("Rain stopping in 5 min");
  });
});

describe("todayPrecipWindow", () => {
  test("returns first future contiguous stretch, summing its buckets", () => {
    const f = forecast(
      buckets([
        ["14:15", 1.1],
        ["15:00", 0.2],
        ["15:15", 0.5],
        ["15:30", 0],
        ["16:00", 0.9],
      ]),
    );
    expect(todayPrecipWindow(f, instant("14:20"))).toEqual({
      startUtc: instant("14:45"),
      endUtc: instant("15:15"),
      totalMm: 0.2 + 0.5,
    });
  });

  test("includes rain in the containing bucket", () => {
    const containingRain = forecast(buckets([["14:15", 0.5]]));
    expect(todayPrecipWindow(containingRain, instant("14:12"))).toEqual({
      startUtc: instant("14:00"),
      endUtc: instant("14:15"),
      totalMm: 0.5,
    });

    const noRainAtAll = forecast(buckets([["14:15", 0]]));
    expect(todayPrecipWindow(noRainAtAll, instant("14:12"))).toBeNull();
  });

  test("stretch terminates where a dry bucket follows", () => {
    const f = forecast(
      buckets([
        ["15:00", 0.3],
        ["15:15", 0.1],
        ["15:30", 0],
        ["15:45", 0.8],
      ]),
    );
    const w = todayPrecipWindow(f, instant("14:12"));
    expect(w?.startUtc).toBe(instant("14:45"));
    expect(w?.endUtc).toBe(instant("15:15"));
    expect(w?.totalMm).toBeCloseTo(0.4);
  });
});
