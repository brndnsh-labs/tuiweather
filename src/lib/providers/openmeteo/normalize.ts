import type {
  CurrentObs,
  DailyPoint,
  GeoPoint,
  HourlyPoint,
  NormalizedForecast,
  PrecipInterval,
} from "../../weather/types";
import { ProviderError } from "../types";
import type { ForecastResponse, MinutelyBlock } from "./schemas";
import { wmoToCondition } from "./wmo";

const PROVIDER_ID = "openmeteo";
const BUCKET_MS = 15 * 60 * 1000;

function requireNum(series: readonly (number | null)[], index: number, field: string): number {
  const value = series[index];
  if (typeof value !== "number") {
    throw new ProviderError(
      `openmeteo ${field}[${index}] is null where a value is required`,
      PROVIDER_ID,
    );
  }
  return value;
}

function optNum(series: readonly (number | null)[] | undefined, index: number): number | null {
  const value = series?.[index];
  return typeof value === "number" ? value : null;
}

function coerceIsDay(value: number | string | undefined): boolean {
  return value === 1 || value === "1";
}

function trimTrailingNullCores(
  count: number,
  coreSeries: ReadonlyArray<readonly (number | null)[]>,
): number {
  outer: while (count > 0) {
    for (const series of coreSeries) {
      if (series[count - 1] === null) {
        count--;
        continue outer;
      }
    }
    break;
  }
  return count;
}

export function normalizeForecast(
  data: ForecastResponse,
  locationOverride?: GeoPoint,
): NormalizedForecast {
  const offsetMs = data.utc_offset_seconds * 1000;
  const toUtc = (label: string): string =>
    new Date(Date.parse(`${label}Z`) - offsetMs).toISOString();

  const cur = data.current;
  const current: CurrentObs = {
    timeUtc: toUtc(cur.time),
    temperatureC: cur.temperature_2m,
    apparentC: cur.apparent_temperature,
    humidityPct: cur.relative_humidity_2m,
    condition: wmoToCondition(cur.weather_code),
    windSpeedKmh: cur.wind_speed_10m,
    windDirectionDeg: cur.wind_direction_10m,
    windGustKmh: cur.wind_gusts_10m ?? null,
    pressureHpa: cur.pressure_msl ?? null,
    cloudCoverPct: cur.cloud_cover ?? null,
    dewPointC: cur.dew_point_2m ?? null,
    visibilityM: null,
    uvIndex: null,
    precipLast1hMm: cur.precipitation ?? null,
    isDay: coerceIsDay(cur.is_day),
  };

  const minutely15 = normalizeMinutely(data.minutely_15, toUtc);

  const h = data.hourly;
  const hourlyCount = trimTrailingNullCores(h.time.length, [h.temperature_2m, h.weather_code]);
  const hourly: HourlyPoint[] = [];
  for (const [i, label] of h.time.slice(0, hourlyCount).entries()) {
    hourly.push({
      timeUtc: toUtc(label),
      temperatureC: requireNum(h.temperature_2m, i, "hourly.temperature_2m"),
      apparentC: requireNum(h.apparent_temperature, i, "hourly.apparent_temperature"),
      precipMm: requireNum(h.precipitation, i, "hourly.precipitation"),
      precipProbabilityPct: optNum(h.precipitation_probability, i),
      condition: wmoToCondition(requireNum(h.weather_code, i, "hourly.weather_code")),
      windSpeedKmh: requireNum(h.wind_speed_10m, i, "hourly.wind_speed_10m"),
      windGustKmh: optNum(h.wind_gusts_10m, i),
      windDirectionDeg: requireNum(h.wind_direction_10m, i, "hourly.wind_direction_10m"),
      humidityPct: optNum(h.relative_humidity_2m, i),
      uvIndex: optNum(h.uv_index, i),
      isDay: coerceIsDay(h.is_day[i]),
    });
  }

  const d = data.daily;
  const dailyCount = trimTrailingNullCores(d.time.length, [
    d.weather_code,
    d.temperature_2m_max,
    d.temperature_2m_min,
    d.precipitation_sum,
  ]);
  const daily: DailyPoint[] = [];
  for (const [i, dateLocal] of d.time.slice(0, dailyCount).entries()) {
    const sunrise = d.sunrise?.[i];
    const sunset = d.sunset?.[i];
    daily.push({
      dateLocal,
      condition: wmoToCondition(requireNum(d.weather_code, i, "daily.weather_code")),
      tempMinC: requireNum(d.temperature_2m_min, i, "daily.temperature_2m_min"),
      tempMaxC: requireNum(d.temperature_2m_max, i, "daily.temperature_2m_max"),
      precipSumMm: requireNum(d.precipitation_sum, i, "daily.precipitation_sum"),
      precipProbabilityMaxPct: optNum(d.precipitation_probability_max, i),
      uvIndexMax: optNum(d.uv_index_max, i),
      sunriseUtc: typeof sunrise === "string" ? toUtc(sunrise) : null,
      sunsetUtc: typeof sunset === "string" ? toUtc(sunset) : null,
      windSpeedMaxKmh: optNum(d.wind_speed_10m_max, i),
      windGustMaxKmh: optNum(d.wind_gusts_10m_max, i),
    });
  }

  return {
    providerId: PROVIDER_ID,
    location: locationOverride ?? { latitude: data.latitude, longitude: data.longitude },
    timezone: data.timezone,
    utcOffsetSeconds: data.utc_offset_seconds,
    fetchedAtUtc: new Date().toISOString(),
    current,
    minutely15,
    hourly,
    daily,
  };
}

function normalizeMinutely(
  block: MinutelyBlock,
  toUtc: (label: string) => string,
): PrecipInterval[] {
  return block.time.map((label, i) => {
    const endUtc = toUtc(label);
    return {
      startUtc: new Date(Date.parse(endUtc) - BUCKET_MS).toISOString(),
      endUtc,
      precipMm: requireNum(block.precipitation, i, "minutely_15.precipitation"),
      probabilityPct: optNum(block.precipitation_probability, i),
    };
  });
}
