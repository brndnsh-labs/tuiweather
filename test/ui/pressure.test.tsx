import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../../src/app/App";
import { createStoreInstance, type ForecastFetcher } from "../../src/app/store";
import { normalizeForecast } from "../../src/lib/providers/openmeteo/normalize";
import { forecastResponseSchema } from "../../src/lib/providers/openmeteo/schemas";
import type { NormalizedForecast } from "../../src/lib/weather/types";
import portlandFixture from "../fixtures/openmeteo/portland.json";
import { stubNullAirQualityFetcher } from "../helpers";

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

function configToml(
  units: "metric" | "imperial",
  pressureOverride?: "metric" | "imperial",
): string {
  if (pressureOverride) {
    return `schema_version = 2
refresh_minutes = 10
theme = "night"
default_location = "portland"

[units]
temp = "${units}"
wind = "${units}"
precip = "${units}"
pressure = "${pressureOverride}"

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
  return `schema_version = 1
units = "${units}"
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

async function makeStore(toml: string, forecast: NormalizedForecast) {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-pressure-test-"));
  tmpDirs.push(dir);
  await writeFile(join(dir, "config.toml"), toml, "utf8");
  const fetcher: ForecastFetcher = () => Promise.resolve({ forecast, stale: false });
  return createStoreInstance({
    configPath: join(dir, "config.toml"),
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

describe("DetailsGrid pressure units", () => {
  test("metric pressure prefs render hPa", async () => {
    const forecast = {
      ...fixtureForecast(),
      current: { ...fixtureForecast().current, pressureHpa: 1015.2 },
    };
    const store = await makeStore(configToml("metric"), forecast);
    const setup = await testRender(<App store={store} nowMs={Date.parse(NOW)} nowUtc={NOW} />, {
      width: 80,
      height: 24,
    });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("Portland"));
      expect(frame).toContain("1015 hPa");
      expect(frame).not.toContain("inHg");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("imperial pressure prefs render inHg to two decimals", async () => {
    const forecast = {
      ...fixtureForecast(),
      current: { ...fixtureForecast().current, pressureHpa: 1013.25 },
    };
    const store = await makeStore(configToml("imperial"), forecast);
    const setup = await testRender(<App store={store} nowMs={Date.parse(NOW)} nowUtc={NOW} />, {
      width: 80,
      height: 24,
    });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("Portland"));
      expect(frame).toContain("29.92 inHg");
      expect(frame).not.toContain("1013 hPa");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("mixed prefs: metric temp but imperial pressure still renders inHg", async () => {
    const forecast = {
      ...fixtureForecast(),
      current: { ...fixtureForecast().current, pressureHpa: 1000 },
    };
    const store = await makeStore(configToml("metric", "imperial"), forecast);
    const setup = await testRender(<App store={store} nowMs={Date.parse(NOW)} nowUtc={NOW} />, {
      width: 80,
      height: 24,
    });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("Portland"));
      expect(frame).toContain("29.53 inHg");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("null pressure renders double dash regardless of units", async () => {
    const forecast = {
      ...fixtureForecast(),
      current: { ...fixtureForecast().current, pressureHpa: null },
    };
    const store = await makeStore(configToml("metric"), forecast);
    const setup = await testRender(<App store={store} nowMs={Date.parse(NOW)} nowUtc={NOW} />, {
      width: 80,
      height: 24,
    });
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("Portland"));
      expect(frame).toContain("pressure");
      const lines = frame.split("\n");
      const pressureLine = lines.find((l) => l.includes("pressure")) ?? "";
      expect(pressureLine).toContain("--");
      expect(pressureLine).not.toContain("hPa");
      expect(pressureLine).not.toContain("inHg");
    } finally {
      await setup.renderer.destroy();
    }
  });
});
