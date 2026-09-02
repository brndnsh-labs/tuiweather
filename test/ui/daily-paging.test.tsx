import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../../src/app/App";
import { createStoreInstance, type ForecastFetcher, type WeatherStore } from "../../src/app/store";
import { normalizeForecast } from "../../src/lib/providers/openmeteo/normalize";
import { forecastResponseSchema } from "../../src/lib/providers/openmeteo/schemas";
import type { DailyPoint, NormalizedForecast } from "../../src/lib/weather/types";
import portlandFixture from "../fixtures/openmeteo/portland.json";
import { stubNullAirQualityFetcher } from "../helpers";

const NOW = "2026-09-02T12:45:00.000Z";
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

function fixtureForecast(): NormalizedForecast {
  const parsed = forecastResponseSchema.parse(portlandFixture);
  return { ...normalizeForecast(parsed), fetchedAtUtc: NOW };
}

function day(dateLocal: string): DailyPoint {
  return {
    dateLocal,
    condition: "clear",
    tempMinC: 10,
    tempMaxC: 20,
    precipSumMm: 0,
    precipProbabilityMaxPct: null,
    sunriseUtc: null,
    sunsetUtc: null,
    windSpeedMaxKmh: null,
  };
}

/** A 7-day forecast, matching what NWS ever returns — DAILY_PAGE_SIZE is also 7. */
function sevenDayForecast(): NormalizedForecast {
  const base = fixtureForecast();
  return {
    ...base,
    daily: [
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
      "2026-09-07",
      "2026-09-08",
    ].map(day),
  };
}

async function makeStore(forecast: NormalizedForecast): Promise<WeatherStore> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-daily-paging-"));
  tmpDirs.push(dir);
  const configPath = join(dir, "config.toml");
  await writeFile(configPath, CONFIG_TOML, "utf8");
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

describe("daily list paging", () => {
  test(", and . page a 14-day forecast; clamped at both ends", async () => {
    const store = await makeStore(fixtureForecast());
    const setup = await testRender(<App store={store} nowMs={NOW_MS} nowUtc={NOW} />, {
      width: 120,
      height: 40,
    });
    try {
      await setup.flush();
      const page1 = await waitUntilFrame(setup, (f) => f.includes("14 day · page 1/2"));

      // Clamped at the start: paging backward from page 1 is a no-op.
      await setup.mockInput.pressKeys([","]);
      await sleep(30);
      expect(setup.captureCharFrame()).toBe(page1);

      await setup.mockInput.pressKeys(["."]);
      const page2 = await waitUntilFrame(setup, (f) => f.includes("14 day · page 2/2"));
      expect(page2).not.toBe(page1);

      // Clamped at the end: paging forward from the last page is a no-op.
      await setup.mockInput.pressKeys(["."]);
      await sleep(30);
      expect(setup.captureCharFrame()).toBe(page2);

      await setup.mockInput.pressKeys([","]);
      const backToPage1 = await waitUntilFrame(setup, (f) => f.includes("14 day · page 1/2"));
      expect(backToPage1).toBe(page1);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("paging with . carries an existing cursor onto the new page so the next arrow press doesn't snap back", async () => {
    const forecast = fixtureForecast();
    const dates = forecast.daily.map((d) => d.dateLocal);
    const store = await makeStore(forecast);
    const setup = await testRender(<App store={store} nowMs={NOW_MS} nowUtc={NOW} />, {
      width: 120,
      height: 40,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("14 day · page 1/2"));

      // Select a day on page 1 (today, index 0 → index 1 after one right-arrow).
      setup.mockInput.pressArrow("right");
      await sleep(30);
      expect(store.getState().dayCursorDate).toBe(dates[1] ?? null);
      expect(store.getState().dailyPageIndex).toBe(0);

      // Page forward without touching the cursor: the cursor should follow onto page 2.
      await setup.mockInput.pressKeys(["."]);
      await waitUntilFrame(setup, (f) => f.includes("14 day · page 2/2"));
      expect(store.getState().dailyPageIndex).toBe(1);
      expect(store.getState().dayCursorDate).toBe(dates[7] ?? null);

      // The next arrow press should move within page 2, not snap back to the cursor's old page.
      setup.mockInput.pressArrow("right");
      await sleep(30);
      expect(store.getState().dayCursorDate).toBe(dates[8] ?? null);
      expect(store.getState().dailyPageIndex).toBe(1);
      expect(setup.captureCharFrame()).toContain("14 day · page 2/2");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("a 7-day forecast (NWS's ceiling) renders as a single page; , and . are inert", async () => {
    const store = await makeStore(sevenDayForecast());
    const setup = await testRender(<App store={store} nowMs={NOW_MS} nowUtc={NOW} />, {
      width: 120,
      height: 40,
    });
    try {
      await setup.flush();
      const before = await waitUntilFrame(setup, (f) => f.includes("7 day"));
      expect(before).not.toContain("page");

      await setup.mockInput.pressKeys(["."]);
      await sleep(30);
      expect(setup.captureCharFrame()).toBe(before);

      await setup.mockInput.pressKeys([","]);
      await sleep(30);
      expect(setup.captureCharFrame()).toBe(before);
    } finally {
      await setup.renderer.destroy();
    }
  });
});
