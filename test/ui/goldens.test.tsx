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

const PORTLAND_FIXTURE_NOW = "2026-09-02T12:45:00.000Z";
const PORTLAND_NOW_MS = Date.parse(PORTLAND_FIXTURE_NOW);

const IMPERIAL_12H_TOML = `schema_version = 1
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

const MIXED_24H_TOML = `schema_version = 2
refresh_minutes = 10
theme = "night"
default_location = "portland"

[units]
temp = "metric"
wind = "imperial"
precip = "imperial"
pressure = "imperial"

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

function fixtureForecast() {
  const parsed = forecastResponseSchema.parse(portlandFixture);
  const forecast = normalizeForecast(parsed);
  return { ...forecast, fetchedAtUtc: PORTLAND_FIXTURE_NOW };
}

async function makeGoldenStore(configToml: string): Promise<WeatherStore> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-golden-"));
  tmpDirs.push(dir);
  await writeFile(join(dir, "config.toml"), configToml, "utf8");
  const forecast = fixtureForecast();
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

describe("golden frames", () => {
  for (const [name, width, height] of [
    ["lg 120x40", 120, 40],
    ["md 80x24", 80, 24],
    ["sm 60x20", 60, 20],
    ["xs 40x12", 40, 12],
  ] as const) {
    test(`portland fixture at ${name}`, async () => {
      const store = await makeGoldenStore(IMPERIAL_12H_TOML);
      const setup = await testRender(
        <App store={store} nowMs={PORTLAND_NOW_MS} nowUtc={PORTLAND_FIXTURE_NOW} />,
        { width, height },
      );
      try {
        await setup.flush();
        const frame = await waitUntilFrame(setup, (f) => f.includes("Portland"));
        expect(frame).toMatchSnapshot(name);
      } finally {
        await setup.renderer.destroy();
      }
    });
  }

  test("portland fixture at md 80x24 with 24h clock and mixed units", async () => {
    const store = await makeGoldenStore(MIXED_24H_TOML);
    const setup = await testRender(
      <App store={store} nowMs={PORTLAND_NOW_MS} nowUtc={PORTLAND_FIXTURE_NOW} />,
      { width: 80, height: 24 },
    );
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("Portland"));
      expect(frame).toContain("sunrise  06:33");
      expect(frame).toContain("18°");
      expect(frame).toContain("gusts    6 mph");
      expect(frame).toMatchSnapshot("md 80x24 mixed 24h");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("portland fixture at sm 60x20 with 24h header clock and mixed units", async () => {
    const store = await makeGoldenStore(MIXED_24H_TOML);
    const setup = await testRender(
      <App store={store} nowMs={PORTLAND_NOW_MS} nowUtc={PORTLAND_FIXTURE_NOW} />,
      { width: 60, height: 20 },
    );
    try {
      await setup.flush();
      const frame = await waitUntilFrame(setup, (f) => f.includes("05:45"));
      expect(frame).toContain("4 mph");
      expect(frame).toMatchSnapshot("sm 60x20 mixed 24h");
    } finally {
      await setup.renderer.destroy();
    }
  });
});
