import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../../src/app/App";
import { createStoreInstance, type ForecastFetcher, type WeatherStore } from "../../src/app/store";
import type { NormalizedForecast } from "../../src/lib/weather/types";
import { stubNullAirQualityFetcher } from "../helpers";

const NOW = "2026-08-24T14:05:00.000Z";
const NOW_MS = Date.parse(NOW);

const CONFIG_TOML = `schema_version = 4
time_format = "24h"
default_location = "portland"

[[locations]]
slug = "portland"
label = "Portland"
latitude = 45.5202
longitude = -122.6765

[panels]
nowcast = true
details = false
hourly = false
daily = false
`;

function bucket(endLabel: string, precipMm: number, probabilityPct: number | null) {
  const endUtc = `2026-08-24T${endLabel}:00.000Z`;
  const startUtc = new Date(Date.parse(endUtc) - 15 * 60_000).toISOString();
  return { startUtc, endUtc, precipMm, probabilityPct };
}

// now (14:05) falls inside the elapsed [13:45,14:00) bucket's neighbor — the
// bucket labeled 14:00 has already elapsed by 14:05 and is excluded; the
// window below starts at 14:15 (currently in progress) through 15:45.
const MINUTELY15 = [
  bucket("14:00", 0, 0),
  bucket("14:15", 0.02, 20),
  bucket("14:30", 0.05, 30),
  bucket("14:45", 0.5, 90),
  bucket("15:00", 0, 10),
  bucket("15:15", 0, 5),
  bucket("15:30", 0, 0),
  bucket("15:45", 0, null),
];

function makeForecast(): NormalizedForecast {
  return {
    providerId: "openmeteo",
    location: { latitude: 45.52, longitude: -122.68 },
    timezone: "UTC",
    utcOffsetSeconds: 0,
    fetchedAtUtc: NOW,
    current: {
      timeUtc: NOW,
      temperatureC: 20,
      apparentC: 20,
      humidityPct: 50,
      condition: "partly-cloudy",
      windSpeedKmh: 10,
      windDirectionDeg: 180,
      windGustKmh: null,
      pressureHpa: null,
      dewPointC: null,
      visibilityM: null,
      uvIndex: null,
      isDay: true,
    },
    hasMinutePrecip: true,
    minutely15: MINUTELY15,
    hourly: [],
    daily: [],
  };
}

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function makeStore(): Promise<WeatherStore> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-nowcast-expand-"));
  tmpDirs.push(dir);
  const configPath = join(dir, "config.toml");
  await writeFile(configPath, CONFIG_TOML, "utf8");
  const forecast = makeForecast();
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

// Buckets from 14:15 through 15:45 (7 upcoming): glyphs ▁▃█▁▁▁▁, peak
// probability 90% overlaid at the 14:45 bucket (col 2), and a "15" hour-tick
// under the 15:00 bucket (col 3) — endUtc-keyed per hard rule 3.
const EXPANDED_BAR = "▁▃90%▁▁";
const EXPANDED_LABEL = "   15  ";

describe("nowcast minutely-15 expansion", () => {
  test("m reveals a labeled bar matching the fixture buckets, including peak probability", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} nowMs={NOW_MS} nowUtc={NOW} />, {
      width: 80,
      height: 24,
    });
    try {
      await setup.flush();
      const before = await waitUntilFrame(setup, (f) => f.includes("Portland"));
      expect(before).not.toContain(EXPANDED_BAR);

      await setup.mockInput.pressKeys(["m"]);
      const after = await waitUntilFrame(setup, (f) => f.includes(EXPANDED_BAR));
      expect(after).toContain(EXPANDED_BAR);
      expect(after).toContain(EXPANDED_LABEL);
      expect(store.getState().nowcastExpanded).toBe(true);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("m again collapses to the identical prior frame", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} nowMs={NOW_MS} nowUtc={NOW} />, {
      width: 80,
      height: 24,
    });
    try {
      await setup.flush();
      const before = await waitUntilFrame(setup, (f) => f.includes("Portland"));

      await setup.mockInput.pressKeys(["m"]);
      await waitUntilFrame(setup, (f) => f.includes(EXPANDED_BAR));

      await setup.mockInput.pressKeys(["m"]);
      const after = await waitUntilFrame(setup, (f) => !f.includes(EXPANDED_BAR));
      expect(after).toBe(before);
      expect(store.getState().nowcastExpanded).toBe(false);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("m is a no-op once resized down to xs, where the mini nowcast has no expansion", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} nowMs={NOW_MS} nowUtc={NOW} />, {
      width: 80,
      height: 24,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("Portland"));

      setup.resize(40, 24);
      await waitUntilFrame(setup, (f) => f.includes("Portland"));

      await setup.mockInput.pressKeys(["m"]);
      await sleep(30);
      expect(store.getState().nowcastExpanded).toBe(false);
    } finally {
      await setup.renderer.destroy();
    }
  });
});
