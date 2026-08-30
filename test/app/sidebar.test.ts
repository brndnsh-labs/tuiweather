import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStoreInstance, type ForecastFetcher } from "../../src/app/store";
import { loadConfig } from "../../src/lib/config/load";
import type { CurrentObs, NormalizedForecast } from "../../src/lib/weather/types";
import { stubNullAirQualityFetcher } from "../helpers";

const NOW = "2026-08-24T12:00:00.000Z";

const THREE_TOML = `schema_version = 3
units = "metric"
refresh_minutes = 10
theme = "night"
default_location = "london"
provider = "openmeteo"
daily_days = 7
hourly_hours = 24

[panels]
nowcast = true
details = true
hourly = true
daily = true

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

[[locations]]
slug = "tokyo"
label = "Tokyo"
latitude = 35.68
longitude = 139.69
`;

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function makeConfigDir(toml: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-sidebar-test-"));
  tmpDirs.push(dir);
  await writeFile(join(dir, "config.toml"), toml, "utf8");
  return dir;
}

function makeForecast(): NormalizedForecast {
  const current: CurrentObs = {
    timeUtc: NOW,
    temperatureC: 18,
    apparentC: 18,
    humidityPct: 50,
    condition: "clear",
    windSpeedKmh: 8,
    windDirectionDeg: 200,
    windGustKmh: null,
    pressureHpa: null,
    dewPointC: null,
    visibilityM: null,
    uvIndex: null,
    isDay: true,
  };
  return {
    providerId: "stub",
    location: { latitude: 0, longitude: 0 },
    timezone: "UTC",
    utcOffsetSeconds: 0,
    fetchedAtUtc: NOW,
    hasMinutePrecip: true,
    current,
    minutely15: [],
    hourly: [],
    daily: [],
  };
}

function stubFetcher(): ForecastFetcher {
  return () => Promise.resolve({ forecast: makeForecast(), stale: false });
}

describe("setDefaultLocation", () => {
  test("sets config.default_location and persists to disk", async () => {
    const dir = await makeConfigDir(THREE_TOML);
    const path = join(dir, "config.toml");
    const store = createStoreInstance({
      configPath: path,
      fetchForecast: stubFetcher(),
      fetchAirQuality: stubNullAirQualityFetcher,
    });
    await store.getState().init();

    expect(store.getState().config.default_location).toBe("london");

    await store.getState().setDefaultLocation("tokyo");

    expect(store.getState().config.default_location).toBe("tokyo");
    const text = await readFile(path, "utf8");
    expect(text).toContain('default_location = "tokyo"');
    const loaded = await loadConfig(path);
    expect(loaded.default_location).toBe("tokyo");
    store.getState().dispose();
  });

  test("no-op for unknown slug leaves config and file untouched", async () => {
    const dir = await makeConfigDir(THREE_TOML);
    const path = join(dir, "config.toml");
    const store = createStoreInstance({
      configPath: path,
      fetchForecast: stubFetcher(),
      fetchAirQuality: stubNullAirQualityFetcher,
    });
    await store.getState().init();
    const before = await readFile(path, "utf8");
    const beforeDefault = store.getState().config.default_location;

    await store.getState().setDefaultLocation("nowhere");

    expect(store.getState().config.default_location).toBe(beforeDefault);
    const after = await readFile(path, "utf8");
    expect(after).toBe(before);
    store.getState().dispose();
  });

  test("no-op when locations list empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tuiweather-sidebar-empty-"));
    tmpDirs.push(dir);
    const path = join(dir, "config.toml");
    const store = createStoreInstance({
      configPath: path,
      fetchForecast: stubFetcher(),
      fetchAirQuality: stubNullAirQualityFetcher,
    });
    await store.getState().init();
    expect(store.getState().config.locations).toEqual([]);
    await store.getState().setDefaultLocation("anything");
    expect(store.getState().config.default_location).toBeUndefined();
    store.getState().dispose();
  });
});

describe("moveLocation", () => {
  test("moves focused location down one and persists order", async () => {
    const dir = await makeConfigDir(THREE_TOML);
    const path = join(dir, "config.toml");
    const store = createStoreInstance({
      configPath: path,
      fetchForecast: stubFetcher(),
      fetchAirQuality: stubNullAirQualityFetcher,
    });
    await store.getState().init();
    expect(store.getState().config.locations.map((l) => l.slug)).toEqual([
      "portland",
      "london",
      "tokyo",
    ]);
    const beforeActive = store.getState().activeSlug;

    await store.getState().moveLocation("portland", 1);

    expect(store.getState().config.locations.map((l) => l.slug)).toEqual([
      "london",
      "portland",
      "tokyo",
    ]);
    expect(store.getState().activeSlug).toBe(beforeActive);
    const loaded = await loadConfig(path);
    expect(loaded.locations.map((l) => l.slug)).toEqual(["london", "portland", "tokyo"]);
    store.getState().dispose();
  });

  test("moves focused location up one and persists order", async () => {
    const dir = await makeConfigDir(THREE_TOML);
    const path = join(dir, "config.toml");
    const store = createStoreInstance({
      configPath: path,
      fetchForecast: stubFetcher(),
      fetchAirQuality: stubNullAirQualityFetcher,
    });
    await store.getState().init();

    await store.getState().moveLocation("tokyo", -1);

    expect(store.getState().config.locations.map((l) => l.slug)).toEqual([
      "portland",
      "tokyo",
      "london",
    ]);
    const loaded = await loadConfig(path);
    expect(loaded.locations.map((l) => l.slug)).toEqual(["portland", "tokyo", "london"]);
    store.getState().dispose();
  });

  test("boundary no-ops: moving first up and last down", async () => {
    const dir = await makeConfigDir(THREE_TOML);
    const path = join(dir, "config.toml");
    const store = createStoreInstance({
      configPath: path,
      fetchForecast: stubFetcher(),
      fetchAirQuality: stubNullAirQualityFetcher,
    });
    await store.getState().init();
    const beforeText = await readFile(path, "utf8");

    await store.getState().moveLocation("portland", -1);
    expect(store.getState().config.locations.map((l) => l.slug)).toEqual([
      "portland",
      "london",
      "tokyo",
    ]);

    await store.getState().moveLocation("tokyo", 1);
    expect(store.getState().config.locations.map((l) => l.slug)).toEqual([
      "portland",
      "london",
      "tokyo",
    ]);

    const afterText = await readFile(path, "utf8");
    expect(afterText).toBe(beforeText);
    store.getState().dispose();
  });

  test("no-op for unknown slug", async () => {
    const dir = await makeConfigDir(THREE_TOML);
    const path = join(dir, "config.toml");
    const store = createStoreInstance({
      configPath: path,
      fetchForecast: stubFetcher(),
      fetchAirQuality: stubNullAirQualityFetcher,
    });
    await store.getState().init();
    const before = store.getState().config.locations.map((l) => l.slug);
    const beforeText = await readFile(path, "utf8");

    await store.getState().moveLocation("ghost", 1);

    expect(store.getState().config.locations.map((l) => l.slug)).toEqual(before);
    expect(await readFile(path, "utf8")).toBe(beforeText);
    store.getState().dispose();
  });

  test("no-op when locations empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tuiweather-sidebar-empty-"));
    tmpDirs.push(dir);
    const path = join(dir, "config.toml");
    const store = createStoreInstance({
      configPath: path,
      fetchForecast: stubFetcher(),
      fetchAirQuality: stubNullAirQualityFetcher,
    });
    await store.getState().init();
    await store.getState().moveLocation("anything", 1);
    expect(store.getState().config.locations).toEqual([]);
    store.getState().dispose();
  });

  test("active slug unchanged by reordering", async () => {
    const dir = await makeConfigDir(THREE_TOML);
    const path = join(dir, "config.toml");
    const store = createStoreInstance({
      configPath: path,
      fetchForecast: stubFetcher(),
      fetchAirQuality: stubNullAirQualityFetcher,
    });
    await store.getState().init();
    expect(store.getState().activeSlug).toBe("london");
    await store.getState().moveLocation("london", 1);
    expect(store.getState().activeSlug).toBe("london");
    expect(store.getState().config.locations.map((l) => l.slug)).toEqual([
      "portland",
      "tokyo",
      "london",
    ]);
    store.getState().dispose();
  });
});

describe("deleteActiveLocation + default_location interaction via focused workflow", () => {
  test("deleting the focused default location migrates default and saves cleanly", async () => {
    const dir = await makeConfigDir(THREE_TOML);
    const path = join(dir, "config.toml");
    const store = createStoreInstance({
      configPath: path,
      fetchForecast: stubFetcher(),
      fetchAirQuality: stubNullAirQualityFetcher,
    });
    await store.getState().init();

    await store.getState().setDefaultLocation("tokyo");
    expect(store.getState().config.default_location).toBe("tokyo");

    store.getState().switchLocation("tokyo");
    expect(store.getState().activeSlug).toBe("tokyo");

    store.getState().armDelete();
    await store.getState().deleteActiveLocation();

    expect(store.getState().config.locations.map((l) => l.slug)).toEqual(["portland", "london"]);
    const loaded = await loadConfig(path);
    expect(loaded.default_location).toBe("portland");
    expect(loaded.locations.map((l) => l.slug)).toEqual(["portland", "london"]);
    expect(store.getState().activeSlug).toBe("london");
    store.getState().dispose();
  });

  test("deleting default when active is default clears migrates correctly with 2 locations", async () => {
    const dir = await makeConfigDir(THREE_TOML);
    const path = join(dir, "config.toml");
    const store = createStoreInstance({
      configPath: path,
      fetchForecast: stubFetcher(),
      fetchAirQuality: stubNullAirQualityFetcher,
    });
    await store.getState().init();
    store.getState().switchLocation("portland");
    await store.getState().setDefaultLocation("portland");
    store.getState().armDelete();
    await store.getState().deleteActiveLocation();
    const loaded = await loadConfig(path);
    expect(loaded.default_location).toBe("london");
    expect(loaded.locations).toHaveLength(2);
    store.getState().dispose();
  });
});
