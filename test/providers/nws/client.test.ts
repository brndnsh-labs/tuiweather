import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import packageJson from "../../../package.json";
import {
  __resetNwsMetadataMemoForTests,
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
  __resetNwsMetadataMemoForTests();
});

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
}

function mockApi(calls: RecordedCall[], routeOverrides: Record<string, unknown> = {}): void {
  const routes: Record<string, unknown> = {
    [POINTS_URL]: pointsBody,
    [HOURLY_URL]: hourlyBody,
    [DAILY_URL]: dailyBody,
    [STATIONS_URL]: stationsBody,
    [OBS_URL]: obsBody,
    ...routeOverrides,
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
      expect(NWS_USER_AGENT).toBe(
        `tuiweather/${packageJson.version} (github.com/brndnsh-labs/tuiweather)`,
      );
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

describe("nws client — url allowlist (ssrf guard)", () => {
  const METADATA_URL = "http://169.254.169.254/latest/meta-data/";

  function pointsWithStationsUrl(observationStations: string): unknown {
    return {
      ...pointsBody,
      properties: { ...pointsBody.properties, observationStations },
    };
  }

  test("rejects a response-provided metadata endpoint without issuing a fetch for it", async () => {
    const calls: RecordedCall[] = [];
    mockApi(calls, { [POINTS_URL]: pointsWithStationsUrl(METADATA_URL) });
    const error = await captureProviderError(fetchForecast(PORTLAND));

    expect(error.providerId).toBe("nws");
    expect(error.message).toContain("observation stations");
    expect(error.message).toContain("host rejected");
    expect(error.message).not.toContain("169.254");
    expect(error.message).not.toContain("http");
    expect(calls.map((call) => call.url)).toEqual([POINTS_URL, HOURLY_URL, DAILY_URL]);
  });

  test.each([
    ["scheme downgrade", "http://api.weather.gov/gridpoints/PQR/113,104/stations"],
    ["host suffix", "https://api.weather.gov.evil.com/stations"],
    ["userinfo trick", "https://api.weather.gov@evil.com/stations"],
    ["explicit port", "https://api.weather.gov:8443/stations"],
  ])("rejects a %s response url", async (_name, url) => {
    const calls: RecordedCall[] = [];
    mockApi(calls, { [POINTS_URL]: pointsWithStationsUrl(url) });
    const error = await captureProviderError(fetchForecast(PORTLAND));

    expect(error.message).toContain("host rejected");
    expect(calls.map((call) => call.url)).not.toContain(url);
  });

  test("rejects a relative response url as not absolute", async () => {
    const calls: RecordedCall[] = [];
    mockApi(calls, { [POINTS_URL]: pointsWithStationsUrl("/gridpoints/PQR/113,104/stations") });
    const error = await captureProviderError(fetchForecast(PORTLAND));

    expect(error.message).toContain("not absolute");
    expect(calls.map((call) => call.url)).not.toContain("/gridpoints/PQR/113,104/stations");
  });

  test("rejects a hostile station id before fetching its observations", async () => {
    const calls: RecordedCall[] = [];
    mockApi(calls, {
      [STATIONS_URL]: { features: [{ id: "http://evil.example.invalid/stations/KPDX" }] },
    });
    const error = await captureProviderError(fetchForecast(PORTLAND));

    expect(error.message).toContain("latest observation");
    expect(error.message).toContain("host rejected");
    expect(calls.map((call) => call.url)).toEqual([
      POINTS_URL,
      HOURLY_URL,
      DAILY_URL,
      STATIONS_URL,
    ]);
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
    expect(error.message).toBe("nws points failed (HTTP 400): Point must be rounded");
    expect(error.message).not.toContain("https://");
  });

  test("falls back to the problem title when detail is missing", async () => {
    mockResponse(JSON.stringify({ title: "Not Found" }), 404);
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.message).toBe("nws points failed (HTTP 404): Not Found");
  });

  test("unified nws shape omits reason when problem body has no detail or title", async () => {
    mockResponse(JSON.stringify({ status: 400 }), 400);
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.message).toBe("nws points failed (HTTP 400)");
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
    expect(error.message).toContain("connection refused");
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
    expect(error.message).toContain(
      "before an HTTP response: getaddrinfo ENOTFOUND api.open-meteo.com",
    );
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  test("omits the suffix when the network cause is empty", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch;
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.message).toBe("nws points request failed before an HTTP response");
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
    expect(error.message.length).toBeLessThan(320);
    expect(error.message).toContain("before an HTTP response:");
  });

  test("parses every endpoint through its schema", () => {
    expect(() => pointsResponseSchema.parse(pointsBody)).not.toThrow();
    expect(() => forecastResponseSchema.parse(hourlyBody)).not.toThrow();
    expect(() => forecastResponseSchema.parse(dailyBody)).not.toThrow();
    expect(() => stationsResponseSchema.parse(stationsBody)).not.toThrow();
    expect(() => observationResponseSchema.parse(obsBody)).not.toThrow();
  });
});

describe("nws client — redirect hardening", () => {
  test("surfaces a 302 to a foreign host as redirected off-host", async () => {
    let observedInit: RequestInit | undefined;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      observedInit = init;
      throw new TypeError(
        "redirect mode is set to error: got 302 to https://evil.example.invalid/",
      );
    }) as unknown as typeof fetch;
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.providerId).toBe("nws");
    expect(error.message).toContain("redirected off-host");
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(observedInit?.redirect).toBe("error");
  });

  test("does not follow a 302 to the same allowed host when redirect is error", async () => {
    let observedInit: RequestInit | undefined;
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      observedInit = init;
      throw new TypeError("fetch failed because redirect mode is set to error");
    }) as unknown as typeof fetch;
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.message).toContain("redirected off-host");
    expect(observedInit?.redirect).toBe("error");
  });

  test("a direct 200 from the allowed host still parses and sends redirect:error", async () => {
    const calls: Array<RecordedCall & { redirect?: string }> = [];
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
        headers: Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>),
        ),
        redirect: init?.redirect as string | undefined,
      });
      const body = routes[url];
      if (body === undefined) {
        return new Response(JSON.stringify({ detail: "no such route" }), { status: 404 });
      }
      const res = new Response(JSON.stringify(body), { status: 200 });
      Object.defineProperty(res, "url", { value: url });
      return res;
    }) as unknown as typeof fetch;
    const forecast = await fetchForecast(PORTLAND);
    expect(forecast.providerId).toBe("nws");
    expect(forecast.hourly.length).toBe(48);
    for (const call of calls) {
      expect(call.redirect).toBe("error");
    }
  });

  test("rejects a 200 whose res.url is off-host (post-fetch belt-and-suspenders)", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === POINTS_URL) {
        const res = new Response(JSON.stringify(pointsBody), { status: 200 });
        Object.defineProperty(res, "url", { value: "https://evil.example.invalid/points" });
        return res;
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.providerId).toBe("nws");
    expect(error.message).toContain("redirected off-host");
  });

  test("rejects a 200 whose res.url downgrades to http", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === POINTS_URL) {
        const res = new Response(JSON.stringify(pointsBody), { status: 200 });
        Object.defineProperty(res, "url", {
          value: "http://api.weather.gov/points/45.5152,-122.6784",
        });
        return res;
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.message).toContain("redirected off-host");
  });
});
