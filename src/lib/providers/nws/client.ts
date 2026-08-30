import type { z } from "zod";
import packageJson from "../../../../package.json";
import type { GeoPoint, NormalizedForecast } from "../../weather/types";
import { causeSuffix, httpError, readJsonCapped } from "../http";
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

export const NWS_USER_AGENT = `tuiweather/${packageJson.version} (github.com/brndnsh-labs/tuiweather)`;

const API_ROOT = "https://api.weather.gov";
const ALLOWED_HOST = new URL(API_ROOT).host;
const TIMEOUT_MS = 10_000;
const MAX_DETAIL_CHARS = 200;

export const NWS_METADATA_TTL_MS = 24 * 60 * 60 * 1000;
const NWS_METADATA_MAX_ENTRIES = 64;

export function nwsProblemReason(data: unknown): string | undefined {
  const v = data as { detail?: unknown; title?: unknown };
  const candidate = v.detail ?? v.title;
  return typeof candidate === "string" ? candidate : undefined;
}

type NwsMetadata = {
  points: import("./schemas").NwsPointsProperties;
  stationId: string;
};

function metadataKey(location: GeoPoint): string {
  return `${location.latitude.toFixed(4)}:${location.longitude.toFixed(4)}`;
}

const nwsMetadataMemo = new Map<string, { value: NwsMetadata; expiresAt: number }>();
const pendingForecasts = new Map<string, Promise<NormalizedForecast>>();

function evictOldestIfNeeded(): void {
  while (nwsMetadataMemo.size > NWS_METADATA_MAX_ENTRIES) {
    const oldest = nwsMetadataMemo.keys().next().value;
    if (oldest === undefined) break;
    nwsMetadataMemo.delete(oldest);
  }
}

export function __resetNwsMetadataMemoForTests(): void {
  nwsMetadataMemo.clear();
  pendingForecasts.clear();
}

export const NWS_HEADERS = {
  "User-Agent": NWS_USER_AGENT,
  Accept: "application/geo+json",
} as const;

export function buildPointsUrl(location: GeoPoint): string {
  return `${API_ROOT}/points/${location.latitude},${location.longitude}`;
}

async function getJson(url: string, label: string): Promise<unknown> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new ProviderError(`nws ${label} url is not absolute`, NWS_PROVIDER_ID);
  }
  if (target.protocol !== "https:" || target.host !== ALLOWED_HOST) {
    throw new ProviderError(`nws ${label} url host rejected`, NWS_PROVIDER_ID);
  }
  let res: Response;
  try {
    res = await fetch(url, {
      headers: NWS_HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.toLowerCase().includes("redirect")) {
      throw new ProviderError(`nws ${label} redirected off-host`, NWS_PROVIDER_ID, cause);
    }
    throw new ProviderError(
      `nws ${label} request failed before an HTTP response${causeSuffix(cause)}`,
      NWS_PROVIDER_ID,
      cause,
    );
  }

  if (res.url) {
    let final: URL;
    try {
      final = new URL(res.url);
    } catch {
      throw new ProviderError(`nws ${label} redirected off-host`, NWS_PROVIDER_ID);
    }
    if (final.protocol !== "https:" || final.host !== ALLOWED_HOST) {
      throw new ProviderError(`nws ${label} redirected off-host`, NWS_PROVIDER_ID);
    }
  }

  let body: unknown;
  try {
    body = await readJsonCapped(res, { providerId: NWS_PROVIDER_ID, label });
  } catch (cause) {
    if (cause instanceof ProviderError) throw cause;
    throw new ProviderError(
      `nws ${label} returned a non-JSON body (HTTP ${res.status})`,
      NWS_PROVIDER_ID,
      cause,
    );
  }

  if (!res.ok) {
    throw httpError(res.status, body, {
      label,
      providerId: NWS_PROVIDER_ID,
      schema: nwsProblemSchema,
      maxChars: MAX_DETAIL_CHARS,
      extractor: nwsProblemReason,
    });
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
  const key = metadataKey(location);
  const pendingKey = `${key}|${window?.forecastDays ?? "*"}|${window?.forecastHours ?? "*"}`;
  const pending = pendingForecasts.get(pendingKey);
  if (pending) return pending;

  const task = (async (): Promise<NormalizedForecast> => {
    const cached = nwsMetadataMemo.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      const meta = cached.value;
      const [hourlyBody, dailyBody, obsBody] = await Promise.all([
        getJson(meta.points.forecastHourly, "hourly forecast"),
        getJson(meta.points.forecast, "daily forecast"),
        getJson(`${meta.stationId}/observations/latest`, "latest observation"),
      ]);
      return normalizeNwsForecast(
        {
          points: meta.points,
          hourly: parseResponse(forecastResponseSchema, hourlyBody, "hourly forecast").properties
            .periods,
          daily: parseResponse(forecastResponseSchema, dailyBody, "daily forecast").properties
            .periods,
          obs: parseResponse(observationResponseSchema, obsBody, "latest observation").properties,
        },
        location,
        window,
      );
    }
    if (cached) nwsMetadataMemo.delete(key);

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

    const meta: NwsMetadata = { points: points.properties, stationId: station.id };
    nwsMetadataMemo.set(key, { value: meta, expiresAt: Date.now() + NWS_METADATA_TTL_MS });
    evictOldestIfNeeded();

    return normalizeNwsForecast(
      {
        points: points.properties,
        hourly: parseResponse(forecastResponseSchema, hourlyBody, "hourly forecast").properties
          .periods,
        daily: parseResponse(forecastResponseSchema, dailyBody, "daily forecast").properties
          .periods,
        obs: obs.properties,
      },
      location,
      window,
    );
  })();

  pendingForecasts.set(pendingKey, task);
  try {
    return await task;
  } finally {
    pendingForecasts.delete(pendingKey);
  }
}

export const nwsProvider: WeatherProvider = {
  id: NWS_PROVIDER_ID,
  getForecast: (location, window) => fetchForecast(location, window),
};
