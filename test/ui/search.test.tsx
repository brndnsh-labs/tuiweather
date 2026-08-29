import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { buildLocationEntry } from "../../src/features/search/SearchOverlay";
import { loadConfig } from "../../src/lib/config/load";
import type { GeocodingResult } from "../../src/lib/providers/types";
import { displayWidth } from "../../src/lib/weather/format";
import type { CurrentObs, NormalizedForecast } from "../../src/lib/weather/types";
import { stubNullAirQualityFetcher } from "../helpers";

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

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
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-search-test-"));
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
const MAINE_RESULT = geo({
  id: 2,
  name: "Portland",
  latitude: 43.66,
  longitude: -70.26,
  admin1: "Maine",
});

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

interface StoreOpts {
  configToml?: string;
  fetcher?: ForecastFetcher;
  search?: SearchLocationsFn;
}

async function makeStore(opts: StoreOpts = {}): Promise<{ store: WeatherStore; path: string }> {
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

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 3000,
  describe = "condition",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(15);
  }
  throw new Error(`waitUntil timed out waiting for: ${describe}`);
}

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

async function openSearch(setup: Awaited<ReturnType<typeof testRender>>): Promise<string> {
  await setup.mockInput.pressKeys(["/"]);
  return waitUntilFrame(setup, (f) => f.includes("search location"));
}

describe("search overlay", () => {
  test("/ opens the overlay, escape closes, underlying frame restored byte-identical", async () => {
    const { store } = await makeStore();
    let quits = 0;
    const setup = await testRender(<App store={store} nowMs={NOW_MS} quit={() => quits++} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      const before = setup.captureCharFrame();

      const openFrame = await openSearch(setup);
      expect(openFrame).toContain("type to search");
      expect(openFrame).toContain("esc cancel");

      await setup.mockInput.pressEscape();
      const after = await waitUntilFrame(setup, (f) => !f.includes("search location"));
      expect(after).toBe(before);
      expect(quits).toBe(0);
      expect(store.getState().overlayOpen).toBe(false);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("typing fires exactly one debounced search once the window elapses", async () => {
    const search = stubSearch(() => Promise.resolve([OREGON_RESULT, MAINE_RESULT]));
    const { store } = await makeStore({ search });
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      await openSearch(setup);

      await setup.mockInput.typeText("portl");
      expect(search.calls).toEqual([]);

      await waitUntilFrame(setup, (f) => f.includes("Portland · Oregon, us"));
      expect(search.calls).toEqual(["portl"]);
      expect(setup.captureCharFrame()).toContain("› Portland · Oregon, us");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("arrow keys move the result cursor", async () => {
    const search = stubSearch(() => Promise.resolve([OREGON_RESULT, MAINE_RESULT]));
    const { store } = await makeStore({ search });
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

      await setup.mockInput.pressArrow("down");
      const moved = await waitUntilFrame(setup, (f) => f.includes("› Portland · Maine, us"));
      expect(moved).not.toContain("› Portland · Oregon, us");

      await setup.mockInput.pressArrow("up");
      const back = await waitUntilFrame(setup, (f) => f.includes("› Portland · Oregon, us"));
      expect(back).toContain("  Portland · Maine, us");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("rapid retyping supersedes the stale in-flight response", async () => {
    let resolveFirst!: (results: GeocodingResult[]) => void;
    const search = stubSearch((query) => {
      if (query === "po") {
        return new Promise<GeocodingResult[]>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve([MAINE_RESULT]);
    });
    const { store } = await makeStore({ search });
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      await openSearch(setup);

      await setup.mockInput.typeText("po");
      await waitUntil(() => search.calls.includes("po"), 3000, 'debounced search fires for "po"');
      expect(search.calls).toEqual(["po"]);
      expect(setup.captureCharFrame()).toContain("searching…");

      await setup.mockInput.typeText("rtland");
      const settled = await waitUntilFrame(setup, (f) => f.includes("Portland · Maine, us"));
      expect(search.calls).toEqual(["po", "portland"]);

      resolveFirst([OREGON_RESULT]);
      await sleep(60);
      const final = setup.captureCharFrame();
      expect(final).toBe(settled);
      expect(final).not.toContain("-122.68");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("enter adds the highlighted result: config persisted, active switched, forecast loaded", async () => {
    const fetcher = stubFetcher();
    const search = stubSearch(() => Promise.resolve([OREGON_RESULT]));
    const { store, path } = await makeStore({ fetcher, search });
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

      const text = await readFile(path, "utf8");
      expect(text).toContain('slug = "portland-oregon-us"');
      expect(text).toContain("latitude = 45.52");
      expect(text).toContain("longitude = -122.68");

      await waitUntil(
        () => fetcher.calls.includes("45.52,-122.68"),
        3000,
        "loadForecast fires for the added location",
      );
      expect(fetcher.calls).toContain("45.52,-122.68");
      expect(store.getState().lastActionError).toBeUndefined();
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("duplicate slug dedupe yields slug then slug-2 through store.addLocation", async () => {
    const { store, path } = await makeStore();
    await store.getState().init();

    await store.getState().addLocation({
      slug: "tokyo",
      label: "Tokyo",
      latitude: 35.68,
      longitude: 139.69,
    });
    await store.getState().addLocation({
      slug: "tokyo",
      label: "Tokyo",
      latitude: 35.68,
      longitude: 139.69,
    });

    const slugs = store.getState().config.locations.map((loc) => loc.slug);
    expect(slugs).toContain("tokyo");
    expect(slugs).toContain("tokyo-2");
    expect(store.getState().activeSlug).toBe("tokyo-2");

    const text = await readFile(path, "utf8");
    expect(text).toContain('slug = "tokyo-2"');
    expect(store.getState().lastActionError).toBeUndefined();
  });

  test('"d" deletes the active location, moves active to the next remaining', async () => {
    const { store, path } = await makeStore();
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("London"));
      expect(store.getState().activeSlug).toBe("london");

      await setup.mockInput.pressKeys(["d"]);
      await sleep(30);
      expect(store.getState().deleteArmed(Date.now())).toBe(true);

      await setup.mockInput.pressKeys(["d"]);

      await waitUntil(
        () => store.getState().activeSlug === "portland",
        3000,
        "active slug moves to portland",
      );
      expect(store.getState().lastActionError).toBeUndefined();
      const text = await readFile(path, "utf8");
      expect(text).not.toContain('slug = "london"');
      expect(text).toContain('slug = "portland"');
    } finally {
      await setup.renderer.destroy();
    }
  });

  test('"d" refuses to delete the last remaining location and leaves config untouched', async () => {
    const { store, path } = await makeStore({ configToml: ONE_LOCATION_TOML });
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      const before = await readFile(path, "utf8");

      await setup.mockInput.pressKeys(["d"]);
      await sleep(30);
      expect(store.getState().lastActionError).toBeUndefined();
      expect(store.getState().deleteArmed(Date.now())).toBe(true);

      await setup.mockInput.pressKeys(["d"]);
      await sleep(30);

      expect(store.getState().lastActionError).toBe("cannot delete the only location");
      expect(store.getState().activeSlug).toBe("portland");
      const after = await readFile(path, "utf8");
      expect(after).toBe(before);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("deleting the default location reassigns default to the first remaining", async () => {
    const { store, path } = await makeStore();
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("London"));

      await setup.mockInput.pressKeys(["d"]);
      await sleep(30);
      await setup.mockInput.pressKeys(["d"]);
      await waitUntil(
        () => store.getState().activeSlug === "portland",
        3000,
        "active slug moves to portland",
      );
      await sleep(30);

      const loaded = await loadConfig(path);
      expect(loaded.default_location).toBe("portland");
      expect(store.getState().lastActionError).toBeUndefined();
    } finally {
      await setup.renderer.destroy();
    }
  });
});

describe("search overlay cell-aware labels", () => {
  test("selecting a wide-named result at 32 cols keeps every row within the frame", async () => {
    const wide = geo({
      id: 7,
      name: "🏙️Honolulu🏙️",
      admin1: "HonoluluHonoluluHonolulu",
    });
    const search = stubSearch(() => Promise.resolve([wide]));
    const { store } = await makeStore({ search });
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 32,
      height: 16,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("London"));
      await openSearch(setup);
      await setup.mockInput.typeText("honolulu");
      const frame = await waitUntilFrame(setup, (f) => f.includes("45.52, -122.68"));
      for (const row of frame.split("\n")) {
        expect(displayWidth(row.trimEnd())).toBeLessThanOrEqual(32);
      }
      const resultRows = frame.split("\n").filter((row) => row.includes("45.52, -122.68"));
      expect(resultRows).toHaveLength(1);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("a >80-code-unit result name round-trips through config as valid UTF-8 with no lone surrogate", async () => {
    const longName = "🏙️".repeat(50);
    expect(longName.length).toBeGreaterThan(80);
    const search = stubSearch(() => Promise.resolve([geo({ id: 8, name: longName })]));
    const { store, path } = await makeStore({ search });
    await store.getState().init();

    await store
      .getState()
      .addLocation(
        buildLocationEntry(geo({ id: 8, name: longName, admin1: "HonoluluCounty" }), []),
      );

    const raw = await readFile(path, "utf8");
    expect(raw).not.toContain("\uFFFD");
    expect(LONE_SURROGATE.test(raw)).toBe(false);

    const loaded = await loadConfig(path);
    const stored = loaded.locations.find((loc) => loc.label.includes("🏙️"));
    expect(stored).toBeDefined();
    expect(displayWidth(stored?.label ?? "")).toBeLessThanOrEqual(80);
    expect(LONE_SURROGATE.test(stored?.label ?? "")).toBe(false);
  });
});
