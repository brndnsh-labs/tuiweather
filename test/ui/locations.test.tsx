import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../../src/app/App";
import { createStoreInstance, type ForecastFetcher, type WeatherStore } from "../../src/app/store";
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

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function makeConfigFile(toml: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-locations-test-"));
  tmpDirs.push(dir);
  await writeFile(join(dir, "config.toml"), toml, "utf8");
  return join(dir, "config.toml");
}

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

async function makeStore(configToml = TWO_LOCATION_TOML): Promise<{
  store: WeatherStore;
  path: string;
}> {
  const path = await makeConfigFile(configToml);
  const store = createStoreInstance({
    configPath: path,
    fetchForecast: stubFetcher(),
    fetchAirQuality: stubNullAirQualityFetcher,
  });
  return { store, path };
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

async function waitUntilFile(path: string, predicate: (text: string) => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  let text = "";
  while (Date.now() < deadline) {
    text = await readFile(path, "utf8");
    if (predicate(text)) return text;
    await sleep(15);
  }
  throw new Error(`waitUntilFile timed out; last content:\n${text}`);
}

async function openLocations(setup: Awaited<ReturnType<typeof testRender>>): Promise<string> {
  await setup.mockInput.pressKeys(["l"]);
  return waitUntilFrame(setup, (f) => f.includes("enter switch · 1-9 jump"));
}

describe("locations overlay", () => {
  test("l opens the overlay with numbered rows; esc closes and frame restores", async () => {
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

      const openFrame = await openLocations(setup);
      expect(openFrame).toContain("1▸  Portland");
      expect(openFrame).toContain("2●★ London");
      expect(openFrame).toContain("s default · d del×2 · J/K move · / add");

      await setup.mockInput.pressEscape();
      await sleep(30);
      const after = await waitUntilFrame(setup, (f) => !f.includes("enter switch · 1-9 jump"));
      expect(after).toBe(before);
      expect(store.getState().locationsOpen).toBe(false);
      expect(quits).toBe(0);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("down moves the cursor; enter switches and closes", async () => {
    const { store } = await makeStore();
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      await openLocations(setup);

      await setup.mockInput.pressArrow("down");
      const moved = await waitUntilFrame(setup, (f) => f.includes("2▸★ London"));

      await setup.mockInput.pressEnter();
      await waitUntilFrame(setup, (f) => !f.includes("enter switch · 1-9 jump"));
      expect(moved).not.toContain("1▸  Portland");
      expect(store.getState().locationsOpen).toBe(false);
      expect(store.getState().activeSlug).toBe("london");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("number key jumps straight to that location and closes", async () => {
    const { store } = await makeStore();
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      await openLocations(setup);

      await setup.mockInput.pressKeys(["1"]);

      await waitUntilFrame(setup, (f) => !f.includes("enter switch · 1-9 jump"));
      expect(store.getState().activeSlug).toBe("portland");
      expect(store.getState().locationsOpen).toBe(false);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("s sets the default to the cursor row", async () => {
    const { store, path } = await makeStore();
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      await openLocations(setup);

      await setup.mockInput.pressKeys(["s"]);
      const text = await waitUntilFile(path, (t) => t.includes('default_location = "portland"'));
      expect(text).toContain('default_location = "portland"');
      expect(store.getState().lastActionError).toBeUndefined();
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("d twice deletes the cursor row even when it is not the active location", async () => {
    const { store, path } = await makeStore();
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      await openLocations(setup);

      await setup.mockInput.pressKeys(["d"]);
      const armedFrame = await waitUntilFrame(setup, (f) => f.includes("d again deletes Portland"));
      expect(armedFrame).toContain("1▸  Portland");

      await setup.mockInput.pressKeys(["d"]);

      await waitUntilFrame(setup, (f) => !f.includes("d again deletes Portland"));
      expect(store.getState().activeSlug).toBe("london");
      expect(store.getState().locationsOpen).toBe(true);
      expect(store.getState().config.locations.map((loc) => loc.slug)).toEqual(["london"]);
      const text = await waitUntilFile(path, (t) => !t.includes('slug = "portland"'));
      expect(text).not.toContain('slug = "portland"');
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("shift-j reorders and the cursor follows the moved row", async () => {
    const { store, path } = await makeStore();
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      await openLocations(setup);

      setup.mockInput.pressKey("j", { shift: true });
      const moved = await waitUntilFrame(setup, (f) => f.includes("2▸  Portland"));
      expect(moved).toContain("1●★ London");
      expect(store.getState().config.locations.map((loc) => loc.slug)).toEqual([
        "london",
        "portland",
      ]);

      const text = await readFile(path, "utf8");
      expect(text.indexOf("london")).toBeLessThan(text.indexOf("portland"));
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("/ inside the overlay closes it and opens search", async () => {
    const { store } = await makeStore();
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      await openLocations(setup);

      await setup.mockInput.pressKeys(["/"]);

      const searchOpen = await waitUntilFrame(setup, (f) => f.includes("search location"));
      expect(searchOpen).not.toContain("enter switch · 1-9 jump");
      expect(store.getState().overlayOpen).toBe(true);
      expect(store.getState().locationsOpen).toBe(false);
    } finally {
      await setup.renderer.destroy();
    }
  });
});
