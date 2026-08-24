import { describe, expect, test } from "bun:test";
import {
  buildGeocodingUrl,
  parseGeocodingResponse,
} from "../../src/lib/providers/openmeteo/geocoding";
import { ProviderError } from "../../src/lib/providers/types";

const BODY = {
  results: [
    {
      id: 4930956,
      name: "Boston",
      latitude: 42.35843,
      longitude: -71.05977,
      country: "United States",
      country_code: "US",
      admin1: "Massachusetts",
      population: 667137,
    },
    { id: 1234567, name: "Nowhere", latitude: 0.5, longitude: 0.5 },
  ],
  generationtime_ms: 0.52,
};

describe("buildGeocodingUrl", () => {
  test("targets the geocoding endpoint with language and format pinned", () => {
    const url = buildGeocodingUrl("Reykjavík", 3);
    expect(url.startsWith("https://geocoding-api.open-meteo.com/v1/search?")).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("name")).toBe("Reykjavík");
    expect(params.get("count")).toBe("3");
    expect(params.get("language")).toBe("en");
    expect(params.get("format")).toBe("json");
  });

  test("defaults the count to 8", () => {
    expect(new URL(buildGeocodingUrl("oslo")).searchParams.get("count")).toBe("8");
  });
});

describe("parseGeocodingResponse", () => {
  test("maps results and leaves optional fields undefined", () => {
    const results = parseGeocodingResponse(BODY);
    expect(results.length).toBe(2);
    expect(results[0]?.name).toBe("Boston");
    expect(results[0]?.admin1).toBe("Massachusetts");
    expect(results[0]?.timezone).toBeUndefined();
    expect(results[1]?.country).toBeUndefined();
  });

  test("returns an empty array when there are no results", () => {
    expect(parseGeocodingResponse({ generationtime_ms: 0.1 })).toEqual([]);
  });

  test("throws a typed ProviderError carrying the API reason", () => {
    let caught: unknown;
    try {
      parseGeocodingResponse({ error: true, reason: "name is too short" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    if (caught instanceof ProviderError) {
      expect(caught.providerId).toBe("openmeteo");
      expect(caught.message).toContain("name is too short");
    }
  });

  test("rejects malformed payloads", () => {
    expect(() => parseGeocodingResponse({})).toThrow(ProviderError);
    expect(() => parseGeocodingResponse({ results: "nope", generationtime_ms: 1 })).toThrow(
      ProviderError,
    );
  });
});
