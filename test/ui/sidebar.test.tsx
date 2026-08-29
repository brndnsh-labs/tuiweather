import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../../src/app/App";
import { createStoreInstance, type ForecastFetcher, type WeatherStore } from "../../src/app/store";
import { loadConfig } from "../../src/lib/config/load";
import type { CurrentObs, NormalizedForecast } from "../../src/lib/weather/types";
import { stubNullAirQualityFetcher } from "../helpers";

const NOW = "2026-08-24T19:00:00.000Z";
const NOW_MS = Date.parse(NOW);

const THREE_TOML = `schema_version = 3
units = "imperial"
refresh_minutes = 10
theme = "night"
default_location = "portland"
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

const TWO_TOML = `schema_version = 3
units = "imperial"
refresh_minutes = 10
theme = "night"
default_location = "portland"
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
`;

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function makeConfigFile(toml: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-sidebar-ui-"));
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
    cloudCoverPct: null,
    dewPointC: null,
    visibilityM: null,
    uvIndex: null,
    precipLast1hMm: null,
    isDay: true,
  };
  return {
    providerId: "stub",
    location: { latitude: 0, longitude: 0 },
    timezone: "UTC",
    utcOffsetSeconds: 0,
    fetchedAtUtc: NOW,
    current,
    minutely15: [],
    hourly: [],
    daily: [],
  };
}

function stubFetcher(): ForecastFetcher {
  return () => Promise.resolve({ forecast: makeForecast(), stale: false });
}

async function makeStore(toml: string): Promise<{ store: WeatherStore; path: string }> {
  const path = await makeConfigFile(toml);
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

async function waitUntilStore(
  setup: Awaited<ReturnType<typeof testRender>>,
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(15);
    await setup.flush().catch(() => undefined);
  }
  throw new Error("waitUntilStore timed out");
}

describe("sidebar navigation", () => {
  test("number keys 1-9 jump to location by order at every tier", async () => {
    const { store } = await makeStore(THREE_TOML);
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      expect(store.getState().activeSlug).toBe("portland");

      await setup.mockInput.pressKeys(["2"]);
      await waitUntilFrame(setup, () => store.getState().activeSlug === "london");
      expect(store.getState().activeSlug).toBe("london");

      await setup.mockInput.pressKeys(["3"]);
      await waitUntilFrame(setup, () => store.getState().activeSlug === "tokyo");
      expect(store.getState().activeSlug).toBe("tokyo");

      await setup.mockInput.pressKeys(["1"]);
      await waitUntilFrame(setup, () => store.getState().activeSlug === "portland");
      expect(store.getState().activeSlug).toBe("portland");

      await setup.mockInput.pressKeys(["9"]);
      await sleep(30);
      expect(store.getState().activeSlug).toBe("portland");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("number key out-of-range is no-op when locations empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tuiweather-empty-"));
    tmpDirs.push(dir);
    const path = join(dir, "config.toml");
    const store = createStoreInstance({
      configPath: path,
      fetchForecast: stubFetcher(),
      fetchAirQuality: stubNullAirQualityFetcher,
    });
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await sleep(80);
      expect(store.getState().activeSlug).toBeNull();
      await setup.mockInput.pressKeys(["1"]);
      await sleep(30);
      expect(store.getState().activeSlug).toBeNull();
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("j/k moves focus down/up, enter activates, wrapping at ends", async () => {
    const { store } = await makeStore(THREE_TOML);
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      expect(store.getState().activeSlug).toBe("portland");
      expect(setup.captureCharFrame()).not.toContain("▸");

      await setup.mockInput.pressKeys(["j"]);
      const focused1 = await waitUntilFrame(setup, (f) => f.includes("▸ Portland"));
      expect(focused1).toContain("▸ Portland");

      await setup.mockInput.pressKeys(["j"]);
      const focused2 = await waitUntilFrame(setup, (f) => f.includes("▸ London"));
      expect(focused2).toContain("▸ London");
      expect(focused2).toContain("●");

      await setup.mockInput.pressKeys(["j"]);
      const focused3 = await waitUntilFrame(setup, (f) => f.includes("▸ Tokyo"));
      expect(focused3).toContain("▸ Tokyo");

      await setup.mockInput.pressKeys(["j"]);
      const wrapped = await waitUntilFrame(setup, (f) => f.includes("▸ Portland"));
      expect(wrapped).toContain("▸ Portland");

      await setup.mockInput.pressKeys(["k"]);
      const wrappedUp = await waitUntilFrame(setup, (f) => f.includes("▸ Tokyo"));
      expect(wrappedUp).toContain("▸ Tokyo");

      await setup.mockInput.pressEnter();
      await waitUntilFrame(setup, () => store.getState().activeSlug === "tokyo");
      expect(store.getState().activeSlug).toBe("tokyo");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("escape clears focus without quitting", async () => {
    const { store } = await makeStore(THREE_TOML);
    let quits = 0;
    const setup = await testRender(<App store={store} nowMs={NOW_MS} quit={() => quits++} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));

      await setup.mockInput.pressKeys(["j"]);
      await waitUntilFrame(setup, (f) => f.includes("▸"));

      await setup.mockInput.pressEscape();
      await sleep(30);
      const cleared = await waitUntilFrame(setup, (f) => !f.includes("▸"));
      expect(cleared).not.toContain("▸");
      expect(quits).toBe(0);
      expect(store.getState().activeSlug).toBe("portland");

      await setup.mockInput.pressEscape();
      await sleep(30);
      expect(quits).toBe(1);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("j/k/enter are no-ops below lg tier", async () => {
    const { store } = await makeStore(THREE_TOML);
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, { width: 70, height: 24 });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      expect(store.getState().activeSlug).toBe("portland");

      await setup.mockInput.pressKeys(["j"]);
      await sleep(30);
      expect(store.getState().activeSlug).toBe("portland");
      expect(setup.captureCharFrame()).not.toContain("▸");
      expect(setup.captureCharFrame()).not.toContain("●");

      await setup.mockInput.pressKeys(["k"]);
      await sleep(30);
      expect(store.getState().activeSlug).toBe("portland");

      await setup.mockInput.pressEnter();
      await sleep(30);
      expect(store.getState().activeSlug).toBe("portland");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("s sets focused as default, falling back to active when no focus", async () => {
    const { store, path } = await makeStore(THREE_TOML);
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));

      await setup.mockInput.pressKeys(["s"]);
      await waitUntilFrame(setup, () => store.getState().config.default_location === "portland");
      expect(store.getState().config.default_location).toBe("portland");
      let loaded = await loadConfig(path);
      expect(loaded.default_location).toBe("portland");

      await setup.mockInput.pressKeys(["j"]);
      await waitUntilFrame(setup, (f) => f.includes("▸ Portland"));
      await setup.mockInput.pressKeys(["j"]);
      await waitUntilFrame(setup, (f) => f.includes("▸ London"));

      await setup.mockInput.pressKeys(["s"]);
      await waitUntilFrame(setup, () => store.getState().config.default_location === "london");
      expect(store.getState().config.default_location).toBe("london");
      loaded = await loadConfig(path);
      expect(loaded.default_location).toBe("london");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("s after resize below lg ignores ghost focus and uses active location", async () => {
    const { store, path } = await makeStore(THREE_TOML);
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));

      await setup.mockInput.pressKeys(["j"]);
      await waitUntilFrame(setup, (f) => f.includes("▸ Portland"));
      await setup.mockInput.pressKeys(["j"]);
      await waitUntilFrame(setup, (f) => f.includes("▸ London"));
      expect(store.getState().activeSlug).toBe("portland");

      setup.resize(70, 24);
      await sleep(160);
      await waitUntilFrame(setup, (f) => !f.includes("▸") && f.includes("Portland"));

      await setup.mockInput.pressKeys(["s"]);
      await sleep(80);
      await waitUntilStore(setup, () => store.getState().config.default_location === "portland");
      expect(store.getState().config.default_location).toBe("portland");
      const loaded = await loadConfig(path);
      expect(loaded.default_location).toBe("portland");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("J/K reorder focused location down/up and persist order", async () => {
    const { store, path } = await makeStore(THREE_TOML);
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      const activeBefore = store.getState().activeSlug;
      expect(activeBefore).toBe("portland");

      await setup.mockInput.pressKeys(["j"]);
      await waitUntilFrame(setup, (f) => f.includes("▸ Portland"));

      setup.mockInput.pressKey("j", { shift: true });
      await waitUntilStore(
        setup,
        () =>
          store
            .getState()
            .config.locations.map((l) => l.slug)
            .join(",") === "london,portland,tokyo",
      );
      expect(store.getState().config.locations.map((l) => l.slug)).toEqual([
        "london",
        "portland",
        "tokyo",
      ]);
      expect(store.getState().activeSlug).toBe(activeBefore);
      let loaded = await loadConfig(path);
      expect(loaded.locations.map((l) => l.slug)).toEqual(["london", "portland", "tokyo"]);
      let frame = await waitUntilFrame(
        setup,
        (f) => f.includes("London") && f.includes("Portland"),
      );
      let lines = frame.split("\n");
      let londonLine = lines.findIndex(
        (l) => l.includes("London") && (l.includes("○") || l.includes("▸") || l.includes("●")),
      );
      let portlandLine = lines.findIndex(
        (l) => l.includes("Portland") && (l.includes("○") || l.includes("▸") || l.includes("●")),
      );
      expect(londonLine).toBeGreaterThan(-1);
      expect(portlandLine).toBeGreaterThan(-1);
      expect(londonLine).toBeLessThan(portlandLine);

      setup.mockInput.pressKey("k", { shift: true });
      await waitUntilStore(
        setup,
        () =>
          store
            .getState()
            .config.locations.map((l) => l.slug)
            .join(",") === "portland,london,tokyo",
      );
      expect(store.getState().config.locations.map((l) => l.slug)).toEqual([
        "portland",
        "london",
        "tokyo",
      ]);
      loaded = await loadConfig(path);
      expect(loaded.locations.map((l) => l.slug)).toEqual(["portland", "london", "tokyo"]);
      frame = await waitUntilFrame(setup, (f) => f.includes("Portland") && f.includes("London"));
      lines = frame.split("\n");
      londonLine = lines.findIndex(
        (l) => l.includes("London") && (l.includes("○") || l.includes("▸") || l.includes("●")),
      );
      portlandLine = lines.findIndex(
        (l) => l.includes("Portland") && (l.includes("○") || l.includes("▸") || l.includes("●")),
      );
      expect(portlandLine).toBeLessThan(londonLine);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("J/K boundary no-ops at first/last position", async () => {
    const { store, path } = await makeStore(TWO_TOML);
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));

      await setup.mockInput.pressKeys(["j"]);
      await waitUntilFrame(setup, (f) => f.includes("▸ Portland"));
      const before = store.getState().config.locations.map((l) => l.slug);
      const beforeText = await readFile(path, "utf8");

      setup.mockInput.pressKey("k", { shift: true });
      await sleep(30);
      expect(store.getState().config.locations.map((l) => l.slug)).toEqual(before);
      expect(await readFile(path, "utf8")).toBe(beforeText);

      await setup.mockInput.pressKeys(["j"]);
      await waitUntilFrame(setup, (f) => f.includes("▸ London"));
      setup.mockInput.pressKey("j", { shift: true });
      await sleep(30);
      expect(store.getState().config.locations.map((l) => l.slug)).toEqual(before);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("J/K without focus is no-op", async () => {
    const { store, path } = await makeStore(TWO_TOML);
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      const before = store.getState().config.locations.map((l) => l.slug);
      const beforeText = await readFile(path, "utf8");
      setup.mockInput.pressKey("j", { shift: true });
      await sleep(30);
      expect(store.getState().config.locations.map((l) => l.slug)).toEqual(before);
      setup.mockInput.pressKey("k", { shift: true });
      await sleep(30);
      expect(store.getState().config.locations.map((l) => l.slug)).toEqual(before);
      expect(await readFile(path, "utf8")).toBe(beforeText);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("long label reserves tail and leaves a spare column (no exact-width row)", async () => {
    const LONG_TOML = `schema_version = 3
units = "imperial"
refresh_minutes = 10
theme = "night"
default_location = "long"
provider = "openmeteo"
daily_days = 7
hourly_hours = 24

[panels]
nowcast = true
details = true
hourly = true
daily = true

[[locations]]
slug = "long"
label = "A Very Long Location Name That Exceeds Sidebar Width By Far"
latitude = 45.52
longitude = -122.68
`;
    const { store } = await makeStore(LONG_TOML);
    const setup = await testRender(<App store={store} nowMs={NOW_MS} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("A Very Long"));
      const lines = frame.split("\n");
      const sidebarLine = lines.find(
        (l) =>
          l.includes("│") &&
          (l.includes("●") || l.includes("○") || l.includes("▸")) &&
          l.includes("°") &&
          (l.includes("A Very Long") || l.includes("…")),
      );
      expect(sidebarLine).toBeDefined();
      if (!sidebarLine) throw new Error("sidebar line with tail not found");
      expect(sidebarLine).toContain("…");
      expect(sidebarLine).toContain("°");
      const idxEllipsis = sidebarLine.indexOf("…");
      const idxTemp = sidebarLine.indexOf("°");
      expect(idxEllipsis).toBeGreaterThan(-1);
      expect(idxTemp).toBeGreaterThan(idxEllipsis);
      const firstPipe = sidebarLine.indexOf("│");
      const secondPipe = sidebarLine.indexOf("│", firstPipe + 1);
      if (firstPipe !== -1 && secondPipe !== -1) {
        const inner = sidebarLine.slice(firstPipe + 1, secondPipe);
        const trimmed = inner.replace(/\s+$/, "");
        const { displayWidth } = await import("../../src/lib/weather/format");
        expect(displayWidth(trimmed)).toBeLessThanOrEqual(23);
        expect(displayWidth(trimmed)).toBeLessThan(24);
      }
    } finally {
      await setup.renderer.destroy();
    }
  });
});
