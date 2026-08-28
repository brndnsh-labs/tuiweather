import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ManualClock } from "@opentui/core/testing";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../../src/app/App";
import type { WeatherStore } from "../../src/app/store";
import { createStoreInstance, type ForecastFetcher } from "../../src/app/store";
import { normalizeForecast } from "../../src/lib/providers/openmeteo/normalize";
import { forecastResponseSchema } from "../../src/lib/providers/openmeteo/schemas";
import { ProviderError } from "../../src/lib/providers/types";
import type { CurrentObs, NormalizedForecast } from "../../src/lib/weather/types";
import { MIN_WIDTH, tierFor } from "../../src/viewport/breakpoints";
import { debounceTrailing } from "../../src/viewport/useViewport";
import portlandFixture from "../fixtures/openmeteo/portland.json";
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
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-ui-test-"));
  tmpDirs.push(dir);
  await writeFile(join(dir, "config.toml"), CONFIG_TOML, "utf8");
  return join(dir, "config.toml");
}

function makeForecast(overrides: Partial<CurrentObs> = {}): NormalizedForecast {
  return {
    providerId: "stub",
    location: { latitude: 45.5202, longitude: -122.6765 },
    timezone: "America/Los_Angeles",
    utcOffsetSeconds: -7 * 3600,
    fetchedAtUtc: NOW,
    current: {
      timeUtc: NOW,
      temperatureC: 22.2222,
      apparentC: 21.1111,
      humidityPct: 50,
      condition: "clear",
      windSpeedKmh: 9.6563,
      windDirectionDeg: 315,
      windGustKmh: null,
      pressureHpa: null,
      cloudCoverPct: null,
      dewPointC: null,
      visibilityM: null,
      uvIndex: null,
      precipLast1hMm: null,
      isDay: true,
      ...overrides,
    },
    minutely15: [],
    hourly: [],
    daily: [],
  };
}

function stubFetcher(forecast = makeForecast()): ForecastFetcher {
  return () => Promise.resolve({ forecast, stale: false });
}

async function makeStore(opts?: { fetcher?: ForecastFetcher }): Promise<WeatherStore> {
  const configPath = await makeConfigFile();
  const store = createStoreInstance({
    configPath,
    fetchForecast: opts?.fetcher ?? stubFetcher(),
    fetchAirQuality: stubNullAirQualityFetcher,
  });
  return store;
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

describe("viewport breakpoints", () => {
  test("tierFor matches the AGENTS.md thresholds", () => {
    expect(tierFor(96)).toBe("lg");
    expect(tierFor(120)).toBe("lg");
    expect(tierFor(95)).toBe("md");
    expect(tierFor(68)).toBe("md");
    expect(tierFor(67)).toBe("sm");
    expect(tierFor(48)).toBe("sm");
    expect(tierFor(47)).toBe("xs");
    expect(tierFor(20)).toBe("xs");
  });

  test("MIN_WIDTH starts the clamped regime", () => {
    expect(MIN_WIDTH).toBe(32);
    expect(tierFor(MIN_WIDTH - 1)).toBe("xs");
  });
});

describe("debounceTrailing", () => {
  test("trailing edge keeps only the latest args", () => {
    const clock = new ManualClock();
    const seen: number[] = [];
    const debounced = debounceTrailing((n: number) => seen.push(n), 100, clock);

    debounced(1);
    debounced(2);
    clock.advance(40);
    debounced(3);
    expect(seen).toEqual([]);

    clock.advance(60);
    expect(seen).toEqual([]);
    clock.advance(41);
    expect(seen).toEqual([3]);
  });

  test("cancel drops pending work", () => {
    const clock = new ManualClock();
    const seen: string[] = [];
    const debounced = debounceTrailing(() => seen.push("ran"), 50, clock);

    debounced();
    debounced.cancel();
    clock.advance(500);
    expect(seen).toEqual([]);
  });

  test("flush runs pending work immediately", () => {
    const clock = new ManualClock();
    const seen: number[] = [];
    const debounced = debounceTrailing((n: number) => seen.push(n), 50, clock);

    debounced(7);
    debounced.flush();
    clock.advance(100);
    expect(seen).toEqual([7]);
  });
});

describe("App shell", () => {
  test("renders header data once the forecast arrives", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} />, { width: 100, height: 24 });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("Portland"));
      expect(frame).toContain("45.5°, -122.7°");
      expect(frame).toContain("locations");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("lg shows the locations sidebar", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} />, { width: 100, height: 24 });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("London"));
      const frame = setup.captureCharFrame();
      expect(frame).toContain("locations");
      expect(frame).toContain("●");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("md drops the sidebar but keeps the full header", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} />, { width: 70, height: 24 });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("Portland"));
      expect(frame).toContain("45.5°, -122.7°");
      expect(frame).not.toContain("●");
      expect(frame).toContain("┌─main");
      expect(frame).not.toContain("· md");
      expect(frame).toContain("/ search");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("resize from lg to md re-renders after the debounce window", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} />, { width: 100, height: 24 });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("●"));

      setup.resize(70, 24);
      await sleep(160);
      const frame = await waitUntilFrame(
        setup,
        (f) => f.includes("45.5°, -122.7°") && !f.includes("●"),
      );
      expect(frame).not.toContain("●");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("sm condenses the header to one line and trims footer hints", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} />, { width: 50, height: 20 });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("Mon 24"));
      expect(frame).toContain("Portland");
      expect(frame).not.toContain("· sm");
      expect(frame).not.toContain("/ search");
      expect(frame).toContain("r refresh");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("xs hides verbose hints entirely", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} />, { width: 40, height: 16 });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("r u ? q"));
      expect(frame).not.toContain("search");
      expect(frame).not.toContain("refresh");
      expect(frame).not.toContain("· xs");
      expect(frame).toContain("r u ? q");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("clamped width renders a truncated single line without crashing", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} />, { width: 20, height: 8 });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("Portland"));
      expect(frame).not.toContain("locations");
      const lineCount = frame.split("\n").length;
      expect(lineCount).toBeGreaterThan(1);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("? opens the help overlay and escape closes it", async () => {
    const store = await makeStore();
    let quits = 0;
    const setup = await testRender(<App store={store} quit={() => quits++} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));

      await setup.mockInput.pressKeys(["?"]);
      const openFrame = await waitUntilFrame(setup, (f) => f.includes("esc close"));
      expect(openFrame).toContain("toggle help");

      await setup.mockInput.pressEscape();
      await sleep(30);
      const closedFrame = await waitUntilFrame(setup, (f) => !f.includes("esc close"));
      expect(closedFrame).not.toContain("toggle help");
      expect(quits).toBe(0);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("help overlay clamps to the terminal on xs widths", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} />, { width: 40, height: 12 });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));

      await setup.mockInput.pressKeys(["?"]);
      const frame = await waitUntilFrame(setup, (f) => f.includes("esc close"));
      for (const row of frame.split("\n")) {
        expect(row.length).toBeLessThanOrEqual(40);
      }
      expect(frame).toContain("keys");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("q quits through the injected callback", async () => {
    const store = await makeStore();
    let quits = 0;
    const setup = await testRender(<App store={store} quit={() => quits++} />, {
      width: 80,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      await setup.mockInput.pressKeys(["q"]);
      await sleep(30);
      expect(quits).toBe(1);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("u cycles units through the store", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} quit={() => undefined} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("72°"));
      await setup.mockInput.pressKeys(["u"]);
      const metricFrame = await waitUntilFrame(setup, (f) => f.includes("22°"));
      expect(metricFrame).toContain("☀️ 22°");
      expect(store.getState().config.units).toBe("metric");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("fetch failure surfaces the error panel with retry hint", async () => {
    const failing: ForecastFetcher = () =>
      Promise.reject(new ProviderError("openmeteo unreachable", "openmeteo"));
    const store = await makeStore({ fetcher: failing });
    const setup = await testRender(<App store={store} />, { width: 90, height: 24 });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("openmeteo unreachable"));
      expect(frame).toContain("press r to retry");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("header shows synced-ago text derived from injected nowMs", async () => {
    const store = await makeStore();
    const nowMs = Date.parse(NOW) + 120_000;
    const setup = await testRender(<App store={store} nowMs={nowMs} />, { width: 90, height: 24 });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("synced 2m ago"));
      expect(frame).toContain("Portland");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("stale forecasts show the stale badge and banner", async () => {
    const staleFetcher: ForecastFetcher = () =>
      Promise.resolve({ forecast: makeForecast(), stale: true });
    const store = await makeStore({ fetcher: staleFetcher });
    const setup = await testRender(<App store={store} />, { width: 90, height: 24 });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("stale"));
      expect(frame).toContain("showing cached data");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("empty main view prompts to refresh instead of naming the tier", async () => {
    const failing: ForecastFetcher = () =>
      Promise.reject(new ProviderError("openmeteo unreachable", "openmeteo"));
    const store = await makeStore({ fetcher: failing });
    const setup = await testRender(<App store={store} />, { width: 90, height: 24 });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("no forecast loaded"));
      expect(frame).toContain("press r to refresh");
      expect(frame).toContain("┌─main");
      expect(frame).not.toContain("· md");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("header shows the location-local long date on wide tiers", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} nowMs={Date.parse(NOW)} />, {
      width: 90,
      height: 24,
    });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("Portland"));
      expect(frame).toContain("Mon Aug 24");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("sm header shows the short local date", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} nowMs={Date.parse(NOW)} />, {
      width: 50,
      height: 20,
    });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("Mon 24"));
      expect(frame).toContain("Mon 24 · ");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("d arms delete and a second d confirms it", async () => {
    const store = await makeStore();
    let quits = 0;
    const setup = await testRender(<App store={store} quit={() => quits++} />, {
      width: 100,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));

      await setup.mockInput.pressKeys(["d"]);
      await sleep(30);
      await waitUntilFrame(setup, (f) => f.includes("press d again to delete Portland"));

      await setup.mockInput.pressKeys(["d"]);
      await sleep(30);
      const deletedFrame = await waitUntilFrame(
        setup,
        (f) => !f.includes("press d again to delete"),
      );
      expect(deletedFrame).not.toContain("Portland");
      expect(store.getState().config.locations.map((loc) => loc.slug)).toEqual(["london"]);
      expect(quits).toBe(0);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("overflow hint stays hidden when content fits a tall viewport", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} />, { width: 100, height: 48 });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("Portland"));
      expect(frame).not.toContain("↓ more");
    } finally {
      await setup.renderer.destroy();
    }
  });
});

describe("scroll affordance", () => {
  test("footer documents scrolling and the overflow hint is static", async () => {
    const forecast = {
      ...normalizeForecast(forecastResponseSchema.parse(portlandFixture)),
      fetchedAtUtc: NOW,
    };
    const store = await makeStore({ fetcher: () => Promise.resolve({ forecast, stale: false }) });
    const setup = await testRender(<App store={store} nowMs={Date.parse(NOW)} nowUtc={NOW} />, {
      width: 80,
      height: 24,
    });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("Portland"));
      expect(frame).toContain("↑↓ scroll");
      expect(frame).toContain("↓ more");

      for (let i = 0; i < 4; i++) {
        setup.mockInput.pressArrow("down");
        await sleep(15);
        await setup.flush().catch(() => undefined);
      }
      expect(setup.captureCharFrame()).not.toContain("↑ back");
      expect(setup.captureCharFrame()).toContain("↓ more");
    } finally {
      await setup.renderer.destroy();
    }
  });
});
