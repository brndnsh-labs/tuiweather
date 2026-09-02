import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { App, estimateMainContentRows } from "../../src/app/App";
import { createStoreInstance, type ForecastFetcher, type WeatherStore } from "../../src/app/store";
import { normalizeForecast } from "../../src/lib/providers/openmeteo/normalize";
import { forecastResponseSchema } from "../../src/lib/providers/openmeteo/schemas";
import type { NormalizedForecast } from "../../src/lib/weather/types";
import portlandFixture from "../fixtures/openmeteo/portland.json";
import { stubNullAirQualityFetcher } from "../helpers";

const NOW = "2026-09-02T12:45:00.000Z";

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
  return createStoreInstance({
    configPath: join(dir, "config.toml"),
    fetchForecast: fetcher,
    fetchAirQuality: stubNullAirQualityFetcher,
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function frameFor(
  toml: string,
  forecast: NormalizedForecast = fixtureForecast(),
  width = 80,
  height = 24,
): Promise<string> {
  const store = await makeStore(toml, forecast);
  const setup = await testRender(<App store={store} nowMs={Date.parse(NOW)} nowUtc={NOW} />, {
    width,
    height,
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

describe("main overflow estimate", () => {
  const ALL_PANELS = { nowcast: true, details: true, hourly: true, daily: true };

  test("md fixture content exceeds an 80x24 viewport once chrome is added", () => {
    const rows = estimateMainContentRows({
      tier: "md",
      width: 76,
      forecast: fixtureForecast(),
      panels: ALL_PANELS,
      nowUtc: NOW,
    });
    expect(rows).toBe(25);
    expect((rows ?? 0) + 6).toBeGreaterThan(24);
  });

  test("tier shapes change the estimate deterministically", () => {
    const forecast = fixtureForecast();
    const base = { width: 90, forecast, panels: ALL_PANELS, nowUtc: NOW };
    expect(estimateMainContentRows({ ...base, tier: "lg" })).toBe(28);
    expect(estimateMainContentRows({ ...base, tier: "sm" })).toBe(19);
    expect(estimateMainContentRows({ ...base, tier: "xs" })).toBeNull();
  });
});

describe("overflow hint", () => {
  test("short md frame surfaces the bottom-right hint", async () => {
    const frame = await frameFor(configToml({}));
    expect(frame).toContain("↓ more");
  });

  test("very short frame still surfaces the hint", async () => {
    const frame = await frameFor(configToml({}), fixtureForecast(), 80, 12);
    expect(frame).toContain("↓ more");
  });

  test("tall frame hides the hint once content fits", async () => {
    const frame = await frameFor(configToml({}), fixtureForecast(), 80, 60);
    expect(frame).not.toContain("↓ more");
  });
});

describe("panels config toggles", () => {
  test("default panels render hero, details, hourly, and daily sections", async () => {
    const frame = await frameFor(configToml({}));
    expect(frame).toContain("╭━━━╮");
    expect(frame).toContain("sunrise");
    expect(frame).toContain("temp ");
    expect(frame).toContain("↓ more");
  });

  test("overflowing md panel reveals the daily section on scroll", async () => {
    const store = await makeStore(configToml({}), fixtureForecast());
    const setup = await testRender(<App store={store} nowMs={Date.parse(NOW)} nowUtc={NOW} />, {
      width: 80,
      height: 24,
    });
    try {
      await setup.flush();
      for (let i = 0; i < 40; i++) {
        const frame = setup.captureCharFrame();
        if (frame.includes("Portland") && i > 2) break;
        await sleep(15);
        await setup.flush().catch(() => undefined);
      }
      for (let i = 0; i < 12; i++) {
        if (setup.captureCharFrame().includes("14 day")) return;
        setup.mockInput.pressArrow("down");
        await sleep(20);
        await setup.flush().catch(() => undefined);
      }
      expect(setup.captureCharFrame()).toContain("14 day");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("panels.details=false drops the details grid but keeps hero", async () => {
    const frame = await frameFor(configToml({ details: false }));
    expect(frame).toContain("feels like");
    expect(frame).not.toContain("sunrise");
    expect(frame).toContain("temp ");
    expect(frame).toContain("14 day");
  });

  test("panels.hourly=false drops the strip but keeps other sections", async () => {
    const frame = await frameFor(configToml({ hourly: false }));
    expect(frame).toContain("╭━━━╮");
    expect(frame).not.toContain("temp ");
    expect(frame).toContain("sunrise");
    expect(frame).toContain("14 day");
  });

  test("panels.daily=false drops list and its rule but keeps other sections", async () => {
    const frame = await frameFor(configToml({ daily: false }));
    expect(frame).toContain("╭━━━╮");
    expect(frame).not.toContain("14 day");
    expect(frame).not.toContain("Mon ☁️");
    expect(frame).toContain("temp ");
  });

  test("panels.nowcast=true shows a wet-now banner with its bucket strip", async () => {
    const forecast = {
      ...fixtureForecast(),
      minutely15: [
        {
          startUtc: "2026-09-02T12:30:00.000Z",
          endUtc: "2026-09-02T12:45:00.000Z",
          precipMm: 0,
          probabilityPct: 10,
        },
        {
          startUtc: "2026-09-02T12:45:00.000Z",
          endUtc: "2026-09-02T13:00:00.000Z",
          precipMm: 0.2,
          probabilityPct: 80,
        },
        {
          startUtc: "2026-09-02T13:00:00.000Z",
          endUtc: "2026-09-02T13:15:00.000Z",
          precipMm: 0.2,
          probabilityPct: 80,
        },
        {
          startUtc: "2026-09-02T13:15:00.000Z",
          endUtc: "2026-09-02T13:30:00.000Z",
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
          startUtc: "2026-09-02T12:45:00.000Z",
          endUtc: "2026-09-02T13:00:00.000Z",
          precipMm: 0.6,
          probabilityPct: 80,
        },
        {
          startUtc: "2026-09-02T13:00:00.000Z",
          endUtc: "2026-09-02T13:15:00.000Z",
          precipMm: 0.05,
          probabilityPct: 60,
        },
      ],
    };
    const frame = await frameFor(configToml({}), forecast, 40);
    expect(frame).toContain("Rain for at least 30 min");
    expect(frame).not.toContain("█▃");
  });

  test("panels.nowcast=false suppresses even a wet-now banner", async () => {
    const forecast = {
      ...fixtureForecast(),
      minutely15: [
        {
          startUtc: "2026-09-02T12:45:00.000Z",
          endUtc: "2026-09-02T13:00:00.000Z",
          precipMm: 0.2,
          probabilityPct: 80,
        },
      ],
    };
    const frame = await frameFor(configToml({ nowcast: false }), forecast);
    expect(frame).not.toContain("Rain");
  });

  test("hasMinutePrecip:false hides banner even with panels.nowcast=true (NWS)", async () => {
    const forecast = {
      ...fixtureForecast(),
      hasMinutePrecip: false,
      minutely15: [],
    };
    const frame = await frameFor(configToml({}), forecast);
    expect(frame).not.toContain("▔");
    expect(frame).not.toContain("Nowcast unavailable");
    expect(frame).not.toContain("Dry");
    const wetAttempt = {
      ...fixtureForecast(),
      hasMinutePrecip: false,
      minutely15: [
        {
          startUtc: "2026-09-02T12:45:00.000Z",
          endUtc: "2026-09-02T13:00:00.000Z",
          precipMm: 0.6,
          probabilityPct: 80,
        },
      ],
    };
    const frame2 = await frameFor(configToml({}), wetAttempt);
    expect(frame2).not.toContain("▔");
    expect(frame2).not.toContain("Rain");
  });
});
