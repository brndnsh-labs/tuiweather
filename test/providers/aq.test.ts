import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  AIR_QUALITY_ENDPOINT,
  aqResponseSchema,
  buildAirQualityUrl,
  fetchAirQuality,
} from "../../src/lib/providers/openmeteo/aq";
import { ProviderError } from "../../src/lib/providers/types";

const PORTLAND = { latitude: 45.5, longitude: -122.7 };
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

describe("aqResponseSchema", () => {
  test("parses recorded Portland air-quality fixture", async () => {
    const body = await Bun.file(
      join(import.meta.dir, "..", "fixtures", "openmeteo", "portland-aq.json"),
    ).json();
    const parsed = aqResponseSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.current.us_aqi).toBe(29);
    expect(parsed.data.current.time).toBe("2026-08-28T22:00");
    expect(parsed.data.utc_offset_seconds).toBe(0);
  });

  test("tolerates extra fields", async () => {
    const body = await Bun.file(
      join(import.meta.dir, "..", "fixtures", "openmeteo", "portland-aq.json"),
    ).json();
    const enriched = { ...body, extra: "field", current: { ...body.current, extra2: 123 } };
    expect(aqResponseSchema.safeParse(enriched).success).toBe(true);
  });

  test("nullable fields can be null or missing", () => {
    const base = {
      utc_offset_seconds: 0,
      timezone: "GMT",
      current: { time: "2026-08-28T22:00", us_aqi: null },
    };
    expect(aqResponseSchema.safeParse(base).success).toBe(true);
    const missing = {
      utc_offset_seconds: 0,
      timezone: "GMT",
      current: { time: "2026-08-28T22:00" },
    };
    const parsed = aqResponseSchema.safeParse(missing);
    expect(parsed.success).toBe(true);
  });
});

describe("buildAirQualityUrl", () => {
  test("targets the air-quality endpoint with expected params", () => {
    const url = buildAirQualityUrl(PORTLAND);
    expect(url.startsWith(`${AIR_QUALITY_ENDPOINT}?`)).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("latitude")).toBe("45.5");
    expect(params.get("longitude")).toBe("-122.7");
    expect(params.get("current")).toBe("us_aqi");
  });
});

describe("fetchAirQuality", () => {
  test("normalizes fixture response with absolute instant", async () => {
    const body = await Bun.file(
      join(import.meta.dir, "..", "fixtures", "openmeteo", "portland-aq.json"),
    ).json();
    mockResponds(JSON.stringify(body), 200);
    const aq = await fetchAirQuality(PORTLAND);
    expect(aq.usAqi).toBe(29);
    expect(aq.observedAtUtc).toBe("2026-08-28T22:00:00.000Z");
  });

  test("applies utc_offset_seconds to convert local-naive time", async () => {
    const body = {
      utc_offset_seconds: 3600,
      timezone: "Europe/Paris",
      current: { time: "2026-08-28T23:00", us_aqi: 42 },
    };
    mockResponds(JSON.stringify(body), 200);
    const aq = await fetchAirQuality(PORTLAND);
    expect(aq.observedAtUtc).toBe("2026-08-28T22:00:00.000Z");
    expect(aq.usAqi).toBe(42);
  });

  test("null fields become null in output", async () => {
    const body = {
      utc_offset_seconds: 0,
      timezone: "GMT",
      current: { time: "2026-08-28T22:00", us_aqi: null },
    };
    mockResponds(JSON.stringify(body), 200);
    const aq = await fetchAirQuality(PORTLAND);
    expect(aq.usAqi).toBeNull();
  });

  test("wraps transport failures", async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError("down"))) as unknown as typeof fetch;
    const error = await captureProviderError(fetchAirQuality(PORTLAND));
    expect(error.message).toContain("before an HTTP response");
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  test("wraps HTTP error with reason", async () => {
    mockResponds(JSON.stringify({ error: true, reason: "quota" }), 400);
    const error = await captureProviderError(fetchAirQuality(PORTLAND));
    expect(error.message).toBe("openmeteo air-quality failed (HTTP 400): quota");
    expect(error.message).not.toContain("https://");
  });

  test("unified air-quality shape omits reason when absent", async () => {
    mockResponds(JSON.stringify({ error: true }), 400);
    const error = await captureProviderError(fetchAirQuality(PORTLAND));
    expect(error.message).toBe("openmeteo air-quality failed (HTTP 400)");
  });

  test("wraps non-JSON body", async () => {
    mockResponds("<html>", 502);
    const error = await captureProviderError(fetchAirQuality(PORTLAND));
    expect(error.message).toContain("non-JSON");
  });

  test("wraps schema validation failures", async () => {
    mockResponds(JSON.stringify({ bad: true }), 200);
    const error = await captureProviderError(fetchAirQuality(PORTLAND));
    expect(error.message).toContain("schema validation");
  });
});
