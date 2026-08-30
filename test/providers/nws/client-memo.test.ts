import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  __resetNwsMetadataMemoForTests,
  fetchForecast,
  NWS_METADATA_TTL_MS,
} from "../../../src/lib/providers/nws/client";
import { ProviderError } from "../../../src/lib/providers/types";

const FIXTURES = join(import.meta.dir, "..", "..", "fixtures", "nws");

const pointsBody = await Bun.file(join(FIXTURES, "points.json")).json();
const hourlyBody = await Bun.file(join(FIXTURES, "hourly.json")).json();
const dailyBody = await Bun.file(join(FIXTURES, "daily.json")).json();
const stationsBody = await Bun.file(join(FIXTURES, "stations.json")).json();
const obsBody = await Bun.file(join(FIXTURES, "obs.json")).json();

const PORTLAND = { latitude: 45.5152, longitude: -122.6784 };
const SEATTLE = { latitude: 47.6062, longitude: -122.3321 };

const PORTLAND_POINTS_URL = "https://api.weather.gov/points/45.5152,-122.6784";
const SEATTLE_POINTS_URL = "https://api.weather.gov/points/47.6062,-122.3321";
const HOURLY_URL = "https://api.weather.gov/gridpoints/PQR/113,104/forecast/hourly";
const DAILY_URL = "https://api.weather.gov/gridpoints/PQR/113,104/forecast";
const STATIONS_URL = "https://api.weather.gov/gridpoints/PQR/113,104/stations";
const OBS_URL = "https://api.weather.gov/stations/KPDX/observations/latest";

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;

beforeEach(() => {
  __resetNwsMetadataMemoForTests();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
  __resetNwsMetadataMemoForTests();
});

interface RecordedCall {
  url: string;
}

function mockApi(calls: RecordedCall[], routeOverrides: Record<string, unknown> = {}): void {
  const routes: Record<string, unknown> = {
    [PORTLAND_POINTS_URL]: pointsBody,
    [SEATTLE_POINTS_URL]: pointsBody,
    [HOURLY_URL]: hourlyBody,
    [DAILY_URL]: dailyBody,
    [STATIONS_URL]: stationsBody,
    [OBS_URL]: obsBody,
    ...routeOverrides,
  };
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push({ url });
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

describe("nws client — metadata memoization", () => {
  test("second fetchForecast for same coordinates issues only 3 fetch calls, not 5", async () => {
    const calls: RecordedCall[] = [];
    mockApi(calls);

    const first = await fetchForecast(PORTLAND);
    expect(first.providerId).toBe("nws");
    expect(calls.length).toBe(5);
    expect(calls.map((c) => c.url)).toEqual([
      PORTLAND_POINTS_URL,
      HOURLY_URL,
      DAILY_URL,
      STATIONS_URL,
      OBS_URL,
    ]);

    calls.length = 0;
    const second = await fetchForecast(PORTLAND);
    expect(second.providerId).toBe("nws");
    expect(calls.length).toBe(3);
    expect(calls.map((c) => c.url)).toEqual([HOURLY_URL, DAILY_URL, OBS_URL]);
  });

  test("rounded coordinates share the same memo entry (4-decimal stability)", async () => {
    const calls: RecordedCall[] = [];
    mockApi(calls);
    const nearby = { latitude: 45.51522, longitude: -122.67838 };
    await fetchForecast(PORTLAND);
    expect(calls.length).toBe(5);
    calls.length = 0;
    await fetchForecast(nearby);
    expect(calls.length).toBe(3);
  });

  test("different coordinates fetch their own metadata (5 calls each)", async () => {
    const calls: RecordedCall[] = [];
    mockApi(calls);

    await fetchForecast(PORTLAND);
    expect(calls.length).toBe(5);
    calls.length = 0;

    await fetchForecast(SEATTLE);
    expect(calls.length).toBe(5);
    expect(calls[0]?.url).toBe(SEATTLE_POINTS_URL);

    calls.length = 0;
    await fetchForecast(PORTLAND);
    expect(calls.length).toBe(3);

    calls.length = 0;
    await fetchForecast(SEATTLE);
    expect(calls.length).toBe(3);
  });

  test("concurrent same-location calls issue 5 total calls, not 10", async () => {
    const calls: RecordedCall[] = [];
    mockApi(calls);

    const [a, b] = await Promise.all([fetchForecast(PORTLAND), fetchForecast(PORTLAND)]);
    expect(a.providerId).toBe("nws");
    expect(b.providerId).toBe("nws");
    expect(calls.length).toBe(5);
  });

  test("concurrent calls with different windows do not share a pending promise", async () => {
    const calls: RecordedCall[] = [];
    mockApi(calls);

    const [narrow, full] = await Promise.all([
      fetchForecast(PORTLAND, { forecastHours: 6 }),
      fetchForecast(PORTLAND),
    ]);
    expect(narrow.hourly.length).toBe(6);
    expect(full.hourly.length).toBe(48);
    expect(calls.length).toBe(10);
  });

  test("a rejected pending forecast clears and fans the rejection out; the next call retries", async () => {
    const calls: RecordedCall[] = [];
    let stationsShouldFail = true;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push({ url });
      if (stationsShouldFail && url === STATIONS_URL) {
        return new Response(JSON.stringify({ title: "Server Error", detail: "boom" }), {
          status: 500,
        });
      }
      const routes: Record<string, unknown> = {
        [PORTLAND_POINTS_URL]: pointsBody,
        [HOURLY_URL]: hourlyBody,
        [DAILY_URL]: dailyBody,
        [STATIONS_URL]: stationsBody,
        [OBS_URL]: obsBody,
      };
      const body = routes[url];
      if (body === undefined) return new Response(JSON.stringify({}), { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    const results = await Promise.allSettled([fetchForecast(PORTLAND), fetchForecast(PORTLAND)]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(calls.length).toBe(4);

    stationsShouldFail = false;
    calls.length = 0;
    const retry = await fetchForecast(PORTLAND);
    expect(retry.providerId).toBe("nws");
    expect(calls.length).toBe(5);
    expect(calls[0]?.url).toBe(PORTLAND_POINTS_URL);
  });

  test("memo expiry at TTL triggers a re-fetch of metadata", async () => {
    const calls: RecordedCall[] = [];
    mockApi(calls);

    let now = Date.now();
    Date.now = () => now;

    await fetchForecast(PORTLAND);
    expect(calls.length).toBe(5);
    calls.length = 0;

    now += 1000;
    await fetchForecast(PORTLAND);
    expect(calls.length).toBe(3);
    calls.length = 0;

    now += NWS_METADATA_TTL_MS + 1;
    await fetchForecast(PORTLAND);
    expect(calls.length).toBe(5);
    expect(calls[0]?.url).toBe(PORTLAND_POINTS_URL);
  });

  test("an error while fetching metadata does NOT poison the memo (next call retries)", async () => {
    const calls: RecordedCall[] = [];
    let shouldFail = true;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push({ url });
      if (shouldFail && url === PORTLAND_POINTS_URL) {
        return new Response(JSON.stringify({ title: "Server Error", detail: "boom" }), {
          status: 500,
        });
      }
      const routes: Record<string, unknown> = {
        [PORTLAND_POINTS_URL]: pointsBody,
        [HOURLY_URL]: hourlyBody,
        [DAILY_URL]: dailyBody,
        [STATIONS_URL]: stationsBody,
        [OBS_URL]: obsBody,
      };
      const body = routes[url];
      if (body === undefined) return new Response(JSON.stringify({}), { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.providerId).toBe("nws");
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe(PORTLAND_POINTS_URL);

    shouldFail = false;
    calls.length = 0;
    const forecast = await fetchForecast(PORTLAND);
    expect(forecast.providerId).toBe("nws");
    expect(calls.length).toBe(5);

    calls.length = 0;
    const second = await fetchForecast(PORTLAND);
    expect(second.providerId).toBe("nws");
    expect(calls.length).toBe(3);
  });

  test("error on stations fetch does not poison memo", async () => {
    const calls: RecordedCall[] = [];
    let attempt = 0;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push({ url });
      if (attempt === 0 && url === STATIONS_URL) {
        return new Response(JSON.stringify({ title: "Bad Gateway" }), { status: 502 });
      }
      const routes: Record<string, unknown> = {
        [PORTLAND_POINTS_URL]: pointsBody,
        [HOURLY_URL]: hourlyBody,
        [DAILY_URL]: dailyBody,
        [STATIONS_URL]: stationsBody,
        [OBS_URL]: obsBody,
      };
      const body = routes[url];
      if (body === undefined) return new Response(JSON.stringify({}), { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    attempt = 0;
    const error = await captureProviderError(fetchForecast(PORTLAND));
    expect(error.providerId).toBe("nws");
    attempt = 1;
    calls.length = 0;
    const forecast = await fetchForecast(PORTLAND);
    expect(forecast.providerId).toBe("nws");
    expect(calls.length).toBe(5);
  });

  test("caps the map at 64 entries, evicting oldest", async () => {
    const calls: RecordedCall[] = [];
    const routes: Record<string, unknown> = {
      [HOURLY_URL]: hourlyBody,
      [DAILY_URL]: dailyBody,
      [STATIONS_URL]: stationsBody,
      [OBS_URL]: obsBody,
    };
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push({ url });
      if (url.startsWith("https://api.weather.gov/points/")) {
        return new Response(JSON.stringify(pointsBody), { status: 200 });
      }
      const body = routes[url];
      if (body === undefined) return new Response(JSON.stringify({}), { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;

    for (let i = 0; i < 65; i++) {
      const loc = { latitude: 40 + i * 0.001, longitude: -100 };
      await fetchForecast(loc);
    }
    expect(calls.filter((c) => c.url.startsWith("https://api.weather.gov/points/")).length).toBe(
      65,
    );

    calls.length = 0;
    await fetchForecast({ latitude: 40, longitude: -100 });
    expect(calls.some((c) => c.url.startsWith("https://api.weather.gov/points/"))).toBe(true);
    expect(calls.length).toBe(5);
  });
});
