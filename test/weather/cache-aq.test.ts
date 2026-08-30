import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat as statFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderError, type WeatherProvider } from "../../src/lib/providers/types";
import {
  airQualityCacheKey,
  CACHE_SCHEMA_VERSION,
  type CacheIo,
  cachedAirQuality,
  cacheKey,
} from "../../src/lib/weather/cache";
import type { AirQuality, GeoPoint } from "../../src/lib/weather/types";

const NOW = "2026-08-24T12:00:00.000Z";
const PORTLAND: GeoPoint = { latitude: 45.5202, longitude: -122.6765 };

function makeAq(usAqi = 29): AirQuality {
  return { usAqi, observedAtUtc: NOW };
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
  handler: () => Promise<AirQuality>,
): WeatherProvider & { calls: () => number } {
  let count = 0;
  return {
    id: "stub",
    getForecast: () => Promise.reject(new Error("not used")),
    getAirQuality() {
      count += 1;
      return handler();
    },
    calls: () => count,
  };
}

describe("airQualityCacheKey", () => {
  test("distinct from forecast cache key", () => {
    const aqKey = airQualityCacheKey("stub", PORTLAND.latitude, PORTLAND.longitude);
    const fcKey = cacheKey("stub", PORTLAND.latitude, PORTLAND.longitude);
    expect(aqKey).not.toBe(fcKey);
    expect(aqKey.endsWith(".json")).toBe(true);
    expect(aqKey).toMatch(/^[0-9a-f]{64}\.json$/);
  });

  test("coordinates within 0.001 degrees share a key", () => {
    expect(airQualityCacheKey("stub", 45.5202, -122.6765)).toBe(
      airQualityCacheKey("stub", 45.5204, -122.6765),
    );
  });

  test("provider id participates", () => {
    expect(airQualityCacheKey("openmeteo", 45.52, -122.68)).not.toBe(
      airQualityCacheKey("stub", 45.52, -122.68),
    );
  });
});

describe("cachedAirQuality", () => {
  const KEY = airQualityCacheKey("stub", PORTLAND.latitude, PORTLAND.longitude);
  function envelopeText(fetchedAtUtc: string, airQuality: AirQuality): string {
    return JSON.stringify({ version: CACHE_SCHEMA_VERSION, fetchedAtUtc, airQuality });
  }

  test("fresh envelope serves cache with zero provider calls", async () => {
    const cached = makeAq(11);
    const io = memoryIo(new Map([[KEY, envelopeText("2026-08-24T11:55:00.000Z", cached)]]));
    const provider = stubProvider(() => Promise.resolve(makeAq(99)));
    const result = await cachedAirQuality(provider, PORTLAND, { nowUtc: NOW }, io);
    expect(provider.calls()).toBe(0);
    expect(result.stale).toBe(false);
    expect(result.airQuality.usAqi).toBe(11);
  });

  test("stale envelope refetches and rewrites", async () => {
    const staleText = envelopeText("2026-08-24T10:00:00.000Z", makeAq(9));
    const io = memoryIo(new Map([[KEY, staleText]]));
    const fresh = makeAq(23);
    const provider = stubProvider(() => Promise.resolve(fresh));
    const result = await cachedAirQuality(provider, PORTLAND, { nowUtc: NOW }, io);
    expect(provider.calls()).toBe(1);
    expect(result.stale).toBe(false);
    expect(result.airQuality.usAqi).toBe(23);
    expect(io.store.get(KEY)).toBe(envelopeText(NOW, fresh));
  });

  test("ProviderError falls back to existing envelope at any age as stale:true", async () => {
    const old = makeAq(9);
    const io = memoryIo(new Map([[KEY, envelopeText("2026-08-23T00:00:00.000Z", old)]]));
    const provider = stubProvider(() => Promise.reject(new ProviderError("down", "stub")));
    const result = await cachedAirQuality(provider, PORTLAND, { nowUtc: NOW }, io);
    expect(provider.calls()).toBe(1);
    expect(result.stale).toBe(true);
    expect(result.airQuality).toEqual(old);
  });

  test("ProviderError with empty cache rethrows", async () => {
    const io = memoryIo();
    const provider = stubProvider(() => Promise.reject(new ProviderError("down", "stub")));
    await expect(cachedAirQuality(provider, PORTLAND, { nowUtc: NOW }, io)).rejects.toBeInstanceOf(
      ProviderError,
    );
    expect(io.store.size).toBe(0);
  });

  test("corrupt file is removed and treated as miss", async () => {
    const io = memoryIo(new Map([[KEY, "{not json"]]));
    const fresh = makeAq(25);
    const provider = stubProvider(() => Promise.resolve(fresh));
    const result = await cachedAirQuality(provider, PORTLAND, { nowUtc: NOW }, io);
    expect(provider.calls()).toBe(1);
    expect(result.stale).toBe(false);
    expect(result.airQuality).toEqual(fresh);
    expect(io.removed).toEqual([KEY]);
  });

  test("missing provider method throws ProviderError", async () => {
    const io = memoryIo();
    const provider: WeatherProvider = {
      id: "stub",
      getForecast: () => Promise.reject(new Error("no")),
    };
    await expect(cachedAirQuality(provider, PORTLAND, { nowUtc: NOW }, io)).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  test("fixed TTL 60 minutes: envelope 50 min old is fresh, 61 min old is stale refetch", async () => {
    const cached = makeAq(11);
    const freshIo = memoryIo(new Map([[KEY, envelopeText("2026-08-24T11:10:00.000Z", cached)]]));
    const providerFresh = stubProvider(() => Promise.resolve(makeAq(99)));
    const resFresh = await cachedAirQuality(providerFresh, PORTLAND, { nowUtc: NOW }, freshIo);
    expect(providerFresh.calls()).toBe(0);
    expect(resFresh.stale).toBe(false);

    const staleIo = memoryIo(new Map([[KEY, envelopeText("2026-08-24T10:58:00.000Z", cached)]]));
    const providerStale = stubProvider(() => Promise.resolve(makeAq(99)));
    const _resStale = await cachedAirQuality(providerStale, PORTLAND, { nowUtc: NOW }, staleIo);
    expect(providerStale.calls()).toBe(1);
  });

  test("on-disk writes are atomic and use restrictive Unix permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tuiweather-cache-aq-"));
    const prev = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = dir;
    try {
      const fresh = makeAq(24);
      const provider = stubProvider(() => Promise.resolve(fresh));
      const result = await cachedAirQuality(provider, PORTLAND, { nowUtc: NOW });
      expect(result.stale).toBe(false);
      const files = await readdir(join(dir, "tuiweather"));
      expect(files).toEqual([KEY]);
      const stat = await statFile(join(dir, "tuiweather", KEY));
      if (process.platform !== "win32") expect(stat.mode & 0o777).toBe(0o600);
    } finally {
      if (prev === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = prev;
      await rm(join(dir, "tuiweather"), { recursive: true, force: true });
    }
  });
});
