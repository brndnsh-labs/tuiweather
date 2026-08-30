import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDefaultSlug } from "../../src/app/store";
import { ConfigError } from "../../src/lib/config/errors";
import { loadConfig } from "../../src/lib/config/load";
import { SCHEMA_VERSION, tuiConfigSchema } from "../../src/lib/config/schema";

const tempDirs: string[] = [];

afterAll(async () => {
  for (const dir of tempDirs) await rm(dir, { recursive: true, force: true });
});

async function configFromText(text: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "tuiweather-load-detail-"));
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

describe("loadConfig error details", () => {
  test("multi-issue config message contains at least first 2 issue lines", async () => {
    const file = await configFromText(
      "schema_version = 3\nrefresh_minutes = 0\ndaily_days = 99\nhourly_hours = 99\n",
    );
    const error = await expectConfigError(loadConfig(file));
    expect(error.issues.length).toBeGreaterThanOrEqual(3);
    expect(error.message).toContain("issue(s)");
    expect(error.message).toContain("refresh_minutes");
    expect(error.message).toContain("daily_days");
    for (const line of error.issues.slice(0, 2)) {
      expect(error.message).toContain(line.split(":")[0] ?? line);
    }
  });

  test("truncates preview after 3 with more indicator", async () => {
    const file = await configFromText(
      'schema_version = 3\nrefresh_minutes = 0\ndaily_days = 99\nhourly_hours = 99\ntheme = "bad"\n',
    );
    const error = await expectConfigError(loadConfig(file));
    expect(error.issues.length).toBeGreaterThan(3);
    expect(error.message).toContain("... and");
    expect(error.message).toContain("more");
  });

  test("hint still appears in issues and in message when relevant", async () => {
    const file = await configFromText(
      '[[locations]]\nslug = "x"\nlabel = "X"\nlatitude = 0\nlongitude = 0\n',
    );
    const error = await expectConfigError(loadConfig(file));
    expect(error.issues.some((issue) => issue.startsWith("hint:"))).toBe(true);
    expect(error.message).toContain("hint:");
  });

  test("stale default_location now loads successfully", async () => {
    const file = await configFromText(
      'schema_version = 3\ndefault_location = "ghost"\n[[locations]]\nslug = "portland"\nlabel = "Portland"\nlatitude = 45.52\nlongitude = -122.67\n',
    );
    const cfg = await loadConfig(file);
    expect(cfg.default_location).toBe("ghost");
    expect(cfg.locations[0]?.slug).toBe("portland");
  });

  test("stale default_location with multiple locations loads", async () => {
    const file = await configFromText(
      'schema_version = 3\ndefault_location = "deleted"\n[[locations]]\nslug = "portland"\nlabel = "Portland"\nlatitude = 0\nlongitude = 0\n[[locations]]\nslug = "oslo"\nlabel = "Oslo"\nlatitude = 1\nlongitude = 1\n',
    );
    const cfg = await loadConfig(file);
    expect(cfg.default_location).toBe("deleted");
    expect(cfg.locations).toHaveLength(2);
  });
});

describe("stale default_location fallback", () => {
  test("resolveDefaultSlug falls back to first location when default is stale", () => {
    const cfg = tuiConfigSchema.parse({
      schema_version: SCHEMA_VERSION,
      default_location: "ghost",
      locations: [
        { slug: "portland", label: "Portland", latitude: 0, longitude: 0 },
        { slug: "oslo", label: "Oslo", latitude: 1, longitude: 1 },
      ],
    });
    expect(resolveDefaultSlug(cfg)).toBe("portland");
  });

  test("resolveDefaultSlug honors explicit slug over stale default", () => {
    const cfg = tuiConfigSchema.parse({
      schema_version: SCHEMA_VERSION,
      default_location: "ghost",
      locations: [
        { slug: "portland", label: "Portland", latitude: 0, longitude: 0 },
        { slug: "oslo", label: "Oslo", latitude: 1, longitude: 1 },
      ],
    });
    expect(resolveDefaultSlug(cfg, "oslo")).toBe("oslo");
  });

  test("resolveDefaultSlug returns null when no locations", () => {
    const cfg = tuiConfigSchema.parse({
      schema_version: SCHEMA_VERSION,
      default_location: "ghost",
    });
    expect(resolveDefaultSlug(cfg)).toBeNull();
  });

  test("loadConfig with zero locations and stale default is allowed (onboarding path)", async () => {
    const file = await configFromText('schema_version = 3\ndefault_location = "ghost"\n');
    const cfg = await loadConfig(file);
    expect(cfg.default_location).toBe("ghost");
    expect(cfg.locations).toEqual([]);
    expect(resolveDefaultSlug(cfg)).toBeNull();
  });
});
