import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/lib/config/load";
import { saveConfig } from "../../src/lib/config/save";
import { SCHEMA_VERSION, tuiConfigSchema } from "../../src/lib/config/schema";

describe("reduced_motion config", () => {
  test("defaults to false when absent", () => {
    const cfg = tuiConfigSchema.parse({ schema_version: SCHEMA_VERSION });
    expect(cfg.reduced_motion).toBe(false);
  });

  test("parses true and false", () => {
    expect(
      tuiConfigSchema.parse({ schema_version: SCHEMA_VERSION, reduced_motion: true })
        .reduced_motion,
    ).toBe(true);
    expect(
      tuiConfigSchema.parse({ schema_version: SCHEMA_VERSION, reduced_motion: false })
        .reduced_motion,
    ).toBe(false);
  });

  test("serializes and round-trips through saveConfig/loadConfig", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tuiweather-reduced-motion-"));
    try {
      const file = join(dir, "config.toml");
      const withTrue = tuiConfigSchema.parse({
        schema_version: SCHEMA_VERSION,
        reduced_motion: true,
      });
      await saveConfig(withTrue, file);
      const textTrue = await readFile(file, "utf8");
      expect(textTrue).toContain("reduced_motion = true");
      await expect(loadConfig(file)).resolves.toEqual(withTrue);

      const withFalse = tuiConfigSchema.parse({
        schema_version: SCHEMA_VERSION,
        reduced_motion: false,
      });
      await saveConfig(withFalse, file);
      const textFalse = await readFile(file, "utf8");
      expect(textFalse).toContain("reduced_motion = false");
      await expect(loadConfig(file)).resolves.toEqual(withFalse);

      const def = tuiConfigSchema.parse({ schema_version: SCHEMA_VERSION });
      await saveConfig(def, file);
      const textDef = await readFile(file, "utf8");
      expect(textDef).toContain("reduced_motion = false");
      await expect(loadConfig(file)).resolves.toEqual(def);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
