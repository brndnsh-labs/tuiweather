import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../../src/app/App";
import {
  ACTION_ERROR_TTL_MS,
  createStoreInstance,
  type ForecastFetcher,
  type SearchLocationsFn,
  type WeatherStore,
} from "../../src/app/store";
import type { GeocodingResult } from "../../src/lib/providers/types";
import type { CurrentObs, NormalizedForecast } from "../../src/lib/weather/types";
import { stubNullAirQualityFetcher } from "../helpers";

const NOW = "2026-08-24T19:00:00.000Z";
const NOW_MS = Date.parse(NOW);

const TWO_LOCATION_TOML = `schema_version = 1
units = "imperial"
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

const ONE_LOCATION_TOML = TWO_LOCATION_TOML.replace(/default_location = "london"\n/, "").replace(
  /\[\[locations\]\]\nslug = "london"[\s\S]*?\n\n/,
  "",
);

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function makeConfigFile(toml: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-action-error-test-"));
  tmpDirs.push(dir);
  await writeFile(join(dir, "config.toml"), toml, "utf8");
  return join(dir, "config.toml");
}

function geo(overrides: Partial<GeocodingResult> = {}): GeocodingResult {
  return {
    id: 1,
    name: "Portland",
    latitude: 45.52,
    longitude: -122.68,
    admin1: "Oregon",
    country: "United States",
    country_code: "us",
    ...overrides,
  };
}

const OREGON_RESULT = geo();

function makeForecast(): NormalizedForecast {
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

function stubFetcher(): ForecastFetcher & { calls: string[] } {
  const calls: string[] = [];
  return Object.assign(
    (location: { latitude: number; longitude: number }) => {
      calls.push(`${location.latitude},${location.longitude}`);
      return Promise.resolve({ forecast: makeForecast(), stale: false });
    },
    { calls },
  );
}

function stubSearch(
  responder: (query: string) => Promise<GeocodingResult[]>,
): SearchLocationsFn & { calls: string[] } {
  const calls: string[] = [];
  return Object.assign(
    (query: string) => {
      calls.push(query);
      return responder(query);
    },
    { calls },
  );
}

async function makeStore(
  opts: { configToml?: string; fetcher?: ForecastFetcher; search?: SearchLocationsFn } = {},
): Promise<{ store: WeatherStore; path: string }> {
  const path = await makeConfigFile(opts.configToml ?? TWO_LOCATION_TOML);
  const store = createStoreInstance({
    configPath: path,
    fetchForecast: opts.fetcher ?? stubFetcher(),
    searchLocations: opts.search ?? stubSearch(() => Promise.resolve([OREGON_RESULT])),
    fetchAirQuality: stubNullAirQualityFetcher,
  });
  return { store, path };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntilFrame(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: (frame: string) => boolean,
  timeoutMs = 5000,
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

async function openSearch(setup: Awaited<ReturnType<typeof testRender>>): Promise<string> {
  await setup.mockInput.pressKeys(["/"]);
  return waitUntilFrame(setup, (f) => f.includes("search location"));
}

async function openLocations(setup: Awaited<ReturnType<typeof testRender>>): Promise<string> {
  await setup.mockInput.pressKeys(["l"]);
  return waitUntilFrame(setup, (f) => f.includes("locations"));
}

describe("action error rendering", () => {
  test("failed add keeps overlay open with error visible", async () => {
    const search = stubSearch(() => Promise.resolve([OREGON_RESULT]));
    const { store, path } = await makeStore({ search });
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      await openSearch(setup);
      await setup.mockInput.typeText("port");
      await waitUntilFrame(setup, (f) => f.includes("Portland · Oregon, us"));

      await rm(path);
      await mkdir(path);

      await setup.mockInput.pressEnter();

      const errorFrame = await waitUntilFrame(setup, (f) => {
        const err = store.getState().lastActionError;
        if (!err) return false;
        return f.includes(err.slice(0, 8)) && f.includes("search location");
      });
      expect(errorFrame).toContain("search location");
      expect(store.getState().overlayOpen).toBe(true);
      expect(store.getState().lastActionError).toBeDefined();

      await rm(path, { recursive: true, force: true });
      await setup.mockInput.typeText("x");
      await sleep(50);
      await setup.flush();
      const afterType = setup.captureCharFrame();
      expect(afterType).toContain("search location");

      expect(store.getState().config.locations).toHaveLength(2);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("successful add still closes the overlay promptly", async () => {
    const search = stubSearch(() => Promise.resolve([OREGON_RESULT]));
    const fetcher = stubFetcher();
    const { store } = await makeStore({ search, fetcher });
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      fetcher.calls.length = 0;
      await openSearch(setup);
      await setup.mockInput.typeText("port");
      await waitUntilFrame(setup, (f) => f.includes("Portland · Oregon, us"));
      await setup.mockInput.pressEnter();
      const closed = await waitUntilFrame(setup, (f) => !f.includes("search location"));
      expect(closed).not.toContain("type to search");
      expect(store.getState().overlayOpen).toBe(false);
      expect(store.getState().activeSlug).toBe("portland-oregon-us");
      expect(store.getState().lastActionError).toBeUndefined();
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("deleting the last location shows refusal in locations overlay", async () => {
    const { store } = await makeStore({ configToml: ONE_LOCATION_TOML });
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      await openLocations(setup);
      await setup.mockInput.pressKeys(["d"]);
      await sleep(30);
      await waitUntilFrame(setup, (f) => f.includes("d again deletes Portland"));
      await setup.mockInput.pressKeys(["d"]);
      const errorFrame = await waitUntilFrame(setup, (f) =>
        f.includes("cannot delete the only location"),
      );
      expect(errorFrame).toContain("locations");
      expect(errorFrame).not.toContain("d again deletes");
      expect(store.getState().lastActionError).toBe("cannot delete the only location");
      expect(store.getState().config.locations).toHaveLength(1);
      expect(store.getState().locationsOpen).toBe(true);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("StatusArea transient shows action error and clears on next action", async () => {
    const { store, path } = await makeStore();
    const setup = await testRender(<App store={store} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      await rm(path);
      await mkdir(path);
      await store
        .getState()
        .addLocation({ slug: "oslo", label: "Oslo", latitude: 59.9, longitude: 10.7 });
      await sleep(20);
      await setup.flush();
      const expected = store.getState().lastActionError ?? "";
      const needle = expected.slice(0, 8);
      const errorFrame = await waitUntilFrame(
        setup,
        (f) => needle.length > 0 && f.includes(needle),
      );
      expect(store.getState().lastActionError).toBeDefined();
      expect(errorFrame).toContain(needle);

      await rm(path, { recursive: true, force: true });
      store.getState().switchLocation("portland");
      await sleep(20);
      await setup.flush();
      const cleared = setup.captureCharFrame();
      expect(cleared).not.toContain(needle);
      expect(store.getState().lastActionError).toBeUndefined();
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("StatusArea transient auto-clears after timeout", async () => {
    const { store, path } = await makeStore();
    const setup = await testRender(<App store={store} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      await rm(path);
      await mkdir(path);
      await store
        .getState()
        .addLocation({ slug: "oslo", label: "Oslo", latitude: 59.9, longitude: 10.7 });
      const needle = (store.getState().lastActionError ?? "").slice(0, 8);
      expect(store.getState().lastActionError).toBeDefined();
      await sleep(ACTION_ERROR_TTL_MS + 200);
      await setup.flush();
      expect(store.getState().lastActionError).toBeUndefined();
      const frame = setup.captureCharFrame();
      if (needle.length > 0) expect(frame).not.toContain(needle);
      await rm(path, { recursive: true, force: true }).catch(() => undefined);
    } finally {
      await setup.renderer.destroy();
    }
  });
});
