import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../../src/app/App";
import { createStoreInstance, type ForecastFetcher } from "../../src/app/store";
import { normalizeForecast } from "../../src/lib/providers/openmeteo/normalize";
import { forecastResponseSchema } from "../../src/lib/providers/openmeteo/schemas";
import portlandFixture from "../fixtures/openmeteo/portland.json";
import { stubNullAirQualityFetcher } from "../helpers";

const PORTLAND_FIXTURE_NOW = "2026-08-24T16:15:00.000Z";
const PORTLAND_NOW_MS = Date.parse(PORTLAND_FIXTURE_NOW);

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

function fixtureForecast() {
  const parsed = forecastResponseSchema.parse(portlandFixture);
  const forecast = normalizeForecast(parsed);
  return { ...forecast, fetchedAtUtc: PORTLAND_FIXTURE_NOW };
}

async function makeStore() {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-hourly-detail-"));
  tmpDirs.push(dir);
  await writeFile(join(dir, "config.toml"), CONFIG_TOML, "utf8");
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

describe("hourly detail row", () => {
  test("md shows detail row, xs hides it", async () => {
    const store = await makeStore();

    const mdSetup = await testRender(
      <App store={store} nowMs={PORTLAND_NOW_MS} nowUtc={PORTLAND_FIXTURE_NOW} />,
      { width: 80, height: 24 },
    );
    try {
      await mdSetup.flush();
      const mdFrame = await waitUntilFrame(
        mdSetup,
        (f) => f.includes("Portland") && f.includes("next"),
      );
      expect(mdFrame).toContain("uv ");
      expect(mdFrame).toContain("rh ");
      expect(mdFrame).toContain("vis ");
    } finally {
      await mdSetup.renderer.destroy();
    }

    const xsSetup = await testRender(
      <App store={store} nowMs={PORTLAND_NOW_MS} nowUtc={PORTLAND_FIXTURE_NOW} />,
      { width: 40, height: 24 },
    );
    try {
      await xsSetup.flush();
      const xsFrame = await waitUntilFrame(xsSetup, (f) => f.includes("Portland"));
      expect(xsFrame).not.toContain("uv ");
      expect(xsFrame).not.toContain("rh ");
      expect(xsFrame).not.toContain("vis ");
    } finally {
      await xsSetup.renderer.destroy();
    }
  });
});
