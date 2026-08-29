import { afterEach, describe, expect, test } from "bun:test";
import {
  buildGeocodingUrl,
  parseGeocodingResponse,
  searchLocations,
} from "../../src/lib/providers/openmeteo/geocoding";
import { ProviderError } from "../../src/lib/providers/types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockResponds(payload: string, status: number): void {
  globalThis.fetch = (() =>
    Promise.resolve(new Response(payload, { status }))) as unknown as typeof fetch;
}

async function captureProviderError(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProviderError) return error;
    throw new Error(`expected ProviderError, got: ${String(error)}`);
  }
  throw new Error("expected promise to reject with ProviderError");
}

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

  test("strips control characters from a hostile API reason", () => {
    let caught: unknown;
    try {
      parseGeocodingResponse({
        error: true,
        reason: "\u001b]0;pwned\u0007 bad name",
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    if (caught instanceof ProviderError) {
      expect(caught.message.includes("\u001b")).toBe(false);
      expect(caught.message.includes("\u0007")).toBe(false);
      expect(caught.message).toContain("bad name");
    }
  });

  test("rejects malformed payloads", () => {
    expect(() => parseGeocodingResponse({})).toThrow(ProviderError);
    expect(() => parseGeocodingResponse({ results: "nope", generationtime_ms: 1 })).toThrow(
      ProviderError,
    );
  });
});

describe("searchLocations error mapping", () => {
  test("rejects an HTTP 200 body carrying the API error shape with the sanitized reason", async () => {
    mockResponds(JSON.stringify({ error: true, reason: "daily limit exceeded" }), 200);
    const error = await captureProviderError(searchLocations("berlin"));
    expect(error.providerId).toBe("openmeteo");
    expect(error.message).toContain("200");
    expect(error.message).toContain("daily limit exceeded");
    expect(error.message).toContain("openmeteo geocoding failed (HTTP 200)");
    expect(error.message).not.toContain("schema validation");
  });

  test("strips control characters from a 200 error body", async () => {
    mockResponds(JSON.stringify({ error: true, reason: "\u001b]0;pwned\u0007 bad" }), 200);
    const error = await captureProviderError(searchLocations("berlin"));
    expect(error.message.includes("\u001b")).toBe(false);
    expect(error.message.includes("\u0007")).toBe(false);
    expect(error.message).toContain("bad");
  });
});
