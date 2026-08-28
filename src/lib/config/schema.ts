import { z } from "zod";
import { PROVIDER_IDS } from "../providers/types";
import type { Units } from "../weather/format";

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const SCHEMA_VERSION = 3;

export interface DisplayPrefs {
  temp: Units;
  wind: Units;
  precip: Units;
  pressure: Units;
  timeFormat: "12h" | "24h";
}

export const locationSchema = z.object({
  slug: z.string().regex(SLUG_PATTERN),
  label: z.string().min(1).max(80),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const panelsSchema = z.object({
  nowcast: z.boolean().default(true),
  details: z.boolean().default(true),
  hourly: z.boolean().default(true),
  daily: z.boolean().default(true),
});

const unitPref = z.enum(["metric", "imperial"]);
const unitPrefsShape = {
  temp: unitPref.optional(),
  wind: unitPref.optional(),
  precip: unitPref.optional(),
  pressure: unitPref.optional(),
};

export const tuiConfigSchema = z
  .object({
    schema_version: z.literal(SCHEMA_VERSION),
    units: unitPref.optional(),
    time_format: z.enum(["12h", "24h", "auto"]).default("auto"),
    unit_prefs: z.object(unitPrefsShape).prefault({}),
    refresh_minutes: z.number().int().min(1).default(10),
    theme: z.enum(["day", "night", "auto"]).default("auto"),
    provider: z.enum(PROVIDER_IDS).default("openmeteo"),
    daily_days: z.number().int().min(1).max(16).default(7),
    hourly_hours: z.number().int().min(12).max(48).default(24),
    panels: panelsSchema.prefault({}),
    default_location: z.string().optional(),
    locations: z.array(locationSchema).prefault([]),
  })
  .superRefine((config, ctx) => {
    const target = config.default_location;
    if (target === undefined) return;
    if (!config.locations.some((loc) => loc.slug === target)) {
      ctx.addIssue({
        code: "custom",
        message: `default_location "${target}" does not match any [[locations]] slug`,
      });
    }
  })
  .transform((config) => {
    const legacy = config.units;
    const unit_prefs = {
      temp: config.unit_prefs.temp ?? legacy ?? "imperial",
      wind: config.unit_prefs.wind ?? legacy ?? "imperial",
      precip: config.unit_prefs.precip ?? legacy ?? "imperial",
      pressure: config.unit_prefs.pressure ?? legacy ?? "imperial",
    };
    return { ...config, units: unit_prefs.temp, unit_prefs };
  });

export type TuiConfig = z.infer<typeof tuiConfigSchema>;

export const DEFAULT_CONFIG: TuiConfig = tuiConfigSchema.parse({ schema_version: SCHEMA_VERSION });

export function resolveDisplayPrefs(config: TuiConfig): DisplayPrefs {
  return {
    temp: config.unit_prefs.temp,
    wind: config.unit_prefs.wind,
    precip: config.unit_prefs.precip,
    pressure: config.unit_prefs.pressure,
    timeFormat:
      config.time_format === "auto"
        ? config.unit_prefs.temp === "imperial"
          ? "12h"
          : "24h"
        : config.time_format,
  };
}

/** Accepts a stored document at any historical version and returns a validated current-version config. */
export function migrateConfig(raw: unknown): TuiConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return tuiConfigSchema.parse(raw);
  }
  const doc: Record<string, unknown> = { ...raw };
  const version = (raw as { schema_version?: unknown }).schema_version;
  // v1 predates the [units] table; v2 predates the `provider` key. Both are
  // upgraded in place, relying on schema defaults for the added fields.
  if (version === 1 || version === 2) {
    doc.schema_version = SCHEMA_VERSION;
  }
  // A [units] table parses under the `units` key; fold it into unit_prefs so
  // the legacy scalar slot only ever holds the metric/imperial string.
  const unitsField = doc.units;
  if (typeof unitsField === "object" && unitsField !== null) {
    const table = unitsField as Record<string, unknown>;
    const existing =
      typeof doc.unit_prefs === "object" && doc.unit_prefs !== null
        ? (doc.unit_prefs as Record<string, unknown>)
        : {};
    doc.unit_prefs = { ...table, ...existing };
    delete doc.units;
  }
  return tuiConfigSchema.parse(doc);
}
