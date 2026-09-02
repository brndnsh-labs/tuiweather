import type { GeoPoint, NormalizedForecast } from "../../weather/types";
import { causeSuffix, errorReason, httpError, readJsonCapped } from "../http";
import { ProviderError } from "../types";
import { normalizeForecast } from "./normalize";
import { apiErrorBodySchema, forecastResponseSchema, MAX_REASON_CHARS } from "./schemas";

export const OPENMETEO_PROVIDER_ID = "openmeteo";

const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const TIMEOUT_MS = 10_000;

/**
 * Daily block depth is fixed, not driven by `daily_days` — the UI pages through this fixed
 * pool (see DailyList's DAILY_PAGE_SIZE) rather than re-fetching a wider window on demand.
 */
const DAILY_FORECAST_DAYS = 14;

const CURRENT_VARIABLES = [
  "temperature_2m",
  "relative_humidity_2m",
  "apparent_temperature",
  "is_day",
  "weather_code",
  "pressure_msl",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "dew_point_2m",
] as const;

const MINUTELY_VARIABLES = ["precipitation", "precipitation_probability"] as const;

const HOURLY_VARIABLES = [
  "temperature_2m",
  "relative_humidity_2m",
  "apparent_temperature",
  "precipitation",
  "precipitation_probability",
  "weather_code",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "uv_index",
  "visibility",
  "is_day",
] as const;

const DAILY_VARIABLES = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "precipitation_probability_max",
  "sunrise",
  "sunset",
  "wind_speed_10m_max",
] as const;

export interface ForecastOptions {
  /** Accepted for shape-compatibility with ForecastWindow; ignored — see DAILY_FORECAST_DAYS. */
  forecastDays?: number;
  forecastHours?: number;
  pastMinutely15?: number;
  forecastMinutely15?: number;
}

export function buildForecastUrl(location: GeoPoint, opts: ForecastOptions = {}): string {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: CURRENT_VARIABLES.join(","),
    minutely_15: MINUTELY_VARIABLES.join(","),
    hourly: HOURLY_VARIABLES.join(","),
    daily: DAILY_VARIABLES.join(","),
    timezone: "auto",
    timeformat: "iso8601",
    forecast_days: String(DAILY_FORECAST_DAYS),
    past_minutely_15: String(opts.pastMinutely15 ?? 8),
    forecast_minutely_15: String(opts.forecastMinutely15 ?? 12),
  });
  if (opts.forecastHours !== undefined) {
    params.set("forecast_hours", String(opts.forecastHours));
  }
  return `${FORECAST_ENDPOINT}?${params.toString()}`;
}

function httpErrorFor(status: number, body: unknown): ProviderError {
  return httpError(status, body, {
    label: "forecast",
    providerId: OPENMETEO_PROVIDER_ID,
    schema: apiErrorBodySchema,
    maxChars: MAX_REASON_CHARS,
  });
}

export async function fetchForecast(
  location: GeoPoint,
  opts: ForecastOptions = {},
): Promise<NormalizedForecast> {
  let res: Response;
  try {
    res = await fetch(buildForecastUrl(location, opts), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    throw new ProviderError(
      `openmeteo forecast request failed before an HTTP response${causeSuffix(cause)}`,
      OPENMETEO_PROVIDER_ID,
      cause,
    );
  }

  let body: unknown;
  try {
    body = await readJsonCapped(res, {
      providerId: OPENMETEO_PROVIDER_ID,
      label: "forecast",
    });
  } catch (cause) {
    if (cause instanceof ProviderError) throw cause;
    throw new ProviderError(
      `openmeteo forecast returned a non-JSON body (HTTP ${res.status})`,
      OPENMETEO_PROVIDER_ID,
      cause,
    );
  }

  if (!res.ok || errorReason(body, apiErrorBodySchema) !== undefined) {
    throw httpErrorFor(res.status, body);
  }

  const parsed = forecastResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ProviderError(
      `openmeteo forecast response failed schema validation (HTTP ${res.status})`,
      OPENMETEO_PROVIDER_ID,
      parsed.error,
    );
  }
  return normalizeForecast(parsed.data, location);
}
