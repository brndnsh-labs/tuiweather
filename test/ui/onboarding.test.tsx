import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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
    location: { latitude: 35.68, longitude: 139.69 },
    timezone: "Asia/Tokyo",
    utcOffsetSeconds: 9 * 3600,
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

async function makeStore(
  search: SearchLocationsFn = () => Promise.resolve([TOKYO]),
): Promise<{ store: WeatherStore; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-onboarding-test-"));
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

async function reachLocationStep(setup: Awaited<ReturnType<typeof testRender>>): Promise<void> {
  await setup.mockInput.pressEnter();
  await waitUntilFrame(setup, (frame) => frame.includes("choose units"));
  await setup.mockInput.pressArrow("down");
  await setup.mockInput.pressEnter();
  await waitUntilFrame(
    setup,
    (frame) => frame.includes("find your first location") || frame.includes("type to search"),
  );
}

describe("first-run onboarding", () => {
  test("missing config opens the guided welcome instead of the weather shell", async () => {
    const { store } = await makeStore();
    const setup = await testRender(<App store={store} />, { width: 80, height: 24 });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (value) => value.includes("welcome to tuiweather"));
      expect(frame).toContain("Live weather, rain timing");
      expect(frame).toContain("s skip");
      expect(frame).toContain("enter/esc continue");
      expect(frame).not.toContain("main ·");
      expect(store.getState().initStatus).toBe("ready");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("escape advances to units and q quits from setup", async () => {
    const { store } = await makeStore();
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
      await setup.mockInput.pressKeys(["q"]);
      expect(quits).toBe(1);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("units and first location persist before weather loads", async () => {
    const { store, path } = await makeStore();
    const setup = await testRender(<App store={store} nowUtc={NOW} />, {
      width: 80,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (frame) => frame.includes("welcome to tuiweather"));
      await reachLocationStep(setup);

      await setup.mockInput.typeText("tokyo");
      await waitUntilFrame(setup, (frame) => frame.includes("Tokyo · Tokyo, jp"));
      await setup.mockInput.pressEnter();

      const weather = await waitUntilFrame(
        setup,
        (frame) => frame.includes("Tokyo, Tokyo") && frame.includes("┌─main"),
      );
      expect(weather).not.toContain("find your first location");
      expect(store.getState().config.units).toBe("metric");
      expect(store.getState().config.default_location).toBe("tokyo-tokyo-jp");
      expect(store.getState().activeSlug).toBe("tokyo-tokyo-jp");
      const saved = await readFile(path, "utf8");
      expect(saved).toContain('units = "metric"');
      expect(saved).toContain('default_location = "tokyo-tokyo-jp"');
      expect(saved).toContain('slug = "tokyo-tokyo-jp"');
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("save failure stays in onboarding and the retained selection can retry", async () => {
    const { store, path } = await makeStore();
    const setup = await testRender(<App store={store} />, { width: 80, height: 24 });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (frame) => frame.includes("welcome to tuiweather"));
      await mkdir(path);
      await reachLocationStep(setup);
      await setup.mockInput.typeText("tokyo");
      await waitUntilFrame(setup, (frame) => frame.includes("Tokyo · Tokyo, jp"));
      await setup.mockInput.pressEnter();

      await waitUntilFrame(setup, (frame) => frame.includes("enter retry"));
      expect(store.getState().config.locations).toEqual([]);
      expect(store.getState().activeSlug).toBeNull();

      await rm(path, { recursive: true });
      await setup.mockInput.pressEnter();
      await waitUntilFrame(
        setup,
        (frame) => frame.includes("Tokyo, Tokyo") && frame.includes("main"),
      );
      expect(store.getState().config.locations).toHaveLength(1);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("search errors remain retryable without leaving setup", async () => {
    const { store } = await makeStore(() => Promise.reject(new Error("geocoder unavailable")));
    const setup = await testRender(<App store={store} />, { width: 80, height: 24 });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (frame) => frame.includes("welcome to tuiweather"));
      await reachLocationStep(setup);
      await setup.mockInput.typeText("tokyo");
      const frame = await waitUntilFrame(setup, (value) => value.includes("geocoder unavailable"));
      expect(frame).toContain("find your first location");
      expect(store.getState().config.locations).toEqual([]);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("setup is responsive at 32 columns and clamps safely below it", async () => {
    const first = await makeStore();
    const xs = await testRender(<App store={first.store} />, { width: 32, height: 16 });
    try {
      await xs.flush();
      await waitUntilFrame(xs, (value) => value.includes("welcome to tuiweather"));
      await reachLocationStep(xs);
      await xs.mockInput.typeText("tokyo");
      const frame = await waitUntilFrame(xs, (value) => value.includes("Tokyo"));
      for (const line of frame.split("\n")) expect(line.length).toBeLessThanOrEqual(32);
    } finally {
      await xs.renderer.destroy();
    }

    const second = await makeStore();
    const clamped = await testRender(<App store={second.store} />, { width: 20, height: 8 });
    try {
      await clamped.flush();
      const frame = await waitUntilFrame(clamped, (value) => value.includes("resize"));
      expect(frame).toContain("tuiweather");
      expect(frame).not.toContain("welcome to tuiweather");
      for (const line of frame.split("\n")) expect(line.length).toBeLessThanOrEqual(20);
    } finally {
      await clamped.renderer.destroy();
    }
  });
});
