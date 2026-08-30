import { z } from "zod";
import type { AirQuality, GeoPoint } from "../../weather/types";
import { errorReason, httpError, readJsonCapped } from "../http";
import { ProviderError } from "../types";
import { apiErrorBodySchema, LOCAL_NAIVE_TIME } from "./schemas";

export const AIR_QUALITY_ENDPOINT = "https://air-quality-api.open-meteo.com/v1/air-quality";
const TIMEOUT_MS = 10_000;

const localNaiveTime = z.string().regex(LOCAL_NAIVE_TIME);

export const aqResponseSchema = z
  .object({
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    utc_offset_seconds: z.number().int(),
    timezone: z.string(),
    current: z
      .object({
        time: localNaiveTime,
        interval: z.number().optional(),
        us_aqi: z.number().nullable().optional(),
        pm2_5: z.number().nullable().optional(),
        ozone: z.number().nullable().optional(),
      })
      .passthrough(),
    current_units: z.unknown().optional(),
  })
  .passthrough();

export type AqResponse = z.infer<typeof aqResponseSchema>;

export function buildAirQualityUrl(location: GeoPoint): string {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: ["us_aqi", "pm2_5", "ozone"].join(","),
  });
  return `${AIR_QUALITY_ENDPOINT}?${params.toString()}`;
}

function httpErrorFor(status: number, body: unknown): ProviderError {
  return httpError(status, body, {
    label: "air-quality",
    providerId: "openmeteo",
    schema: apiErrorBodySchema,
  });
}

function normalizeAirQuality(data: AqResponse): AirQuality {
  const offsetMs = data.utc_offset_seconds * 1000;
  const observedAtUtc = new Date(Date.parse(`${data.current.time}Z`) - offsetMs).toISOString();
  return {
    usAqi: data.current.us_aqi ?? null,
    pm25UgM3: data.current.pm2_5 ?? null,
    ozoneUgM3: data.current.ozone ?? null,
    observedAtUtc,
  };
}

export async function fetchAirQuality(location: GeoPoint): Promise<AirQuality> {
  let res: Response;
  try {
    res = await fetch(buildAirQualityUrl(location), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    throw new ProviderError(
      "openmeteo air-quality request failed before an HTTP response",
      "openmeteo",
      cause,
    );
  }

  let body: unknown;
  try {
    body = await readJsonCapped(res, { providerId: "openmeteo", label: "air-quality" });
  } catch (cause) {
    if (cause instanceof ProviderError) throw cause;
    throw new ProviderError(
      `openmeteo air-quality returned a non-JSON body (HTTP ${res.status})`,
      "openmeteo",
      cause,
    );
  }

  if (!res.ok || errorReason(body, apiErrorBodySchema) !== undefined) {
    throw httpErrorFor(res.status, body);
  }

  const parsed = aqResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ProviderError(
      `openmeteo air-quality response failed schema validation (HTTP ${res.status})`,
      "openmeteo",
      parsed.error,
    );
  }
  return normalizeAirQuality(parsed.data);
}
