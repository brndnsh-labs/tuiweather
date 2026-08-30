import { afterAll, describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigError } from "../../src/lib/config/errors";
import { loadConfig } from "../../src/lib/config/load";
import { saveConfig } from "../../src/lib/config/save";
import { DEFAULT_CONFIG, type TuiConfig, tuiConfigSchema } from "../../src/lib/config/schema";

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-config-test-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

function sampleConfig(): TuiConfig {
  return tuiConfigSchema.parse({
    schema_version: 3,
    time_format: "24h",
    unit_prefs: { temp: "metric", wind: "imperial", precip: "metric", pressure: "imperial" },
    panels: { nowcast: true, details: false, hourly: true, daily: false },
    default_location: "portland",
    locations: [
      { slug: "portland", label: "Portland, OR", latitude: 45.5202, longitude: -122.6742 },
      { slug: "reykjavik", label: "Reykjavík, IS", latitude: 64.1466, longitude: -21.9426 },
    ],
  });
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

describe("saveConfig", () => {
  test("creates parent directories and writes the file", async () => {
    const file = join(await tempDir(), "deep", "nested", "config.toml");
    await saveConfig(sampleConfig(), file);
    expect(statSync(file).isFile()).toBe(true);
  });

  test.skipIf(process.platform === "win32")("final file mode is 0600", async () => {
    const file = join(await tempDir(), "config.toml");
    await saveConfig(sampleConfig(), file);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  test("leaves no *.tmp-* files behind on success", async () => {
    const dir = await tempDir();
    const file = join(dir, "config.toml");
    await saveConfig(sampleConfig(), file);
    const leftovers = (await readdir(dir)).filter((name) => name.includes(".tmp-"));
    expect(leftovers).toEqual([]);
  });

  test("overwrites an existing file", async () => {
    const file = join(await tempDir(), "config.toml");
    await saveConfig(sampleConfig(), file);
    const next = sampleConfig();
    next.time_format = "12h";
    next.refresh_minutes = 30;
    await saveConfig(next, file);
    const loaded = await loadConfig(file);
    expect(loaded.time_format).toBe("12h");
    expect(loaded.refresh_minutes).toBe(30);
  });

  test("round-trips locations, panels, and scalars exactly", async () => {
    const file = join(await tempDir(), "config.toml");
    const original = sampleConfig();
    await saveConfig(original, file);
    await expect(loadConfig(file)).resolves.toEqual(original);
  });

  test("round-trips a default-only config", async () => {
    const file = join(await tempDir(), "config.toml");
    const original = tuiConfigSchema.parse({ schema_version: 3 });
    await saveConfig(original, file);
    await expect(loadConfig(file)).resolves.toEqual(original);
  });

  test("round-trips the selected provider", async () => {
    const file = join(await tempDir(), "config.toml");
    const original = tuiConfigSchema.parse({ schema_version: 3, provider: "nws" });
    await saveConfig(original, file);
    const text = await readFile(file, "utf8");
    expect(text).toContain('provider = "nws"');
    await expect(loadConfig(file)).resolves.toEqual(original);
  });

  test("writes the units scalar when prefs are uniform and the full matrix otherwise", async () => {
    const uniformFile = join(await tempDir(), "uniform.toml");
    await saveConfig(tuiConfigSchema.parse({ schema_version: 3 }), uniformFile);
    const uniformText = await readFile(uniformFile, "utf8");
    expect(uniformText).toContain('units = "imperial"');
    expect(uniformText).not.toContain("[units]");

    const mixedFile = join(await tempDir(), "mixed.toml");
    await saveConfig(sampleConfig(), mixedFile);
    const mixedText = await readFile(mixedFile, "utf8");
    expect(mixedText).not.toMatch(/^units =/m);
    expect(mixedText).toContain("[units]");
    expect(mixedText).toContain('temp = "metric"');
    expect(mixedText).toContain('wind = "imperial"');
    const reloaded = await loadConfig(mixedFile);
    expect(reloaded.unit_prefs).toEqual(sampleConfig().unit_prefs);
  });

  test("refuses to persist a legacy version 1 document", async () => {
    const file = join(await tempDir(), "config.toml");
    const legacy = { ...sampleConfig(), schema_version: 1 } as unknown as TuiConfig;
    await expect(saveConfig(legacy, file)).rejects.toThrow();
  });

  test("places bare keys before [panels] and [[locations]] headers", async () => {
    const file = join(await tempDir(), "config.toml");
    await saveConfig(
      tuiConfigSchema.parse({
        schema_version: 3,
        default_location: "portland",
        locations: [{ slug: "portland", label: "Portland", latitude: 0, longitude: 0 }],
      }),
      file,
    );
    const text = await readFile(file, "utf8");
    expect(text.match(/^schema_version = 3$/m)).not.toBeNull();
    const schemaAt = text.indexOf("schema_version");
    const unitsAt = text.indexOf("units =");
    const timeAt = text.indexOf("time_format");
    const daysAt = text.indexOf("daily_days");
    const hoursAt = text.indexOf("hourly_hours");
    const panelsAt = text.indexOf("[panels]");
    const locationsAt = text.indexOf("[[locations]]");
    for (const at of [timeAt, unitsAt, daysAt, hoursAt]) expect(at).toBeGreaterThan(schemaAt);
    expect(panelsAt).toBeGreaterThan(hoursAt);
    expect(locationsAt).toBeGreaterThan(panelsAt);
  });

  test("keeps the [units] table header ahead of [panels]", async () => {
    const file = join(await tempDir(), "config.toml");
    await saveConfig(sampleConfig(), file);
    const text = await readFile(file, "utf8");
    const unitsTableAt = text.indexOf("[units]");
    const hoursAt = text.indexOf("hourly_hours");
    const panelsAt = text.indexOf("[panels]");
    const locationsAt = text.indexOf("[[locations]]");
    expect(unitsTableAt).toBeGreaterThan(hoursAt);
    expect(panelsAt).toBeGreaterThan(unitsTableAt);
    expect(locationsAt).toBeGreaterThan(panelsAt);
  });
});

describe("loadConfig", () => {
  test("returns DEFAULT_CONFIG when the file is missing", async () => {
    const file = join(await tempDir(), "does-not-exist.toml");
    await expect(loadConfig(file)).resolves.toEqual(DEFAULT_CONFIG);
  });

  test("wraps malformed TOML in ConfigError with the path", async () => {
    const file = join(await tempDir(), "broken.toml");
    await writeFile(file, "[unclosed\n");
    const error = await expectConfigError(loadConfig(file));
    expect(error.message).toContain("invalid TOML");
    expect(error.message).toContain(file);
  });

  test("malformed TOML error does not echo file contents", async () => {
    const file = join(await tempDir(), "secret-ish.toml");
    await writeFile(file, 'api_key = "super-secret-value"\n[[unclosed\n');
    const error = await expectConfigError(loadConfig(file));
    expect(error.message).not.toContain("super-secret-value");
  });

  test("rejects unsupported schema_version with issues", async () => {
    const file = join(await tempDir(), "future.toml");
    await writeFile(file, "schema_version = 99\n");
    const error = await expectConfigError(loadConfig(file));
    expect(error.issues.length).toBeGreaterThan(0);
    expect(error.issues.some((issue) => issue.includes("schema_version"))).toBe(true);
  });

  test("hints about bare-key ordering when root fields are missing", async () => {
    const file = join(await tempDir(), "tables-first.toml");
    await writeFile(file, '[[locations]]\nslug = "x"\nlabel = "X"\nlatitude = 0\nlongitude = 0\n');
    const error = await expectConfigError(loadConfig(file));
    expect(error.issues.some((issue) => issue.startsWith("hint:"))).toBe(true);
  });

  test("honors XDG_CONFIG_HOME", async () => {
    const cfgHome = join(await tempDir(), "xdg-config");
    await mkdir(join(cfgHome, "tuiweather"), { recursive: true });
    await writeFile(
      join(cfgHome, "tuiweather", "config.toml"),
      'schema_version = 1\nunits = "metric"\n',
    );
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = cfgHome;
    try {
      const loaded = await loadConfig();
      expect(loaded.units).toBe("metric");
      expect(loaded.theme).toBe("auto");
    } finally {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
    }
  });
});
