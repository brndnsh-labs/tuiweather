import { describe, expect, test } from "bun:test";
import { buildJsonLine, buildOneLine } from "../../src/app/oneline";
import { conditionGlyph } from "../../src/lib/providers/openmeteo/wmo";
import type {
  CurrentObs,
  DailyPoint,
  NormalizedForecast,
  PrecipInterval,
} from "../../src/lib/weather/types";

const NOW = "2026-08-24T12:00:00.000Z";
const NOW_MINUS_10MIN = "2026-08-24T11:50:00.000Z";
const MIN_MS = 60_000;
const SEGMENT_SEP = " · ";

function bucket(startOffsetMin: number, precipMm: number): PrecipInterval {
  const startMs = Date.parse(NOW) + startOffsetMin * MIN_MS;
  return {
    startUtc: new Date(startMs).toISOString(),
    endUtc: new Date(startMs + 15 * MIN_MS).toISOString(),
    precipMm,
    probabilityPct: null,
  };
}

function currentObs(overrides: Partial<CurrentObs> = {}): CurrentObs {
  return {
    timeUtc: NOW,
    temperatureC: 22.2222,
    apparentC: 21.1111,
    humidityPct: 50,
    condition: "clear",
    windSpeedKmh: 9.6563,
    windDirectionDeg: 315,
    windGustKmh: null,
    pressureHpa: null,
    cloudCoverPct: null,
    dewPointC: null,
    visibilityM: null,
    uvIndex: null,
    precipLast1hMm: null,
    isDay: true,
    ...overrides,
  };
}

function dailyPoint(overrides: Partial<DailyPoint> = {}): DailyPoint {
  return {
    dateLocal: "2026-08-24",
    condition: "clear",
    tempMinC: 14.4444,
    tempMaxC: 23.8889,
    precipSumMm: 0,
    precipProbabilityMaxPct: null,
    uvIndexMax: null,
    sunriseUtc: null,
    sunsetUtc: null,
    windSpeedMaxKmh: null,
    windGustMaxKmh: null,
    ...overrides,
  };
}

interface ForecastOverrides {
  current?: Partial<CurrentObs>;
  minutely15?: PrecipInterval[];
  daily?: DailyPoint[];
}

function makeForecast(overrides: ForecastOverrides = {}): NormalizedForecast {
  return {
    providerId: "stub",
    location: { latitude: 45.52, longitude: -122.68 },
    timezone: "America/Los_Angeles",
    utcOffsetSeconds: -7 * 3600,
    fetchedAtUtc: NOW,
    current: currentObs(overrides.current),
    minutely15: overrides.minutely15 ?? [bucket(-15, 0), bucket(0, 0)],
    hourly: [],
    daily: overrides.daily ?? [dailyPoint()],
  };
}

describe("buildOneLine", () => {
  test("dry nowcast omitted; imperial baseline", () => {
    expect(buildOneLine(makeForecast(), "imperial", NOW)).toBe("☀ 72° fl70 · 58°–75° · ↘6mph nw");
  });

  test("metric rendering converts every segment", () => {
    expect(buildOneLine(makeForecast(), "metric", NOW)).toBe("☀ 22° fl21 · 14°–24° · ↘10km/h nw");
  });

  test("starting rain shows minutes until onset", () => {
    const forecast = makeForecast({
      current: { condition: "rain" },
      minutely15: [bucket(-15, 0), bucket(0, 0), bucket(15, 0.5), bucket(30, 0.2)],
    });
    expect(buildOneLine(forecast, "imperial", NOW)).toBe(
      `${conditionGlyph("rain")} 72° fl70 · ☂ in 15min · 58°–75° · ↘6mph nw`,
    );
  });

  test("stopping rain counts down to the end of the wet stretch", () => {
    // now sits inside bucket [-15..0): wet until NOW, dry after.
    const forecast = makeForecast({
      minutely15: [bucket(-30, 0.5), bucket(-15, 0.4), bucket(0, 0), bucket(15, 0.3)],
    });
    expect(buildOneLine(forecast, "imperial", NOW_MINUS_10MIN)).toBe(
      "☀ 72° fl70 · ☂ 10min · 58°–75° · ↘6mph nw",
    );
  });

  test("ongoing rain with unknown end renders a bare umbrella", () => {
    const forecast = makeForecast({
      minutely15: [bucket(-30, 0.5), bucket(-15, 0.4), bucket(0, 0.6)],
    });
    const line = buildOneLine(forecast, "imperial", NOW_MINUS_10MIN);
    expect(line.split(SEGMENT_SEP)).toEqual(["☀ 72° fl70", "☂", "58°–75°", "↘6mph nw"]);
  });

  test("empty daily list drops the hi–lo segment", () => {
    expect(buildOneLine(makeForecast({ daily: [] }), "imperial", NOW)).toBe(
      "☀ 72° fl70 · ↘6mph nw",
    );
  });

  test("sub-freezing temperatures keep signs and degree marks", () => {
    const line = buildOneLine(
      makeForecast({
        current: { temperatureC: -5.4, apparentC: -8 },
        daily: [dailyPoint({ tempMinC: -9, tempMaxC: -1 })],
      }),
      "imperial",
      NOW,
    );
    expect(line.startsWith("☀ 22° fl18")).toBe(true);
    expect(line).toContain("16°–30°");
  });
});

describe("buildJsonLine", () => {
  test("metric values are canonical while line keeps configured units", () => {
    const forecast = makeForecast();
    const json = buildJsonLine(
      forecast,
      { label: "Portland", latitude: 45.52, longitude: -122.68 },
      "imperial",
      NOW,
    );
    expect(json.location).toEqual({ label: "Portland", latitude: 45.52, longitude: -122.68 });
    expect(json.observedAtUtc).toBe(NOW);
    expect(json.temperatureC).toBe(22.2222);
    expect(json.apparentC).toBe(21.1111);
    expect(json.condition).toBe("clear");
    expect(json.today).toEqual({ minC: 14.4444, maxC: 23.8889 });
    expect(json.wind).toEqual({ speedKmh: 9.6563, dirDeg: 315, gustKmh: null });
    expect(json.nowcast).toEqual({ kind: "dry" });
    expect(json.line).toBe(buildOneLine(forecast, "imperial", NOW));
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);
  });

  test("nowcast derives from buckets and daily/wind nulls propagate", () => {
    const forecast = makeForecast({
      current: {
        condition: "rain",
        windGustKmh: 41.8,
      },
      minutely15: [bucket(-15, 0), bucket(0, 0), bucket(15, 0.5), bucket(30, 0.2)],
      daily: [],
    });
    const json = buildJsonLine(
      forecast,
      { label: null, latitude: 1.5, longitude: 2.5 },
      "metric",
      NOW,
    );
    expect(json.nowcast).toEqual({ kind: "starting", startsInMin: 15, intensity: "heavy" });
    expect(json.condition).toBe("rain");
    expect(json.wind).toEqual({ speedKmh: 9.6563, dirDeg: 315, gustKmh: 41.8 });
    expect(json.today).toEqual({ minC: null, maxC: null });
  });

  test("line field is byte-identical to plain one-line output for the same run", () => {
    for (const units of ["metric", "imperial"] as const) {
      const forecast = makeForecast({
        minutely15: [bucket(-30, 0.5), bucket(-15, 0.4), bucket(0, 0)],
      });
      const nowUtc = NOW_MINUS_10MIN;
      const json = buildJsonLine(
        forecast,
        { label: null, latitude: 45.52, longitude: -122.68 },
        units,
        nowUtc,
      );
      expect(json.line).toBe(buildOneLine(forecast, units, nowUtc));
    }
  });
});
