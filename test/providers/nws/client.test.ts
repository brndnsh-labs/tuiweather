import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  buildPointsUrl,
  fetchForecast,
  NWS_USER_AGENT,
} from "../../../src/lib/providers/nws/client";
import { normalizeNwsForecast } from "../../../src/lib/providers/nws/normalize";
import {
  forecastResponseSchema,
  observationResponseSchema,
  pointsResponseSchema,
  stationsResponseSchema,
} from "../../../src/lib/providers/nws/schemas";
import { ProviderError } from "../../../src/lib/providers/types";

const FIXTURES = join(import.meta.dir, "..", "..", "fixtures", "nws");

const pointsBody = await Bun.file(join(FIXTURES, "points.json")).json();
const hourlyBody = await Bun.file(join(FIXTURES, "hourly.json")).json();
const dailyBody = await Bun.file(join(FIXTURES, "daily.json")).json();
const stationsBody = await Bun.file(join(FIXTURES, "stations.json")).json();
const obsBody = await Bun.file(join(FIXTURES, "obs.json")).json();

const PORTLAND = { latitude: 45.5152, longitude: -122.6784 };

const POINTS_URL = "https://api.weather.gov/points/45.5152,-122.6784";
const HOURLY_URL = "https://api.weather.gov/gridpoints/PQR/113,104/forecast/hourly";
const DAILY_URL = "https://api.weather.gov/gridpoints/PQR/113,104/forecast";
const STATIONS_URL = "https://api.weather.gov/gridpoints/PQR/113,104/stations";
const OBS_URL = "https://api.weather.gov/stations/KPDX/observations/latest";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
}

function mockApi(calls: RecordedCall[]): void {
  const routes: Record<string, unknown> = {
    [POINTS_URL]: pointsBody,
    [HOURLY_URL]: hourlyBody,
    [DAILY_URL]: dailyBody,
    [STATIONS_URL]: stationsBody,
    [OBS_URL]: obsBody,
  };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
    });
    const body = routes[url];
    if (body === undefined) {
      return new Response(JSON.stringify({ detail: "no such route" }), { status: 404 });
    }
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
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

describe("nws client — request composition", () => {
  test("builds the points url from the raw coordinates", () => {
    expect(buildPointsUrl(PORTLAND)).toBe(POINTS_URL);
  });

  test("follows points → hourly + daily + stations → latest observation", async () => {
    const calls: RecordedCall[] = [];
    mockApi(calls);
    const forecast = await fetchForecast(PORTLAND);

    expect(calls.map((call) => call.url)).toEqual([
      POINTS_URL,
      HOURLY_URL,
      DAILY_URL,
      STATIONS_URL,
      OBS_URL,
    ]);
    expect(forecast.providerId).toBe("nws");
    expect(forecast.location).toEqual(PORTLAND);
    expect(forecast.timezone).toBe("America/Los_Angeles");
    expect(forecast.hourly.length).toBe(48);
    expect(forecast.daily.length).toBe(7);
    expect(forecast.current.temperatureC).toBe(23);
  });

  test("sends the required User-Agent on every request", async () => {
    const calls: RecordedCall[] = [];
    mockApi(calls);
    await fetchForecast(PORTLAND);
    expect(calls.length).toBe(5);
    for (const call of calls) {
      expect(call.headers["User-Agent"]).toBe(NWS_USER_AGENT);
      expect(NWS_USER_AGENT).toBe("tuiweather/0.1 (github.com/brndnsh-labs/tuiweather)");
    }
  });

  test("passes the forecast window through to normalization", async () => {
    const calls: RecordedCall[] = [];
    mockApi(calls);
    const forecast = await fetchForecast(PORTLAND, { forecastDays: 2, forecastHours: 6 });
    expect(forecast.daily.length).toBe(2);
    expect(forecast.hourly.length).toBe(6);
  });

  test("produces the same forecast as normalizing the fixtures directly", async () => {
    const calls: RecordedCall[] = [];
    mockApi(calls);
    const fetched = await fetchForecast(PORTLAND, { forecastDays: 3, forecastHours: 12 });
    const direct = normalizeNwsForecast(
      {
        points: pointsResponseSchema.parse(pointsBody).properties,
        hourly: forecastResponseSchema.parse(hourlyBody).properties.periods,
        daily: forecastResponseSchema.parse(dailyBody).properties.periods,
        obs: observationResponseSchema.parse(obsBody).properties,
      },
      PORTLAND,
      { forecastDays: 3, forecastHours: 12 },
    );
    expect({ ...fetched, fetchedAtUtc: "" }).toEqual({ ...direct, fetchedAtUtc: "" });
  });

  test("rejects when the station list is empty", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === STATIONS_URL) {
        return new Response(JSON.stringify({ features: [] }), { status: 200 });
      }
      const routes: Record<string, unknown> = {
        [POINTS_URL]: pointsBody,
        [HOURLY_URL]: hourlyBody,
        [DAILY_URL]: dailyBody,
      };
      const body = routes[url];
      if (body === undefined) {
        return new Response(JSON.stringify({ detail: "no such route" }), { status: 404 });
      }
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.providerId).toBe("nws");
    expect(error.message).toContain("stations list is empty");
  });
});

describe("nws client — error wrapping", () => {
  function mockResponse(payload: string, status: number, urlMatch = POINTS_URL): void {
    globalThis.fetch = (async (input: string | URL | Request) =>
      new Response(String(input).includes(urlMatch) ? payload : "{}", {
        status: String(input).includes(urlMatch) ? status : 200,
      })) as unknown as typeof fetch;
  }

  test("surfaces HTTP status and problem detail without echoing the request URL", async () => {
    mockResponse(JSON.stringify({ title: "Bad Request", detail: "Point must be rounded" }), 400);
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.providerId).toBe("nws");
    expect(error.message).toContain("400");
    expect(error.message).toContain("Point must be rounded");
    expect(error.message).not.toContain("https://");
  });

  test("falls back to the problem title when detail is missing", async () => {
    mockResponse(JSON.stringify({ title: "Not Found" }), 404);
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.message).toContain("Not Found");
  });

  test("strips control characters and clamps a hostile problem detail", async () => {
    mockResponse(
      JSON.stringify({ detail: `${"\u001b]0;pwned\u0007".repeat(30)}x`.repeat(50) }),
      400,
    );
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.message.includes("\u001b")).toBe(false);
    expect(error.message.includes("\u0007")).toBe(false);
    expect(error.message.length).toBeLessThan(300);
  });

  test("wraps a non-JSON body in ProviderError", async () => {
    mockResponse("<html>gateway</html>", 502);
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.message).toContain("non-JSON");
    expect(error.message).toContain("502");
  });

  test("wraps schema validation failures with the parse error as cause", async () => {
    mockResponse(JSON.stringify({ unexpected: true }), 200);
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

  test("parses every endpoint through its schema", () => {
    expect(() => pointsResponseSchema.parse(pointsBody)).not.toThrow();
    expect(() => forecastResponseSchema.parse(hourlyBody)).not.toThrow();
    expect(() => forecastResponseSchema.parse(dailyBody)).not.toThrow();
    expect(() => stationsResponseSchema.parse(stationsBody)).not.toThrow();
    expect(() => observationResponseSchema.parse(obsBody)).not.toThrow();
  });
});
