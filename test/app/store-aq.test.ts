import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AirQualityFetcher,
  createStoreInstance,
  type ForecastFetcher,
} from "../../src/app/store";
import { ProviderError } from "../../src/lib/providers/types";
import type { AirQuality, NormalizedForecast } from "../../src/lib/weather/types";

const NOW = "2026-08-24T12:00:00.000Z";

const CONFIG_TOML = `schema_version = 1
units = "metric"
refresh_minutes = 10
theme = "night"
default_location = "portland"

[[locations]]
slug = "portland"
label = "Portland"
latitude = 45.5202
longitude = -122.6765

[panels]
nowcast = true
details = true
hourly = true
daily = true
`;

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

function makeForecast(): NormalizedForecast {
  return {
    providerId: "stub",
    location: { latitude: 45.5202, longitude: -122.6765 },
    timezone: "America/Los_Angeles",
    utcOffsetSeconds: -7 * 3600,
    fetchedAtUtc: NOW,
    hasMinutePrecip: true,
    current: {
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
    },
    minutely15: [],
    hourly: [],
    daily: [],
  };
}

function makeAq(): AirQuality {
  return { usAqi: 29, observedAtUtc: NOW };
}

async function makeConfigDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-store-aq-"));
  tmpDirs.push(dir);
  await writeFile(join(dir, "config.toml"), CONFIG_TOML, "utf8");
  return dir;
}

describe("store air quality", () => {
  test("AQ lands in state on init", async () => {
    const dir = await makeConfigDir();
    const fetcher: ForecastFetcher = () =>
      Promise.resolve({ forecast: makeForecast(), stale: false });
    const aqFetcher: AirQualityFetcher = () => Promise.resolve(makeAq());
    const store = createStoreInstance({
      configPath: join(dir, "config.toml"),
      fetchForecast: fetcher,
      fetchAirQuality: aqFetcher,
    });
    await store.getState().init();
    // allow async AQ fire-and-forget to settle
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getState().airQuality?.usAqi).toBe(29);
    expect(store.getState().airQualityBySlug.portland?.usAqi).toBe(29);
    store.getState().dispose();
  });

  test("forecast still renders when AQ fetch rejects (silent null)", async () => {
    const dir = await makeConfigDir();
    const fetcher: ForecastFetcher = () =>
      Promise.resolve({ forecast: makeForecast(), stale: false });
    const aqFetcher: AirQualityFetcher = () => Promise.reject(new ProviderError("down", "stub"));
    const store = createStoreInstance({
      configPath: join(dir, "config.toml"),
      fetchForecast: fetcher,
      fetchAirQuality: aqFetcher,
    });
    await store.getState().init();
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getState().forecastBySlug.portland).toBeDefined();
    expect(store.getState().airQuality).toBeNull();
    expect(store.getState().errorBySlug.portland).toBeUndefined();
    store.getState().dispose();
  });

  test("missing getAirQuality (fetcher throws ProviderError) → null, no throw", async () => {
    const dir = await makeConfigDir();
    const fetcher: ForecastFetcher = () =>
      Promise.resolve({ forecast: makeForecast(), stale: false });
    const failingAq: AirQualityFetcher = () =>
      Promise.reject(new ProviderError("provider does not support air quality", "stub"));
    const store = createStoreInstance({
      configPath: join(dir, "config.toml"),
      fetchForecast: fetcher,
      fetchAirQuality: failingAq,
    });
    await store.getState().init();
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getState().airQuality).toBeNull();
    expect(store.getState().forecastBySlug.portland).toBeDefined();
    store.getState().dispose();
  });

  test("AQ never delays forecast resolution (deferred promises)", async () => {
    const dir = await makeConfigDir();
    let releaseAq!: (v: AirQuality) => void;
    const aqPromise = new Promise<AirQuality>((resolve) => {
      releaseAq = resolve;
    });
    const fetcher: ForecastFetcher = () =>
      Promise.resolve({ forecast: makeForecast(), stale: false });
    const aqFetcher: AirQualityFetcher = () => aqPromise;
    const store = createStoreInstance({
      configPath: join(dir, "config.toml"),
      fetchForecast: fetcher,
      fetchAirQuality: aqFetcher,
    });
    await store.getState().init();
    // forecast should be ready even though AQ still pending
    expect(store.getState().forecastBySlug.portland).toBeDefined();
    expect(store.getState().airQuality).toBeNull();
    // now release AQ
    releaseAq(makeAq());
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getState().airQuality?.usAqi).toBe(29);
    store.getState().dispose();
  });

  test("dispose clears AQ state", async () => {
    const dir = await makeConfigDir();
    const fetcher: ForecastFetcher = () =>
      Promise.resolve({ forecast: makeForecast(), stale: false });
    const aqFetcher: AirQualityFetcher = () => Promise.resolve(makeAq());
    const store = createStoreInstance({
      configPath: join(dir, "config.toml"),
      fetchForecast: fetcher,
      fetchAirQuality: aqFetcher,
    });
    await store.getState().init();
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getState().airQuality).not.toBeNull();
    store.getState().dispose();
    expect(store.getState().airQuality).toBeNull();
    expect(store.getState().airQualityBySlug).toEqual({});
  });
});
