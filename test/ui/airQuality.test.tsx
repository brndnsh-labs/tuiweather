import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../../src/app/App";
import {
  type AirQualityFetcher,
  createStoreInstance,
  type ForecastFetcher,
} from "../../src/app/store";
import { normalizeForecast } from "../../src/lib/providers/openmeteo/normalize";
import { forecastResponseSchema } from "../../src/lib/providers/openmeteo/schemas";
import type { AirQuality, NormalizedForecast } from "../../src/lib/weather/types";
import portlandFixture from "../fixtures/openmeteo/portland.json";

const NOW = "2026-08-24T16:15:00.000Z";
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

function configToml(): string {
  return `schema_version = 1
units = "metric"
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
}

async function makeStore(forecast: NormalizedForecast, airQuality: AirQuality | null) {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-aq-ui-"));
  tmpDirs.push(dir);
  await writeFile(join(dir, "config.toml"), configToml(), "utf8");
  const fetcher: ForecastFetcher = () => Promise.resolve({ forecast, stale: false });
  const aqFetcher: AirQualityFetcher = airQuality
    ? () => Promise.resolve(airQuality)
    : () => Promise.resolve({ usAqi: null, observedAtUtc: NOW });
  // for null case we simulate fetcher that returns null usAqi, but DetailsGrid checks usAqi != null so it will be omitted
  // To truly test omission, we need fetcher that returns null usAqi OR we can make AQ null by rejecting and store sets null
  // Instead for null case, provide a fetcher that resolves to null usAqi then DetailsGrid will omit
  return createStoreInstance({
    configPath: join(dir, "config.toml"),
    fetchForecast: fetcher,
    fetchAirQuality: aqFetcher,
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

describe("DetailsGrid air quality", () => {
  test("shows air cell with fixture AQI (29 good)", async () => {
    const forecast = fixtureForecast();
    const aq: AirQuality = { usAqi: 29, observedAtUtc: NOW };
    const store = await makeStore(forecast, aq);
    const setup = await testRender(<App store={store} nowMs={Date.parse(NOW)} nowUtc={NOW} />, {
      width: 80,
      height: 24,
    });
    try {
      await setup.flush();
      const _frame = await waitUntilFrame(setup, (f) => f.includes("Portland"));
      // allow AQ async to land
      await sleep(40);
      await setup.flush();
      const frame2 = setup.captureCharFrame();
      expect(frame2).toContain("air");
      expect(frame2).toContain("29 good");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("omitted when AQ null (frame does not contain air label)", async () => {
    const forecast = fixtureForecast();
    const store = await makeStore(forecast, null);
    const setup = await testRender(<App store={store} nowMs={Date.parse(NOW)} nowUtc={NOW} />, {
      width: 80,
      height: 24,
    });
    try {
      await setup.flush();
      const _frame = await waitUntilFrame(setup, (f) => f.includes("Portland"));
      await sleep(40);
      await setup.flush();
      const frame2 = setup.captureCharFrame();
      expect(frame2).not.toContain("air");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("air truncates at md floor 68 cols for very-unhealthy and stays on one row", async () => {
    const forecast = fixtureForecast();
    const aq: AirQuality = { usAqi: 250, observedAtUtc: NOW };
    const store = await makeStore(forecast, aq);
    const setup = await testRender(<App store={store} nowMs={Date.parse(NOW)} nowUtc={NOW} />, {
      width: 68,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));
      await sleep(40);
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("air"));
      expect(frame).toContain("air");
      expect(frame).not.toContain("very-unhealthy");
      const lines = frame.split("\n");
      const airLine = lines.find((line) => line.includes("air"));
      expect(airLine).toBeDefined();
      expect(airLine).toContain("…");
      expect(airLine).toContain("250");
      const airIdx = lines.indexOf(airLine ?? "");
      const nextLine = lines[airIdx + 1] ?? "";
      expect(nextLine).not.toContain("unhealthy");
      expect(nextLine).not.toContain("very-");
    } finally {
      await setup.renderer.destroy();
    }
  });
});
