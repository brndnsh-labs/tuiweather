import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createStoreInstance,
  type ForecastFetcher,
  type RefreshTimerDeps,
} from "../../src/app/store";
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
): ForecastFetcher & { calls: { locations: string[]; maxAges: number[]; windows: unknown[] } } {
  const calls = {
    locations: [] as string[],
    maxAges: [] as number[],
    windows: [] as unknown[],
  };
  return Object.assign(
    (
      location: { latitude: number; longitude: number },
      opts: { maxAgeMinutes: number; window: unknown },
    ) => {
      calls.locations.push(`${location.latitude},${location.longitude}`);
      calls.maxAges.push(opts.maxAgeMinutes);
      calls.windows.push(opts.window);
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

  test("passes the configured forecast window to the fetcher", async () => {
    const dir = await makeConfigDir(CONFIG_TOML);
    const fetcher = stubFetcher();
    const store = createStoreInstance({
      configPath: join(dir, "config.toml"),
      fetchForecast: fetcher,
    });

    await store.getState().init();

    expect(fetcher.calls.windows).toEqual([{ forecastDays: 7, forecastHours: 24 }]);
  });

  test("honors daily_days and hourly_hours config overrides", async () => {
    const toml = CONFIG_TOML.replace(
      "refresh_minutes = 10\n",
      "refresh_minutes = 10\ndaily_days = 10\nhourly_hours = 48\n",
    );
    const dir = await makeConfigDir(toml);
    const fetcher = stubFetcher();
    const store = createStoreInstance({
      configPath: join(dir, "config.toml"),
      fetchForecast: fetcher,
    });

    await store.getState().init();

    expect(fetcher.calls.windows).toEqual([{ forecastDays: 10, forecastHours: 48 }]);
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

  test("empty config becomes ready without fetching a location", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tuiweather-store-test-"));
    tmpDirs.push(dir);
    const fetcher = stubFetcher();
    const store = createStoreInstance({
      configPath: join(dir, "config.toml"),
      fetchForecast: fetcher,
    });

    await store.getState().init();

    expect(store.getState().initStatus).toBe("ready");
    expect(store.getState().config.locations).toEqual([]);
    expect(store.getState().activeSlug).toBeNull();
    expect(fetcher.calls.locations).toEqual([]);
  });

  test("completeOnboarding atomically saves units and the first default location", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tuiweather-store-test-"));
    tmpDirs.push(dir);
    const path = join(dir, "config.toml");
    const fetcher = stubFetcher();
    const store = createStoreInstance({ configPath: path, fetchForecast: fetcher });
    await store.getState().init();

    const completed = await store.getState().completeOnboarding(
      {
        slug: "tokyo-jp",
        label: "Tokyo, jp",
        latitude: 35.68,
        longitude: 139.69,
      },
      "metric",
    );

    expect(completed).toBe(true);
    expect(store.getState().config.units).toBe("metric");
    expect(store.getState().config.default_location).toBe("tokyo-jp");
    expect(store.getState().activeSlug).toBe("tokyo-jp");
    expect(fetcher.calls.locations).toEqual(["35.68,139.69"]);
    const text = await readFile(path, "utf8");
    expect(text).toContain('units = "metric"');
    expect(text).toContain('default_location = "tokyo-jp"');
    expect(text).toContain('slug = "tokyo-jp"');
    store.getState().dispose();
  });

  test("completeOnboarding leaves state empty when the atomic save fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tuiweather-store-test-"));
    tmpDirs.push(dir);
    const path = join(dir, "config.toml");
    const fetcher = stubFetcher();
    const store = createStoreInstance({ configPath: path, fetchForecast: fetcher });
    await store.getState().init();
    await mkdir(path);

    const completed = await store.getState().completeOnboarding(
      {
        slug: "tokyo-jp",
        label: "Tokyo, jp",
        latitude: 35.68,
        longitude: 139.69,
      },
      "metric",
    );

    expect(completed).toBe(false);
    expect(store.getState().config.locations).toEqual([]);
    expect(store.getState().activeSlug).toBeNull();
    expect(fetcher.calls.locations).toEqual([]);
    expect(store.getState().lastActionError).toBeDefined();
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

    await store.getState().toggleUnits();

    expect(store.getState().config.units).toBe("imperial");
    const text = await readFile(join(dir, "config.toml"), "utf8");
    expect(text).toContain('units = "imperial"');
    expect(text).toContain('default_location = "london"');
    expect(text).toContain('slug = "portland"');
    expect(store.getState().lastActionError).toBeUndefined();

    await store.getState().toggleUnits();
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

    await store.getState().toggleUnits();

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

interface FakeRefreshTimers extends RefreshTimerDeps {
  advance(ms: number): Promise<void>;
  pending(): number;
}

function makeFakeTimers(): FakeRefreshTimers {
  const jobs = new Map<number, { at: number; periodMs: number; handler: () => void }>();
  let nextId = 1;
  let now = 0;
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  return {
    setInterval(handler, ms) {
      const id = nextId++;
      jobs.set(id, { at: now + ms, periodMs: ms, handler });
      return id;
    },
    clearInterval(handle) {
      if (typeof handle === "number") jobs.delete(handle);
    },
    pending: () => jobs.size,
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...jobs.entries()]
          .filter(([, job]) => job.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        due[1].at += due[1].periodMs;
        due[1].handler();
        await flush();
      }
      now = target;
    },
  };
}

describe("store auto-refresh", () => {
  const PERIOD_MS = 10 * 60_000;

  function makeFetcher(): ForecastFetcher & { calls: string[] } {
    const calls: string[] = [];
    return Object.assign(
      (location: { latitude: number; longitude: number }) => {
        calls.push(`${location.latitude},${location.longitude}`);
        return Promise.resolve({ forecast: makeForecast(), stale: false });
      },
      { calls },
    );
  }

  async function timedStore(fetcher: ForecastFetcher, timers: FakeRefreshTimers) {
    const dir = await makeConfigDir(CONFIG_TOML);
    return createStoreInstance({
      configPath: join(dir, "config.toml"),
      fetchForecast: fetcher,
      refreshTimers: timers,
    });
  }

  test("two virtual periods fire two background fetches on a single timer", async () => {
    const timers = makeFakeTimers();
    const fetcher = makeFetcher();
    const store = await timedStore(fetcher, timers);

    await store.getState().init();
    expect(store.getState().activeSlug).toBe("london");
    expect(fetcher.calls.length).toBe(1);
    expect(timers.pending()).toBe(1);

    await timers.advance(PERIOD_MS - 1);
    expect(fetcher.calls.length).toBe(1);

    await timers.advance(1);
    expect(fetcher.calls.length).toBe(2);
    expect(timers.pending()).toBe(1);

    await timers.advance(PERIOD_MS);
    expect(fetcher.calls.length).toBe(3);
    expect(timers.pending()).toBe(1);

    store.getState().dispose();
  });

  test("repeated init and manual refresh never stack timers", async () => {
    const timers = makeFakeTimers();
    const fetcher = makeFetcher();
    const store = await timedStore(fetcher, timers);

    await store.getState().init();
    await store.getState().init();
    await store.getState().refresh(store.getState().activeSlug);
    expect(timers.pending()).toBe(1);

    await timers.advance(PERIOD_MS);
    store.getState().dispose();
  });

  test("dispose stops the loop and blocks future scheduling", async () => {
    const timers = makeFakeTimers();
    const fetcher = makeFetcher();
    const store = await timedStore(fetcher, timers);

    await store.getState().init();
    expect(timers.pending()).toBe(1);

    store.getState().dispose();
    expect(timers.pending()).toBe(0);

    const after = fetcher.calls.length;
    await timers.advance(PERIOD_MS * 3);
    expect(fetcher.calls.length).toBe(after);

    store.getState().switchLocation("london");
    expect(timers.pending()).toBe(0);

    store.getState().dispose();
  });

  test("slug switch resets the interval to the new location", async () => {
    const timers = makeFakeTimers();
    const fetcher = makeFetcher();
    const store = await timedStore(fetcher, timers);

    await store.getState().init();
    expect(store.getState().activeSlug).toBe("london");
    fetcher.calls.length = 0;

    await timers.advance(PERIOD_MS - 1000);
    store.getState().switchLocation("portland");
    expect(fetcher.calls).toEqual(["45.5202,-122.6765"]);
    expect(timers.pending()).toBe(1);

    await timers.advance(PERIOD_MS - 1000);
    expect(fetcher.calls.length).toBe(1);

    await timers.advance(1000);
    expect(fetcher.calls).toEqual(["45.5202,-122.6765", "45.5202,-122.6765"]);

    store.getState().dispose();
  });

  test("init failure leaves no timer behind", async () => {
    const timers = makeFakeTimers();
    const dir = await mkdtemp(join(tmpdir(), "tuiweather-store-test-"));
    tmpDirs.push(dir);
    const store = createStoreInstance({
      configPath: dir,
      fetchForecast: makeFetcher(),
      refreshTimers: timers,
    });

    await store.getState().init();

    expect(store.getState().lastActionError).toBeDefined();
    expect(timers.pending()).toBe(0);
  });
});
