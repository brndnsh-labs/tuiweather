import type { z } from "zod";
import type { GeoPoint, NormalizedForecast } from "../../weather/types";
import { type ForecastWindow, ProviderError, type WeatherProvider } from "../types";
import { normalizeNwsForecast } from "./normalize";
import {
  forecastResponseSchema,
  nwsProblemSchema,
  observationResponseSchema,
  pointsResponseSchema,
  stationsResponseSchema,
} from "./schemas";

export const NWS_PROVIDER_ID = "nws";

export const NWS_USER_AGENT = "tuiweather/0.1 (github.com/brndnsh-labs/tuiweather)";

const API_ROOT = "https://api.weather.gov";
const TIMEOUT_MS = 10_000;
const MAX_DETAIL_CHARS = 200;

const NWS_HEADERS = {
  "User-Agent": NWS_USER_AGENT,
  Accept: "application/geo+json",
} as const;

export function buildPointsUrl(location: GeoPoint): string {
  return `${API_ROOT}/points/${location.latitude},${location.longitude}`;
}

function isControl(code: number): boolean {
  return code <= 0x1f || code === 0x7f;
}

function sanitizeText(text: string): string {
  let out = "";
  for (const ch of text) {
    if (!isControl(ch.codePointAt(0) ?? 0)) out += ch;
  }
  return out.slice(0, MAX_DETAIL_CHARS);
}

function problemDetail(body: unknown): string | undefined {
  const parsed = nwsProblemSchema.safeParse(body);
  if (!parsed.success) return undefined;
  const detail = parsed.data.detail ?? parsed.data.title;
  return detail === undefined ? undefined : sanitizeText(detail);
}

async function getJson(url: string, label: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers: NWS_HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (cause) {
    throw new ProviderError(
      `nws ${label} request failed before an HTTP response`,
      NWS_PROVIDER_ID,
      cause,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (cause) {
    throw new ProviderError(
      `nws ${label} returned a non-JSON body (HTTP ${res.status})`,
      NWS_PROVIDER_ID,
      cause,
    );
  }

  if (!res.ok) {
    const detail = problemDetail(body);
    throw new ProviderError(
      `nws ${label} failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`,
      NWS_PROVIDER_ID,
    );
  }
  return body;
}

function parseResponse<T extends z.ZodTypeAny>(schema: T, body: unknown, label: string) {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ProviderError(
      `nws ${label} response failed schema validation`,
      NWS_PROVIDER_ID,
      parsed.error,
    );
  }
  return parsed.data;
}

export async function fetchForecast(
  location: GeoPoint,
  window?: ForecastWindow,
): Promise<NormalizedForecast> {
  const points = parseResponse(
    pointsResponseSchema,
    await getJson(buildPointsUrl(location), "points"),
    "points",
  );

  const [hourlyBody, dailyBody, stationsBody] = await Promise.all([
    getJson(points.properties.forecastHourly, "hourly forecast"),
    getJson(points.properties.forecast, "daily forecast"),
    getJson(points.properties.observationStations, "observation stations"),
  ]);

  const stations = parseResponse(stationsResponseSchema, stationsBody, "observation stations");
  const station = stations.features[0];
  if (station === undefined) {
    throw new ProviderError(
      "nws observation stations list is empty; cannot fetch a current observation",
      NWS_PROVIDER_ID,
    );
  }
  const obs = parseResponse(
    observationResponseSchema,
    await getJson(`${station.id}/observations/latest`, "latest observation"),
    "latest observation",
  );

  return normalizeNwsForecast(
    {
      points: points.properties,
      hourly: parseResponse(forecastResponseSchema, hourlyBody, "hourly forecast").properties
        .periods,
      daily: parseResponse(forecastResponseSchema, dailyBody, "daily forecast").properties.periods,
      obs: obs.properties,
    },
    location,
    window,
  );
}

export const nwsProvider: WeatherProvider = {
  id: NWS_PROVIDER_ID,
  getForecast: (location, window) => fetchForecast(location, window),
};
