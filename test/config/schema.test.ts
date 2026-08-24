import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, tuiConfigSchema } from "../../src/lib/config/schema";

const base = { schema_version: 1 };

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
    expect(cfg.refresh_minutes).toBe(10);
    expect(cfg.theme).toBe("auto");
    expect(cfg.daily_days).toBe(7);
    expect(cfg.hourly_hours).toBe(24);
    expect(cfg.panels).toEqual({ nowcast: true, details: true, hourly: true, daily: true });
    expect(cfg.locations).toEqual([]);
  });

  test("DEFAULT_CONFIG matches parsed defaults", () => {
    expect(DEFAULT_CONFIG).toEqual(tuiConfigSchema.parse(base));
    expect(DEFAULT_CONFIG.locations).toEqual([]);
  });

  test("full valid document parses verbatim", () => {
    const cfg = tuiConfigSchema.parse({
      schema_version: 1,
      units: "metric",
      refresh_minutes: 5,
      theme: "day",
      daily_days: 10,
      hourly_hours: 36,
      panels: { nowcast: false, details: true, hourly: false, daily: true },
      default_location: "portland",
      locations: [
        { slug: "portland", label: "Portland, OR", latitude: 45.5202, longitude: -122.6742 },
        { slug: "oslo", label: "Oslo, Norway", latitude: 59.9139, longitude: 10.7522 },
      ],
    });
    expect(cfg.units).toBe("metric");
    expect(cfg.refresh_minutes).toBe(5);
    expect(cfg.theme).toBe("day");
    expect(cfg.daily_days).toBe(10);
    expect(cfg.hourly_hours).toBe(36);
    expect(cfg.panels.nowcast).toBe(false);
    expect(cfg.panels.hourly).toBe(false);
    expect(cfg.default_location).toBe("portland");
    expect(cfg.locations).toHaveLength(2);
  });

  test("partial panels inherit defaults", () => {
    const cfg = tuiConfigSchema.parse({ ...base, panels: { hourly: false } });
    expect(cfg.panels).toEqual({ nowcast: true, details: true, hourly: false, daily: true });
  });

  test("rejects bad units and theme", () => {
    rejects({ ...base, units: "kelvin" });
    rejects({ ...base, theme: "system" });
  });

  test("rejects schema_version other than 1", () => {
    rejects({ schema_version: 2 });
    rejects({ schema_version: "1" });
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

  test("rejects dangling default_location and names the slug in the error", () => {
    const result = tuiConfigSchema.safeParse({ ...base, default_location: "nowhere" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message).join("\n");
      expect(messages).toContain("nowhere");
    }
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
