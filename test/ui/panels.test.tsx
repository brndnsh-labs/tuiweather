import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { App } from "../../src/app/App";
import { createStoreInstance, type ForecastFetcher, type WeatherStore } from "../../src/app/store";
import { normalizeForecast } from "../../src/lib/providers/openmeteo/normalize";
import { forecastResponseSchema } from "../../src/lib/providers/openmeteo/schemas";
import type { NormalizedForecast } from "../../src/lib/weather/types";
import portlandFixture from "../fixtures/openmeteo/portland.json";

const NOW = "2026-08-24T16:15:00.000Z";

function configToml(panels: {
  nowcast?: boolean;
  details?: boolean;
  hourly?: boolean;
  daily?: boolean;
}): string {
  const flag = (name: string, value: boolean | undefined): string =>
    `${name} = ${value === false ? "false" : "true"}`;
  return `schema_version = 1
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
${flag("nowcast", panels.nowcast)}
${flag("details", panels.details)}
${flag("hourly", panels.hourly)}
${flag("daily", panels.daily)}
`;
}

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

async function makeStore(toml: string, forecast: NormalizedForecast): Promise<WeatherStore> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-panels-test-"));
  tmpDirs.push(dir);
  await writeFile(join(dir, "config.toml"), toml, "utf8");
  const fetcher: ForecastFetcher = () => Promise.resolve({ forecast, stale: false });
  return createStoreInstance({ configPath: join(dir, "config.toml"), fetchForecast: fetcher });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function frameFor(
  toml: string,
  forecast: NormalizedForecast = fixtureForecast(),
  width = 80,
): Promise<string> {
  const store = await makeStore(toml, forecast);
  const setup = await testRender(<App store={store} nowMs={Date.parse(NOW)} nowUtc={NOW} />, {
    width,
    height: 24,
  });
  try {
    await setup.flush();
    let frame = "";
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      frame = setup.captureCharFrame();
      if (frame.includes("Portland")) break;
      await sleep(15);
      await setup.flush().catch(() => undefined);
    }
    return frame;
  } finally {
    await setup.renderer.destroy();
  }
}

describe("panels config toggles", () => {
  test("default panels render hero, details, hourly, and daily sections", async () => {
    const frame = await frameFor(configToml({}));
    expect(frame).toContain("╭━━━╮");
    expect(frame).toContain("sunrise");
    expect(frame).toContain("temp ");
    expect(frame).toContain("7 day");
    expect(frame).toContain("Mon");
  });

  test("panels.details=false drops the details grid but keeps hero", async () => {
    const frame = await frameFor(configToml({ details: false }));
    expect(frame).toContain("feels like");
    expect(frame).not.toContain("sunrise");
    expect(frame).toContain("temp ");
    expect(frame).toContain("7 day");
  });

  test("panels.hourly=false drops the strip but keeps other sections", async () => {
    const frame = await frameFor(configToml({ hourly: false }));
    expect(frame).toContain("╭━━━╮");
    expect(frame).not.toContain("temp ");
    expect(frame).toContain("sunrise");
    expect(frame).toContain("7 day");
  });

  test("panels.daily=false drops list and its rule but keeps other sections", async () => {
    const frame = await frameFor(configToml({ daily: false }));
    expect(frame).toContain("╭━━━╮");
    expect(frame).not.toContain("7 day");
    expect(frame).not.toContain("Mon");
    expect(frame).toContain("temp ");
  });

  test("panels.nowcast=true shows a wet-now banner with its bucket strip", async () => {
    const forecast = {
      ...fixtureForecast(),
      minutely15: [
        {
          startUtc: "2026-08-24T16:00:00.000Z",
          endUtc: "2026-08-24T16:15:00.000Z",
          precipMm: 0,
          probabilityPct: 10,
        },
        {
          startUtc: "2026-08-24T16:15:00.000Z",
          endUtc: "2026-08-24T16:30:00.000Z",
          precipMm: 0.2,
          probabilityPct: 80,
        },
        {
          startUtc: "2026-08-24T16:30:00.000Z",
          endUtc: "2026-08-24T16:45:00.000Z",
          precipMm: 0.2,
          probabilityPct: 80,
        },
        {
          startUtc: "2026-08-24T16:45:00.000Z",
          endUtc: "2026-08-24T17:00:00.000Z",
          precipMm: 0,
          probabilityPct: 10,
        },
      ],
    };
    const frame = await frameFor(configToml({}), forecast);
    expect(frame).toContain("Rain stopping");
    // Series from the bucket containing 16:15 (labeled 16:30, [16:15,16:30)):
    // [0.2, 0] → moderate ▅ then dry ▁, on the row right below the sentence.
    const lines = frame.split("\n");
    const bannerIdx = lines.findIndex((line) => line.includes("Rain stopping"));
    expect(lines[bannerIdx + 1]).toContain("▅▁");
  });

  test("dry period renders neither banner nor strip", async () => {
    const frame = await frameFor(configToml({}));
    expect(frame).not.toContain("▔");
  });

  test("xs keeps the wet banner prose-only (no strip row)", async () => {
    const forecast = {
      ...fixtureForecast(),
      minutely15: [
        {
          startUtc: "2026-08-24T16:15:00.000Z",
          endUtc: "2026-08-24T16:30:00.000Z",
          precipMm: 0.6,
          probabilityPct: 80,
        },
        {
          startUtc: "2026-08-24T16:30:00.000Z",
          endUtc: "2026-08-24T16:45:00.000Z",
          precipMm: 0.05,
          probabilityPct: 60,
        },
      ],
    };
    const frame = await frameFor(configToml({}), forecast, 40);
    expect(frame).toContain("Rain for at least 2 hr");
    expect(frame).not.toContain("█▃");
  });

  test("panels.nowcast=false suppresses even a wet-now banner", async () => {
    const forecast = {
      ...fixtureForecast(),
      minutely15: [
        {
          startUtc: "2026-08-24T16:15:00.000Z",
          endUtc: "2026-08-24T16:30:00.000Z",
          precipMm: 0.2,
          probabilityPct: 80,
        },
      ],
    };
    const frame = await frameFor(configToml({ nowcast: false }), forecast);
    expect(frame).not.toContain("Rain");
  });
});
