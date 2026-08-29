import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { memo, useState } from "react";
import { __setTickIntervalMs, TICK_INTERVAL_MS } from "../../src/app/App";
import { useNowMs } from "../../src/app/hooks/useNowMs";
import { createStoreInstance, type ForecastFetcher } from "../../src/app/store";
import { DailyList } from "../../src/features/daily/DailyList";
import type { CurrentObs, NormalizedForecast } from "../../src/lib/weather/types";
import { stubNullAirQualityFetcher } from "../helpers";

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

[[locations]]
slug = "london"
label = "London"
latitude = 51.5072
longitude = -0.1276

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

function makeForecast(tempC = 20): NormalizedForecast {
  const current: CurrentObs = {
    timeUtc: "2026-08-24T19:00:00.000Z",
    temperatureC: tempC,
    apparentC: tempC,
    humidityPct: 50,
    condition: "clear",
    windSpeedKmh: 8,
    windDirectionDeg: 200,
    windGustKmh: null,
    pressureHpa: null,
    cloudCoverPct: null,
    dewPointC: null,
    visibilityM: null,
    uvIndex: null,
    precipLast1hMm: null,
    isDay: true,
  };
  return {
    providerId: "stub",
    location: { latitude: 45.52, longitude: -122.67 },
    timezone: "UTC",
    utcOffsetSeconds: 0,
    fetchedAtUtc: "2026-08-24T19:00:00.000Z",
    hasMinutePrecip: true,
    current,
    minutely15: [],
    hourly: [],
    daily: [
      {
        dateLocal: "2026-08-24",
        condition: "clear",
        tempMinC: 15,
        tempMaxC: 25,
        precipSumMm: 0,
        precipProbabilityMaxPct: null,
        uvIndexMax: null,
        sunriseUtc: null,
        sunsetUtc: null,
        windSpeedMaxKmh: null,
        windGustMaxKmh: null,
      },
    ],
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

describe("perf 60: memo and tick scoping", () => {
  test("memo works with @opentui/react: stable props do not re-render memoized leaf", async () => {
    let memoRenders = 0;
    let plainRenders = 0;

    const MemoLeaf = memo(function MemoLeaf({ label }: { label: string }) {
      memoRenders++;
      return <text>{label}</text>;
    });

    function PlainLeaf({ label }: { label: string }) {
      plainRenders++;
      return <text>{label}</text>;
    }

    let setChurn: (n: number) => void = () => {};
    function ParentWithSetter() {
      const [churn, setChurnState] = useState(0);
      setChurn = (n) => setChurnState(n);
      return (
        <box flexDirection="column">
          <text>{`churn:${churn}`}</text>
          <MemoLeaf label="stable" />
          <PlainLeaf label="stable" />
        </box>
      );
    }

    const setup = await testRender(<ParentWithSetter />, { width: 40, height: 10 });
    try {
      await setup.flush();
      const initialMemo = memoRenders;
      const initialPlain = plainRenders;
      expect(initialMemo).toBe(1);
      expect(initialPlain).toBe(1);

      for (let i = 1; i <= 3; i++) {
        setChurn(i);
        await sleep(15);
        await setup.flush().catch(() => undefined);
        await waitUntilFrame(setup, (f) => f.includes(`churn:${i}`));
      }

      expect(memoRenders).toBe(initialMemo);
      expect(plainRenders).toBe(initialPlain + 3);
      expect(plainRenders).toBeGreaterThan(memoRenders);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("store churn for inactive slug does not re-render memoized DailyList for active forecast", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tuiweather-tick-renders-"));
    tmpDirs.push(dir);
    await writeFile(join(dir, "config.toml"), CONFIG_TOML, "utf8");
    const baseForecast = makeForecast(20);
    const fetcher: ForecastFetcher = () =>
      Promise.resolve({ forecast: baseForecast, stale: false });
    const store = createStoreInstance({
      configPath: join(dir, "config.toml"),
      fetchForecast: fetcher,
      fetchAirQuality: stubNullAirQualityFetcher,
    });
    await store.getState().init();
    await sleep(50);

    const activeForecast = store.getState().forecastBySlug.portland?.forecast ?? baseForecast;

    let memoRenders = 0;
    const SpyDailyList = memo(function SpyDailyList(props: Parameters<typeof DailyList>[0]) {
      memoRenders++;
      return <DailyList {...props} />;
    });

    let plainRenders = 0;
    function PlainDailyList(props: Parameters<typeof DailyList>[0]) {
      plainRenders++;
      return <DailyList {...props} />;
    }

    // Stable prefs derived from config
    const prefs = {
      temp: "imperial" as const,
      wind: "imperial" as const,
      precip: "imperial" as const,
      pressure: "imperial" as const,
      timeFormat: "12h" as const,
    };
    const days = activeForecast.daily;

    function Parent() {
      const [churn, setChurn] = useState(0);
      // expose setter
      (Parent as unknown as { _set?: (n: number) => void })._set = (n: number) => setChurn(n);
      return (
        <box flexDirection="column">
          <text>{`c:${churn}`}</text>
          <SpyDailyList days={days} prefs={prefs} columns={1} width={40} />
          <PlainDailyList days={days} prefs={prefs} columns={1} width={40} />
        </box>
      );
    }

    const setup = await testRender(<Parent />, { width: 50, height: 20 });
    try {
      await setup.flush();
      const startMemo = memoRenders;
      const startPlain = plainRenders;

      // Simulate N store churns for inactive location (london) - but Parent's props are stable,
      // the churn is simulated by Parent re-renders (like App re-rendering on any store change).
      // For the real App, App would NOT re-render on inactive churn after our fix (selector granularity),
      // so the number of parent re-renders is less. Here we simulate the worst-case parent churn.
      for (let i = 1; i <= 5; i++) {
        (Parent as unknown as { _set: (n: number) => void })._set(i);
        await sleep(15);
        await setup.flush().catch(() => undefined);
        await waitUntilFrame(setup, (f) => f.includes(`c:${i}`));
      }

      expect(memoRenders).toBe(startMemo);
      expect(plainRenders).toBe(startPlain + 5);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("tick only re-renders time leaf, not memoized heavy panel", async () => {
    const original = TICK_INTERVAL_MS;
    __setTickIntervalMs(30);
    try {
      let heavyRenders = 0;
      const HeavyMemo = memo(function HeavyMemo({ label }: { label: string }) {
        heavyRenders++;
        return <text>{label}</text>;
      });

      let timeRenders = 0;
      function TimeLeaf({ nowMs }: { nowMs: number }) {
        timeRenders++;
        return <text>{`t:${nowMs}`}</text>;
      }
      function TimeLeafWithTick(props: { frozen?: number }) {
        const now = useNowMs(props.frozen);
        return <TimeLeaf nowMs={now} />;
      }

      function Parent({ frozen }: { frozen?: number }) {
        return (
          <box flexDirection="column">
            <TimeLeafWithTick frozen={frozen} />
            <HeavyMemo label="heavy" />
          </box>
        );
      }

      // Live tick path: no frozen nowMs => TimeLeaf should tick, HeavyMemo should stay
      const liveSetup = await testRender(<Parent />, { width: 30, height: 10 });
      try {
        await liveSetup.flush();
        const startHeavy = heavyRenders;
        const startTime = timeRenders;
        await sleep(100);
        await liveSetup.flush().catch(() => undefined);
        // Poll for time leaf having advanced (at least one more render)
        const deadline = Date.now() + 1000;
        while (Date.now() < deadline && timeRenders <= startTime) {
          await sleep(15);
          await liveSetup.flush().catch(() => undefined);
        }
        expect(timeRenders).toBeGreaterThan(startTime);
        expect(heavyRenders).toBe(startHeavy);
      } finally {
        await liveSetup.renderer.destroy();
      }

      // Reset counters for frozen path
      heavyRenders = 0;
      timeRenders = 0;
      const frozenNow = Date.now();
      const frozenSetup = await testRender(<Parent frozen={frozenNow} />, {
        width: 30,
        height: 10,
      });
      try {
        await frozenSetup.flush();
        const startHeavyF = heavyRenders;
        const startTimeF = timeRenders;
        await sleep(100);
        await frozenSetup.flush().catch(() => undefined);
        await sleep(15);
        expect(timeRenders).toBe(startTimeF);
        expect(heavyRenders).toBe(startHeavyF);
      } finally {
        await frozenSetup.renderer.destroy();
      }
    } finally {
      __setTickIntervalMs(original);
    }
  });

  test("per-row sidebar isolates: updating one slug does not re-render other row", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tuiweather-sidebar-isolate-"));
    tmpDirs.push(dir);
    await writeFile(join(dir, "config.toml"), CONFIG_TOML, "utf8");
    const store = createStoreInstance({
      configPath: join(dir, "config.toml"),
      fetchForecast: async () => ({ forecast: makeForecast(20), stale: false }),
      fetchAirQuality: stubNullAirQualityFetcher,
    });
    await store.getState().init();
    await sleep(50);

    let portlandRenders = 0;
    let londonRenders = 0;

    function Row({ slug }: { slug: string }) {
      const entry = store((s) => s.forecastBySlug[slug]);
      if (slug === "portland") portlandRenders++;
      else londonRenders++;
      return <text>{`${slug}:${entry ? entry.forecast.current.temperatureC : "none"}`}</text>;
    }
    const MemoRow = memo(Row);

    function Parent() {
      return (
        <box flexDirection="column">
          <MemoRow slug="portland" />
          <MemoRow slug="london" />
        </box>
      );
    }

    const setup = await testRender(<Parent />, { width: 40, height: 10 });
    try {
      await setup.flush();
      portlandRenders = 0;
      londonRenders = 0;

      // Mutate only london's forecast
      const londonForecast = makeForecast(30);
      store.setState((s) => ({
        forecastBySlug: {
          ...s.forecastBySlug,
          london: { forecast: londonForecast, fetchedAtMs: Date.now() },
        },
      }));
      await sleep(15);
      await setup.flush().catch(() => undefined);
      await waitUntilFrame(setup, (f) => f.includes("30"));

      expect(londonRenders).toBeGreaterThan(0);
      expect(portlandRenders).toBe(0);
    } finally {
      await setup.renderer.destroy();
    }
  });
});
