import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "../../src/lib/config/errors";
import { loadConfig } from "../../src/lib/config/load";
import { saveConfig } from "../../src/lib/config/save";
import { resolveDisplayPrefs, SCHEMA_VERSION } from "../../src/lib/config/schema";

const tempDirs: string[] = [];

afterAll(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function configFromFile(text: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-migrate-test-"));
  tempDirs.push(dir);
  const file = join(dir, "config.toml");
  await writeFile(file, text, "utf8");
  return file;
}

async function expectConfigError(promise: Promise<unknown>): Promise<ConfigError> {
  try {
    await promise;
  } catch (e) {
    if (e instanceof ConfigError) return e;
    throw new Error(`expected ConfigError, got: ${String(e)}`);
  }
  throw new Error("expected promise to reject with ConfigError");
}

describe("v1/v2/v3 → v4 migration via loadConfig", () => {
  test("v1 metric document loads as v4 with derived defaults and openmeteo provider", async () => {
    const file = await configFromFile('schema_version = 1\nunits = "metric"\n');
    const cfg = await loadConfig(file);
    expect(cfg.schema_version).toBe(SCHEMA_VERSION);
    expect(cfg.provider).toBe("openmeteo");
    expect(cfg.ink).toBe("auto");
    expect(cfg.units).toBe("metric");
    expect(cfg.time_format).toBe("auto");
    expect(cfg.unit_prefs).toEqual({
      temp: "metric",
      wind: "metric",
      precip: "metric",
      pressure: "metric",
    });
    expect(resolveDisplayPrefs(cfg)).toEqual({
      temp: "metric",
      wind: "metric",
      precip: "metric",
      pressure: "metric",
      timeFormat: "24h",
    });
  });

  test("v1 document without a units scalar derives imperial everywhere", async () => {
    const file = await configFromFile("schema_version = 1\n");
    const cfg = await loadConfig(file);
    expect(cfg.schema_version).toBe(SCHEMA_VERSION);
    expect(cfg.units).toBe("imperial");
    expect(cfg.ink).toBe("auto");
    expect(resolveDisplayPrefs(cfg).timeFormat).toBe("12h");
  });

  test("partial [units] table in a v2 document overrides only its fields", async () => {
    const file = await configFromFile(`schema_version = 2

[units]
temp = "metric"
`);
    const cfg = await loadConfig(file);
    expect(cfg.unit_prefs.temp).toBe("metric");
    expect(cfg.unit_prefs.wind).toBe("imperial");
    expect(cfg.unit_prefs.precip).toBe("imperial");
    expect(cfg.unit_prefs.pressure).toBe("imperial");
  });

  test("v3 document without ink migrates to v4 with ink auto", async () => {
    const file = await configFromFile('schema_version = 3\ntheme = "day"\n');
    const cfg = await loadConfig(file);
    expect(cfg.schema_version).toBe(SCHEMA_VERSION);
    expect(cfg.ink).toBe("auto");
    expect(cfg.theme).toBe("day");
  });

  test("v3 document with explicit ink preserves it after migration", async () => {
    const file = await configFromFile('schema_version = 3\nink = "light"\n');
    const cfg = await loadConfig(file);
    expect(cfg.schema_version).toBe(SCHEMA_VERSION);
    expect(cfg.ink).toBe("light");
  });

  test("v3 document selects the nws provider", async () => {
    const file = await configFromFile(`schema_version = 3\nprovider = "nws"\n`);
    const cfg = await loadConfig(file);
    expect(cfg.schema_version).toBe(SCHEMA_VERSION);
    expect(cfg.provider).toBe("nws");
  });

  test("v4 document with explicit ink loads verbatim", async () => {
    const file = await configFromFile(`schema_version = 4\nink = "dark"\n`);
    const cfg = await loadConfig(file);
    expect(cfg.schema_version).toBe(4);
    expect(cfg.ink).toBe("dark");
  });

  test("invalid ink is rejected descriptively", async () => {
    const badInk = await expectConfigError(
      loadConfig(await configFromFile('schema_version = 4\nink = "system"\n')),
    );
    expect(badInk.issues.some((issue) => issue.includes("ink"))).toBe(true);
  });

  test("invalid values are rejected descriptively", async () => {
    const badUnits = await expectConfigError(
      loadConfig(await configFromFile('schema_version = 1\nunits = "kelvin"\n')),
    );
    expect(badUnits.issues.some((issue) => issue.includes("units"))).toBe(true);

    const badProvider = await expectConfigError(
      loadConfig(await configFromFile('schema_version = 3\nprovider = "noaa"\n')),
    );
    expect(badProvider.issues.some((issue) => issue.includes("provider"))).toBe(true);

    const badTime = await expectConfigError(
      loadConfig(await configFromFile('schema_version = 2\ntime_format = "sunrise"\n')),
    );
    expect(badTime.issues.some((issue) => issue.includes("time_format"))).toBe(true);

    const badPref = await expectConfigError(
      loadConfig(await configFromFile('schema_version = 2\n[units]\nwind = "knots"\n')),
    );
    expect(badPref.issues.some((issue) => issue.startsWith("unit_prefs.wind"))).toBe(true);

    const future = await expectConfigError(
      loadConfig(await configFromFile("schema_version = 99\n")),
    );
    expect(future.issues.some((issue) => issue.includes("schema_version"))).toBe(true);
  });

  test("round-trip save → load preserves all new fields", async () => {
    const file = await configFromFile('schema_version = 1\nunits = "imperial"\n');
    const migrated = await loadConfig(file);
    const dir = await mkdtemp(join(tmpdir(), "tuiweather-migrate-rt-"));
    tempDirs.push(dir);
    const saved = join(dir, "roundtrip.toml");
    await saveConfig(migrated, saved);
    const text = await readFile(saved, "utf8");
    expect(text.match(/^schema_version = 4$/m)).not.toBeNull();
    await expect(loadConfig(saved)).resolves.toEqual(migrated);
  });

  test("v3 without ink re-saves as v4 with bumped version", async () => {
    const file = await configFromFile('schema_version = 3\ntheme = "night"\n');
    const migrated = await loadConfig(file);
    expect(migrated.schema_version).toBe(4);
    expect(migrated.ink).toBe("auto");
    const dir = await mkdtemp(join(tmpdir(), "tuiweather-migrate-ink-"));
    tempDirs.push(dir);
    const saved = join(dir, "ink-roundtrip.toml");
    await saveConfig(migrated, saved);
    const text = await readFile(saved, "utf8");
    expect(text.match(/^schema_version = 4$/m)).not.toBeNull();
    expect(text).toContain('ink = "auto"');
    const reloaded = await loadConfig(saved);
    expect(reloaded.schema_version).toBe(4);
    expect(reloaded.ink).toBe("auto");
  });

  test("mixed display prefs survive save → load exactly", async () => {
    const file = await configFromFile(`schema_version = 2
refresh_minutes = 3
theme = "night"
daily_days = 5
hourly_hours = 12
default_location = "portland"

[units]
temp = "metric"
wind = "imperial"
precip = "metric"
pressure = "imperial"

[[locations]]
slug = "portland"
label = "Portland"
latitude = 45.5202
longitude = -122.6742

[panels]
nowcast = true
details = true
hourly = false
daily = true
`);
    const original = await loadConfig(file);
    const dir = await mkdtemp(join(tmpdir(), "tuiweather-migrate-mixed-"));
    tempDirs.push(dir);
    const saved = join(dir, "config.toml");
    await saveConfig(original, saved);
    await expect(loadConfig(saved)).resolves.toEqual(original);
  });
});
