import { z } from "zod";

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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

export const tuiConfigSchema = z
  .object({
    schema_version: z.literal(1),
    units: z.enum(["metric", "imperial"]).default("imperial"),
    refresh_minutes: z.number().int().min(1).default(10),
    theme: z.enum(["day", "night", "auto"]).default("auto"),
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
  });

export type TuiConfig = z.infer<typeof tuiConfigSchema>;

export const DEFAULT_CONFIG: TuiConfig = tuiConfigSchema.parse({ schema_version: 1 });
