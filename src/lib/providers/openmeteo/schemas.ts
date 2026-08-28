import { z } from "zod";

export const LOCAL_NAIVE_TIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const localNaiveTime = z.string().regex(LOCAL_NAIVE_TIME);
const localDate = z.string().regex(LOCAL_DATE);
const numArray = z.array(z.number().nullable());
const strOrNullArray = z.array(z.string().nullable());
const isDayStep = z.union([z.number(), z.string()]);

export const apiErrorBodySchema = z.object({
  error: z.literal(true),
  reason: z.string().optional(),
});

const MAX_REASON_CHARS = 200;

function isControl(code: number): boolean {
  return code <= 0x1f || code === 0x7f;
}

export function sanitizedErrorReason(reason: string): string {
  let out = "";
  for (const ch of reason) {
    if (!isControl(ch.codePointAt(0) ?? 0)) out += ch;
  }
  return out.slice(0, MAX_REASON_CHARS);
}

export const currentBlockSchema = z.object({
  time: localNaiveTime,
  interval: z.number().optional(),
  temperature_2m: z.number(),
  relative_humidity_2m: z.number(),
  apparent_temperature: z.number(),
  is_day: isDayStep,
  precipitation: z.number().nullable(),
  weather_code: z.number(),
  cloud_cover: z.number().nullable(),
  pressure_msl: z.number().nullable(),
  wind_speed_10m: z.number(),
  wind_direction_10m: z.number(),
  wind_gusts_10m: z.number().nullable(),
  dew_point_2m: z.number().nullable(),
});

export const minutelyBlockSchema = z
  .object({
    time: z.array(localNaiveTime),
    precipitation: numArray,
    precipitation_probability: numArray.optional(),
  })
  .superRefine((block, ctx) => {
    const n = block.time.length;
    for (const [key, value] of Object.entries(block)) {
      if (Array.isArray(value) && value.length !== n) {
        ctx.addIssue({
          code: "custom",
          message: `minutely_15.${key}: ${value.length} entries vs ${n} time labels`,
        });
      }
    }
  });

export const hourlyBlockSchema = z
  .object({
    time: z.array(localNaiveTime),
    temperature_2m: numArray,
    relative_humidity_2m: numArray.optional(),
    apparent_temperature: numArray,
    precipitation: numArray,
    precipitation_probability: numArray.optional(),
    weather_code: numArray,
    wind_speed_10m: numArray,
    wind_direction_10m: numArray,
    wind_gusts_10m: numArray.optional(),
    uv_index: numArray.optional(),
    visibility: numArray.optional(),
    is_day: z.array(isDayStep),
  })
  .superRefine((block, ctx) => {
    const n = block.time.length;
    for (const [key, value] of Object.entries(block)) {
      if (Array.isArray(value) && value.length !== n) {
        ctx.addIssue({
          code: "custom",
          message: `hourly.${key}: ${value.length} entries vs ${n} time labels`,
        });
      }
    }
  });

export const dailyBlockSchema = z
  .object({
    time: z.array(localDate),
    weather_code: numArray,
    temperature_2m_max: numArray,
    temperature_2m_min: numArray,
    precipitation_sum: numArray,
    precipitation_probability_max: numArray.optional(),
    uv_index_max: numArray.optional(),
    sunrise: strOrNullArray.optional(),
    sunset: strOrNullArray.optional(),
    wind_speed_10m_max: numArray.optional(),
    wind_gusts_10m_max: numArray.optional(),
  })
  .superRefine((block, ctx) => {
    const n = block.time.length;
    for (const [key, value] of Object.entries(block)) {
      if (Array.isArray(value) && value.length !== n) {
        ctx.addIssue({
          code: "custom",
          message: `daily.${key}: ${value.length} entries vs ${n} time labels`,
        });
      }
    }
  });

export const forecastResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  generationtime_ms: z.number().optional(),
  utc_offset_seconds: z.number().int(),
  timezone: z.string(),
  timezone_abbreviation: z.string().optional(),
  elevation: z.number().optional(),
  current: currentBlockSchema,
  minutely_15: minutelyBlockSchema,
  hourly: hourlyBlockSchema,
  daily: dailyBlockSchema,
});

export const geocodingResultSchema = z.object({
  id: z.number(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  country: z.string().optional(),
  country_code: z.string().optional(),
  admin1: z.string().optional(),
  admin2: z.string().optional(),
  timezone: z.string().optional(),
  population: z.number().optional(),
  elevation: z.number().optional(),
});

export const geocodingResponseSchema = z.object({
  results: z.array(geocodingResultSchema).optional(),
  generationtime_ms: z.number(),
});

export type CurrentBlock = z.infer<typeof currentBlockSchema>;
export type MinutelyBlock = z.infer<typeof minutelyBlockSchema>;
export type HourlyBlock = z.infer<typeof hourlyBlockSchema>;
export type DailyBlock = z.infer<typeof dailyBlockSchema>;
export type ForecastResponse = z.infer<typeof forecastResponseSchema>;
