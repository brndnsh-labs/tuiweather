import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStoreInstance, type ForecastFetcher } from "../../src/app/store";
import { ProviderError } from "../../src/lib/providers/types";
import type { CurrentObs, NormalizedForecast } from "../../src/lib/weather/types";

const NOW = "2026-08-24T12:00:00.000Z";

const CONFIG_TOML = `schema_version = 1
units = "metric"
refresh_minutes = 10
theme = "night"
default_location = "london"

[[locations]]
slug = "portland"
label = "Portland"
latitude = 45.5202
longitude = -122.6765

[[locations]]
slug = "london"
label = "London"
latitude = 51.5072
longitude = -0.1276

[panels]
nowcast = true
details = true
hourly = true
daily = true
`;

const NO_DEFAULT_TOML = CONFIG_TOML.replace('default_location = "london"\n', "");

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function makeConfigDir(toml: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-store-test-"));
  tmpDirs.push(dir);
  await writeFile(join(dir, "config.toml"), toml, "utf8");
  return dir;
}

function stubFetcher(
  forecast?: NormalizedForecast,
  failWith?: ProviderError,
): ForecastFetcher & { calls: { locations: string[]; maxAges: number[] } } {
  const calls = { locations: [] as string[], maxAges: [] as number[] };
  return Object.assign(
    (location: { latitude: number; longitude: number }, opts: { maxAgeMinutes: number }) => {
      calls.locations.push(`${location.latitude},${location.longitude}`);
      calls.maxAges.push(opts.maxAgeMinutes);
      if (failWith) return Promise.reject(failWith);
      return Promise.resolve({ forecast: forecast ?? makeForecast(), stale: false });
    },
    { calls },
  );
}

function makeForecast(temperatureC = 18): NormalizedForecast {
  const current: CurrentObs = {
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
  };
  return {
    providerId: "stub",
    location: { latitude: 45.5202, longitude: -122.6765 },
    timezone: "America/Los_Angeles",
    utcOffsetSeconds: -7 * 3600,
    fetchedAtUtc: NOW,
    current,
    minutely15: [],
    hourly: [],
    daily: [],
  };
}

describe("store", () => {
  test("init loads config and picks default_location", async () => {
    const dir = await makeConfigDir(CONFIG_TOML);
    const fetcher = stubFetcher();
    const store = createStoreInstance({
      configPath: join(dir, "config.toml"),
      fetchForecast: fetcher,
    });

    await store.getState().init();

    expect(store.getState().activeSlug).toBe("london");
    expect(store.getState().config.units).toBe("metric");
    expect(fetcher.calls.locations).toEqual(["51.5072,-0.1276"]);
    expect(store.getState().forecastBySlug.london?.forecast.current.temperatureC).toBe(18);
    expect(store.getState().loadingSlugs).toEqual({});
  });

  test("init falls back to the first location when no default is set", async () => {
    const dir = await makeConfigDir(NO_DEFAULT_TOML);
    const fetcher = stubFetcher();
    const store = createStoreInstance({
      configPath: join(dir, "config.toml"),
      fetchForecast: fetcher,
    });

    await store.getState().init();

    expect(store.getState().activeSlug).toBe("portland");
  });

  test("config read failure lands in lastActionError, never throws", async () => {
    // A directory at the config path makes readFile reject with EISDIR.
    const dir = await mkdtemp(join(tmpdir(), "tuiweather-store-test-"));
    tmpDirs.push(dir);
    const store = createStoreInstance({ configPath: dir });

    await store.getState().init();

    expect(store.getState().lastActionError).toBeDefined();
    expect(store.getState().activeSlug).toBeNull();
  });

  test("cycleLocation wraps around both ends", async () => {
    const dir = await makeConfigDir(CONFIG_TOML);
    const store = createStoreInstance({
      configPath: join(dir, "config.toml"),
      fetchForecast: stubFetcher(),
    });
    await store.getState().init();
    expect(store.getState().activeSlug).toBe("london");

    store.getState().cycleLocation(1);
    expect(store.getState().activeSlug).toBe("portland");

    store.getState().cycleLocation(-1);
    expect(store.getState().activeSlug).toBe("london");

    store.getState().cycleLocation(-1);
    expect(store.getState().activeSlug).toBe("portland");

    store.getState().cycleLocation(-1);
    expect(store.getState().activeSlug).toBe("london");

    store.getState().cycleLocation(1);
    expect(store.getState().activeSlug).toBe("portland");
  });

  test("switchLocation ignores unknown slugs and loads known ones", async () => {
    const dir = await makeConfigDir(CONFIG_TOML);
    const fetcher = stubFetcher();
    const store = createStoreInstance({
      configPath: join(dir, "config.toml"),
      fetchForecast: fetcher,
    });
    await store.getState().init();
    fetcher.calls.locations.length = 0;

    store.getState().switchLocation("nowhere");
    expect(store.getState().activeSlug).toBe("london");

    store.getState().switchLocation("portland");
    expect(store.getState().activeSlug).toBe("portland");
    expect(fetcher.calls.locations).toEqual(["45.5202,-122.6765"]);
  });

  test("fetch failure lands in errorBySlug and clears loading", async () => {
    const dir = await makeConfigDir(CONFIG_TOML);
    const failing = stubFetcher(undefined, new ProviderError("upstream down", "stub"));
    const store = createStoreInstance({
      configPath: join(dir, "config.toml"),
      fetchForecast: failing,
    });

    await store.getState().init();

    expect(store.getState().errorBySlug.london).toBe("upstream down");
    expect(store.getState().loadingSlugs).toEqual({});
    expect(store.getState().forecastBySlug.london).toBeUndefined();
  });

  test("refresh bypasses freshness by requesting maxAgeMinutes 0", async () => {
    const dir = await makeConfigDir(CONFIG_TOML);
    const fetcher = stubFetcher();
    const store = createStoreInstance({
      configPath: join(dir, "config.toml"),
      fetchForecast: fetcher,
    });
    await store.getState().init();
    fetcher.calls.maxAges.length = 0;

    await store.getState().refresh("london");
    expect(fetcher.calls.maxAges).toEqual([0]);

    await store.getState().loadForecast("london");
    expect(fetcher.calls.maxAges).toEqual([0, 10]);
  });

  test("toggleUnits flips units and persists to disk", async () => {
    const dir = await makeConfigDir(CONFIG_TOML);
    const store = createStoreInstance({
      configPath: join(dir, "config.toml"),
      fetchForecast: stubFetcher(),
    });
    await store.getState().init();

    store.getState().toggleUnits();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(store.getState().config.units).toBe("imperial");
    const text = await readFile(join(dir, "config.toml"), "utf8");
    expect(text).toContain('units = "imperial"');
    expect(text).toContain('default_location = "london"');
    expect(text).toContain('slug = "portland"');
    expect(store.getState().lastActionError).toBeUndefined();

    store.getState().toggleUnits();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(store.getState().config.units).toBe("metric");
  });

  test("persist failure surfaces in lastActionError", async () => {
    const dir = await makeConfigDir(CONFIG_TOML);
    await writeFile(join(dir, "blocked"), "", "utf8");
    const store = createStoreInstance({
      configPath: join(dir, "blocked", "config.toml"),
      fetchForecast: stubFetcher(),
    });
    await store.getState().init();
    expect(store.getState().config.units).toBe("imperial");

    store.getState().toggleUnits();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(store.getState().lastActionError).toBeDefined();
  });

  test("helpOpen toggles independently of weather actions", async () => {
    const store = createStoreInstance({ fetchForecast: stubFetcher() });
    expect(store.getState().helpOpen).toBe(false);

    store.getState().toggleHelp();
    expect(store.getState().helpOpen).toBe(true);

    store.getState().toggleHelp();
    expect(store.getState().helpOpen).toBe(false);
  });
});
