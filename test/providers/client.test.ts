import { afterEach, describe, expect, test } from "bun:test";
import { buildForecastUrl, fetchForecast } from "../../src/lib/providers/openmeteo/client";
import { forecastResponseSchema } from "../../src/lib/providers/openmeteo/schemas";
import { ProviderError } from "../../src/lib/providers/types";

const PORTLAND = { latitude: 45.5202, longitude: -122.6742 };

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

describe("buildForecastUrl", () => {
  test("targets the forecast endpoint with timezone=auto and round-tripped coordinates", () => {
    const url = buildForecastUrl(PORTLAND);
    expect(url.startsWith("https://api.open-meteo.com/v1/forecast?")).toBe(true);

    const params = new URL(url).searchParams;
    expect(params.get("timezone")).toBe("auto");
    expect(params.get("latitude")).toBe("45.5202");
    expect(params.get("longitude")).toBe("-122.6742");
    expect(params.get("timeformat")).toBe("iso8601");
  });

  test("requests the documented variable sets and default time windows", () => {
    const params = new URL(buildForecastUrl(PORTLAND)).searchParams;

    const current = params.get("current") ?? "";
    for (const variable of ["temperature_2m", "pressure_msl", "wind_gusts_10m", "dew_point_2m"]) {
      expect(current).toContain(variable);
    }
    // visibility and uv_index are hourly-only; they must not leak into current
    expect(current).not.toContain("visibility");
    expect(current).not.toContain("uv_index");

    const hourly = params.get("hourly") ?? "";
    for (const variable of ["precipitation_probability", "uv_index", "visibility", "is_day"]) {
      expect(hourly).toContain(variable);
    }

    expect(params.get("minutely_15")).toBe("precipitation,precipitation_probability");
    expect(params.get("forecast_days")).toBe("14");
    expect(params.get("past_minutely_15")).toBe("8");
    expect(params.get("forecast_minutely_15")).toBe("12");
    // hourly_hours is opt-in via config; the default request must not pin it
    expect(params.get("forecast_hours")).toBeNull();
  });

  test("honors explicit window overrides, except forecast_days which stays fixed", () => {
    const params = new URL(
      buildForecastUrl(PORTLAND, { forecastDays: 7, forecastHours: 48, pastMinutely15: 4 }),
    ).searchParams;
    expect(params.get("forecast_days")).toBe("14");
    expect(params.get("forecast_hours")).toBe("48");
    expect(params.get("past_minutely_15")).toBe("4");
  });
});

describe("fetchForecast error mapping", () => {
  test("surfaces HTTP status and API reason without echoing the request URL", async () => {
    mockResponds(JSON.stringify({ error: true, reason: "Latitude must be numeric" }), 400);
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.providerId).toBe("openmeteo");
    expect(error.message).toBe("openmeteo forecast failed (HTTP 400): Latitude must be numeric");
    expect(error.message).not.toContain("https://");
    expect(error.message).not.toContain("?");
  });

  test("unified shape omits reason when absent", async () => {
    mockResponds(JSON.stringify({ error: true }), 400);
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.message).toBe("openmeteo forecast failed (HTTP 400)");
  });

  test("rejects an HTTP 200 body carrying the API error shape", async () => {
    mockResponds(JSON.stringify({ error: true, reason: "quota exceeded" }), 200);
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.message).toContain("quota exceeded");
  });

  test("strips control characters and clamps a hostile API reason", async () => {
    const reason = `${"\u001b]0;pwned\u0007".repeat(30)}${"x".repeat(500)}`;
    mockResponds(JSON.stringify({ error: true, reason }), 400);
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.message.includes("\u001b")).toBe(false);
    expect(error.message.includes("\u0007")).toBe(false);
    expect(error.message.length).toBeLessThan(300);
  });

  test("wraps a non-JSON body in ProviderError", async () => {
    mockResponds("<html>gateway</html>", 502);
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.message).toContain("non-JSON");
    expect(error.message).toContain("502");
  });

  test("wraps schema validation failures with the parse error as cause", async () => {
    mockResponds(JSON.stringify({ unexpected: true }), 200);
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.message).toContain("schema validation");
    expect(error.cause).toBeDefined();
  });

  test("wraps transport failures (network/timeout) in ProviderError", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new TypeError("connection refused"))) as unknown as typeof fetch;
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.message).toContain("before an HTTP response");
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  test("appends the sanitized network cause when fetch rejects with an inner cause", async () => {
    globalThis.fetch = (() =>
      Promise.reject(
        new TypeError("fetch failed", {
          cause: new Error("getaddrinfo ENOTFOUND api.open-meteo.com"),
        }),
      )) as unknown as typeof fetch;
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.message).toBe(
      "openmeteo forecast request failed before an HTTP response: getaddrinfo ENOTFOUND api.open-meteo.com",
    );
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  test("omits the suffix when the network cause is empty", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.message).toBe("openmeteo forecast request failed before an HTTP response");
  });

  test("sanitizes control chars and caps a hostile network cause", async () => {
    const hostile = `${"\u001b]0;pwned\u0007\n".repeat(10)}${"x".repeat(500)}`;
    globalThis.fetch = (() =>
      Promise.reject(
        new TypeError("fetch failed", { cause: new Error(hostile) }),
      )) as unknown as typeof fetch;
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.message.includes("\u001b")).toBe(false);
    expect(error.message.includes("\u0007")).toBe(false);
    expect(error.message.includes("\n")).toBe(false);
    expect(error.message.length).toBeLessThan(300);
    expect(error.message).toContain("before an HTTP response:");
  });
});

describe("fetchForecast success path", () => {
  test("normalizes the payload and keys it to the requested location", async () => {
    const payload = syntheticBody();
    payload.latitude = 10.625;
    payload.longitude = -20.125;
    mockResponds(JSON.stringify(payload), 200);

    const forecast = await fetchForecast(PORTLAND);
    expect(forecast.providerId).toBe("openmeteo");
    expect(forecast.location).toEqual(PORTLAND);
    expect(forecast.timezone).toBe("Europe/Paris");
    expect(forecast.utcOffsetSeconds).toBe(3600);
    expect(forecast.hourly.length).toBe(2);
    expect(forecastSchemaHolds(forecast)).toBe(true);
  });
});

function forecastSchemaHolds(value: unknown): boolean {
  return typeof value === "object" && value !== null && "current" in value && "daily" in value;
}

function syntheticBody() {
  return forecastResponseSchema.parse({
    latitude: 0,
    longitude: 0,
    utc_offset_seconds: 3600,
    timezone: "Europe/Paris",
    current: {
      time: "2026-08-24T12:15",
      temperature_2m: 21.5,
      relative_humidity_2m: 55,
      apparent_temperature: 22.5,
      is_day: 1,
      weather_code: 61,
      pressure_msl: null,
      wind_speed_10m: 9.1,
      wind_direction_10m: 180,
      wind_gusts_10m: null,
      dew_point_2m: null,
    },
    minutely_15: {
      time: ["2026-08-24T11:00", "2026-08-24T11:15"],
      precipitation: [0, 0.4],
    },
    hourly: {
      time: ["2026-08-24T11:00", "2026-08-24T12:00"],
      temperature_2m: [18, 19],
      relative_humidity_2m: [60, 62],
      apparent_temperature: [17, 18.5],
      precipitation: [0, 0.5],
      weather_code: [2, 61],
      wind_speed_10m: [5, 7],
      wind_direction_10m: [10, 20],
      is_day: [1, 0],
    },
    daily: {
      time: ["2026-08-24"],
      weather_code: [61],
      temperature_2m_max: [23.9],
      temperature_2m_min: [12.3],
      precipitation_sum: [1.2],
      sunrise: ["2026-08-24T06:00"],
      sunset: ["2026-08-24T21:00"],
    },
  });
}
