import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../../src/app/App";
import { createStoreInstance, type ForecastFetcher, type WeatherStore } from "../../src/app/store";
import { normalizeForecast } from "../../src/lib/providers/openmeteo/normalize";
import { forecastResponseSchema } from "../../src/lib/providers/openmeteo/schemas";
import portlandFixture from "../fixtures/openmeteo/portland.json";
import { stubNullAirQualityFetcher } from "../helpers";

const NOW = "2026-08-24T16:15:00.000Z";
const NOW_MS = Date.parse(NOW);

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

async function makeStore(): Promise<WeatherStore> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-hourly-inspect-"));
  tmpDirs.push(dir);
  const configPath = join(dir, "config.toml");
  await writeFile(configPath, CONFIG_TOML, "utf8");
  const forecast = normalizeForecast(forecastResponseSchema.parse(portlandFixture));
  const fetcher: ForecastFetcher = () => Promise.resolve({ forecast, stale: false });
  return createStoreInstance({
    configPath,
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

// First and last points of the lg-tier (48-point) window computed against the
// fixture from NOW: window[0] is 2026-08-24T17:00:00.000Z local 10:00 AM, and
// window[47] is 2026-08-26T16:00:00.000Z local 9:00 AM.
const FIRST_ROW = "10:00 AM  68° feels 68°  0.00 in 0%  7 mph N";
const LAST_ROW = "9:00 AM  67° feels 66°  0.00 in 0%  4 mph S";
const FIRST_TIME_UTC = "2026-08-24T17:00:00.000Z";
const LAST_TIME_UTC = "2026-08-26T16:00:00.000Z";

describe("hourly inspect cursor", () => {
  test("i opens a readout matching the fixture's next upcoming hour", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} nowMs={NOW_MS} nowUtc={NOW} />, {
      width: 120,
      height: 40,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland") && f.includes("next"));
      await setup.mockInput.pressKeys(["i"]);
      const frame = await waitUntilFrame(setup, (f) => f.includes(FIRST_ROW));
      expect(frame).toContain(FIRST_ROW);
      expect(store.getState().hourlyInspectTimeUtc).toBe(FIRST_TIME_UTC);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("right clamps at the last windowed point; left clamps back to the first", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} nowMs={NOW_MS} nowUtc={NOW} />, {
      width: 120,
      height: 40,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland") && f.includes("next"));
      await setup.mockInput.pressKeys(["i"]);
      await waitUntilFrame(setup, (f) => f.includes(FIRST_ROW));

      for (let i = 0; i < 60; i++) {
        setup.mockInput.pressArrow("right");
      }
      const atEnd = await waitUntilFrame(setup, (f) => f.includes(LAST_ROW));
      expect(atEnd).toContain(LAST_ROW);
      expect(store.getState().hourlyInspectTimeUtc).toBe(LAST_TIME_UTC);

      for (let i = 0; i < 60; i++) {
        setup.mockInput.pressArrow("left");
      }
      const atStart = await waitUntilFrame(setup, (f) => f.includes(FIRST_ROW));
      expect(atStart).toContain(FIRST_ROW);
      expect(store.getState().hourlyInspectTimeUtc).toBe(FIRST_TIME_UTC);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("escape exits inspect mode and restores the identical prior frame", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} nowMs={NOW_MS} nowUtc={NOW} />, {
      width: 120,
      height: 40,
    });
    try {
      await setup.flush();
      const before = await waitUntilFrame(
        setup,
        (f) => f.includes("Portland") && f.includes("next"),
      );
      expect(before).not.toContain(FIRST_ROW);

      await setup.mockInput.pressKeys(["i"]);
      await waitUntilFrame(setup, (f) => f.includes(FIRST_ROW));

      await setup.mockInput.pressEscape();
      await sleep(30);
      const after = await waitUntilFrame(setup, (f) => !f.includes(FIRST_ROW));
      expect(after).toBe(before);
      expect(store.getState().hourlyInspectTimeUtc).toBeNull();
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("i still closes inspect after resizing down to xs, where HourlyStrip no longer renders", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} nowMs={NOW_MS} nowUtc={NOW} />, {
      width: 120,
      height: 40,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland") && f.includes("next"));
      await setup.mockInput.pressKeys(["i"]);
      await waitUntilFrame(setup, (f) => f.includes(FIRST_ROW));
      expect(store.getState().hourlyInspectTimeUtc).toBe(FIRST_TIME_UTC);

      setup.resize(40, 24);
      await waitUntilFrame(setup, (f) => f.includes("Portland") && !f.includes(FIRST_ROW));

      await setup.mockInput.pressKeys(["i"]);
      await sleep(30);
      expect(store.getState().hourlyInspectTimeUtc).toBeNull();
    } finally {
      await setup.renderer.destroy();
    }
  });
});
