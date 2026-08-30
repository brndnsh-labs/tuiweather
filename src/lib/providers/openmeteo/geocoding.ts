import type { z } from "zod";
import { causeSuffix, errorReason, httpError, readJsonCapped, sanitizeText } from "../http";
import type { GeocodingResult } from "../types";
import { ProviderError } from "../types";
import { apiErrorBodySchema, geocodingResponseSchema, type geocodingResultSchema } from "./schemas";

const GEOCODING_ENDPOINT = "https://geocoding-api.open-meteo.com/v1/search";
const TIMEOUT_MS = 10_000;
const NAME_MAX_CELLS = 120;

export type OpenMeteoGeocodingResult = z.infer<typeof geocodingResultSchema>;

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
      `openmeteo geocoding failed: ${sanitizeText(errorParsed.data.reason ?? "unknown error", 200)}`,
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
  const results = parsed.data.results ?? [];
  // Sanitize at the provider boundary: names flow verbatim into the search
  // list, the sidebar, and config.toml, so no host string may carry terminal
  // control sequences into the TUI.
  for (const r of results) {
    r.name = sanitizeText(r.name, NAME_MAX_CELLS);
    if (r.country !== undefined) r.country = sanitizeText(r.country, NAME_MAX_CELLS);
    if (r.admin1 !== undefined) r.admin1 = sanitizeText(r.admin1, NAME_MAX_CELLS);
    if (r.admin2 !== undefined) r.admin2 = sanitizeText(r.admin2, NAME_MAX_CELLS);
  }
  return results;
}

export async function searchLocations(query: string, count = 8): Promise<GeocodingResult[]> {
  let res: Response;
  try {
    res = await fetch(buildGeocodingUrl(query, count), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    throw new ProviderError(
      `openmeteo geocoding request failed before an HTTP response${causeSuffix(cause)}`,
      "openmeteo",
      cause,
    );
  }

  let body: unknown;
  try {
    body = await readJsonCapped(res, { providerId: "openmeteo", label: "geocoding" });
  } catch (cause) {
    if (cause instanceof ProviderError) throw cause;
    throw new ProviderError(
      `openmeteo geocoding returned a non-JSON body (HTTP ${res.status})`,
      "openmeteo",
      cause,
    );
  }

  if (!res.ok || errorReason(body, apiErrorBodySchema) !== undefined) {
    throw httpError(res.status, body, {
      label: "geocoding",
      providerId: "openmeteo",
      schema: apiErrorBodySchema,
    });
  }
  return parseGeocodingResponse(body);
}
