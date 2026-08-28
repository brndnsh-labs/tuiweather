import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { normalizeNwsForecast } from "../../../src/lib/providers/nws/normalize";
import {
  forecastResponseSchema,
  observationResponseSchema,
  pointsResponseSchema,
} from "../../../src/lib/providers/nws/schemas";

const FIXTURES = join(import.meta.dir, "..", "..", "fixtures", "nws");

const pointsBody = pointsResponseSchema.parse(await Bun.file(join(FIXTURES, "points.json")).json());
const hourlyBody = forecastResponseSchema.parse(
  await Bun.file(join(FIXTURES, "hourly.json")).json(),
);
const dailyBody = forecastResponseSchema.parse(await Bun.file(join(FIXTURES, "daily.json")).json());
const obsBody = observationResponseSchema.parse(await Bun.file(join(FIXTURES, "obs.json")).json());

const PORTLAND = { latitude: 45.5152, longitude: -122.6784 };

function normalize(window?: { forecastDays?: number; forecastHours?: number }) {
  return normalizeNwsForecast(
    {
      points: pointsBody.properties,
      hourly: hourlyBody.properties.periods,
      daily: dailyBody.properties.periods,
      obs: obsBody.properties,
    },
    PORTLAND,
    window,
  );
}

const forecast = normalize();

describe("nws normalize — identity and location", () => {
  test("keys the forecast to the nws provider and the requested location", () => {
    expect(forecast.providerId).toBe("nws");
    expect(forecast.location).toEqual(PORTLAND);
    expect(forecast.timezone).toBe("America/Los_Angeles");
    expect(Date.parse(forecast.fetchedAtUtc)).not.toBeNaN();
  });

  test("NWS has no 15-minute precipitation series", () => {
    expect(forecast.minutely15).toEqual([]);
  });
});

describe("nws normalize — absolute UTC instants (hard rule 2)", () => {
  test("converts offset-bearing NWS times to Z-suffixed instants", () => {
    const stamps = [
      forecast.current.timeUtc,
      forecast.fetchedAtUtc,
      ...forecast.hourly.map((point) => point.timeUtc),
    ];
    for (const stamp of stamps) {
      expect(stamp.endsWith("Z")).toBe(true);
      expect(Number.isNaN(Date.parse(stamp))).toBe(false);
    }
  });

  test("15:00-07:00 local hourly periods land on the right UTC instant", () => {
    expect(forecast.hourly[0]?.timeUtc).toBe("2026-08-28T22:00:00.000Z");
    expect(forecast.hourly[1]?.timeUtc).toBe("2026-08-28T23:00:00.000Z");
    expect(forecast.hourly[24]?.timeUtc).toBe("2026-08-29T22:00:00.000Z");
  });

  test("derives utcOffsetSeconds from the period offsets", () => {
    expect(forecast.utcOffsetSeconds).toBe(-7 * 3600);
  });

  test("current observation timestamp (+00:00) normalizes unchanged", () => {
    expect(forecast.current.timeUtc).toBe("2026-08-28T22:20:00.000Z");
  });
});

describe("nws normalize — metric conversion (hard rule 1)", () => {
  test("converts hourly Fahrenheit temperatures to Celsius", () => {
    expect(forecast.hourly[0]?.temperatureC).toBeCloseTo(23.888889, 5);
    expect(forecast.hourly[1]?.temperatureC).toBeCloseTo(24.444444, 5);
  });

  test("converts hourly mph winds to km/h and compass bearings to degrees", () => {
    expect(forecast.hourly[0]?.windSpeedKmh).toBeCloseTo(8.04672, 5);
    expect(forecast.hourly[0]?.windDirectionDeg).toBe(337.5);
  });

  test("passes through already-metric dewpoint and percent humidity", () => {
    expect(forecast.hourly[0]?.humidityPct).toBe(56);
  });

  test("keeps the metric current observation values, Pa → hPa included", () => {
    const cur = forecast.current;
    expect(cur.temperatureC).toBe(23);
    expect(cur.dewPointC).toBe(10);
    expect(cur.humidityPct).toBeCloseTo(43.726894, 4);
    expect(cur.pressureHpa).toBeCloseTo(1016.2552, 4);
    expect(cur.visibilityM).toBeCloseTo(16093.44, 2);
    expect(cur.windSpeedKmh).toBeCloseTo(14.832, 3);
    expect(cur.windDirectionDeg).toBe(360);
    expect(cur.windGustKmh).toBeNull();
  });

  test("derives an apparent temperature from the heat index", () => {
    expect(forecast.current.apparentC).toBeCloseTo(22.497313, 4);
  });

  test("maps NWS condition text through the enum", () => {
    expect(forecast.current.condition).toBe("partly-cloudy");
    expect(forecast.hourly[0]?.condition).toBe("mostly-clear");
    expect(forecast.current.isDay).toBe(true);
  });
});

describe("nws normalize — day/night merge", () => {
  const daily = forecast.daily;
  const hourly = hourlyBody.properties.periods;
  const periods = dailyBody.properties.periods;

  test("merges 14 half-day periods into 7 calendar days", () => {
    expect(daily.map((day) => day.dateLocal)).toEqual([
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
    expect(daily.length).toBe(7);
  });

  test("takes the high from the daytime period and the low from the nighttime period", () => {
    const day = daily[0];
    if (!day) throw new Error("expected a first daily point");
    expect(day.tempMaxC).toBeCloseTo(25, 5);
    expect(day.tempMinC).toBeCloseTo(13.333333, 5);
  });

  test("takes the pop and condition from the daytime period", () => {
    const day = daily[1];
    if (!day) throw new Error("expected a second daily point");
    expect(day.precipProbabilityMaxPct).toBe(18);
    expect(day.condition).toBe("rain");
  });

  test("every merged day agrees with its source periods", () => {
    for (const point of daily) {
      const dayPeriod = periods.find(
        (p) => p.startTime.slice(0, 10) === point.dateLocal && p.isDaytime,
      );
      const nightPeriod = periods.find(
        (p) => p.startTime.slice(0, 10) === point.dateLocal && !p.isDaytime,
      );
      expect(dayPeriod).toBeDefined();
      expect(nightPeriod).toBeDefined();
      if (dayPeriod) {
        expect(point.tempMaxC).toBeCloseTo(((dayPeriod.temperature - 32) * 5) / 9, 5);
        expect(point.precipProbabilityMaxPct).toBe(
          dayPeriod.probabilityOfPrecipitation?.value ?? null,
        );
      }
      if (nightPeriod) {
        expect(point.tempMinC).toBeCloseTo(((nightPeriod.temperature - 32) * 5) / 9, 5);
      }
    }
  });

  test("hourly count survives normalization at the default window", () => {
    expect(hourly.length).toBe(48);
    expect(forecast.hourly.length).toBe(48);
  });
});

describe("nws normalize — gaps map to null", () => {
  test("hourly points carry no uv, visibility, gusts, or precip amounts", () => {
    for (const point of forecast.hourly) {
      expect(point.uvIndex).toBeNull();
      expect(point.visibilityM).toBeNull();
      expect(point.windGustKmh).toBeNull();
      expect(point.precipMm).toBe(0);
    }
  });

  test("daily points carry no uv max, sunrise/sunset, gusts, or precip amounts", () => {
    for (const day of forecast.daily) {
      expect(day.uvIndexMax).toBeNull();
      expect(day.sunriseUtc).toBeNull();
      expect(day.sunsetUtc).toBeNull();
      expect(day.windGustMaxKmh).toBeNull();
      expect(day.precipSumMm).toBe(0);
    }
  });

  test("current observation lacks uv, cloud cover, and hourly precip", () => {
    expect(forecast.current.uvIndex).toBeNull();
    expect(forecast.current.cloudCoverPct).toBeNull();
    expect(forecast.current.precipLast1hMm).toBeNull();
  });
});

describe("nws normalize — forecast windows", () => {
  test("forecastHours truncates the hourly series", () => {
    expect(normalize({ forecastHours: 12 }).hourly.length).toBe(12);
  });

  test("forecastDays truncates the merged daily series", () => {
    const days = normalize({ forecastDays: 3 }).daily;
    expect(days.length).toBe(3);
    expect(days.map((day) => day.dateLocal)).toEqual(["2026-08-28", "2026-08-29", "2026-08-30"]);
  });
});
