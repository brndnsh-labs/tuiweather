import { describe, expect, test } from "bun:test";
import { buildJsonLine, buildOneLine } from "../../src/app/oneline";
import type { DisplayPrefs } from "../../src/lib/config/schema";
import { conditionGlyph } from "../../src/lib/weather/condition-display";
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

function prefsOf(
  units: "metric" | "imperial",
  overrides: Partial<DisplayPrefs> = {},
): DisplayPrefs {
  return {
    temp: units,
    wind: units,
    precip: units,
    pressure: units,
    timeFormat: units === "imperial" ? "12h" : "24h",
    ...overrides,
  };
}

const IMPERIAL = prefsOf("imperial");
const METRIC = prefsOf("metric");
const MIXED = prefsOf("imperial", {
  temp: "metric",
  precip: "metric",
  timeFormat: "24h",
});

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
    dewPointC: null,
    visibilityM: null,
    uvIndex: null,
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
    sunriseUtc: null,
    sunsetUtc: null,
    windSpeedMaxKmh: null,
    ...overrides,
  };
}

interface ForecastOverrides {
  current?: Partial<CurrentObs>;
  minutely15?: PrecipInterval[];
  daily?: DailyPoint[];
  hasMinutePrecip?: boolean;
}

function makeForecast(overrides: ForecastOverrides = {}): NormalizedForecast {
  return {
    providerId: "stub",
    location: { latitude: 45.52, longitude: -122.68 },
    timezone: "America/Los_Angeles",
    utcOffsetSeconds: -7 * 3600,
    fetchedAtUtc: NOW,
    hasMinutePrecip: overrides.hasMinutePrecip ?? true,
    current: currentObs(overrides.current),
    minutely15: overrides.minutely15 ?? [bucket(-15, 0), bucket(0, 0)],
    hourly: [],
    daily: overrides.daily ?? [dailyPoint()],
  };
}

describe("buildOneLine", () => {
  test("dry nowcast omitted; imperial baseline", () => {
    expect(buildOneLine(makeForecast(), IMPERIAL, NOW)).toBe("☀ 72° fl70 · 58°–75° · ↘6mph nw");
  });

  test("metric rendering converts every segment", () => {
    expect(buildOneLine(makeForecast(), METRIC, NOW)).toBe("☀ 22° fl21 · 14°–24° · ↘10km/h nw");
  });

  test("mixed prefs render metric temps with imperial wind", () => {
    expect(buildOneLine(makeForecast(), MIXED, NOW)).toBe("☀ 22° fl21 · 14°–24° · ↘6mph nw");
  });

  test("starting rain shows minutes until onset", () => {
    const forecast = makeForecast({
      current: { condition: "rain" },
      minutely15: [bucket(-15, 0), bucket(0, 0), bucket(15, 0.5), bucket(30, 0.2)],
    });
    expect(buildOneLine(forecast, IMPERIAL, NOW)).toBe(
      `${conditionGlyph("rain")} 72° fl70 · ☂ in 15min · 58°–75° · ↘6mph nw`,
    );
  });

  test("stopping rain counts down to the end of the wet stretch", () => {
    // now sits inside bucket [-15..0): wet until NOW, dry after.
    const forecast = makeForecast({
      minutely15: [bucket(-30, 0.5), bucket(-15, 0.4), bucket(0, 0), bucket(15, 0.3)],
    });
    expect(buildOneLine(forecast, IMPERIAL, NOW_MINUS_10MIN)).toBe(
      "☀ 72° fl70 · ☂ 10min · 58°–75° · ↘6mph nw",
    );
  });

  test("ongoing rain with unknown end renders a bare umbrella", () => {
    const forecast = makeForecast({
      minutely15: [bucket(-30, 0.5), bucket(-15, 0.4), bucket(0, 0.6)],
    });
    const line = buildOneLine(forecast, IMPERIAL, NOW_MINUS_10MIN);
    expect(line.split(SEGMENT_SEP)).toEqual(["☀ 72° fl70", "☂", "58°–75°", "↘6mph nw"]);
  });

  test("empty daily list drops the hi–lo segment", () => {
    expect(buildOneLine(makeForecast({ daily: [] }), IMPERIAL, NOW)).toBe("☀ 72° fl70 · ↘6mph nw");
  });

  test("sub-freezing temperatures keep signs and degree marks", () => {
    const line = buildOneLine(
      makeForecast({
        current: { temperatureC: -5.4, apparentC: -8 },
        daily: [dailyPoint({ tempMinC: -9, tempMaxC: -1 })],
      }),
      IMPERIAL,
      NOW,
    );
    expect(line.startsWith("☀ 22° fl18")).toBe(true);
    expect(line).toContain("16°–30°");
  });

  test("unavailable nowcast omits umbrella segment like dry", () => {
    const forecast = makeForecast({ hasMinutePrecip: false, minutely15: [] });
    expect(buildOneLine(forecast, IMPERIAL, NOW)).toBe("☀ 72° fl70 · 58°–75° · ↘6mph nw");
    expect(buildOneLine(forecast, IMPERIAL, NOW)).not.toContain("☂");
  });
});

describe("buildJsonLine", () => {
  test("metric values are canonical while line keeps configured units", () => {
    const forecast = makeForecast();
    const json = buildJsonLine(
      forecast,
      { label: "Portland", latitude: 45.52, longitude: -122.68 },
      IMPERIAL,
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
    expect(json.line).toBe(buildOneLine(forecast, IMPERIAL, NOW));
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
      METRIC,
      NOW,
    );
    expect(json.nowcast).toEqual({ kind: "starting", startsInMin: 15, intensity: "heavy" });
    expect(json.condition).toBe("rain");
    expect(json.wind).toEqual({ speedKmh: 9.6563, dirDeg: 315, gustKmh: 41.8 });
    expect(json.today).toEqual({ minC: null, maxC: null });
  });

  test("line field is byte-identical to plain one-line output for the same run", () => {
    const prefSets: DisplayPrefs[] = [IMPERIAL, METRIC, MIXED];
    for (const prefs of prefSets) {
      const forecast = makeForecast({
        minutely15: [bucket(-30, 0.5), bucket(-15, 0.4), bucket(0, 0)],
      });
      const nowUtc = NOW_MINUS_10MIN;
      const json = buildJsonLine(
        forecast,
        { label: null, latitude: 45.52, longitude: -122.68 },
        prefs,
        nowUtc,
      );
      expect(json.line).toBe(buildOneLine(forecast, prefs, nowUtc));
    }
  });
});
