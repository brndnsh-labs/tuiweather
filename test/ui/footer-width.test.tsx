import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../../src/app/App";
import { footerText } from "../../src/app/components/Footer";
import { SIDEBAR_WIDTH } from "../../src/app/components/Sidebar";
import type { ForecastFetcher, WeatherStore } from "../../src/app/store";
import { createStoreInstance } from "../../src/app/store";
import { normalizeForecast } from "../../src/lib/providers/openmeteo/normalize";
import { forecastResponseSchema } from "../../src/lib/providers/openmeteo/schemas";
import { displayWidth } from "../../src/lib/weather/format";
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
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-footer-"));
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

describe("lg footer width awareness", () => {
  for (const width of [96, 104]) {
    test(`hint line occupies exactly one row at lg ${width}x24`, async () => {
      const store = await makeStore();
      const setup = await testRender(<App store={store} nowMs={NOW_MS} nowUtc={NOW} />, {
        width,
        height: 24,
      });
      try {
        await setup.flush();
        await waitUntilFrame(setup, (f) => f.includes("Portland"));
        const frame = setup.captureCharFrame();
        const hint = footerText("lg", width - SIDEBAR_WIDTH);
        const rows = frame.split("\n");

        expect(hint.endsWith("…")).toBe(true);
        const hintRows = rows.filter((row) => row.includes(hint));
        expect(hintRows).toHaveLength(1);
        expect(hintRows[0]?.indexOf(hint)).toBe(SIDEBAR_WIDTH);
        for (const row of rows) {
          expect(displayWidth(row)).toBeLessThanOrEqual(width);
        }
      } finally {
        await setup.renderer.destroy();
      }
    });
  }

  test("tier-floor hints below lg fit untruncated in their full-width column", () => {
    expect(footerText("md", 68)).not.toContain("…");
    expect(footerText("sm", 48)).not.toContain("…");
    expect(footerText("xs", 32)).not.toContain("…");
  });
});
