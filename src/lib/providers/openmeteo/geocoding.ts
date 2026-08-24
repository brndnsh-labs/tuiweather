import type { z } from "zod";
import { ProviderError } from "../types";
import { apiErrorBodySchema, geocodingResponseSchema, type geocodingResultSchema } from "./schemas";

const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const TIMEOUT_MS = 10_000;

export type GeocodingResult = z.infer<typeof geocodingResultSchema>;

export function buildGeocodingUrl(query: string, count = 8): string {
  const params = new URLSearchParams({
    name: query,
    count: String(count),
    language: "en",
    format: "json",
  });
  return `${GEOCODING_ENDPOINT}?${params.toString()}`;
}

export function parseGeocodingResponse(body: unknown): GeocodingResult[] {
  const errorParsed = apiErrorBodySchema.safeParse(body);
  if (errorParsed.success) {
    throw new ProviderError(
      `openmeteo geocoding failed: ${errorParsed.data.reason ?? "unknown error"}`,
      "openmeteo",
    );
  }
  const parsed = geocodingResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new ProviderError(
      "openmeteo geocoding response failed schema validation",
      "openmeteo",
      parsed.error,
    );
  }
  return parsed.data.results ?? [];
}

export async function searchLocations(query: string, count = 8): Promise<GeocodingResult[]> {
  let res: Response;
  try {
    res = await fetch(buildGeocodingUrl(query, count), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    throw new ProviderError(
      "openmeteo geocoding request failed before an HTTP response",
      "openmeteo",
      cause,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch (cause) {
    throw new ProviderError(
      `openmeteo geocoding returned a non-JSON body (HTTP ${res.status})`,
      "openmeteo",
      cause,
    );
  }

  if (!res.ok) {
    const reason = apiErrorBodySchema.safeParse(body);
    const detail = reason.success ? `: ${reason.data.reason ?? "unknown error"}` : "";
    throw new ProviderError(
      `openmeteo geocoding failed (HTTP ${res.status})${detail}`,
      "openmeteo",
    );
  }
  return parseGeocodingResponse(body);
}
