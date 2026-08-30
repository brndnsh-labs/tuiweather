import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../../src/app/App";
import {
  createStoreInstance,
  type ForecastFetcher,
  type SearchLocationsFn,
  type WeatherStore,
} from "../../src/app/store";
import type { GeocodingResult } from "../../src/lib/providers/types";
import type { CurrentObs, NormalizedForecast } from "../../src/lib/weather/types";
import { stubNullAirQualityFetcher } from "../helpers";

const NOW = "2026-08-24T19:00:00.000Z";
const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

function forecast(): NormalizedForecast {
  const current: CurrentObs = {
    timeUtc: NOW,
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
    fetchedAtUtc: NOW,
    hasMinutePrecip: true,
    current,
    minutely15: [],
    hourly: [],
    daily: [],
  };
}

const TOKYO: GeocodingResult = {
  id: 1,
  name: "Tokyo",
  latitude: 35.68,
  longitude: 139.69,
  admin1: "Tokyo",
  country: "Japan",
  country_code: "jp",
};

const CONFIG_TOML = `schema_version = 3
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
`;

async function makeEmptyStore(
  search: SearchLocationsFn = () => Promise.resolve([TOKYO]),
): Promise<{ store: WeatherStore; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-skip-test-"));
  tmpDirs.push(dir);
  const path = join(dir, "config.toml");
  const fetcher: ForecastFetcher = () => Promise.resolve({ forecast: forecast(), stale: false });
  return {
    path,
    store: createStoreInstance({
      configPath: path,
      fetchForecast: fetcher,
      searchLocations: search,
      fetchAirQuality: stubNullAirQualityFetcher,
    }),
  };
}

async function makePopulatedStore(): Promise<WeatherStore> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-rerun-test-"));
  tmpDirs.push(dir);
  const configPath = join(dir, "config.toml");
  await writeFile(configPath, CONFIG_TOML, "utf8");
  const fetcher: ForecastFetcher = () => Promise.resolve({ forecast: forecast(), stale: false });
  return createStoreInstance({
    configPath,
    fetchForecast: fetcher,
    fetchAirQuality: stubNullAirQualityFetcher,
    searchLocations: () => Promise.resolve([TOKYO]),
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

describe("onboarding skip and re-run", () => {
  test("skip from welcome reaches the main empty state", async () => {
    const { store } = await makeEmptyStore();
    const setup = await testRender(<App store={store} />, { width: 80, height: 24 });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (frame) => frame.includes("welcome to tuiweather"));
      expect(setup.captureCharFrame()).toContain("s skip");
      await setup.mockInput.pressKeys(["s"]);
      const frame = await waitUntilFrame(
        setup,
        (value) => value.includes("no forecast loaded") && !value.includes("welcome to tuiweather"),
      );
      expect(frame).toContain("no forecast loaded");
      expect(store.getState().onboardingSkipped).toBe(true);
      expect(store.getState().config.locations).toEqual([]);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("re-run from help opens onboarding", async () => {
    const store = await makePopulatedStore();
    const setup = await testRender(<App store={store} />, { width: 100, height: 24 });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (frame) => frame.includes("Portland"));
      await setup.mockInput.pressKeys(["?"]);
      const helpFrame = await waitUntilFrame(setup, (frame) => frame.includes("o re-run setup"));
      expect(helpFrame).toContain("o re-run setup");
      expect(helpFrame).toContain("esc close");
      await setup.mockInput.pressKeys(["o"]);
      const onboarding = await waitUntilFrame(setup, (frame) =>
        frame.includes("welcome to tuiweather"),
      );
      expect(onboarding).toContain("welcome to tuiweather");
      expect(onboarding).not.toContain("esc close");
      expect(store.getState().onboardingForced).toBe(true);
      expect(store.getState().helpOpen).toBe(false);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("completing after re-run succeeds and lands in the main view", async () => {
    const store = await makePopulatedStore();
    const setup = await testRender(<App store={store} nowUtc={NOW} />, { width: 80, height: 24 });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (frame) => frame.includes("Portland"));
      await setup.mockInput.pressKeys(["?"]);
      await waitUntilFrame(setup, (frame) => frame.includes("o re-run setup"));
      await setup.mockInput.pressKeys(["o"]);
      await waitUntilFrame(setup, (frame) => frame.includes("welcome to tuiweather"));
      await setup.mockInput.pressEnter();
      await waitUntilFrame(setup, (frame) => frame.includes("choose units"));
      await setup.mockInput.pressArrow("down");
      await setup.mockInput.pressEnter();
      await waitUntilFrame(
        setup,
        (frame) => frame.includes("find your first location") || frame.includes("type to search"),
      );
      await setup.mockInput.typeText("tokyo");
      await waitUntilFrame(setup, (frame) => frame.includes("Tokyo · Tokyo, jp"));
      await setup.mockInput.pressEnter();
      const weather = await waitUntilFrame(
        setup,
        (frame) => frame.includes("Tokyo, Tokyo") && frame.includes("main"),
      );
      expect(weather).not.toContain("find your first location");
      expect(store.getState().config.locations.map((loc) => loc.slug)).toEqual([
        "portland",
        "london",
        "tokyo-tokyo-jp",
      ]);
      expect(store.getState().onboardingForced).toBe(false);
      expect(store.getState().activeSlug).toBe("tokyo-tokyo-jp");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("escape behavior unchanged — escape advances from welcome, back from units, q quits", async () => {
    const { store } = await makeEmptyStore();
    let quits = 0;
    const setup = await testRender(<App store={store} quit={() => quits++} />, {
      width: 80,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (frame) => frame.includes("welcome to tuiweather"));
      await setup.mockInput.pressEscape();
      await sleep(30);
      await waitUntilFrame(setup, (frame) => frame.includes("choose units"));
      await setup.mockInput.pressEscape();
      await sleep(30);
      await waitUntilFrame(setup, (frame) => frame.includes("welcome to tuiweather"));
      await setup.mockInput.pressKeys(["q"]);
      expect(quits).toBe(1);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("help overlay o does not fire when help is closed", async () => {
    const store = await makePopulatedStore();
    const setup = await testRender(<App store={store} />, { width: 100, height: 24 });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (frame) => frame.includes("Portland"));
      await setup.mockInput.pressKeys(["o"]);
      await sleep(40);
      await setup.flush().catch(() => undefined);
      const frame = setup.captureCharFrame();
      expect(frame).not.toContain("welcome to tuiweather");
      expect(frame).toContain("Portland");
      expect(store.getState().onboardingForced).toBe(false);
    } finally {
      await setup.renderer.destroy();
    }
  });
});
