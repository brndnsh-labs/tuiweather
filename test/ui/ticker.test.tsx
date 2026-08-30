import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { __setTickIntervalMs, App, TICK_INTERVAL_MS } from "../../src/app/App";
import { createStoreInstance, type ForecastFetcher, type WeatherStore } from "../../src/app/store";
import type { CurrentObs, NormalizedForecast } from "../../src/lib/weather/types";
import { stubNullAirQualityFetcher } from "../helpers";

const CONFIG_TOML = `schema_version = 1
units = "imperial"
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

function makeForecast(fetchedAtUtc: string): NormalizedForecast {
  const current: CurrentObs = {
    timeUtc: fetchedAtUtc,
    temperatureC: 18,
    apparentC: 17,
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
    fetchedAtUtc,
    hasMinutePrecip: true,
    current,
    minutely15: [],
    hourly: [],
    daily: [],
  };
}

async function makeStore(forecast: NormalizedForecast): Promise<WeatherStore> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-ticker-test-"));
  tmpDirs.push(dir);
  await writeFile(join(dir, "config.toml"), CONFIG_TOML, "utf8");
  const fetcher: ForecastFetcher = () => Promise.resolve({ forecast, stale: false });
  return createStoreInstance({
    configPath: join(dir, "config.toml"),
    fetchForecast: fetcher,
    fetchAirQuality: stubNullAirQualityFetcher,
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntilFrame(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: (frame: string) => boolean,
  timeoutMs = 3000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let frame = "";
  while (Date.now() < deadline) {
    frame = setup.captureCharFrame();
    if (predicate(frame)) return frame;
    await sleep(15);
    await setup.flush().catch(() => undefined);
  }
  throw new Error(`waitUntilFrame timed out; last frame:\n${frame}`);
}

// The 3s + 4s sequential waitUntilFrame budgets (7s) exceed bun's 5s default
// per-test timeout, so the advancing-tick test carries an explicit 30s timeout.
describe("ticker", () => {
  test("without injected clock the header ago string advances after tick", async () => {
    const original = TICK_INTERVAL_MS;
    __setTickIntervalMs(30);
    try {
      const baseNow = Date.now();
      const fetchedAtUtc = new Date(baseNow - 89_500).toISOString();
      const store = await makeStore(makeForecast(fetchedAtUtc));
      const setup = await testRender(<App store={store} />, { width: 90, height: 24 });
      try {
        await setup.flush();
        await waitUntilFrame(setup, (f) => f.includes("just now"), 3000);
        const advanced = await waitUntilFrame(setup, (f) => f.includes("1m ago"), 4000);
        expect(advanced).toContain("1m ago");
      } finally {
        await setup.renderer.destroy();
      }
    } finally {
      __setTickIntervalMs(original);
    }
  }, 30_000);

  test("with injected nowMs the header ago string stays frozen", async () => {
    const original = TICK_INTERVAL_MS;
    __setTickIntervalMs(30);
    try {
      const baseNow = Date.now();
      const fetchedAtUtc = new Date(baseNow - 89_950).toISOString();
      const injectedNowMs = baseNow;
      const store = await makeStore(makeForecast(fetchedAtUtc));
      const setup = await testRender(
        <App store={store} nowMs={injectedNowMs} nowUtc={new Date(injectedNowMs).toISOString()} />,
        {
          width: 90,
          height: 24,
        },
      );
      try {
        await setup.flush();
        const initial = await waitUntilFrame(setup, (f) => f.includes("just now"), 3000);
        expect(initial).toContain("just now");
        // Negative assertion is load-bearing: a live ticker would have crossed the
        // 90s "just now"→"1m ago" threshold after ~50ms + one injected tick (30ms).
        // Keep a short fixed settle past that threshold; polling cannot prove the
        // absence of a transition, so the brief sleep is intentional.
        await sleep(80);
        await setup.flush().catch(() => undefined);
        const later = setup.captureCharFrame();
        expect(later).toContain("just now");
        expect(later).not.toContain("1m ago");
      } finally {
        await setup.renderer.destroy();
      }
    } finally {
      __setTickIntervalMs(original);
    }
  });
});
