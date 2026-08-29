import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat as statFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderError, type WeatherProvider } from "../../src/lib/providers/types";
import { type CacheIo, cachedForecast, cacheKey, cacheRoot } from "../../src/lib/weather/cache";
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
    hasMinutePrecip: true,
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

describe("cacheRoot", () => {
  test("XDG_CACHE_HOME wins on every platform when set and non-blank", () => {
    expect(cacheRoot("linux", { XDG_CACHE_HOME: "/xdg" })).toBe("/xdg");
    expect(cacheRoot("win32", { XDG_CACHE_HOME: "C:\\xdg", LOCALAPPDATA: "C:\\lad" })).toBe(
      "C:\\xdg",
    );
  });

  test("blank XDG_CACHE_HOME falls through like unset", () => {
    expect(cacheRoot("linux", { XDG_CACHE_HOME: "   " })).toBe(join(homedir(), ".cache"));
    expect(cacheRoot("win32", { XDG_CACHE_HOME: "", LOCALAPPDATA: "C:\\lad" })).toBe("C:\\lad");
  });

  test("win32 uses LOCALAPPDATA when XDG is unset", () => {
    expect(cacheRoot("win32", { LOCALAPPDATA: "C:\\Users\\b\\AppData\\Local" })).toBe(
      "C:\\Users\\b\\AppData\\Local",
    );
  });

  test("non-win32 ignores LOCALAPPDATA", () => {
    expect(cacheRoot("linux", { LOCALAPPDATA: "C:\\lad" })).toBe(join(homedir(), ".cache"));
    expect(cacheRoot("darwin", { LOCALAPPDATA: "C:\\lad" })).toBe(join(homedir(), ".cache"));
  });

  test("win32 with both unset falls back to ~/.cache", () => {
    expect(cacheRoot("win32", {})).toBe(join(homedir(), ".cache"));
    expect(cacheRoot("win32", { LOCALAPPDATA: "  " })).toBe(join(homedir(), ".cache"));
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

  test("TTL boundary is inclusive: a write-then-read round trip hits at exactly TTL and refetches one ms later", async () => {
    const io = memoryIo();
    let n = 0;
    const provider = stubProvider(async () => makeForecast(20 + ++n));
    const ttlMs = 10 * 60_000;

    await cachedForecast(provider, PORTLAND, { nowUtc: NOW, maxAgeMinutes: 10 }, io);
    expect(provider.calls()).toBe(1);

    const atBoundary = new Date(Date.parse(NOW) + ttlMs).toISOString();
    const hit = await cachedForecast(
      provider,
      PORTLAND,
      { nowUtc: atBoundary, maxAgeMinutes: 10 },
      io,
    );
    expect(hit.stale).toBe(false);
    expect(hit.forecast.current.temperatureC).toBe(21);
    expect(provider.calls()).toBe(1);

    const pastBoundary = new Date(Date.parse(NOW) + ttlMs + 1).toISOString();
    const miss = await cachedForecast(
      provider,
      PORTLAND,
      {
        nowUtc: pastBoundary,
        maxAgeMinutes: 10,
      },
      io,
    );
    expect(miss.forecast.current.temperatureC).toBe(22);
    expect(provider.calls()).toBe(2);
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

  test("envelope with a null current block counts as corrupt", async () => {
    const forecast = makeForecast() as unknown as Record<string, unknown>;
    forecast.current = null;
    const io = memoryIo(new Map([[KEY, JSON.stringify({ fetchedAtUtc: NOW, forecast })]]));
    const provider = stubProvider(() => Promise.resolve(makeForecast(21)));

    const result = await cachedForecast(provider, PORTLAND, { nowUtc: NOW }, io);

    expect(provider.calls()).toBe(1);
    expect(result.stale).toBe(false);
    expect(result.forecast).toEqual(makeForecast(21));
    expect(io.removed).toEqual([KEY]);
  });

  test("envelope with an unknown condition counts as corrupt", async () => {
    const forecast = makeForecast() as unknown as Record<string, unknown>;
    (forecast.current as Record<string, unknown>).condition = "volcano";
    const io = memoryIo(new Map([[KEY, JSON.stringify({ fetchedAtUtc: NOW, forecast })]]));
    const provider = stubProvider(() => Promise.resolve(makeForecast(22)));

    const result = await cachedForecast(provider, PORTLAND, { nowUtc: NOW }, io);

    expect(provider.calls()).toBe(1);
    expect(result.stale).toBe(false);
    expect(io.removed).toEqual([KEY]);
  });

  test("envelope with an unparseable fetchedAtUtc counts as corrupt", async () => {
    const io = memoryIo(
      new Map([[KEY, JSON.stringify({ fetchedAtUtc: "not-a-date", forecast: makeForecast() })]]),
    );
    const provider = stubProvider(() => Promise.resolve(makeForecast(23)));

    const result = await cachedForecast(provider, PORTLAND, { nowUtc: NOW }, io);

    expect(provider.calls()).toBe(1);
    expect(result.stale).toBe(false);
    expect(io.removed).toEqual([KEY]);
  });

  test("an envelope the cache wrote itself round-trips as fresh", async () => {
    const written = makeForecast(20);
    const io = memoryIo();
    io.write(KEY, envelopeText("2026-08-24T11:58:00.000Z", written));
    const provider = stubProvider(() => Promise.reject(new Error("must not be called")));

    const result = await cachedForecast(provider, PORTLAND, { nowUtc: NOW }, io);

    expect(provider.calls()).toBe(0);
    expect(result.stale).toBe(false);
    expect(result.forecast).toEqual(written);
  });

  test("on-disk writes are 0o600, atomic, and leave no tmp files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tuiweather-cache-test-"));
    const prevCacheHome = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = dir;
    try {
      const fresh = makeForecast(24);
      const provider = stubProvider(() => Promise.resolve(fresh));
      const result = await cachedForecast(provider, PORTLAND, { nowUtc: NOW });

      expect(result.stale).toBe(false);
      const files = await readdir(join(dir, "tuiweather"));
      expect(files).toEqual([KEY]);
      const stat = await statFile(join(dir, "tuiweather", KEY));
      expect(stat.mode & 0o777).toBe(0o600);
      const roundTripped = await cachedForecast(
        stubProvider(() => {
          throw new Error("must not be called");
        }),
        PORTLAND,
        { nowUtc: NOW },
      );
      expect(roundTripped.forecast).toEqual(fresh);
    } finally {
      if (prevCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = prevCacheHome;
      await rm(join(dir, "tuiweather"), { recursive: true, force: true });
    }
  });
});
