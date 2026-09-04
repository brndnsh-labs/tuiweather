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
import type { NormalizedForecast } from "../../src/lib/weather/types";
import portlandFixture from "../fixtures/openmeteo/portland.json";
import { stubNullAirQualityFetcher } from "../helpers";

const NOW = "2026-09-02T12:45:00.000Z";
const NOW_MS = Date.parse(NOW);

function toml(panels: { nowcast: boolean; details: boolean }): string {
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
nowcast = ${panels.nowcast}
details = ${panels.details}
hourly = true
daily = true
`;
}

function tomlManyLocations(count: number, defaultIndex: number): string {
  const locations = Array.from(
    { length: count },
    (_, i) => `
[[locations]]
slug = "location-${i}"
label = "Location ${i}"
latitude = 45.5202
longitude = -122.6765
`,
  ).join("");
  return `schema_version = 1
units = "imperial"
refresh_minutes = 10
theme = "night"
default_location = "location-${defaultIndex}"
${locations}
[panels]
nowcast = true
details = true
hourly = true
daily = true
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
  const forecast = normalizeForecast(forecastResponseSchema.parse(portlandFixture));
  return { ...forecast, fetchedAtUtc: NOW };
}

async function makeStore(
  configToml: string,
  forecast: NormalizedForecast = fixtureForecast(),
): Promise<WeatherStore> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-rail-"));
  tmpDirs.push(dir);
  await writeFile(join(dir, "config.toml"), configToml, "utf8");
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

async function renderAt(
  store: WeatherStore,
  width: number,
  height: number,
  waitFor = "Portland",
): Promise<{
  frame: string;
  destroy: () => void;
  pressKeys: (keys: string[], predicate: (frame: string) => boolean) => Promise<string>;
}> {
  const setup = await testRender(<App store={store} nowMs={NOW_MS} nowUtc={NOW} />, {
    width,
    height,
  });
  await setup.flush();
  const frame = await waitUntilFrame(setup, (f) => f.includes(waitFor));
  return {
    frame,
    destroy: () => setup.renderer.destroy(),
    pressKeys: async (keys: string[], predicate: (frame: string) => boolean) => {
      await setup.mockInput.pressKeys(keys);
      return waitUntilFrame(setup, predicate);
    },
  };
}

/** The rail occupies the first SIDEBAR_WIDTH columns of every body row. */
function railColumn(frame: string): string[] {
  return frame.split("\n").map((line) => line.slice(0, 26));
}

describe("lg status rail", () => {
  test("the nowcast reaches the lg tier with no keypress", async () => {
    const store = await makeStore(toml({ nowcast: true, details: true }));
    const { frame, destroy } = await renderAt(store, 120, 40);
    try {
      const rail = railColumn(frame).join("\n");
      expect(rail).toContain("── now · m");
      expect(rail).toContain("Dry");
      expect(rail).toContain("── today");
      expect(rail).toContain("☂ 92% · 0.66 in");
      // The sidebar today card drops its sun line — the main DaylightBar is the
      // single sun source on wide rails.
      expect(rail).not.toContain("↑ 6:33 AM");
      expect(frame).toContain("↑ 6:33 AM");
    } finally {
      destroy();
    }
  });

  test("today pins to the bottom, with the leftover rows between it and the nowcast", async () => {
    const store = await makeStore(toml({ nowcast: true, details: true }));
    const { frame, destroy } = await renderAt(store, 120, 40);
    try {
      const rail = railColumn(frame);
      const nowRow = rail.findIndex((line) => line.includes("── now · m"));
      const todayRow = rail.findIndex((line) => line.includes("── today"));
      const precipRow = rail.findIndex((line) => line.includes("☂ 92%"));
      expect(nowRow).toBeGreaterThan(0);
      // Today sits at the foot of the rail: its last row is the row above the bottom border.
      const bottomBorder = rail.findIndex((line) => line.startsWith("└"));
      expect(precipRow).toBe(bottomBorder - 1);
      // The gap lands between the two sections, not after both.
      expect(todayRow - nowRow).toBeGreaterThan(10);
      for (const line of rail.slice(nowRow + 2, todayRow)) {
        expect(line.slice(1, 25).trim()).toBe("");
      }
    } finally {
      destroy();
    }
  });

  test("panels.nowcast = false suppresses the now section but keeps today", async () => {
    const store = await makeStore(toml({ nowcast: false, details: true }));
    const { frame, destroy } = await renderAt(store, 120, 40);
    try {
      const rail = railColumn(frame).join("\n");
      expect(rail).not.toContain("── now");
      expect(rail).not.toContain("Dry");
      expect(rail).toContain("── today");
    } finally {
      destroy();
    }
  });

  test("panels.details = false suppresses today but keeps the nowcast", async () => {
    const store = await makeStore(toml({ nowcast: true, details: false }));
    const { frame, destroy } = await renderAt(store, 120, 40);
    try {
      const rail = railColumn(frame).join("\n");
      expect(rail).toContain("── now · m");
      expect(rail).not.toContain("── today");
    } finally {
      destroy();
    }
  });

  test("a provider with no minute feed hides the section — never a false Dry", async () => {
    const forecast: NormalizedForecast = { ...fixtureForecast(), hasMinutePrecip: false };
    const store = await makeStore(toml({ nowcast: true, details: true }), forecast);
    const { frame, destroy } = await renderAt(store, 120, 40);
    try {
      const rail = railColumn(frame).join("\n");
      expect(rail).not.toContain("── now");
      expect(rail).not.toContain("Dry");
      expect(rail).toContain("── today");
    } finally {
      destroy();
    }
  });

  test("narrow-lg viewports go slim: locations only, no now/today cards", async () => {
    const store = await makeStore(toml({ nowcast: true, details: true }));
    const { frame, destroy } = await renderAt(store, 100, 40);
    try {
      const lines = frame.split("\n").filter((line) => line.length > 0);
      for (const line of lines) {
        expect(displayWidth(line)).toBeLessThanOrEqual(100);
      }
      const rail = railColumn(frame).join("\n");
      expect(rail).toContain("Portland");
      expect(rail).not.toContain("── now · m");
      expect(rail).not.toContain("── today");
      // The main panel keeps its own daylight + hourly sections.
      expect(frame).toContain("↑ 6:33 AM");
      expect(frame).toContain("next 48h");
    } finally {
      destroy();
    }
  });

  test("renders at the 96-column lg floor with no row overflowing the terminal", async () => {
    const store = await makeStore(toml({ nowcast: true, details: true }));
    const { frame, destroy } = await renderAt(store, 96, 24);
    try {
      const lines = frame.split("\n").filter((line) => line.length > 0);
      for (const line of lines) {
        expect(displayWidth(line)).toBeLessThanOrEqual(96);
      }
      const rail = railColumn(frame).join("\n");
      expect(rail).toContain("Portland");
      expect(rail).not.toContain("── now · m");
      expect(rail).not.toContain("── today");
    } finally {
      destroy();
    }
  });

  test("a long location list clamps with a '+N more' row, keeping the active location visible", async () => {
    const store = await makeStore(tomlManyLocations(30, 29), undefined);
    const { frame, destroy } = await renderAt(store, 96, 24, "Location 29");
    try {
      const rail = railColumn(frame).join("\n");
      // The active location (last configured) stays in view, with its neighbors
      // contiguous — no rows silently dropped from the middle of the window.
      for (let i = 9; i <= 29; i++) {
        expect(rail).toContain(`Location ${i} `);
      }
      for (let i = 0; i <= 8; i++) {
        expect(rail).not.toContain(`Location ${i} `);
      }
      expect(rail).toContain("● Location 29");
      expect(rail).toContain("+9 more · l");
    } finally {
      destroy();
    }
  });

  test("j/k focus navigation scrolls the clamped window into view instead of going invisible", async () => {
    const store = await makeStore(tomlManyLocations(30, 0));
    const { destroy, pressKeys } = await renderAt(store, 96, 24, "Location 0");
    try {
      // With nothing focused yet, a single `k` (vim "up") jumps focus straight
      // to the last configured location — the reviewer-found gap: that used to
      // land outside the active-anchored window with no `▸` marker anywhere.
      const afterK = await pressKeys(["k"], (f) => f.includes("▸"));
      const rail = railColumn(afterK).join("\n");
      expect(rail).toContain("▸ Location 29");
    } finally {
      destroy();
    }
  });

  test("a short rail sheds today before the nowcast, and never half-draws a section", async () => {
    const store = await makeStore(toml({ nowcast: true, details: true }));
    const { frame, destroy } = await renderAt(store, 120, 7);
    try {
      const rail = railColumn(frame).join("\n");
      expect(rail).toContain("── now · m");
      expect(rail).not.toContain("── today");
      // Today's rows must not leak in without their rule.
      expect(rail).not.toContain("☂ 92%");
    } finally {
      destroy();
    }
  });
});
