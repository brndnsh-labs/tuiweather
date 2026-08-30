import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testRender } from "@opentui/react/test-utils";
import { useEffect, useState } from "react";
import { createStoreInstance } from "../../src/app/store";
import type { CurrentObs, NormalizedForecast } from "../../src/lib/weather/types";
import {
  appearancesEqual,
  FALLBACK_APPEARANCE,
  type TerminalAppearance,
} from "../../src/theme/detect";
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

async function makeConfigFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-appearance-test-"));
  tmpDirs.push(dir);
  await writeFile(join(dir, "config.toml"), CONFIG_TOML, "utf8");
  return join(dir, "config.toml");
}

function makeForecast(): NormalizedForecast {
  const current: CurrentObs = {
    timeUtc: "2026-08-24T19:00:00.000Z",
    temperatureC: 20,
    apparentC: 20,
    humidityPct: 50,
    condition: "clear",
    windSpeedKmh: 5,
    windDirectionDeg: 180,
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
    location: { latitude: 45.5202, longitude: -122.6765 },
    timezone: "America/Los_Angeles",
    utcOffsetSeconds: -7 * 3600,
    fetchedAtUtc: "2026-08-24T19:00:00.000Z",
    hasMinutePrecip: false,
    current,
    minutely15: [],
    hourly: [],
    daily: [],
  };
}

function stubFetcher() {
  const forecast = makeForecast();
  return () => Promise.resolve({ forecast, stale: false });
}

async function makeStore() {
  const configPath = await makeConfigFile();
  return createStoreInstance({
    configPath,
    fetchForecast: stubFetcher(),
    fetchAirQuality: stubNullAirQualityFetcher,
  });
}

function Probe({ appearancePromise }: { appearancePromise: Promise<TerminalAppearance> }) {
  const [appearance, setAppearance] = useState<TerminalAppearance>(FALLBACK_APPEARANCE);
  useEffect(() => {
    let cancelled = false;
    appearancePromise
      .then((detected) => {
        if (cancelled) return;
        setAppearance((prev) => (appearancesEqual(prev, detected) ? prev : detected));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [appearancePromise]);
  return <text>{`ink:${appearance.ink} bg:${appearance.background ?? "null"}`}</text>;
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("appearance instant-first-frame swap", () => {
  test("renders fallback ink first, then swaps to light when promise resolves", async () => {
    const d = deferred<TerminalAppearance>();
    const setup = await testRender(<Probe appearancePromise={d.promise} />, {
      width: 30,
      height: 5,
    });
    try {
      await setup.flush();
      const first = await waitUntilFrame(setup, (f) => f.includes("ink:dark"));
      expect(first).toContain("ink:dark");
      expect(first).toContain("bg:null");

      d.resolve({ ink: "light", background: "#f4f6fb" });
      const second = await waitUntilFrame(setup, (f) => f.includes("ink:light"));
      expect(second).toContain("ink:light");
      expect(second).toContain("#f4f6fb");
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("does not re-render when detected appearance equals fallback", async () => {
    let renders = 0;
    function CountedProbe({
      appearancePromise,
    }: {
      appearancePromise: Promise<TerminalAppearance>;
    }) {
      renders++;
      const [appearance, setAppearance] = useState<TerminalAppearance>(FALLBACK_APPEARANCE);
      useEffect(() => {
        let cancelled = false;
        appearancePromise
          .then((detected) => {
            if (cancelled) return;
            setAppearance((prev) => (appearancesEqual(prev, detected) ? prev : detected));
          })
          .catch(() => undefined);
        return () => {
          cancelled = true;
        };
      }, [appearancePromise]);
      return <text>{`ink:${appearance.ink} bg:${appearance.background ?? "null"}`}</text>;
    }

    const d = deferred<TerminalAppearance>();
    const setup = await testRender(<CountedProbe appearancePromise={d.promise} />, {
      width: 30,
      height: 5,
    });
    try {
      await setup.flush();
      const first = await waitUntilFrame(setup, (f) => f.includes("ink:dark"));
      expect(first).toContain("bg:null");
      const before = renders;

      d.resolve({ ink: "dark", background: null });
      await sleep(60);
      await setup.flush().catch(() => undefined);
      const still = setup.captureCharFrame();
      expect(still).toContain("ink:dark");
      expect(still).toContain("bg:null");
      expect(renders).toBe(before);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("quitting before the promise resolves does not throw", async () => {
    const unhandled: unknown[] = [];
    const onRejection = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onRejection);
    const d = deferred<TerminalAppearance>();
    let settled = false;
    d.promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const setup = await testRender(<Probe appearancePromise={d.promise} />, {
      width: 30,
      height: 5,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.includes("ink:dark"));
      await setup.renderer.destroy();
      d.resolve({ ink: "light", background: "#f4f6fb" });
      await sleep(30);
      await d.promise.catch(() => undefined);
      expect(unhandled).toEqual([]);
      expect(settled).toBe(true);
      expect(setup.renderer.isDestroyed).toBe(true);
    } finally {
      try {
        await setup.renderer.destroy();
      } catch {}
      process.off("unhandledRejection", onRejection);
    }
  });

  test("AppearanceApp renders fallback immediately and survives swap", async () => {
    const { AppearanceApp } = await import("../../src/app/AppearanceApp");
    const store = await makeStore();
    const d = deferred<TerminalAppearance>();
    const setup = await testRender(<AppearanceApp store={store} appearancePromise={d.promise} />, {
      width: 80,
      height: 20,
    });
    try {
      await setup.flush();
      await sleep(30);
      await setup.flush().catch(() => undefined);
      d.resolve({ ink: "light", background: "#f4f6fb" });
      await sleep(30);
      await setup.flush().catch(() => undefined);
      const frame = setup.captureCharFrame();
      expect(frame.length).toBeGreaterThan(0);
      await d.promise.catch(() => undefined);
    } finally {
      await setup.renderer.destroy();
    }
  });

  test("AppearanceApp does not throw if destroyed before the promise resolves", async () => {
    const unhandled: unknown[] = [];
    const onRejection = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onRejection);
    const { AppearanceApp } = await import("../../src/app/AppearanceApp");
    const store = await makeStore();
    const d = deferred<TerminalAppearance>();
    let settled = false;
    d.promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const setup = await testRender(<AppearanceApp store={store} appearancePromise={d.promise} />, {
      width: 60,
      height: 10,
    });
    try {
      await setup.flush();
      await waitUntilFrame(setup, (f) => f.length > 0);
      await setup.renderer.destroy();
      d.resolve({ ink: "light", background: "#ffffff" });
      await sleep(30);
      await d.promise.catch(() => undefined);
      expect(unhandled).toEqual([]);
      expect(settled).toBe(true);
      expect(setup.renderer.isDestroyed).toBe(true);
    } finally {
      try {
        await setup.renderer.destroy();
      } catch {}
      process.off("unhandledRejection", onRejection);
    }
  });
});

describe("appearancesEqual", () => {
  test("compares ink and background", () => {
    expect(
      appearancesEqual({ ink: "dark", background: null }, { ink: "dark", background: null }),
    ).toBe(true);
    expect(
      appearancesEqual({ ink: "dark", background: null }, { ink: "light", background: null }),
    ).toBe(false);
    expect(
      appearancesEqual(
        { ink: "dark", background: "#111111" },
        { ink: "dark", background: "#111111" },
      ),
    ).toBe(true);
    expect(
      appearancesEqual(
        { ink: "dark", background: "#111111" },
        { ink: "dark", background: "#222222" },
      ),
    ).toBe(false);
    expect(
      appearancesEqual({ ink: "dark", background: null }, { ink: "dark", background: "#111111" }),
    ).toBe(false);
  });
});
