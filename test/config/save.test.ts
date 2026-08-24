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
    schema_version: 1,
    units: "metric",
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

  test("final file mode is 0600", async () => {
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
    next.units = "imperial";
    next.refresh_minutes = 30;
    await saveConfig(next, file);
    const loaded = await loadConfig(file);
    expect(loaded.units).toBe("imperial");
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
    const original = tuiConfigSchema.parse({ schema_version: 1 });
    await saveConfig(original, file);
    await expect(loadConfig(file)).resolves.toEqual(original);
  });

  test("places bare keys before [panels] and [[locations]] headers", async () => {
    const file = join(await tempDir(), "config.toml");
    await saveConfig(sampleConfig(), file);
    const text = await readFile(file, "utf8");
    expect(text.match(/^schema_version = 1$/m)).not.toBeNull();
    const schemaAt = text.indexOf("schema_version");
    const unitsAt = text.indexOf("units =");
    const daysAt = text.indexOf("daily_days");
    const hoursAt = text.indexOf("hourly_hours");
    const panelsAt = text.indexOf("[panels]");
    const locationsAt = text.indexOf("[[locations]]");
    for (const at of [unitsAt, daysAt, hoursAt]) expect(at).toBeGreaterThan(schemaAt);
    expect(panelsAt).toBeGreaterThan(hoursAt);
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
    await writeFile(file, "schema_version = 2\n");
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
