import { describe, expect, test } from "bun:test";
import {
  DEFAULT_CONFIG,
  migrateConfig,
  resolveDisplayPrefs,
  SCHEMA_VERSION,
  type TuiConfig,
  tuiConfigSchema,
} from "../../src/lib/config/schema";

const base = { schema_version: SCHEMA_VERSION } as const;

function location(slug: string) {
  return { slug, label: "L", latitude: 0, longitude: 0 };
}

function rejects(data: unknown): void {
  expect(tuiConfigSchema.safeParse(data).success).toBe(false);
}

describe("tuiConfigSchema", () => {
  test("empty document applies all defaults", () => {
    const cfg = tuiConfigSchema.parse(base);
    expect(cfg.units).toBe("imperial");
    expect(cfg.time_format).toBe("auto");
    expect(cfg.unit_prefs).toEqual({
      temp: "imperial",
      wind: "imperial",
      precip: "imperial",
      pressure: "imperial",
    });
    expect(cfg.refresh_minutes).toBe(10);
    expect(cfg.theme).toBe("auto");
    expect(cfg.ink).toBe("auto");
    expect(cfg.daily_days).toBe(7);
    expect(cfg.hourly_hours).toBe(24);
    expect(cfg.panels).toEqual({ nowcast: true, details: true, hourly: true, daily: true });
    expect(cfg.locations).toEqual([]);
  });

  test("DEFAULT_CONFIG matches parsed defaults at current version", () => {
    expect(DEFAULT_CONFIG).toEqual(tuiConfigSchema.parse(base));
    expect(DEFAULT_CONFIG.schema_version).toBe(SCHEMA_VERSION);
    expect(DEFAULT_CONFIG.provider).toBe("openmeteo");
    expect(DEFAULT_CONFIG.ink).toBe("auto");
    expect(DEFAULT_CONFIG.locations).toEqual([]);
  });

  test("full valid document parses verbatim", () => {
    const cfg = tuiConfigSchema.parse({
      schema_version: SCHEMA_VERSION,
      time_format: "24h",
      unit_prefs: { temp: "metric", wind: "imperial", precip: "metric", pressure: "metric" },
      refresh_minutes: 5,
      theme: "day",
      ink: "light",
      daily_days: 10,
      hourly_hours: 36,
      panels: { nowcast: false, details: true, hourly: false, daily: true },
      default_location: "portland",
      locations: [
        { slug: "portland", label: "Portland, OR", latitude: 45.5202, longitude: -122.6742 },
        { slug: "oslo", label: "Oslo, Norway", latitude: 59.9139, longitude: 10.7522 },
      ],
    });
    expect(cfg.time_format).toBe("24h");
    expect(cfg.unit_prefs.temp).toBe("metric");
    expect(cfg.unit_prefs.wind).toBe("imperial");
    expect(cfg.refresh_minutes).toBe(5);
    expect(cfg.theme).toBe("day");
    expect(cfg.ink).toBe("light");
    expect(cfg.daily_days).toBe(10);
    expect(cfg.hourly_hours).toBe(36);
    expect(cfg.panels.nowcast).toBe(false);
    expect(cfg.panels.hourly).toBe(false);
    expect(cfg.default_location).toBe("portland");
    expect(cfg.locations).toHaveLength(2);
  });

  test("partial unit prefs fall back per-field to the legacy units scalar", () => {
    const cfg = tuiConfigSchema.parse({
      ...base,
      units: "metric",
      unit_prefs: { wind: "imperial" },
    });
    expect(cfg.unit_prefs.temp).toBe("metric");
    expect(cfg.unit_prefs.wind).toBe("imperial");
    expect(cfg.unit_prefs.precip).toBe("metric");
    expect(cfg.unit_prefs.pressure).toBe("metric");
  });

  test("a fully absent matrix derives every field and the scalar from temp", () => {
    const cfg = tuiConfigSchema.parse({ ...base, unit_prefs: { temp: "metric" } });
    expect(cfg.units).toBe("metric");
    expect(cfg.unit_prefs.wind).toBe("imperial");
  });

  test("partial panels inherit defaults", () => {
    const cfg = tuiConfigSchema.parse({ ...base, panels: { hourly: false } });
    expect(cfg.panels).toEqual({ nowcast: true, details: true, hourly: false, daily: true });
  });

  test("rejects bad units, time_format, and theme", () => {
    rejects({ ...base, units: "kelvin" });
    rejects({ ...base, time_format: "sunrise" });
    rejects({ ...base, unit_prefs: { temp: "kelvin" } });
    rejects({ ...base, theme: "system" });
  });

  test("ink defaults to auto and accepts light/dark", () => {
    expect(tuiConfigSchema.parse(base).ink).toBe("auto");
    expect(tuiConfigSchema.parse({ ...base, ink: "light" }).ink).toBe("light");
    expect(tuiConfigSchema.parse({ ...base, ink: "dark" }).ink).toBe("dark");
    expect(tuiConfigSchema.parse({ ...base, ink: "auto" }).ink).toBe("auto");
  });

  test("rejects invalid ink values", () => {
    rejects({ ...base, ink: "system" });
    rejects({ ...base, ink: "" });
    rejects({ ...base, ink: 1 });
    rejects({ ...base, ink: "LIGHT" });
  });

  test("provider defaults to openmeteo and accepts the known ids", () => {
    expect(tuiConfigSchema.parse(base).provider).toBe("openmeteo");
    expect(tuiConfigSchema.parse({ ...base, provider: "nws" }).provider).toBe("nws");
    expect(tuiConfigSchema.parse({ ...base, provider: "openmeteo" }).provider).toBe("openmeteo");
    rejects({ ...base, provider: "meteosource" });
    rejects({ ...base, provider: 1 });
  });

  test("rejects schema_version other than current", () => {
    rejects({ schema_version: SCHEMA_VERSION - 1 });
    rejects({ schema_version: "4" });
    rejects({});
    rejects({ schema_version: SCHEMA_VERSION + 1 });
  });

  test("rejects out-of-range daily_days", () => {
    for (const days of [-1, 0, 17]) rejects({ ...base, daily_days: days });
  });

  test("accepts boundary daily_days", () => {
    expect(tuiConfigSchema.parse({ ...base, daily_days: 1 }).daily_days).toBe(1);
    expect(tuiConfigSchema.parse({ ...base, daily_days: 16 }).daily_days).toBe(16);
  });

  test("rejects out-of-range hourly_hours", () => {
    for (const hours of [11, 49, 0, -24]) rejects({ ...base, hourly_hours: hours });
  });

  test("accepts boundary hourly_hours", () => {
    expect(tuiConfigSchema.parse({ ...base, hourly_hours: 12 }).hourly_hours).toBe(12);
    expect(tuiConfigSchema.parse({ ...base, hourly_hours: 48 }).hourly_hours).toBe(48);
  });

  test("rejects non-integer or non-positive refresh_minutes", () => {
    rejects({ ...base, refresh_minutes: 0 });
    rejects({ ...base, refresh_minutes: 1.5 });
    rejects({ ...base, refresh_minutes: -5 });
    expect(tuiConfigSchema.parse({ ...base, refresh_minutes: 1 }).refresh_minutes).toBe(1);
  });

  test("rejects invalid slugs", () => {
    for (const slug of ["Portland!", "-x", "x-", "a--b", "", "new york", "Port"]) {
      rejects({ ...base, locations: [location(slug)] });
    }
  });

  test("accepts kebab-case slugs", () => {
    for (const slug of ["portland", "a", "a1", "new-york-city", "a1-b2-c3"]) {
      expect(tuiConfigSchema.safeParse({ ...base, locations: [location(slug)] }).success).toBe(
        true,
      );
    }
  });

  test("enforces label length limits", () => {
    rejects({ ...base, locations: [{ slug: "x", label: "", latitude: 0, longitude: 0 }] });
    const maxLabel = "a".repeat(80);
    expect(
      tuiConfigSchema.safeParse({
        ...base,
        locations: [{ slug: "x", label: maxLabel, latitude: 0, longitude: 0 }],
      }).success,
    ).toBe(true);
    rejects({
      ...base,
      locations: [{ slug: "x", label: `${maxLabel}a`, latitude: 0, longitude: 0 }],
    });
  });

  test("rejects out-of-range coordinates", () => {
    rejects({ ...base, locations: [{ ...location("x"), latitude: 90.0001 }] });
    rejects({ ...base, locations: [{ ...location("x"), latitude: -90.0001 }] });
    rejects({ ...base, locations: [{ ...location("x"), longitude: 180.5 }] });
    rejects({ ...base, locations: [{ ...location("x"), longitude: -181 }] });
    expect(
      tuiConfigSchema.safeParse({
        ...base,
        locations: [{ ...location("x"), latitude: 90, longitude: -180 }],
      }).success,
    ).toBe(true);
  });

  test("allows dangling default_location — stale value survives and falls back at runtime", () => {
    const cfg = tuiConfigSchema.parse({
      ...base,
      default_location: "nowhere",
      locations: [location("portland")],
    });
    expect(cfg.default_location).toBe("nowhere");
    expect(tuiConfigSchema.parse({ ...base, default_location: "nowhere" }).default_location).toBe(
      "nowhere",
    );
  });

  test("accepts default_location matching a location slug", () => {
    const cfg = tuiConfigSchema.parse({
      ...base,
      default_location: "portland",
      locations: [location("portland")],
    });
    expect(cfg.default_location).toBe("portland");
  });
});

describe("resolveDisplayPrefs", () => {
  test("auto follows imperial temperature to a 12h clock", () => {
    const prefs = resolveDisplayPrefs(tuiConfigSchema.parse(base));
    expect(prefs).toEqual({
      temp: "imperial",
      wind: "imperial",
      precip: "imperial",
      pressure: "imperial",
      timeFormat: "12h",
    });
  });

  test("auto follows metric temperature to a 24h clock", () => {
    const prefs = resolveDisplayPrefs(tuiConfigSchema.parse({ ...base, units: "metric" }));
    expect(prefs.timeFormat).toBe("24h");
    expect(prefs.temp).toBe("metric");
  });

  test("explicit time_format wins over auto derivation", () => {
    const imperial24 = resolveDisplayPrefs(
      tuiConfigSchema.parse({ ...base, units: "imperial", time_format: "24h" }),
    );
    expect(imperial24.timeFormat).toBe("24h");
    const metric12 = resolveDisplayPrefs(
      tuiConfigSchema.parse({ ...base, units: "metric", time_format: "12h" }),
    );
    expect(metric12.timeFormat).toBe("12h");
  });

  test("mixed prefs pass through untouched", () => {
    const prefs = resolveDisplayPrefs(
      tuiConfigSchema.parse({
        ...base,
        unit_prefs: { temp: "metric", wind: "imperial", precip: "metric", pressure: "imperial" },
      }),
    );
    expect(prefs).toEqual({
      temp: "metric",
      wind: "imperial",
      precip: "metric",
      pressure: "imperial",
      timeFormat: "24h",
    });
  });
});

describe("migrateConfig", () => {
  test("promotes a v1 document to current with derived defaults and openmeteo provider", () => {
    const cfg = migrateConfig({ schema_version: 1, units: "metric" });
    expect(cfg.schema_version).toBe(SCHEMA_VERSION);
    expect(cfg.provider).toBe("openmeteo");
    expect(cfg.ink).toBe("auto");
    expect(cfg.units).toBe("metric");
    expect(cfg.unit_prefs).toEqual({
      temp: "metric",
      wind: "metric",
      precip: "metric",
      pressure: "metric",
    });
    expect(cfg.time_format).toBe("auto");
  });

  test("promotes a v2 document to current, defaulting the provider", () => {
    const cfg = migrateConfig({
      schema_version: 2,
      theme: "night",
      default_location: "oslo",
      locations: [location("oslo")],
    });
    expect(cfg.schema_version).toBe(SCHEMA_VERSION);
    expect(cfg.provider).toBe("openmeteo");
    expect(cfg.ink).toBe("auto");
    expect(cfg.theme).toBe("night");
    expect(cfg.locations.map((loc) => loc.slug)).toEqual(["oslo"]);
  });

  test("promotes a v3 document to current, defaulting ink to auto", () => {
    const cfg = migrateConfig({
      schema_version: 3,
      theme: "day",
    });
    expect(cfg.schema_version).toBe(SCHEMA_VERSION);
    expect(cfg.ink).toBe("auto");
    expect(cfg.theme).toBe("day");
  });

  test("explicit partial overrides win over derived legacy values", () => {
    const cfg = migrateConfig({
      schema_version: 1,
      units: "imperial",
      unit_prefs: { temp: "metric", precip: "metric" },
    });
    expect(cfg.unit_prefs.temp).toBe("metric");
    expect(cfg.unit_prefs.wind).toBe("imperial");
    expect(cfg.unit_prefs.precip).toBe("metric");
    expect(cfg.unit_prefs.pressure).toBe("imperial");
  });

  test("still validates the migrated document", () => {
    expect(() => migrateConfig({ schema_version: 1, units: "kelvin" })).toThrow();
    expect(() => migrateConfig({ schema_version: 1, daily_days: 99 })).toThrow();
    expect(() => migrateConfig({ schema_version: 2, provider: "nope" })).toThrow();
    expect(() => migrateConfig({ schema_version: 3, ink: "nope" })).toThrow();
  });

  test("passes current-version documents through unchanged", () => {
    const cfg = migrateConfig({ ...base, time_format: "12h", ink: "light" });
    expect(cfg.time_format).toBe("12h");
    expect(cfg.ink).toBe("light");
  });

  test("parsed output re-parses idempotently", () => {
    const cfg: TuiConfig = migrateConfig({
      schema_version: 1,
      units: "metric",
      default_location: "oslo",
      locations: [location("oslo")],
    });
    expect(tuiConfigSchema.parse(cfg)).toEqual(cfg);
  });
});
