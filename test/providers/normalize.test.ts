import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { normalizeForecast } from "../../src/lib/providers/openmeteo/normalize";
import { forecastResponseSchema } from "../../src/lib/providers/openmeteo/schemas";

const FIXTURES = join(import.meta.dir, "..", "fixtures", "openmeteo");

const portlandBody = await Bun.file(join(FIXTURES, "portland.json")).json();
const tokyoBody = await Bun.file(join(FIXTURES, "tokyo.json")).json();

const portland = normalizeForecast(forecastResponseSchema.parse(portlandBody));
const tokyo = normalizeForecast(forecastResponseSchema.parse(tokyoBody));

function toUtc(label: string, offsetSeconds: number): string {
  return new Date(Date.parse(`${label}Z`) - offsetSeconds * 1000).toISOString();
}

describe("normalizeForecast", () => {
  test("emits only Z-suffixed absolute timestamps for both cities", () => {
    for (const forecast of [portland, tokyo]) {
      const stamps = [
        forecast.current.timeUtc,
        forecast.fetchedAtUtc,
        ...forecast.minutely15.flatMap((bucket) => [bucket.startUtc, bucket.endUtc]),
        ...forecast.hourly.map((point) => point.timeUtc),
        ...forecast.daily.flatMap((day) => [day.sunriseUtc, day.sunsetUtc]),
      ].filter((stamp): stamp is string => stamp !== null);
      expect(stamps.length).toBeGreaterThan(0);
      for (const stamp of stamps) {
        const parsed = new Date(stamp);
        expect(stamp.endsWith("Z")).toBe(true);
        expect(Number.isNaN(parsed.getTime())).toBe(false);
      }
    }
  });

  test("converts local-naive labels using utc_offset_seconds (Portland, UTC-7)", () => {
    const offset = portlandBody.utc_offset_seconds;
    const label = portlandBody.hourly.time[5];
    expect(portland.hourly[5]?.timeUtc).toBe(toUtc(label, offset));

    const currentLabel = portlandBody.current.time;
    expect(portland.current.timeUtc).toBe(toUtc(currentLabel, offset));
  });

  test("preserves minutely bucket count and labels each bucket by its END instant", () => {
    const body = portlandBody.minutely_15;
    expect(portland.minutely15.length).toBe(body.time.length);
    for (const [i, bucket] of portland.minutely15.entries()) {
      expect(bucket.endUtc).toBe(toUtc(body.time[i], portlandBody.utc_offset_seconds));
      expect(bucket.startUtc).toBe(
        new Date(Date.parse(bucket.endUtc) - 15 * 60 * 1000).toISOString(),
      );
      expect(Date.parse(bucket.endUtc) - Date.parse(bucket.startUtc)).toBe(15 * 60 * 1000);
    }
    expect(portland.minutely15[0]?.precipMm).toBe(body.precipitation[0]);
  });

  test("maps Tokyo labels across UTC+9 and agrees with Portland on the absolute instant", () => {
    const offset = tokyoBody.utc_offset_seconds;
    expect(offset).toBe(9 * 3600);
    expect(tokyo.current.timeUtc).toBe(toUtc(tokyoBody.current.time, offset));

    // Both fixtures were recorded during the same quarter-hour, so their local labels
    // convert to the identical UTC instant despite the 16-hour offset gap.
    expect(tokyoBody.current.time).toBe("2026-09-02T21:45");
    expect(portlandBody.current.time).toBe("2026-09-02T05:45");
    expect(tokyo.current.timeUtc).toBe(portland.current.timeUtc);
  });

  test("keeps daily dates location-local while sunrise/sunset become instants", () => {
    expect(portland.daily[0]?.dateLocal).toBe(portlandBody.daily.time[0]);
    expect(tokyo.daily[0]?.dateLocal).toBe(tokyoBody.daily.time[0]);

    const offset = portlandBody.utc_offset_seconds;
    const sunrise = portlandBody.daily.sunrise[0];
    expect(portland.daily[0]?.sunriseUtc).toBe(toUtc(sunrise, offset));
    expect(portland.daily[0]?.sunriseUtc?.endsWith("Z")).toBe(true);
  });

  test("preserves order of hourly instants", () => {
    for (const forecast of [portland, tokyo]) {
      let previous = -Infinity;
      for (const point of forecast.hourly) {
        const t = Date.parse(point.timeUtc);
        expect(t).toBeGreaterThan(previous);
        previous = t;
      }
    }
  });

  test("trims trailing hours whose core values are null, if the recording has any", () => {
    // Whether the live recording window ends on a null-padded hour depends on Open-Meteo's
    // model availability at capture time; assert the trim invariant either way rather than
    // requiring nulls to be present (see the synthetic case below for a deterministic check).
    const firstNull = portlandBody.hourly.temperature_2m.indexOf(null);
    expect(portland.hourly.length).toBe(
      firstNull === -1 ? portlandBody.hourly.time.length : firstNull,
    );

    for (const point of portland.hourly) {
      expect(typeof point.temperatureC).toBe("number");
      expect(typeof point.precipMm).toBe("number");
      expect(typeof point.condition).toBe("string");
    }
  });

  test("passes nulls through without fabricating values", () => {
    const body = syntheticBody();
    const forecast = normalizeForecast(forecastResponseSchema.parse(body));

    expect(forecast.current.isDay).toBe(true);
    expect(forecast.current.windGustKmh).toBeNull();
    expect(forecast.current.pressureHpa).toBeNull();
    expect(forecast.current.dewPointC).toBeNull();
    expect(forecast.current.visibilityM).toBeNull();
    expect(forecast.current.uvIndex).toBeNull();

    expect(forecast.minutely15[0]?.probabilityPct).toBeNull();
    expect(forecast.minutely15[1]?.probabilityPct).toBe(30);

    expect(forecast.hourly.length).toBe(2);
    expect(forecast.hourly[1]?.isDay).toBe(false);
    expect(forecast.hourly[1]?.windGustKmh).toBe(33);
    expect(forecast.hourly[1]?.uvIndex).toBeNull();

    expect(forecast.daily[0]?.sunriseUtc).toBe(
      new Date(Date.parse("2026-08-24T06:00Z") - 3600 * 1000).toISOString(),
    );
  });

  test("treats an absent probability series as all-null", () => {
    const body = syntheticBody({ probabilities: false });
    const forecast = normalizeForecast(forecastResponseSchema.parse(body));
    expect(forecast.minutely15.every((bucket) => bucket.probabilityPct === null)).toBe(true);
    expect(forecast.hourly.every((point) => point.precipProbabilityPct === null)).toBe(true);
  });

  test("keeps the requested location when provided", () => {
    const requested = { latitude: 45.5202, longitude: -122.6742 };
    const forecast = normalizeForecast(forecastResponseSchema.parse(syntheticBody()), requested);
    expect(forecast.location).toEqual(requested);
    expect(forecast.location.latitude).not.toBe(10.5);
  });
});

function syntheticBody({ probabilities = true }: { probabilities?: boolean } = {}) {
  const minutely: Record<string, unknown> = {
    time: ["2026-08-24T11:00", "2026-08-24T11:15", "2026-08-24T11:30"],
    precipitation: [0, 0.4, 1.1],
  };
  const hourly: Record<string, unknown> = {
    time: ["2026-08-24T11:00", "2026-08-24T12:00", "2026-08-24T13:00"],
    temperature_2m: [18, 19, null],
    relative_humidity_2m: [60, 62, null],
    apparent_temperature: [17, 18.5, null],
    precipitation: [0, 0.5, null],
    weather_code: [2, 61, null],
    wind_speed_10m: [5, 7, null],
    wind_direction_10m: [10, 20, null],
    wind_gusts_10m: [null, 33, null],
    uv_index: [3.5, null, null],
    visibility: [24140, null, null],
    is_day: [1, "0", 1],
  };
  if (probabilities) {
    minutely.precipitation_probability = [null, 30, 90];
    hourly.precipitation_probability = [10, null, null];
  }
  return {
    latitude: 10.5,
    longitude: -20.25,
    utc_offset_seconds: 3600,
    timezone: "Europe/Paris",
    current: {
      time: "2026-08-24T12:15",
      temperature_2m: 21.5,
      relative_humidity_2m: 55,
      apparent_temperature: 22.5,
      is_day: "1",
      weather_code: 61,
      pressure_msl: null,
      wind_speed_10m: 9.1,
      wind_direction_10m: 180,
      wind_gusts_10m: null,
      dew_point_2m: null,
    },
    minutely_15: minutely,
    hourly,
    daily: {
      time: ["2026-08-24"],
      weather_code: [61],
      temperature_2m_max: [23.9],
      temperature_2m_min: [12.3],
      precipitation_sum: [1.2],
      precipitation_probability_max: [70],
      sunrise: ["2026-08-24T06:00"],
      sunset: ["2026-08-24T21:00"],
      wind_speed_10m_max: [22],
    },
  };
}
