import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../../src/app/App";
import { createStoreInstance, type ForecastFetcher, type WeatherStore } from "../../src/app/store";
import { normalizeForecast } from "../../src/lib/providers/openmeteo/normalize";
import { forecastResponseSchema } from "../../src/lib/providers/openmeteo/schemas";
import { displayWidth } from "../../src/lib/weather/format";
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

async function makeStore(): Promise<WeatherStore> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-day-detail-"));
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

async function openDayDetail(setup: Awaited<ReturnType<typeof testRender>>): Promise<string> {
  await setup.mockInput.pressKeys(["v"]);
  return waitUntilFrame(
    setup,
    (frame) => frame.includes("day detail") && frame.includes("wind max"),
  );
}

describe("day detail overlay", () => {
  test("right selects the next day; v opens it; escape restores the identical main frame", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} nowMs={NOW_MS} nowUtc={NOW} />, {
      width: 120,
      height: 40,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (frame) => frame.includes("Portland"));
      setup.mockInput.pressArrow("right");
      const before = await waitUntilFrame(setup, (frame) => frame.includes("▸Thu"));
      expect(before).toContain("▸Thu");

      const open = await openDayDetail(setup);
      expect(open).toContain("Thu 2026-09-03");
      expect(store.getState().dayDetailDate).toBe("2026-09-03");

      await setup.mockInput.pressEscape();
      await sleep(30);
      const after = await waitUntilFrame(setup, (frame) => !frame.includes("day detail"));
      expect(after).toBe(before);
      expect(store.getState().dayDetailDate).toBeNull();
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("compact overlay clamps below 32 columns without overflowing", async () => {
    const store = await makeStore();
    const setup = await testRender(<App store={store} nowMs={NOW_MS} nowUtc={NOW} />, {
      width: 30,
      height: 12,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (frame) => frame.includes("Portland"));
      await setup.mockInput.pressKeys(["v"]);
      const frame = await waitUntilFrame(
        setup,
        (candidate) => candidate.includes("hourly points") && candidate.includes("esc close"),
      );
      const rows = frame.trimEnd().split("\n");
      expect(rows).toHaveLength(12);
      for (const row of rows) {
        expect(displayWidth(row)).toBeLessThanOrEqual(30);
      }
    } finally {
      await setup.renderer.destroy();
    }
  });

  for (const [name, width, height] of [
    ["md 80x24", 80, 24],
    ["lg 120x40", 120, 40],
  ] as const) {
    test(`portland day detail golden at ${name}`, async () => {
      const store = await makeStore();
      const setup = await testRender(<App store={store} nowMs={NOW_MS} nowUtc={NOW} />, {
        width,
        height,
      });
      try {
        await setup.flush();
        await waitUntilFrame(setup, (frame) => frame.includes("Portland"));
        const frame = await openDayDetail(setup);
        expect(frame).toContain("Wed 2026-09-02");
        expect(frame).toMatchSnapshot(name);
      } finally {
        await setup.renderer.destroy();
      }
    });
  }
});
