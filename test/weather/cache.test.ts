import { describe, expect, test } from "bun:test";
import { ProviderError, type WeatherProvider } from "../../src/lib/providers/types";
import { type CacheIo, cachedForecast, cacheKey } from "../../src/lib/weather/cache";
import type { GeoPoint, NormalizedForecast } from "../../src/lib/weather/types";

const NOW = "2026-08-24T12:00:00.000Z";
const PORTLAND: GeoPoint = { latitude: 45.5202, longitude: -122.6765 };

function makeForecast(temperatureC = 18): NormalizedForecast {
  return {
    providerId: "stub",
    location: PORTLAND,
    timezone: "America/Los_Angeles",
    utcOffsetSeconds: -7 * 3600,
    fetchedAtUtc: NOW,
    current: {
      timeUtc: NOW,
      temperatureC,
      apparentC: temperatureC,
      humidityPct: 50,
      condition: "clear",
      windSpeedKmh: 8,
      windDirectionDeg: 200,
      windGustKmh: null,
      pressureHpa: null,
      cloudCoverPct: null,
      dewPointC: null,
      visibilityM: null,
      uvIndex: null,
      precipLast1hMm: null,
      isDay: true,
    },
    minutely15: [],
    hourly: [],
    daily: [],
  };
}

interface MemoryIo extends CacheIo {
  store: Map<string, string>;
  removed: string[];
}

function memoryIo(seed?: Map<string, string>): MemoryIo {
  const store = seed ?? new Map<string, string>();
  const removed: string[] = [];
  return {
    store,
    removed,
    async baseDir() {
      return "/memory-cache/tuiweather";
    },
    async read(key) {
      return store.get(key) ?? null;
    },
    async write(key, text) {
      store.set(key, text);
    },
    async remove(key) {
      store.delete(key);
      removed.push(key);
    },
  };
}

function stubProvider(
  handler: () => Promise<NormalizedForecast>,
): WeatherProvider & { calls: () => number } {
  let count = 0;
  return {
    id: "stub",
    getForecast(location) {
      count += 1;
      void location;
      return handler();
    },
    calls: () => count,
  };
}

const KEY = cacheKey("stub", PORTLAND.latitude, PORTLAND.longitude);

function envelopeText(fetchedAtUtc: string, forecast: NormalizedForecast): string {
  return JSON.stringify({ fetchedAtUtc, forecast });
}

describe("cacheKey", () => {
  test("coordinates within 0.001 degrees share a key", () => {
    expect(cacheKey("stub", 45.5202, -122.6765)).toBe(cacheKey("stub", 45.5204, -122.6765));
  });

  test("different longitude yields a different key", () => {
    expect(cacheKey("stub", 45.5202, -122.6765)).not.toBe(cacheKey("stub", 45.5202, -121.6765));
  });

  test("provider id participates in the key and file uses .json suffix", () => {
    expect(cacheKey("openmeteo", 45.52, -122.68)).not.toBe(cacheKey("stub", 45.52, -122.68));
    expect(KEY.endsWith(".json")).toBe(true);
    expect(KEY).toMatch(/^[0-9a-f]{64}\.json$/);
  });

  test("forecast window participates in the key", () => {
    expect(cacheKey("stub", 45.5202, -122.6765, { forecastDays: 7 })).not.toBe(KEY);
    expect(cacheKey("stub", 45.5202, -122.6765, { forecastDays: 7, forecastHours: 24 })).not.toBe(
      cacheKey("stub", 45.5202, -122.6765, { forecastDays: 7, forecastHours: 48 }),
    );
    expect(cacheKey("stub", 45.5202, -122.6765, { forecastDays: 7 })).toBe(
      cacheKey("stub", 45.5204, -122.6765, { forecastDays: 7 }),
    );
  });
});

describe("cachedForecast", () => {
  test("fresh envelope serves the cache with zero provider calls", async () => {
    const cached = makeForecast(11);
    const io = memoryIo(new Map([[KEY, envelopeText("2026-08-24T11:55:00.000Z", cached)]]));
    const provider = stubProvider(() => Promise.resolve(makeForecast()));

    const result = await cachedForecast(provider, PORTLAND, { nowUtc: NOW }, io);

    expect(provider.calls()).toBe(0);
    expect(result.stale).toBe(false);
    expect(result.forecast.current.temperatureC).toBe(11);
    expect(io.store.get(KEY)).toBe(envelopeText("2026-08-24T11:55:00.000Z", cached));
  });

  test("maxAgeMinutes tightens freshness", async () => {
    const cached = makeForecast(11);
    const io = memoryIo(new Map([[KEY, envelopeText("2026-08-24T11:51:00.000Z", cached)]]));
    const provider = stubProvider(() => Promise.resolve(makeForecast(22)));

    await cachedForecast(provider, PORTLAND, { nowUtc: NOW, maxAgeMinutes: 5 }, io);
    expect(provider.calls()).toBe(1);

    const freshAgain = memoryIo(new Map([[KEY, envelopeText("2026-08-24T11:55:30.000Z", cached)]]));
    await cachedForecast(provider, PORTLAND, { nowUtc: NOW, maxAgeMinutes: 5 }, freshAgain);
    expect(provider.calls()).toBe(1);
  });

  test("stale envelope refetches and rewrites the file", async () => {
    const staleText = envelopeText("2026-08-24T10:00:00.000Z", makeForecast(9));
    const io = memoryIo(new Map([[KEY, staleText]]));
    const fresh = makeForecast(23);
    const provider = stubProvider(() => Promise.resolve(fresh));

    const result = await cachedForecast(provider, PORTLAND, { nowUtc: NOW }, io);

    expect(provider.calls()).toBe(1);
    expect(result.stale).toBe(false);
    expect(result.forecast.current.temperatureC).toBe(23);
    expect(io.store.get(KEY)).toBe(envelopeText(NOW, fresh));
    expect(io.store.get(KEY)).not.toBe(staleText);
  });

  test("ProviderError falls back to an existing envelope at any age as stale:true", async () => {
    const old = makeForecast(9);
    const io = memoryIo(new Map([[KEY, envelopeText("2026-08-23T00:00:00.000Z", old)]]));
    const provider = stubProvider(() => Promise.reject(new ProviderError("upstream down", "stub")));

    const result = await cachedForecast(provider, PORTLAND, { nowUtc: NOW }, io);

    expect(provider.calls()).toBe(1);
    expect(result.stale).toBe(true);
    expect(result.forecast).toEqual(old);
  });

  test("ProviderError with empty cache rethrows", async () => {
    const io = memoryIo();
    const provider = stubProvider(() => Promise.reject(new ProviderError("upstream down", "stub")));

    expect(cachedForecast(provider, PORTLAND, { nowUtc: NOW }, io)).rejects.toBeInstanceOf(
      ProviderError,
    );
    expect(io.store.size).toBe(0);
  });

  test("corrupt file is removed quietly and treated as a miss", async () => {
    const io = memoryIo(new Map([[KEY, "{not json"]]));
    const fresh = makeForecast(25);
    const provider = stubProvider(() => Promise.resolve(fresh));

    const result = await cachedForecast(provider, PORTLAND, { nowUtc: NOW }, io);

    expect(provider.calls()).toBe(1);
    expect(result.stale).toBe(false);
    expect(result.forecast).toEqual(fresh);
    expect(io.removed).toEqual([KEY]);
    expect(JSON.parse(io.store.get(KEY) ?? "{}")).toBeTruthy();
  });

  test("envelope with malformed forecast body counts as corrupt", async () => {
    const io = memoryIo(new Map([[KEY, JSON.stringify({ fetchedAtUtc: NOW })]]));
    const provider = stubProvider(() => Promise.resolve(makeForecast(19)));

    const result = await cachedForecast(provider, PORTLAND, { nowUtc: NOW }, io);

    expect(provider.calls()).toBe(1);
    expect(result.stale).toBe(false);
    expect(io.removed).toEqual([KEY]);
  });
});
