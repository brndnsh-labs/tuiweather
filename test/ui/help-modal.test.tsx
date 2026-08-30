import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../../src/app/App";
import { createStoreInstance, type ForecastFetcher, type WeatherStore } from "../../src/app/store";
import type { CurrentObs, NormalizedForecast } from "../../src/lib/weather/types";
import { stubNullAirQualityFetcher } from "../helpers";

const NOW = "2026-08-24T19:00:00.000Z";

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

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function makeConfigFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-help-modal-"));
  tmpDirs.push(dir);
  await writeFile(join(dir, "config.toml"), CONFIG_TOML, "utf8");
  return join(dir, "config.toml");
}

function makeForecast(): NormalizedForecast {
  const current: CurrentObs = {
    timeUtc: NOW,
    temperatureC: 22,
    apparentC: 21,
    humidityPct: 50,
    condition: "clear",
    windSpeedKmh: 9,
    windDirectionDeg: 315,
    windGustKmh: null,
    pressureHpa: null,
    dewPointC: null,
    visibilityM: null,
    uvIndex: null,
    isDay: true,
  };
  return {
    providerId: "stub",
    location: { latitude: 45.5202, longitude: -122.6765 },
    timezone: "America/Los_Angeles",
    utcOffsetSeconds: -7 * 3600,
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

async function makeStore(): Promise<WeatherStore> {
  const configPath = await makeConfigFile();
  return createStoreInstance({
    configPath,
    fetchForecast: stubFetcher(),
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

describe("help modal", () => {
  test("help overlay is modal: d d does not delete, escape closes help", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} />, { width: 100, height: 24 });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));

      await setup.mockInput.pressKeys(["?"]);
      await waitUntilFrame(setup, (f) => f.includes("esc close"));

      await setup.mockInput.pressKeys(["d"]);
      await sleep(30);
      await setup.mockInput.pressKeys(["d"]);
      await sleep(30);
      await setup.flush().catch(() => undefined);

      const helpFrame = setup.captureCharFrame();
      expect(helpFrame).toContain("esc close");
      expect(helpFrame).not.toContain("press d again to delete");
      expect(store.getState().config.locations.map((l) => l.slug)).toEqual(["portland", "london"]);

      const frameAfterD = setup.captureCharFrame();
      expect(frameAfterD).toContain("Portland");

      await setup.mockInput.pressEscape();
      await sleep(30);
      const closed = await waitUntilFrame(setup, (f) => !f.includes("esc close"));
      expect(closed).not.toContain("esc close");
      expect(closed).not.toContain("toggle help");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("help modal blocks r refresh while open", async () => {
    let fetchCalls = 0;
    const countingFetcher: ForecastFetcher = () => {
      fetchCalls += 1;
      return Promise.resolve({ forecast: makeForecast(), stale: false });
    };
    const configPath = await makeConfigFile();
    const countingStore = createStoreInstance({
      configPath,
      fetchForecast: countingFetcher,
      fetchAirQuality: stubNullAirQualityFetcher,
    });
    const setup = await testRender(<App store={countingStore} />, { width: 100, height: 24 });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      const before = fetchCalls;

      await setup.mockInput.pressKeys(["?"]);
      await waitUntilFrame(setup, (f) => f.includes("esc close"));

      await setup.mockInput.pressKeys(["r"]);
      await sleep(40);
      await setup.flush().catch(() => undefined);
      expect(fetchCalls).toBe(before);

      await setup.mockInput.pressEscape();
      await sleep(30);
      await waitUntilFrame(setup, (f) => !f.includes("esc close"));
      expect(setup.captureCharFrame()).not.toContain("esc close");
    } finally {
      await setup.renderer.destroy();
    }
    countingStore.getState().dispose();
  });
});
