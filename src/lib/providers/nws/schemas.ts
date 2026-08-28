import { z } from "zod";

export const OFFSET_ISO_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const offsetIsoTime = z.string().regex(OFFSET_ISO_TIME);

export const quantityValueSchema = z.object({
  unitCode: z.string().optional(),
  value: z.number().nullable().optional(),
});

export const pointsResponseSchema = z.object({
  properties: z.object({
    cwa: z.string(),
    gridId: z.string(),
    gridX: z.number().int(),
    gridY: z.number().int(),
    forecast: z.string(),
    forecastHourly: z.string(),
    observationStations: z.string(),
    timeZone: z.string(),
  }),
});

export const periodSchema = z.object({
  number: z.number().int(),
  name: z.string(),
  startTime: offsetIsoTime,
  endTime: offsetIsoTime,
  isDaytime: z.boolean(),
  temperature: z.number(),
  temperatureUnit: z.string(),
  probabilityOfPrecipitation: quantityValueSchema.optional(),
  dewpoint: quantityValueSchema.optional(),
  relativeHumidity: quantityValueSchema.optional(),
  windSpeed: z.string(),
  windDirection: z.string(),
  icon: z.string(),
  shortForecast: z.string(),
  detailedForecast: z.string().optional(),
});

export const forecastResponseSchema = z.object({
  properties: z.object({
    units: z.string().optional(),
    periods: z.array(periodSchema),
  }),
});

export const stationsResponseSchema = z.object({
  features: z.array(z.object({ id: z.string() })),
});

export const observationResponseSchema = z.object({
  properties: z.object({
    timestamp: offsetIsoTime,
    textDescription: z.string(),
    icon: z.string().optional(),
    temperature: quantityValueSchema,
    dewpoint: quantityValueSchema.optional(),
    relativeHumidity: quantityValueSchema.optional(),
    windDirection: quantityValueSchema.optional(),
    windSpeed: quantityValueSchema.optional(),
    windGust: quantityValueSchema.optional(),
    barometricPressure: quantityValueSchema.optional(),
    seaLevelPressure: quantityValueSchema.optional(),
    visibility: quantityValueSchema.optional(),
    heatIndex: quantityValueSchema.optional(),
    windChill: quantityValueSchema.optional(),
  }),
});

export const nwsProblemSchema = z.object({
  type: z.string().optional(),
  title: z.string().optional(),
  status: z.number().optional(),
  detail: z.string().optional(),
});

export type NwsQuantity = z.infer<typeof quantityValueSchema>;
export type NwsPointsProperties = z.infer<typeof pointsResponseSchema>["properties"];
export type NwsPeriod = z.infer<typeof periodSchema>;
export type NwsObservationProperties = z.infer<typeof observationResponseSchema>["properties"];
